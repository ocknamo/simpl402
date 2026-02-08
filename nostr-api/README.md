# x402 over Lightning Network - Nostr API

Lightning Network による支払い必須の REST API 実装です。x402 プロトコルに準拠しています。

## 概要

このプロジェクトは、HTTP 402 (Payment Required) を使用した支払い付き API を実装しています。
Lightning Network を支払い基盤として利用し、coinos.io API と連携します。

## 機能

- **GET /nostr/secret-key**: Lightning 支払いが必要なエンドポイント
  - 初回アクセス時: `402 Payment Required` + Lightning invoice を返す
  - 支払い後: `PAYMENT-SIGNATURE` ヘッダーで invoice を送信し、検証後にリソースを返す

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
PAYMENT-REQUIRED: eyJzY2hlbWUiOiJsaWdodG5pbmciLCJuZXR3b3JrIjoiYml0Y29pbiIsImludm9pY2UiOiJsbmJjMS4uLiJ9
```

### 2. invoice のデコード

```bash
# Base64 デコード
echo "eyJzY2hlbWUiOiJsaWdodG5pbmciLCJuZXR3b3JrIjoiYml0Y29pbiIsImludm9pY2UiOiJsbmJjMS4uLiJ9" | base64 -d
```

### 3. Lightning 支払い

デコードした invoice を Lightning ウォレットで支払います。

### 4. 支払い後のアクセス

```bash
# PAYMENT-SIGNATURE ヘッダーに invoice を Base64 エンコードして送信
curl -i http://localhost:8787/nostr/secret-key \
  -H "PAYMENT-SIGNATURE: eyJzY2hlbWUiOiJsaWdodG5pbmciLCJuZXR3b3JrIjoiYml0Y29pbiIsImludm9pY2UiOiJsbmJjMS4uLiJ9"
```

成功時のレスポンス：
```json
{
  "secretKey": "nsec1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
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
Server (402 + invoice)
  |
  | 2. Lightning 支払い
  |
Lightning Network (coinos.io)
  |
  | 3. GET /nostr/secret-key + PAYMENT-SIGNATURE
  |
Server (検証 → 200 OK + secretKey)
```

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

- [x402 over Lightning Network 設計書](../docs/idea.md)
- [Cloudflare Workers ドキュメント](https://developers.cloudflare.com/workers/)
- [coinos.io API](https://coinos.io)
