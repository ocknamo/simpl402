# x402 over Lightning Network

最小実現構成 設計書（改訂版）

## 1. 目的

* HTTP 402（Payment Required）を用いた支払い付き API / コンテンツ配信
* x402 の標準ヘッダー仕様に準拠
* Lightning Network を支払い基盤として利用
* クライアントは preimage を扱わない
* サーバ自身が Lightning ノードで支払いを検証する
* **クライアント側の状態管理を極力減らす**

---

## 2. 前提・スコープ

### 前提

* サーバは Lightning ノード（LND / Core Lightning 等）を運用
* サーバは LNURL/BOLT11 invoice を発行・照会できる
* invoice から payment_hash を抽出できる
* 簡単のためにcoinos.ioなどのサードパーティウォレットAPIを使用できる

### 非スコープ

* ストリーミング課金
* クライアント認証・同一性確認
* preimage を使った認可
* WebLN 仕様

---

## 3. アーキテクチャ概要

```
Client
  |
  | HTTP GET /resource
  |
Server (x402 API)
  |
  | invoice 発行 / 検証
  |
Lightning Node
```

* クライアントは「invoiceを支払って再送する」だけ
* 支払検証は常にサーバ側で完結

---

## 4. 使用する HTTP ヘッダー（x402 準拠）

### 4.1 支払い要求（402 応答）

```
HTTP/1.1 402 Payment Required
PAYMENT-REQUIRED: <base64(PaymentRequired)>
```

#### PaymentRequired（JSON）

```json
{
  "scheme": "lightning",
  "network": "bitcoin",
  "invoice": "lnbc1..."
}
```

* BOLT11 invoice をそのまま渡す
* クライアントはこの値を保存しておけばよい

---

### 4.2 支払い後の再リクエスト（修正版）

```
GET /resource
PAYMENT-SIGNATURE: <base64(PaymentSignature)>
```

#### PaymentSignature（JSON）

```json
{
  "scheme": "lightning",
  "network": "bitcoin",
  "invoice": "lnbc1..."
}
```

### この設計の意図

* クライアントは

  * invoice を受け取る
  * invoice を支払う
  * 同じ invoice をそのまま返す
    → **状態管理が最小**
* payment_hash はサーバ側で invoice から導出する

---

## 5. シーケンス

### 5.1 初回アクセス

1. Client → Server
   `GET /resource`

2. Server

   * invoice を生成（金額・期限・用途を設定）

3. Server → Client

```
402 Payment Required
PAYMENT-REQUIRED: base64({ invoice })
```

---

### 5.2 支払い

4. Client → Wallet
   invoice を支払う

5. Lightning Network
   payment が settle

6. Server の Lightning Node
   invoice が settled 状態になる

---

### 5.3 再リクエスト

7. Client → Server

```
GET /resource
PAYMENT-SIGNATURE: base64({ invoice })
```

8. Server

   * invoice を decode
   * payment_hash を抽出
   * 自ノードで支払済みか検証

9. Server → Client

   * 支払済みなら `200 OK`
   * 未払いなら再度 `402`

---

## 6. サーバ側検証ロジック

### 必須検証

* invoice が自サーバ発行である
* invoice が期限切れでない
* invoice に含まれる payment_hash が settled
* 金額が要求額以上

### 任意の追加制御

* invoice ↔ resource の紐付け
* 使用済み invoice / payment_hash の記録
* 再利用回数制限

---

## 7. TypeScript 実装例（概略）

### 7.1 Base64 JSON ユーティリティ

```ts
function encodeHeader(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64");
}

function decodeHeader<T>(value: string): T {
  return JSON.parse(Buffer.from(value, "base64").toString());
}
```

---

### 7.2 支払い要求（402）

```ts
const paymentRequired = {
  scheme: "lightning",
  network: "bitcoin",
  invoice: invoice.bolt11,
};

res.status(402)
  .setHeader("PAYMENT-REQUIRED", encodeHeader(paymentRequired))
  .end();
```

---

### 7.3 再リクエスト検証

```ts
const sigHeader = req.headers["payment-signature"];
if (!sigHeader || Array.isArray(sigHeader)) {
  return requirePayment(res);
}

const sig = decodeHeader<{
  scheme: string;
  network: string;
  invoice: string;
}>(sigHeader);

// invoice をデコードして payment_hash を取得
const decoded = decodeBolt11(sig.invoice);
const paymentHash = decoded.paymentHash;

const payment = await lightning.lookupInvoice(paymentHash);

if (!payment.settled) {
  return requirePayment(res);
}

return serveResource(res);
```

---

## 8. セキュリティと性質

### 成立している点

* ウォレット非依存
* preimage 非公開
* x402 ヘッダー完全互換
* クライアントの同一性不要
* API / ペイウォール / AI エージェントに適合

### 性質上の注意

* invoice は Bearer トークンとして機能
* 転送可能性あり（TTL・単発利用で制御）
* Lightning settle の遅延は影響する

---

## 9. まとめ

* `PaymentSignature` に **invoice をそのまま入れる設計**は

  * x402 的に自然
  * クライアント実装が最小
  * サーバ検証モデルと完全整合
* Lightning を使った x402 実装として
  **最小・現実的・拡張可能な構成**

この設計は、記事課金・API 課金・AI の自動支払いフローのいずれにも無理なく適用できます。
