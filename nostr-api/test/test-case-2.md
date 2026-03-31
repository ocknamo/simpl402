# テストケース2: POST /nostr/badge-challenge (NIP-58 Badge Award)

支払い後にNIP-58バッジを発行するエンドポイントのテストです。

## 前提条件

- 開発サーバーが起動していること (`npm run dev`)
- 親ディレクトリの `TESTING.md` に記載されている環境変数が設定されていること

## デフォルトテスト設定

```bash
# デフォルトのテスト用npub
TEST_NPUB="npub19dzc258s3l8ht547cktvqsgura8wj0ecyr02a9g6zgxq9r3scjqqqrg7sk"
```

**注意**: 以下のコマンド例では全て上記のデフォルトnpubを使用しています。

---

## 2-1. リクエストボディ検証（誤課金防止）

支払い前にリクエストボディが正しく検証されることを確認します。

### ケース A: npubフィールド欠落

```bash
curl -i http://localhost:8787/nostr/badge-challenge \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{}'
```

**期待される結果:**
```
HTTP/1.1 400 Bad Request
Content-Type: application/json

{"error":"Missing or invalid \"npub\" field in request body"}
```

✅ **確認ポイント:**
- ステータスコードが `400 Bad Request`
- **課金されていない**（402ではない）
- エラーメッセージが明確

---

### ケース B: 無効なnpub形式

```bash
curl -i http://localhost:8787/nostr/badge-challenge \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"npub": "invalid_npub"}'
```

**期待される結果:**
```
HTTP/1.1 400 Bad Request
Content-Type: application/json

{"error":"Invalid npub format. Must be a valid Nostr public key (npub1...)"}
```

✅ **確認ポイント:**
- ステータスコードが `400 Bad Request`
- **課金されていない**（402ではない）
- 支払い前に入力検証が実行されている

---

### ケース C: 無効なJSON

```bash
curl -i http://localhost:8787/nostr/badge-challenge \
  -X POST \
  -H "Content-Type: application/json" \
  -d 'invalid json'
```

**期待される結果:**
```
HTTP/1.1 400 Bad Request
Content-Type: application/json

{"error":"Invalid JSON in request body"}
```

✅ **確認ポイント:**
- ステータスコードが `400 Bad Request`
- **課金されていない**（402ではない）

---

## 2-2. 有効なnpubでの402レスポンス確認

有効なnpubを指定して、課金リクエストを受け取ります。

```bash
# デフォルトのテスト用npub
TEST_NPUB="npub19dzc258s3l8ht547cktvqsgura8wj0ecyr02a9g6zgxq9r3scjqqqrg7sk"

curl -i http://localhost:8787/nostr/badge-challenge \
  -X POST \
  -H "Content-Type: application/json" \
  -d "{\"npub\": \"$TEST_NPUB\"}"
```

**期待される結果:**
```
HTTP/1.1 402 Payment Required
Content-Type: application/json
PAYMENT-REQUIRED: eyJ4NDAyVmVyc2lvbiI6Mi...

{"error":"Payment required"}
```

✅ **確認ポイント:**
- リクエストボディ検証が**成功した後**に `402 Payment Required` が返る
- `PAYMENT-REQUIRED` ヘッダーが存在する

---

## 2-3. バッジチャレンジ用のPAYMENT-SIGNATUREを作成

```bash
# デフォルトのテスト用npub
TEST_NPUB="npub19dzc258s3l8ht547cktvqsgura8wj0ecyr02a9g6zgxq9r3scjqqqrg7sk"

# PAYMENT-REQUIREDヘッダーを取得
BADGE_PAYMENT_REQUIRED=$(curl -s -i http://localhost:8787/nostr/badge-challenge \
  -X POST \
  -H "Content-Type: application/json" \
  -d "{\"npub\": \"$TEST_NPUB\"}" | \
  grep -i "payment-required:" | cut -d' ' -f2 | tr -d '\r')

# インボイスを抽出
BADGE_INVOICE=$(echo "$BADGE_PAYMENT_REQUIRED" | base64 -d | jq -r '.accepts[0].extra.invoice')
echo "Badge Invoice: $BADGE_INVOICE"

# PAYMENT-SIGNATUREペイロードを作成
BADGE_RESOURCE=$(echo "$BADGE_PAYMENT_REQUIRED" | base64 -d | jq -c '.resource')
BADGE_ACCEPTED=$(echo "$BADGE_PAYMENT_REQUIRED" | base64 -d | jq -c '.accepts[0]')

BADGE_PAYMENT_PAYLOAD=$(jq -n \
  --argjson resource "$BADGE_RESOURCE" \
  --argjson accepted "$BADGE_ACCEPTED" \
  --arg invoice "$BADGE_INVOICE" \
  '{
    x402Version: 2,
    resource: $resource,
    accepted: $accepted,
    payload: {
      invoice: $invoice
    }
  }' | base64 -w0)

echo "Badge PAYMENT-SIGNATURE payload created"
```

---

## 2-4. 未払いインボイスでの検証

```bash
curl -i http://localhost:8787/nostr/badge-challenge \
  -X POST \
  -H "Content-Type: application/json" \
  -H "PAYMENT-SIGNATURE: $BADGE_PAYMENT_PAYLOAD" \
  -d "{\"npub\": \"$TEST_NPUB\"}"
```

**期待される結果:**
```
HTTP/1.1 402 Payment Required
Content-Type: application/json
PAYMENT-RESPONSE: eyJzdWNjZXNzIjpmYWxzZS...

{"error":"Payment not confirmed"}
```

✅ **確認ポイント:**
- 支払い未確認の場合、`402 Payment Required` が返る

---

## 2-5. 支払い後のバッジ発行確認

Lightning Walletでインボイスを支払った後、バッジが発行されることを確認します。

```bash
# Lightning Walletで$BADGE_INVOICEを支払う
echo "============================================"
echo "請求書 (Lightning Invoice)"
echo "============================================"
echo ""
echo "$BADGE_INVOICE"
echo ""
echo "============================================"
echo "金額: 100,000 millisats (100 sats)"
echo "有効期限: 1時間"
echo "============================================"
echo ""
read -p "Press Enter after payment is complete..."

# 支払い後、バッジ発行リクエスト
curl -i http://localhost:8787/nostr/badge-challenge \
  -X POST \
  -H "Content-Type: application/json" \
  -H "PAYMENT-SIGNATURE: $BADGE_PAYMENT_PAYLOAD" \
  -d "{\"npub\": \"$TEST_NPUB\"}"
```

**期待される結果:**
```
HTTP/1.1 200 OK
Content-Type: application/json
PAYMENT-RESPONSE: eyJzdWNjZXNzIjp0cnVlL...

{
  "success": true,
  "eventId": "abc123...",
  "message": "Badge awarded successfully"
}
```

✅ **確認ポイント:**
- ステータスコードが `200 OK`
- レスポンスに `success: true` が含まれる
- `eventId` が返される（NIP-58 Badge Award eventのID）
- `message` に成功メッセージが含まれる
- バックグラウンドでNostrリレーに公開される（`ctx.waitUntil`）

---

## 2-6. PAYMENT-RESPONSEの確認

```bash
BADGE_PAYMENT_RESPONSE=$(curl -s -i http://localhost:8787/nostr/badge-challenge \
  -X POST \
  -H "Content-Type: application/json" \
  -H "PAYMENT-SIGNATURE: $BADGE_PAYMENT_PAYLOAD" \
  -d "{\"npub\": \"$TEST_NPUB\"}" | \
  grep -i "payment-response:" | cut -d' ' -f2 | tr -d '\r')

echo "$BADGE_PAYMENT_RESPONSE" | base64 -d | jq .
```

**期待される出力（支払い成功時）:**
```json
{
  "success": true,
  "transaction": "lnbc1...",
  "network": "lightning:bitcoin",
  "payer": "anonymous",
  "extra": {
    "invoice": "lnbc1...",
    "settledAt": 1739116800
  }
}
```

**期待される出力（インボイス再利用時）:**
```json
{
  "success": false,
  "errorReason": "invoice_already_used",
  "network": "lightning:bitcoin"
}
```

---

## 2-7. バッジ発行イベントの確認

Nostrリレーでバッジアワードイベントが公開されているか確認します。

```bash
# ウェブソケット経由でリレーに問い合わせる（websocat等のツールが必要）
# または、Nostrクライアントで確認
# wss://yabu.me で kind:8 のイベントを確認
```

✅ **確認ポイント:**
- kind 8 (Badge Award) イベントが公開されている
- `a` タグに `30009:{issuer_pubkey}:ocknamo-test-0001` が含まれる
- `p` タグに受信者のpubkey (hex) が含まれる

---

## まとめ

このテストケースで確認できる項目：

### NIP-58 Badge Award
1. ✅ バッジアワードイベント（kind 8）の作成
2. ✅ イベント署名（バッジ発行者秘密鍵）
3. ✅ Nostrリレーへの公開（非同期、`ctx.waitUntil`）
4. ✅ npub形式のバリデーション

### 誤課金防止設計
1. ✅ リクエストボディの事前検証（支払い前）
2. ✅ 無効な入力でのエラーレスポンス（400 Bad Request）
3. ✅ 検証成功後のみ課金要求（402 Payment Required）

### x402プロトコル（v2準拠）
1. ✅ 402 Payment Requiredレスポンスの生成
2. ✅ PAYMENT-REQUIREDヘッダー（resource, accepts配列）
3. ✅ PAYMENT-SIGNATUREヘッダー（x402 v2形式）
4. ✅ PAYMENT-RESPONSEヘッダー（success/failure settlement）
5. ✅ 支払い検証（coinos.io API連携）
6. ✅ インボイス再利用防止（Cloudflare KV）

### セキュリティ
1. ✅ 環境変数による秘密情報管理
2. ✅ インボイス重複チェック
3. ✅ 支払いハッシュ検証
