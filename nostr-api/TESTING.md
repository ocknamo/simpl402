# x402 API 動作確認手順

このドキュメントでは、x402 over Lightning Network APIの動作確認手順を説明します。

## 前提条件

- 開発サーバーが起動していること (`npm run dev`)
- `curl` コマンドが利用可能であること

## 動作確認手順

### 1. 開発サーバーの起動

```bash
cd /home/yoshiki/workspace/ln/simpl402/nostr-api
npm run dev
```

サーバーが `http://localhost:8787` で起動します。

### 2. 402 Payment Required レスポンスの確認

支払いなしで保護されたエンドポイントにアクセスします。

```bash
curl -i http://localhost:8787/nostr/secret-key
```

**期待される結果:**
```
HTTP/1.1 402 Payment Required
Content-Type: application/json
PAYMENT-REQUIRED: eyJ4NDAyVmVyc2lvbiI6MiwgImVycm9yIjogIlBheW1lbnQgcmVxdWlyZWQiLCAicmVzb3VyY2UiOiB7Li4ufSwgImFjY2VwdHMiOiBbey4uLn1dfQ==

{"error":"Payment required"}
```

✅ **確認ポイント:**
- ステータスコードが `402 Payment Required`
- `PAYMENT-REQUIRED` ヘッダーにBase64エンコードされたx402 v2準拠のJSON（resource, accepts配列含む）が含まれている
- レスポンスボディにエラーメッセージが含まれている

### 3. PAYMENT-REQUIREDのデコードとPAYMENT-SIGNATUREの作成

手順2で取得したPAYMENT-REQUIREDヘッダーをデコードし、PAYMENT-SIGNATUREを作成します。

```bash
# PAYMENT-REQUIREDをデコード
PAYMENT_REQUIRED="eyJ4NDAyVmVyc2lvbiI6MiwgImVycm9yIjogIlBheW1lbnQgcmVxdWlyZWQiLCAicmVzb3VyY2UiOiB7Li4ufSwgImFjY2VwdHMiOiBbey4uLn1dfQ=="
echo "$PAYMENT_REQUIRED" | base64 -d | jq

# 出力例:
# {
#   "x402Version": 2,
#   "error": "PAYMENT-SIGNATURE header is required",
#   "resource": {
#     "url": "http://localhost:8787/nostr/secret-key",
#     "description": "Access to Nostr secret key",
#     "mimeType": "application/json"
#   },
#   "accepts": [
#     {
#       "scheme": "lightning",
#       "network": "bitcoin",
#       "amount": "100000",
#       "asset": "BTC",
#       "maxTimeoutSeconds": 3600,
#       "extra": {
#         "invoice": "lnbc1..."
#       }
#     }
#   ]
# }

# invoiceを抽出
INVOICE=$(echo "$PAYMENT_REQUIRED" | base64 -d | jq -r '.accepts[0].extra.invoice')
echo "Invoice: $INVOICE"
```

### 4. 未払いインボイスでの支払い検証

PAYMENT-SIGNATUREを作成して支払い検証を試みます。

```bash
# PAYMENT-SIGNATUREペイロードを作成（x402 v2形式）
PAYMENT_PAYLOAD=$(cat <<EOF | jq -c | base64 -w0
{
  "x402Version": 2,
  "resource": {
    "url": "http://localhost:8787/nostr/secret-key",
    "description": "Access to Nostr secret key",
    "mimeType": "application/json"
  },
  "accepted": {
    "scheme": "lightning",
    "network": "bitcoin",
    "amount": "100000",
    "asset": "BTC"
  },
  "payload": {
    "invoice": "$INVOICE"
  }
}
EOF
)

curl -i "http://localhost:8787/nostr/secret-key" \
  -H "PAYMENT-SIGNATURE: $PAYMENT_PAYLOAD"
```

**期待される結果:**
```
HTTP/1.1 402 Payment Required
Content-Type: application/json
PAYMENT-RESPONSE: eyJzdWNjZXNzIjpmYWxzZSwiZXJyb3JSZWFzb24iOiJwYXltZW50X25vdF9jb25maXJtZWQiLCJuZXR3b3JrIjoiYml0Y29pbiJ9

{"error":"Payment not confirmed"}
```

✅ **確認ポイント:**
- ステータスコードが `402 Payment Required`
- `PAYMENT-RESPONSE` ヘッダーにBase64エンコードされた失敗レスポンスが含まれている
- レスポンスボディが `{"error":"Payment not confirmed"}`

### 5. 実際の支払い後の検証（オプション）

Lightning Walletでインボイスを支払った後、同じPAYMENT-SIGNATUREで再度アクセスします。

```bash
# Lightning Walletで$INVOICEを支払う

# 支払い後、同じPAYMENT-SIGNATUREで再度アクセス
curl -i "http://localhost:8787/nostr/secret-key" \
  -H "PAYMENT-SIGNATURE: $PAYMENT_PAYLOAD"
```

**期待される結果:**
```
HTTP/1.1 200 OK
Content-Type: application/json
PAYMENT-RESPONSE: eyJzdWNjZXNzIjp0cnVlLCJ0cmFuc2FjdGlvbiI6ImxuYmMxLi4uIiwibmV0d29yayI6ImJpdGNvaW4iLCJwYXllciI6ImFub255bW91cyIsImV4dHJhIjp7Imlud29pY2UiOiJsbmJjMS4uLiIsInNldHRsZWRBdCI6MTczOTExNjgwMH19

{"secretKey":"nsec1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}
```

✅ **確認ポイント:**
- ステータスコードが `200 OK`
- `PAYMENT-RESPONSE` ヘッダーにBase64エンコードされた成功レスポンスが含まれている
- JSONレスポンスに `secretKey` が含まれている

### 6. インボイスの再利用防止の確認

同じ支払い済みPAYMENT-SIGNATUREで再度アクセスします。

```bash
# 同じ支払い済みPAYMENT-SIGNATUREを再度使用
curl -i "http://localhost:8787/nostr/secret-key" \
  -H "PAYMENT-SIGNATURE: $PAYMENT_PAYLOAD"
```

**期待される結果:**
```
HTTP/1.1 402 Payment Required
Content-Type: application/json
PAYMENT-RESPONSE: eyJzdWNjZXNzIjpmYWxzZSwiZXJyb3JSZWFzb24iOiJpbnZvaWNlX2FscmVhZHlfdXNlZCIsIm5ldHdvcmsiOiJiaXRjb2luIn0=

{"error":"Invoice already used"}
```

✅ **確認ポイント:**
- ステータスコードが `402 Payment Required`
- `PAYMENT-RESPONSE` ヘッダーにBase64エンコードされた失敗レスポンスが含まれている
- レスポンスボディが `{"error":"Invoice already used"}`

### 7. 存在しないエンドポイントの確認

```bash
curl -i http://localhost:8787/invalid/path
```

**期待される結果:**
```
HTTP/1.1 404 Not Found
Content-Length: 9
Content-Type: text/plain;charset=UTF-8

Not Found
```

✅ **確認ポイント:**
- ステータスコードが `404 Not Found`

## トラブルシューティング

### サーバーが起動しない

```bash
# 依存関係を再インストール
npm install

# 開発サーバーを再起動
npm run dev
```

### 環境変数が設定されていない

`.dev.vars` ファイルが存在し、必要な環境変数が設定されているか確認してください。

```bash
cat .dev.vars
```

必要な環境変数:
- `COINOS_API_KEY`
- `COINOS_API_URL`
- `INVOICE_AMOUNT_SATS`
- `INVOICE_EXPIRY_SECONDS`

### API呼び出しでエラーが発生する

開発サーバーのログを確認してください。デバッグ情報が出力されています。

```bash
# ターミナルでログを確認
# [DEBUG] で始まる行に注目
```

## まとめ

この手順により、以下の機能が正常に動作していることを確認できます：

1. ✅ x402 v2準拠の402 Payment Requiredレスポンスの生成
2. ✅ PAYMENT-REQUIREDヘッダーにresource、accepts配列を含むペイロードの発行
3. ✅ PAYMENT-SIGNATUREヘッダーでx402 v2形式のペイロード送信
4. ✅ PAYMENT-RESPONSEヘッダーで成功/失敗のsettlementレスポンス返却
5. ✅ 支払い検証（未払い/支払い済み）
6. ✅ インボイスの再利用防止（Cloudflare KVで管理）
7. ✅ エラーハンドリング

すべての確認項目が期待通りの結果になれば、APIは正常に動作しています！
