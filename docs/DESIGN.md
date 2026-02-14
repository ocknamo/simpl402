# x402 + NIP-58 Badge Award System - 設計書

## 概要

本システムは、Lightning NetworkとNostrプロトコルを組み合わせた課金システムです。x402プロトコルによるHTTP課金とNIP-58バッジアワード機能を実装しています。

### 主要機能

1. **x402プロトコル対応課金システム**: Lightning Networkによる少額課金（マイクロペイメント）
2. **NIP-58バッジアワード**: 支払い確認後のNostrバッジ自動発行
3. **二段階検証**: 支払い前のリクエスト検証による誤課金防止

## アーキテクチャ

### システム構成

```
┌─────────────┐
│   Client    │
│  (x402)     │
└──────┬──────┘
       │ HTTP + x402 headers
       ↓
┌─────────────────────────────┐
│  Cloudflare Workers         │
│  ┌─────────────────────┐   │
│  │  Request Handler    │   │
│  └──────┬──────────────┘   │
│         ↓                   │
│  ┌─────────────────────┐   │
│  │  Payment Verifier   │←──┼─→ KV (Invoice Dedup)
│  └──────┬──────────────┘   │
│         ↓                   │
│  ┌─────────────────────┐   │
│  │  Badge Issuer       │   │
│  └──────┬──────────────┘   │
└─────────┼───────────────────┘
          │
          ├─→ coinos.io (Lightning Node)
          │
          └─→ Nostr Relay (Badge Award)
```

### 技術スタック

- **Runtime**: Cloudflare Workers (Edge Computing)
- **言語**: TypeScript
- **Lightning**: coinos.io API
- **Storage**: Cloudflare KV (Invoice deduplication)
- **Protocol**: x402 v2, NIP-58
- **Nostr Library**: nostr-tools

## x402プロトコル実装

### プロトコルバージョン

本実装は **x402 v2** に完全準拠しています。

### HTTPヘッダー

#### 1. PAYMENT-REQUIRED (402 Response)

サーバーが支払いを要求する際に返すヘッダー：

```typescript
interface X402PaymentRequired {
  x402Version: 2;
  error: string;
  resource: {
    url: string;
    description: string;
    mimeType: string;
  };
  accepts: Array<{
    scheme: "lightning";
    network: "bitcoin";
    amount: string;  // satoshis
    asset: "BTC";
    maxTimeoutSeconds?: number;
    extra: {
      invoice: string;  // BOLT11 invoice
    };
  }>;
}
```

#### 2. PAYMENT-SIGNATURE (Request Header)

クライアントが支払い証明を提示する際のヘッダー：

```typescript
interface X402PaymentPayload {
  x402Version: 2;
  resource: X402Resource;
  accepted: X402PaymentMethod;
  payload: {
    invoice: string;  // BOLT11 invoice (same as received)
  };
}
```

#### 3. PAYMENT-RESPONSE (Response Header)

サーバーが支払い検証結果を返すヘッダー：

```typescript
interface X402SettlementResponse {
  success: boolean;
  transaction?: string;  // invoice
  network?: "bitcoin";
  errorReason?: string;
  extra?: {
    invoice: string;
    settledAt: number;  // Unix timestamp
  };
}
```

### エンコーディング

すべてのx402ヘッダーはBase64エンコードされたJSONです：

```typescript
// エンコード
const header = btoa(JSON.stringify(payload));

// デコード
const payload = JSON.parse(atob(header));
```

## Lightning Network統合

### coinos.io API

#### インボイス作成

```
POST https://coinos.io/api/lightning/invoice
Authorization: Bearer {API_KEY}
Content-Type: application/json

{
  "amount": 100,  // satoshis
  "expiry": 3600  // seconds
}
```

レスポンス：
```json
{
  "amount": 100,
  "text": "lnbc1...",  // BOLT11 invoice
  "hash": "abc123...",
  "created": 1234567890
}
```

#### 支払い検証

```
GET https://coinos.io/api/invoice/{invoice_text}
Authorization: Bearer {API_KEY}
```

レスポンス：
```json
{
  "id": "...",
  "hash": "abc123...",
  "amount": 100,
  "confirmed": true,  // 支払い済み
  "received": true
}
```

### インボイスデコード

BOLT11インボイスから支払いハッシュと有効期限を抽出：

```typescript
interface DecodedInvoice {
  paymentHash: string;      // 重複チェック用
  satoshis: number;         // 金額検証用
  timestamp: number;        // 作成時刻
  timeExpireDate: number;   // 有効期限（Unix timestamp）
}
```

### 重複支払い防止

Cloudflare KVを使用して使用済みインボイスを管理：

```typescript
// インボイス使用済みマーク
const key = `used:${paymentHash}`;
await env.USED_INVOICES.put(key, 'true', { 
  expirationTtl: 86400  // 24時間
});

// 使用済みチェック
const alreadyUsed = await env.USED_INVOICES.get(key);
```

## NIP-58バッジアワード実装

### Badge Award Event (kind 8)

NIP-58に準拠したバッジアワードイベント：

```typescript
{
  kind: 8,
  created_at: 1234567890,
  tags: [
    ['a', '30009:{issuer_pubkey}:{badge_d_tag}'],
    ['p', '{recipient_pubkey}', '{relay_url}']
  ],
  content: '',
  // id, pubkey, sig は finalizeEvent で自動生成
}
```

### バッジ発行者秘密鍵管理

#### ローカル開発環境

`.dev.vars`ファイル（gitignore済み）：
```bash
BADGE_ISSUER_NSEC=nsec1...your_secret_key...
```

#### 本番環境

Cloudflare Secretsとして管理：
```bash
# CLI経由
wrangler secret put BADGE_ISSUER_NSEC

# または Dashboard経由で設定
```

### Nostrリレーへの公開

WebSocketを使用してバッジアワードイベントを送信：

```typescript
// NIP-01: EVENT message
const message = ['EVENT', signedEvent];
ws.send(JSON.stringify(message));

// NIP-01: OK response
// ["OK", <event_id>, <true|false>, <message>]
```

実装では`ctx.waitUntil()`を使用して、リレーへの公開を非同期で実行：

```typescript
ctx.waitUntil(
  publishToRelay(RELAY_URL, signedEvent)
    .then(() => console.log('Published'))
    .catch(error => console.error(error))
);
```

これにより：
- クライアントへのレスポンスは即座に返る
- リレーへの公開は並行して実行される
- リレー障害時でもクライアントには成功レスポンス

## APIエンドポイント

### 1. GET /nostr/secret-key

**機能**: x402で保護された秘密鍵取得（デモ用）

**課金**: 100 satoshis

**レスポンス例**:
```json
{
  "secretKey": "nsec1xxxxx..."
}
```

### 2. POST /nostr/badge-challenge

**機能**: 支払い後にNIP-58バッジを発行

**課金**: 100 satoshis

**リクエストボディ**:
```json
{
  "npub": "npub1xxxxx..."
}
```

**バリデーション**:
1. JSON形式チェック
2. `npub`フィールド存在チェック
3. npub形式検証（nip19デコード）

**レスポンス例**:
```json
{
  "success": true,
  "eventId": "abc123...",
  "message": "Badge awarded successfully"
}
```

## データフロー

### 支払いフロー（基本）

```
1. Client → Server: GET /resource
   (PAYMENT-SIGNATUREヘッダーなし)

2. Server → Client: 402 Payment Required
   PAYMENT-REQUIRED: {invoice, amount, ...}

3. Client: Lightning支払い実行

4. Client → Server: GET /resource
   PAYMENT-SIGNATURE: {invoice, ...}

5. Server: 
   - インボイスデコード
   - 重複チェック (KV)
   - 支払い確認 (coinos.io)
   - 使用済みマーク (KV)

6. Server → Client: 200 OK
   PAYMENT-RESPONSE: {success: true}
   Content: {リソースデータ}
```

### バッジアワードフロー

```
1. Client → Server: POST /nostr/badge-challenge
   Body: {npub: "npub1..."}
   (PAYMENT-SIGNATUREなし)

2. Server: 
   - リクエストボディ検証
   - npub形式検証
   ※ 検証成功後に課金要求

3. Server → Client: 402 Payment Required
   PAYMENT-REQUIRED: {100 sats invoice}

4. Client: Lightning支払い

5. Client → Server: POST /nostr/badge-challenge
   Body: {npub: "npub1..."}
   PAYMENT-SIGNATURE: {invoice}

6. Server:
   - 支払い検証
   - 金額検証（100 sats）
   - Badge Award Event作成
   - イベント署名
   - リレーへ公開（非同期）

7. Server → Client: 200 OK (即座に)
   PAYMENT-RESPONSE: {success: true}
   Body: {eventId, success, message}

8. Background: Nostrリレーへ公開完了
```

### 誤課金防止設計

**重要**: 支払い前にリクエスト内容を検証

```typescript
// ❌ 悪い例: 支払い後に検証
if (!paymentSig) return requirePayment();
const body = await request.json();  // 支払い後にエラー
if (!body.npub) return error();     // → 返金不可能

// ✅ 良い例: 支払い前に検証
const body = await request.json();
if (!body.npub) return error();     // 課金前にエラー
if (!paymentSig) return requirePayment();
```

## エラーハンドリング

### エラーレスポンス形式

すべてのエラーレスポンスにPAYMENT-RESPONSEヘッダーを含める：

```typescript
{
  status: 400/402/500,
  headers: {
    'Content-Type': 'application/json',
    'PAYMENT-RESPONSE': base64({
      success: false,
      errorReason: 'error_code'
    })
  },
  body: {
    error: 'Human readable message'
  }
}
```

### エラーコード一覧

| コード | 意味 | HTTPステータス |
|--------|------|----------------|
| `unsupported_version` | x402バージョン不一致 | 400 |
| `unsupported_scheme` | 非対応の支払いスキーム | 400 |
| `missing_invoice` | インボイス未指定 | 400 |
| `invalid_amount` | 金額不一致 | 400 |
| `invalid_payload` | ペイロード形式エラー | 400 |
| `invoice_expired` | インボイス期限切れ | 402 |
| `invoice_already_used` | インボイス使用済み | 402 |
| `payment_not_confirmed` | 支払い未確認 | 402 |

## セキュリティ

### 環境変数管理

#### 秘密情報

以下は**絶対に**コードリポジトリにコミットしない：

1. `COINOS_API_KEY`: Lightning Node APIキー
2. `BADGE_ISSUER_NSEC`: バッジ発行者の秘密鍵

#### 管理方法

**ローカル開発**:
```bash
# .dev.vars (gitignore済み)
COINOS_API_KEY=your_api_key
BADGE_ISSUER_NSEC=nsec1xxx...
```

**本番環境**:
```bash
# Cloudflare Secrets
wrangler secret put COINOS_API_KEY
wrangler secret put BADGE_ISSUER_NSEC
```

#### 型定義

`worker-configuration.d.ts`で型安全性を確保：

```typescript
interface Env {
  COINOS_API_KEY: string;
  BADGE_ISSUER_NSEC: string;
  USED_INVOICES: KVNamespace;
  // ...
}
```

### インボイスセキュリティ

1. **重複チェック**: 同一インボイスの再利用防止
2. **有効期限チェック**: 期限切れインボイス拒否
3. **金額検証**: 期待金額との照合
4. **支払いハッシュ検証**: coinos.io APIで実際の支払い確認

### Nostr秘密鍵保護

- nsec形式で保存（bech32エンコード）
- 環境変数経由でのみアクセス
- 署名処理のみに使用（公開しない）
- メモリ上での短時間のみ展開

## デプロイメント

### 前提条件

1. Cloudflareアカウント
2. coinos.ioアカウント＆APIキー
3. Nostr秘密鍵（バッジ発行用）
4. wrangler CLI インストール

### デプロイ手順

#### 1. 依存関係インストール

```bash
cd nostr-api
npm install
```

#### 2. ローカル環境変数設定

```bash
# .dev.vars ファイル作成
cp .dev.vars.example .dev.vars

# 実際の値を設定
nano .dev.vars
```

#### 3. ローカルテスト

```bash
npm run dev
```

#### 4. 本番デプロイ

```bash
# Secretsの設定
wrangler secret put COINOS_API_KEY
wrangler secret put BADGE_ISSUER_NSEC

# デプロイ
npm run deploy
```

### Cloudflare Workers設定

#### KV Namespace

`wrangler.jsonc`で設定済み：

```jsonc
{
  "kv_namespaces": [
    {
      "binding": "USED_INVOICES",
      "id": "eeb6bdbb127c411986787b1aac5a0236",
      "preview_id": "INVOICES"
    }
  ]
}
```

#### 環境変数（非秘密）

```jsonc
{
  "vars": {
    "COINOS_API_URL": "https://coinos.io/api",
    "INVOICE_AMOUNT_SATS": "100",
    "INVOICE_EXPIRY_SECONDS": "3600"
  }
}
```

## テスト

### 手動テスト手順

#### 1. 秘密鍵エンドポイント

```bash
# 1. 初回リクエスト（402受信）
curl -v http://localhost:8787/nostr/secret-key

# PAYMENT-REQUIREDヘッダーからinvoiceを取得

# 2. Lightning支払い実行
# (Lightning Walletで支払い)

# 3. 支払い証明付きリクエスト
curl -v http://localhost:8787/nostr/secret-key \
  -H "PAYMENT-SIGNATURE: <base64_payload>"
```

#### 2. バッジチャレンジ

```bash
# 1. 初回リクエスト（402受信）
curl -v http://localhost:8787/nostr/badge-challenge \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"npub": "npub1xxxxx..."}'

# 2. Lightning支払い実行

# 3. 支払い証明付きリクエスト
curl -v http://localhost:8787/nostr/badge-challenge \
  -X POST \
  -H "Content-Type: application/json" \
  -H "PAYMENT-SIGNATURE: <base64_payload>" \
  -d '{"npub": "npub1xxxxx..."}'
```

### エラーケーステスト

```bash
# 無効なnpub
curl -X POST http://localhost:8787/nostr/badge-challenge \
  -H "Content-Type: application/json" \
  -d '{"npub": "invalid"}'
# → 400 Bad Request (課金されない)

# npubフィールド欠落
curl -X POST http://localhost:8787/nostr/badge-challenge \
  -H "Content-Type: application/json" \
  -d '{}'
# → 400 Bad Request (課金されない)
```

## パフォーマンス最適化

### Edge Computing

Cloudflare Workersの利点：

- 世界中のエッジロケーションで実行
- レイテンシー最小化
- 自動スケーリング

### 非同期処理

リレーへの公開を非同期化：

```typescript
ctx.waitUntil(publishToRelay(RELAY_URL, signedEvent));
// レスポンスは即座に返る
```

### KV最適化

- TTL設定で自動クリーンアップ（24時間）
- ペイメントハッシュをキーに使用（効率的な検索）

## 今後の拡張性

### 機能拡張案

1. **複数バッジ対応**: 異なる金額・バッジの柔軟な設定
2. **バッジメタデータ**: 発行理由・タイムスタンプ等の追加情報
3. **リレー選択**: 複数リレーへの並行公開
4. **Webhook通知**: バッジ発行完了通知
5. **管理ダッシュボード**: 発行履歴・統計表示

### プロトコル拡張

1. **他の支払い方法**: Cashu, Fedimint等のサポート
2. **定期支払い**: サブスクリプションモデル
3. **バルク処理**: 複数バッジの一括発行

## 参考資料

### 仕様書

- [x402 HTTP Transport Specification v2](https://github.com/oven-sh/x402)
- [NIP-58: Badges](https://github.com/nostr-protocol/nips/blob/master/58.md)
- [NIP-01: Basic protocol flow description](https://github.com/nostr-protocol/nips/blob/master/01.md)
- [NIP-19: bech32-encoded entities](https://github.com/nostr-protocol/nips/blob/master/19.md)
- [BOLT #11: Invoice Protocol](https://github.com/lightning/bolts/blob/master/11-payment-encoding.md)

### ライブラリ

- [nostr-tools](https://github.com/nbd-wtf/nostr-tools)
- [light-bolt11-decoder](https://github.com/immortal-tofu/light-bolt11-decoder)

### API

- [coinos.io API Documentation](https://coinos.io/docs/api)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Cloudflare KV Documentation](https://developers.cloudflare.com/kv/)

---

## 変更履歴

### 2026-02-14

- 初版作成
- x402 v2準拠実装
- NIP-58バッジアワード機能実装
- 環境変数管理の改善（BADGE_ISSUER_NSEC）
- 誤課金防止設計の追加
