# simpl402

x402 over Lightning Network の実装です。HTTP 402 (Payment Required) プロトコルを使用し、Lightning Network によるマイクロペイメントを実現します。

[English version is here](./README.md)

## このリポジトリについて

[x402](https://github.com/x402-foundation/x402) は、HTTP 402 ステータスコードを活用した支払いプロトコルです。このリポジトリでは、x402 HTTP Transport Specification v2 に準拠した API を Cloudflare Workers 上に実装しています。支払い基盤には Lightning Network (coinos.io API) を利用します。

## ディレクトリ構成

| ディレクトリ | 説明 |
|---|---|
| [`nostr-api/`](./nostr-api/README.md) | メインアプリ。Cloudflare Workers 上で動作する x402 対応 REST API |
| [`docs/`](./docs/) | 設計ドキュメント（アーキテクチャ、NIP-58、支払いスキーム仕様） |

## クイックスタート

```bash
cd nostr-api
npm install
cp .dev.vars.example .dev.vars
# .dev.vars に coinos.io の API キーを設定
npm run dev
```

詳細は [`nostr-api/README.md`](./nostr-api/README.md) を参照してください。

## 技術スタック

- **Cloudflare Workers** – サーバーレス実行環境
- **TypeScript** – 型安全性
- **Lightning Network** – 支払い基盤（coinos.io API）
- **Cloudflare KV** – 使用済み invoice の重複排除
- **x402 v2** – HTTP 支払いプロトコル
- **NIP-58** – Nostr バッジ発行

## 参考資料

- [x402](https://github.com/x402-foundation/x402) – x402 プロトコル仕様
- [x402 HTTP Transport Specification v2](https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/http.md)
- [coinos.io API](https://coinos.io)

## ライセンス

MIT
