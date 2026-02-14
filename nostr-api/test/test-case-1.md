# テストケース1: GET /nostr/secret-key (デモエンドポイント)

x402で保護された秘密鍵取得エンドポイントのテストです。

## 前提条件

- 開発サーバーが起動していること (`npm run dev`)
- 親ディレクトリの `TESTING.md` に記載されている環境変数が設定されていること

## デフォルトテスト設定

このテストでは特にnpubは不要です（GETエンドポイント）。

---

## 1-1. 402 Payment Required レスポンスの確認

支払いなしで保護されたエンドポイントにアクセスします。

```bash
curl -i http://localhost:8787/nostr/secret-key
```

**期待される結果:**
```
HTTP/1.1 402 Payment Required
Content-Type: application/json
PAYMENT-REQUIRED: eyJ4NDAyVmVyc2lvbiI6Mi...

{"error":"Payment required"}
```

✅ **確認ポイント:**
- ステータスコードが `402 Payment Required`
- `PAYMENT-REQUIRED` ヘッダーが存在する
- レスポンスボディに `{"error":"Payment required"}` が含まれる

---

## 1-2. PAYMENT-REQUIREDヘッダーのデコード

```bash
# レスポンスからPAYMENT-REQUIREDヘッダーを抽出してデコード
PAYMENT_REQUIRED=$(curl -s -i http://localhost:8787/nostr/secret-key | grep -i "payment-required:" | cut -d' ' -f2 | tr -d '\r')

# デコードして確認
echo "$PAYMENT_REQUIRED" | base64 -d | jq .
```

**期待される出力:**
```json
{
  "x402Version": 2,
  "error": "Payment required",
  "resource": {
    "url": "http://localhost:8787/nostr/secret-key",
    "description": "Access to Nostr secret key",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "lightning",
      "network": "bitcoin",
      "amount": "100",
      "asset": "BTC",
      "maxTimeoutSeconds": 3600,
      "extra": {
        "invoice": "lnbc1..."
      }
    }
  ]
}
```

✅ **確認ポイント:**
- `x402Version` が `2`
- `resource` に `url`, `description`, `mimeType` が含まれる
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
curl -i http://localhost:8787/nostr/secret-key \
  -H "PAYMENT-SIGNATURE: $PAYMENT_PAYLOAD"
```

**期待される結果:**
```
HTTP/1.1 402 Payment Required
Content-Type: application/json
PAYMENT-RESPONSE: eyJzdWNjZXNzIjpmYWxzZS...

{"error":"Payment not confirmed"}
```

✅ **確認ポイント:**
- ステータスコードが `402 Payment Required`
- `PAYMENT-RESPONSE` ヘッダーに失敗レスポンスが含まれる
- レスポンスボディが `{"error":"Payment not confirmed"}`

---

## 1-6. PAYMENT-RESPONSEのデコード

```bash
PAYMENT_RESPONSE=$(curl -s -i http://localhost:8787/nostr/secret-key \
  -H "PAYMENT-SIGNATURE: $PAYMENT_PAYLOAD" | \
  grep -i "payment-response:" | cut -d' ' -f2 | tr -d '\r')

echo "$PAYMENT_RESPONSE" | base64 -d | jq .
```

**期待される出力:**
```json
{
  "success": false,
  "errorReason": "payment_not_confirmed",
  "network": "bitcoin"
}
```

---

## 1-7. 実際の支払い後の検証（オプション）

Lightning Walletでインボイスを支払った後、同じPAYMENT-SIGNATUREで再度アクセスします。

```bash
# Lightning Walletで$INVOICEを支払う
echo "Please pay this invoice with your Lightning Wallet:"
echo "$INVOICE"
echo ""
read -p "Press Enter after payment is complete..."

# 支払い後、同じPAYMENT-SIGNATUREで再度アクセス
curl -i http://localhost:8787/nostr/secret-key \
  -H "PAYMENT-SIGNATURE: $PAYMENT_PAYLOAD"
```

**期待される結果:**
```
HTTP/1.1 200 OK
Content-Type: application/json
PAYMENT-RESPONSE: eyJzdWNjZXNzIjp0cnVlL...

{"secretKey":"nsec1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}
```

✅ **確認ポイント:**
- ステータスコードが `200 OK`
- `PAYMENT-RESPONSE` ヘッダーに成功レスポンスが含まれる
- レスポンスボディに `secretKey` が含まれる

---

## 1-8. インボイスの再利用防止の確認

同じ支払い済みPAYMENT-SIGNATUREで再度アクセスします。

```bash
curl -i http://localhost:8787/nostr/secret-key \
  -H "PAYMENT-SIGNATURE: $PAYMENT_PAYLOAD"
```

**期待される結果:**
```
HTTP/1.1 402 Payment Required
Content-Type: application/json
PAYMENT-RESPONSE: eyJzdWNjZXNzIjpmYWxzZS...

{"error":"Invoice already used"}
```

✅ **確認ポイント:**
- ステータスコードが `402 Payment Required`
- レスポンスボディが `{"error":"Invoice already used"}`
- 同一インボイスの再利用が防止されている（Cloudflare KV）

---

## まとめ

このテストケースで確認できる項目：

### x402プロトコル（v2準拠）
1. ✅ 402 Payment Requiredレスポンスの生成
2. ✅ PAYMENT-REQUIREDヘッダー（resource, accepts配列）
3. ✅ PAYMENT-SIGNATUREヘッダー（x402 v2形式）
4. ✅ PAYMENT-RESPONSEヘッダー（success/failure settlement）
5. ✅ 支払い検証（coinos.io API連携）
6. ✅ インボイス再利用防止（Cloudflare KV）
7. ✅ インボイス有効期限チェック
8. ✅ 金額検証

### セキュリティ
1. ✅ 環境変数による秘密情報管理
2. ✅ インボイス重複チェック
3. ✅ 支払いハッシュ検証
