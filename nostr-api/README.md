# x402 over Lightning Network - Nostr API

Lightning Network による支払い必須の REST API 実装です。**x402 HTTP Transport Specification v2** に完全準拠しています。

## 概要

このプロジェクトは、HTTP 402 (Payment Required) を使用した支払い付き API を実装しています。
Lightning Network を支払い基盤として利用し、coinos.io API と連携します。

x402 v2仕様に準拠し、以下のヘッダーを使用します：
- `PAYMENT-REQUIRED`: サーバーが支払い要求を送信（resource、accepts配列を含む）
- `PAYMENT-SIGNATURE`: クライアントが支払い情報を送信（x402Version、resource、accepted、payloadを含む）
- `PAYMENT-RESPONSE`: サーバーが決済結果を返却（success、transaction、errorReasonなどを含む）

## 機能

- **GET /nostr/secret-key**: Lightning 支払いが必要なエンドポイント
  - 初回アクセス時: `402 Payment Required` + `PAYMENT-REQUIRED` ヘッダーでLightning invoiceを含む支払い要求を返す
  - 支払い後: `PAYMENT-SIGNATURE` ヘッダーでx402 v2形式のペイロードを送信し、検証後に `PAYMENT-RESPONSE` ヘッダーと共にリソースを返す

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 環境変数の設定

`.dev.vars.example` をコピーして `.dev.vars` を作成し、coinos.io の API キーを設定します：

```bash
cp .dev.vars.example .dev.vars
```

`.dev.vars` を編集：

```
COINOS_API_KEY=your_actual_api_key_here
```

### 3. Cloudflare KV の作成（ローカル開発では不要）

デプロイ時には、使用済み invoice を記録するための KV Namespace が必要です：

```bash
# KV Namespace を作成
wrangler kv:namespace create "USED_INVOICES"

# Preview用も作成
wrangler kv:namespace create "USED_INVOICES" --preview
```

作成された ID を `wrangler.jsonc` の `kv_namespaces` セクションに設定してください。

## 開発

ローカル開発サーバーを起動：

```bash
npm run dev
```

サーバーは `http://localhost:8787` で起動します。

## テスト

### 1. 初回アクセス（402 レスポンス）

```bash
curl -i http://localhost:8787/nostr/secret-key
```

レスポンス例：
```
HTTP/1.1 402 Payment Required
Content-Type: application/json
PAYMENT-REQUIRED: eyJ4NDAyVmVyc2lvbiI6MiwgImVycm9yIjogIlBBWU1FTlQtU0lHTkFUVVJFIGhlYWRlciBpcyByZXF1aXJlZCIsICJyZXNvdXJjZSI6IHsuLi59LCAiYWNjZXB0cyI6IFt7Li4ufV19

{"error":"Payment required"}
```

### 2. PAYMENT-REQUIRED のデコード

```bash
# Base64 デコード
echo "eyJ4NDAyVmVyc2lvbiI6MiwgImVycm9yIjogIlBBWU1FTlQtU0lHTkFUVVJFIGhlYWRlciBpcyByZXF1aXJlZCIsICJyZXNvdXJjZSI6IHsuLi59LCAiYWNjZXB0cyI6IFt7Li4ufV19" | base64 -d | jq
```

デコード結果（x402 v2形式）：
```json
{
  "x402Version": 2,
  "error": "PAYMENT-SIGNATURE header is required",
  "resource": {
    "url": "http://localhost:8787/nostr/secret-key",
    "description": "Access to Nostr secret key",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "lightning",
      "network": "bitcoin",
      "amount": "100000",
      "asset": "BTC",
      "maxTimeoutSeconds": 3600,
      "extra": {
        "invoice": "lnbc1..."
      }
    }
  ]
}
```

### 3. Lightning 支払い

`accepts[0].extra.invoice` の値を Lightning ウォレットで支払います。

### 4. 支払い後のアクセス

```bash
# PAYMENT-SIGNATURE ヘッダーにx402 v2形式のペイロードを送信
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
    "invoice": "lnbc1..."
  }
}
EOF
)

curl -i http://localhost:8787/nostr/secret-key \
  -H "PAYMENT-SIGNATURE: $PAYMENT_PAYLOAD"
```

成功時のレスポンス：
```
HTTP/1.1 200 OK
Content-Type: application/json
PAYMENT-RESPONSE: eyJzdWNjZXNzIjp0cnVlLCJ0cmFuc2FjdGlvbiI6ImxuYmMxLi4uIiwibmV0d29yayI6ImJpdGNvaW4iLCJwYXllciI6ImFub255bW91cyIsImV4dHJhIjp7Imlud29pY2UiOiJsbmJjMS4uLiIsInNldHRsZWRBdCI6MTczOTExNjgwMH19

{"secretKey":"nsec1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}
```

## デプロイ

### 1. Cloudflare にログイン

```bash
wrangler login
```

### 2. Secrets の設定

```bash
wrangler secret put COINOS_API_KEY
```

### 3. デプロイ

```bash
npm run deploy
```

## アーキテクチャ

```
Client
  |
  | 1. GET /nostr/secret-key
  |
Server (402 + PAYMENT-REQUIRED header with x402 v2 payload)
  |
  | 2. Lightning 支払い
  |
Lightning Network (coinos.io)
  |
  | 3. GET /nostr/secret-key + PAYMENT-SIGNATURE header with x402 v2 payload
  |
Server (検証 → 200 OK + PAYMENT-RESPONSE header + secretKey)
```

### x402 v2 ヘッダーフロー

1. **PAYMENT-REQUIRED** (Server → Client)
   - `x402Version`: 2
   - `resource`: アクセス対象のリソース情報
   - `accepts`: 受け入れ可能な支払い方法の配列（Lightning含む）

2. **PAYMENT-SIGNATURE** (Client → Server)
   - `x402Version`: 2
   - `resource`: リクエスト対象のリソース情報
   - `accepted`: 選択した支払い方法
   - `payload`: 支払い固有の情報（Lightning invoiceなど）

3. **PAYMENT-RESPONSE** (Server → Client)
   - `success`: 決済成功/失敗
   - `transaction`: トランザクションID（成功時）
   - `errorReason`: エラー理由（失敗時）

## 技術スタック

- **Cloudflare Workers**: サーバーレス実行環境
- **TypeScript**: 型安全性
- **Lightning Network**: 支払い基盤（coinos.io API）
- **Cloudflare KV**: 使用済み invoice の記録
- **light-bolt11-decoder**: BOLT11 invoice のデコード

## 設定

### wrangler.jsonc

- `COINOS_API_URL`: coinos.io API の URL
- `INVOICE_AMOUNT_SATS`: デフォルトの invoice 金額（100 sats）
- `INVOICE_EXPIRY_SECONDS`: invoice の有効期限（3600秒 = 1時間）

## セキュリティ

- invoice は一度のみ使用可能（Cloudflare KV で管理）
- 期限切れ invoice は自動的に拒否
- 支払い検証は Lightning ノードで実行

## ライセンス

MIT

## 参考資料

- [x402 HTTP Transport Specification v2](https://github.com/coinbase/x402/blob/main/specs/transports-v2/http.md)
- [coinos.io API](https://coinos.io)
