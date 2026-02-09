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
Content-Length: 0
PAYMENT-REQUIRED: eyJzY2hlbWUiOiJsaWdodG5pbmciLCJuZXR3b3JrIjoiYml0Y29pbiIsImludm9pY2UiOiJsbmJjMS4uLiJ9
```

✅ **確認ポイント:**
- ステータスコードが `402 Payment Required`
- `PAYMENT-REQUIRED` ヘッダーにBase64エンコードされたJSON（Lightning invoice含む）が含まれている

### 3. 未払いインボイスでの支払い検証

手順2で取得したBase64エンコードされたJSON（未払い）を使って支払い検証を試みます。

```bash
# 手順2で取得したPAYMENT-REQUIREDヘッダーの値を使用
PAYMENT_SIG="eyJzY2hlbWUiOiJsaWdodG5pbmciLCJuZXR3b3JrIjoiYml0Y29pbiIsImludm9pY2UiOiJsbmJjMS4uLiJ9"

curl -i "http://localhost:8787/nostr/secret-key" \
  -H "PAYMENT-SIGNATURE: $PAYMENT_SIG"
```

**期待される結果:**
```
HTTP/1.1 402 Payment Required
Content-Length: 21
Content-Type: text/plain;charset=UTF-8

Payment not confirmed
```

✅ **確認ポイント:**
- ステータスコードが `402 Payment Required`
- レスポンスボディが `Payment not confirmed`

### 4. 実際の支払い後の検証（オプション）

Lightning Walletでインボイスを支払った後、同じPAYMENT-SIGNATUREで再度アクセスします。

```bash
# Base64をデコードしてinvoiceを取得
echo "$PAYMENT_SIG" | base64 -d | jq -r '.invoice'
# → Lightning Walletでこのinvoiceを支払う

# 支払い後、同じPAYMENT-SIGNATUREで再度アクセス
curl -i "http://localhost:8787/nostr/secret-key" \
  -H "PAYMENT-SIGNATURE: $PAYMENT_SIG"
```

**期待される結果:**
```
HTTP/1.1 200 OK
Content-Type: application/json

{
  "secretKey": "nsec1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

✅ **確認ポイント:**
- ステータスコードが `200 OK`
- JSONレスポンスに `secretKey` が含まれている

### 5. インボイスの再利用防止の確認

同じ支払い済みPAYMENT-SIGNATUREで再度アクセスします。

```bash
# 同じ支払い済みPAYMENT-SIGNATUREを再度使用
curl -i "http://localhost:8787/nostr/secret-key" \
  -H "PAYMENT-SIGNATURE: $PAYMENT_SIG"
```

**期待される結果:**
```
HTTP/1.1 402 Payment Required
Content-Length: 21
Content-Type: text/plain;charset=UTF-8

Invoice already used
```

✅ **確認ポイント:**
- ステータスコードが `402 Payment Required`
- レスポンスボディが `Invoice already used`

### 6. 存在しないエンドポイントの確認

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

1. ✅ 402 Payment Required レスポンスの生成
2. ✅ Base64エンコードされたLightning invoiceの発行
3. ✅ 支払い検証（未払い/支払い済み）
4. ✅ インボイスの再利用防止（Cloudflare KVで管理）
5. ✅ エラーハンドリング

すべての確認項目が期待通りの結果になれば、APIは正常に動作しています！
