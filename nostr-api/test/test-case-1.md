# テストケース1: GET /test/uuid (デモエンドポイント)

x402で保護された UUID v4 生成エンドポイントのテストです。

## 前提条件

- 開発サーバーが起動していること (`npm run dev`)
- 親ディレクトリの `TESTING.md` に記載されている環境変数が設定されていること

## デフォルトテスト設定

このテストでは特にnpubは不要です（GETエンドポイント）。

---

## 1-1. 402 Payment Required レスポンスの確認

支払いなしで保護されたエンドポイントにアクセスします。

```bash
curl -i http://localhost:8787/test/uuid
```

**期待される結果:**
```
HTTP/1.1 402 Payment Required
Content-Type: application/json
PAYMENT-REQUIRED: eyJ4NDAyVmVyc2lvbiI6Mi...

{"error":"Payment required"}
```

確認ポイント:
- ステータスコードが `402 Payment Required`
- `PAYMENT-REQUIRED` ヘッダーが存在する
- レスポンスボディに `{"error":"Payment required"}` が含まれる

---

## 1-2. PAYMENT-REQUIREDヘッダーのデコード

```bash
# レスポンスからPAYMENT-REQUIREDヘッダーを抽出してデコード
PAYMENT_REQUIRED=$(curl -s -i http://localhost:8787/test/uuid | grep -i "payment-required:" | cut -d' ' -f2 | tr -d '\r')

# デコードして確認
echo "$PAYMENT_REQUIRED" | base64 -d | jq .
```

**期待される出力:**
```json
{
  "x402Version": 2,
  "error": "Payment required",
  "resource": {
    "url": "http://localhost:8787/test/uuid",
    "description": "Access to UUID v4 generator",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "bip122:000000000019d6689c085ae165831e93",
      "amount": "100000",
      "asset": "BTC",
      "payTo": "anonymous",
      "maxTimeoutSeconds": 3600,
      "extra": {
        "paymentMethod": "lightning",
        "invoice": "lnbc1..."
      }
    }
  ]
}
```

確認ポイント:
- `x402Version` が `2`
- `resource` に `url`, `description`, `mimeType` が含まれる
- `description` が "Access to UUID v4 generator"
- `accepts` 配列に Lightning支払い方法が含まれる
- `extra.invoice` に BOLT11 インボイスが含まれる

---

## 1-3. インボイスの抽出

```bash
# インボイスを変数に保存
INVOICE=$(echo "$PAYMENT_REQUIRED" | base64 -d | jq -r '.accepts[0].extra.invoice')
echo "Invoice: $INVOICE"
```

---

## 1-4. PAYMENT-SIGNATUREペイロードの作成

x402 v2形式のPAYMENT-SIGNATUREペイロードを作成します。

```bash
# PAYMENT-REQUIREDから必要な情報を抽出
RESOURCE=$(echo "$PAYMENT_REQUIRED" | base64 -d | jq -c '.resource')
ACCEPTED=$(echo "$PAYMENT_REQUIRED" | base64 -d | jq -c '.accepts[0] | del(.extra)')

# PAYMENT-SIGNATUREペイロードを作成
PAYMENT_PAYLOAD=$(jq -n \
  --argjson resource "$RESOURCE" \
  --argjson accepted "$ACCEPTED" \
  --arg invoice "$INVOICE" \
  '{
    x402Version: 2,
    resource: $resource,
    accepted: $accepted,
    payload: {
      invoice: $invoice
    }
  }' | base64 -w0)

echo "PAYMENT-SIGNATURE payload created"
```

---

## 1-5. 未払いインボイスでの支払い検証

```bash
curl -i http://localhost:8787/test/uuid \
  -H "PAYMENT-SIGNATURE: $PAYMENT_PAYLOAD"
```

**期待される結果:**
```
HTTP/1.1 402 Payment Required
Content-Type: application/json
PAYMENT-RESPONSE: eyJzdWNjZXNzIjpmYWxzZS...

{"error":"Payment not confirmed"}
```

確認ポイント:
- ステータスコードが `402 Payment Required`
- `PAYMENT-RESPONSE` ヘッダーに失敗レスポンスが含まれる
- レスポンスボディが `{"error":"Payment not confirmed"}`

---

## 1-6. PAYMENT-RESPONSEのデコード

```bash
PAYMENT_RESPONSE=$(curl -s -i http://localhost:8787/test/uuid \
  -H "PAYMENT-SIGNATURE: $PAYMENT_PAYLOAD" | \
  grep -i "payment-response:" | cut -d' ' -f2 | tr -d '\r')

echo "$PAYMENT_RESPONSE" | base64 -d | jq .
```

**期待される出力:**
```json
{
  "success": false,
  "errorReason": "payment_not_confirmed",
  "network": "lightning:bitcoin"
}
```

---

## 1-7. 実際の支払い後の検証（オプション）

Lightning Walletでインボイスを支払った後、バッジが発行されることを確認します。

**重要:** 実際の支払いテストを行う場合、インボイスを一時ファイルに保存する必要があります。これにより、ユーザーが支払ったインボイスと検証に使用するインボイスが同じであることを保証します。

### ステップ1: インボイスの取得と保存

```bash
# インボイスを取得して保存
PAYMENT_REQUIRED=$(curl -s -i http://localhost:8787/test/uuid | \
  grep -i "payment-required:" | cut -d' ' -f2 | tr -d '\r')
echo "$PAYMENT_REQUIRED" > test_invoice_payload.txt

INVOICE=$(echo "$PAYMENT_REQUIRED" | base64 -d | jq -r '.accepts[0].extra.invoice')
echo "$INVOICE" > test_invoice.txt
```

### ステップ2: 支払いの実行

```bash
echo "============================================"
echo "請求書 (Lightning Invoice)"
echo "============================================"
echo ""
echo "$INVOICE"
echo ""
echo "============================================"
echo "金額: 100 sats"
echo "有効期限: 1時間"
echo "============================================"
echo ""
read -p "Press Enter after payment is complete..."
```

### ステップ3: 支払い後の検証（保存したインボイスを使用）

```bash
# 保存したインボイスを使用して検証
PAYMENT_REQUIRED=$(cat test_invoice_payload.txt)
INVOICE=$(cat test_invoice.txt)
RESOURCE=$(echo "$PAYMENT_REQUIRED" | base64 -d | jq -c '.resource')
ACCEPTED=$(echo "$PAYMENT_REQUIRED" | base64 -d | jq -c '.accepts[0] | del(.extra)')

PAYMENT_PAYLOAD=$(jq -n \
  --argjson resource "$RESOURCE" \
  --argjson accepted "$ACCEPTED" \
  --arg invoice "$INVOICE" \
  '{
    x402Version: 2,
    resource: $resource,
    accepted: $accepted,
    payload: {
      invoice: $invoice
    }
  }' | base64 -w0)

curl -i http://localhost:8787/test/uuid \
  -H "PAYMENT-SIGNATURE: $PAYMENT_PAYLOAD"
```

**期待される結果:**
```
HTTP/1.1 200 OK
Content-Type: application/json
PAYMENT-RESPONSE: eyJzdWNjZXNzIjp0cnVlL...

{"uuid":"550e8400-e29b-41d4-a716-446655440000"}
```

確認ポイント:
- ステータスコードが `200 OK`
- `PAYMENT-RESPONSE` ヘッダーに成功レスポンスが含まれる
- レスポンスボディに `uuid` が含まれる（UUID v4形式）

**注意:** インボイスをファイルに保存せずに、毎回 `curl` で新しいインボイスを取得すると、ユーザーが支払ったインボイスと異なるものが使われてしまうため、必ずインボイスを保存してください。

---

## 1-8. インボイスの再利用防止の確認

保存したインボイスを使用して、インボイスの再利用が防止されていることを確認します。

```bash
# 保存したインボイスを再利用
PAYMENT_REQUIRED=$(cat test_invoice_payload.txt)
INVOICE=$(cat test_invoice.txt)
RESOURCE=$(echo "$PAYMENT_REQUIRED" | base64 -d | jq -c '.resource')
ACCEPTED=$(echo "$PAYMENT_REQUIRED" | base64 -d | jq -c '.accepts[0] | del(.extra)')

PAYMENT_PAYLOAD=$(jq -n \
  --argjson resource "$RESOURCE" \
  --argjson accepted "$ACCEPTED" \
  --arg invoice "$INVOICE" \
  '{
    x402Version: 2,
    resource: $resource,
    accepted: $accepted,
    payload: {
      invoice: $invoice
    }
  }' | base64 -w0)

curl -i http://localhost:8787/test/uuid \
  -H "PAYMENT-SIGNATURE: $PAYMENT_PAYLOAD"
```

**期待される結果:**
```
HTTP/1.1 402 Payment Required
Content-Type: application/json
PAYMENT-RESPONSE: eyJzdWNjZXNzIjpmYWxzZS...

{"error":"Invoice already used"}
```

確認ポイント:
- ステータスコードが `402 Payment Required`
- レスポンスボディが `{"error":"Invoice already used"}`
- 同一インボイスの再利用が防止されている（Cloudflare KV）

---

## まとめ

このテストケースで確認できる項目：

### x402プロトコル（v2準拠）
1. 402 Payment Requiredレスポンスの生成
2. PAYMENT-REQUIREDヘッダー（resource, accepts配列）
3. PAYMENT-SIGNATUREヘッダー（x402 v2形式）
4. PAYMENT-RESPONSEヘッダー（success/failure settlement）
5. 支払い検証（coinos.io API連携）
6. インボイス再利用防止（Cloudflare KV）
7. インボイス有効期限チェック
8. 金額検証

### セキュリティ
1. 環境変数による秘密情報管理
2. インボイス重複チェック
3. 支払いハッシュ検証
