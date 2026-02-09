# x402 HTTP Transport 仕様との比較

## 概要

このドキュメントは、現在の Lightning Network 実装と x402 HTTP Transport 仕様（v2）との差分を分析したものです。

## 主要な差分

### 1. **プロトコルバージョンの欠如**

**仕様:**
```json
{
  "x402Version": 2,
  ...
}
```

**現在の実装:**
- `x402Version` フィールドが含まれていない
- バージョン管理が行われていない

**影響:** プロトコルの互換性管理ができない

---

### 2. **PaymentRequired の構造が大幅に異なる**

**仕様:**
```json
{
  "x402Version": 2,
  "error": "PAYMENT-SIGNATURE header is required",
  "resource": {
    "url": "https://api.example.com/premium-data",
    "description": "Access to premium market data",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:84532",
      "amount": "10000",
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "payTo": "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
      "maxTimeoutSeconds": 60,
      "extra": { ... }
    }
  ]
}
```

**現在の実装:**
```json
{
  "scheme": "lightning",
  "network": "bitcoin",
  "invoice": "lnbc..."
}
```

**差分:**
- ❌ `x402Version` フィールドがない
- ❌ `error` フィールドがない（エラーメッセージの説明）
- ❌ `resource` オブジェクトがない（リソースの詳細情報）
- ❌ `accepts` 配列がない（複数の支払い方法をサポートできない）
- ✅ Lightning 固有の `invoice` フィールドを直接含む（簡略化されている）

**影響:**
- クライアントがリソース情報を取得できない
- 複数の支払い方法を提示できない
- エラーメッセージが標準化されていない

---

### 3. **PaymentSignature (PaymentPayload) の構造が異なる**

**仕様:**
```json
{
  "x402Version": 2,
  "resource": {
    "url": "https://api.example.com/premium-data",
    "description": "Access to premium market data",
    "mimeType": "application/json"
  },
  "accepted": {
    "scheme": "exact",
    "network": "eip155:84532",
    "amount": "10000",
    "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    "payTo": "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
    "maxTimeoutSeconds": 60,
    "extra": { ... }
  },
  "payload": {
    "signature": "0x2d6a7588...",
    "authorization": { ... }
  }
}
```

**現在の実装:**
```json
{
  "scheme": "lightning",
  "network": "bitcoin",
  "invoice": "lnbc..."
}
```

**差分:**
- ❌ `x402Version` フィールドがない
- ❌ `resource` オブジェクトがない
- ❌ `accepted` オブジェクトがない（どの支払い方法を選択したか不明）
- ❌ `payload` オブジェクトがない
- ✅ Lightning 固有の `invoice` フィールドのみ

**影響:**
- サーバーがどのリソースに対する支払いか確認できない
- 支払い方法の選択が明示的でない
- 標準的な x402 クライアントとの互換性がない

---

### 4. **SettlementResponse (PAYMENT-RESPONSE) が実装されていない**

**仕様:**
```json
{
  "success": true,
  "transaction": "0x1234567890abcdef...",
  "network": "eip155:84532",
  "payer": "0x857b06519E91e3A54538791bDbb0E22373e36b66"
}
```

**現在の実装:**
- `PAYMENT-RESPONSE` ヘッダーが全く実装されていない
- 支払い結果の詳細情報が返されない

**影響:**
- クライアントが支払いの詳細（トランザクションID、支払者アドレスなど）を取得できない
- 支払い失敗時の理由が不明確

---

### 5. **エラーハンドリングの違い**

**仕様:**
- 支払い失敗時も `PAYMENT-RESPONSE` ヘッダーを返す
- `errorReason` フィールドで失敗理由を明示

**現在の実装:**
- 単純な HTTP ステータスコードとテキストメッセージのみ
- 構造化されたエラー情報がない

---

### 6. **Lightning Network 固有の拡張**

**現在の実装の特徴:**
- ✅ BOLT11 インボイスのデコード機能
- ✅ インボイスの有効期限チェック
- ✅ インボイスの再利用防止（KV ストア使用）
- ✅ coinos.io API との統合

これらは Lightning Network 固有の実装であり、x402 仕様の `extra` フィールドで拡張情報として含めることができる。

---

## 互換性の問題

### 現在の実装の問題点

1. **標準的な x402 クライアントと互換性がない**
   - 仕様で定義された必須フィールドが欠けている
   - 構造が大幅に簡略化されている

2. **拡張性が低い**
   - 複数の支払い方法をサポートできない
   - リソース情報を含められない

3. **デバッグが困難**
   - エラー情報が不十分
   - 支払い結果の詳細が取得できない

### Lightning Network 実装としての利点

1. **シンプルで実装が容易**
   - 必要最小限のフィールドのみ
   - Lightning Network に特化

2. **実用的な機能**
   - インボイスの再利用防止
   - 有効期限チェック

---

## 推奨される改善案

### オプション A: x402 仕様に完全準拠

Lightning Network を x402 の `accepts` 配列の一つの支払い方法として実装する。

**PaymentRequired の例:**
```json
{
  "x402Version": 2,
  "error": "PAYMENT-SIGNATURE header is required",
  "resource": {
    "url": "https://api.example.com/nostr/secret-key",
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
        "invoice": "lnbc100n1...",
        "paymentHash": "abc123...",
        "expiresAt": 1740672154
      }
    }
  ]
}
```

**PaymentPayload の例:**
```json
{
  "x402Version": 2,
  "resource": {
    "url": "https://api.example.com/nostr/secret-key",
    "description": "Access to Nostr secret key",
    "mimeType": "application/json"
  },
  "accepted": {
    "scheme": "lightning",
    "network": "bitcoin",
    "amount": "100",
    "asset": "BTC",
    "maxTimeoutSeconds": 3600,
    "extra": {
      "invoice": "lnbc100n1...",
      "paymentHash": "abc123..."
    }
  },
  "payload": {
    "invoice": "lnbc100n1...",
    "preimage": "def456..." // 支払い証明（オプション）
  }
}
```

**SettlementResponse の例:**
```json
{
  "success": true,
  "transaction": "abc123...", // payment hash
  "network": "bitcoin",
  "payer": "node_pubkey_or_identifier",
  "extra": {
    "preimage": "def456...",
    "settledAt": 1740672100
  }
}
```

### オプション B: Lightning Network 専用実装を維持

現在の簡略化された実装を維持しつつ、最小限の x402 互換性を追加する。

**最小限の変更:**
1. `x402Version: 2` フィールドを追加
2. `PAYMENT-RESPONSE` ヘッダーを実装（簡易版）

---

## まとめ

| 項目 | x402 仕様 | 現在の実装 | 互換性 |
|------|-----------|------------|--------|
| プロトコルバージョン | ✅ 必須 | ❌ なし | ❌ |
| resource オブジェクト | ✅ 必須 | ❌ なし | ❌ |
| accepts 配列 | ✅ 必須 | ❌ なし | ❌ |
| accepted オブジェクト | ✅ 必須 | ❌ なし | ❌ |
| payload オブジェクト | ✅ 必須 | ❌ なし | ❌ |
| PAYMENT-RESPONSE | ✅ 必須 | ❌ なし | ❌ |
| Lightning invoice | ➖ extra | ✅ あり | ⚠️ 独自 |
| インボイス再利用防止 | ➖ 実装依存 | ✅ あり | ✅ |
| 有効期限チェック | ➖ 実装依存 | ✅ あり | ✅ |

**結論:**
現在の実装は Lightning Network に特化したシンプルな実装であり、実用的ではあるが、x402 HTTP Transport 仕様（v2）とは互換性がない。標準的な x402 クライアントとの相互運用性を確保するには、仕様に準拠した構造への変更が必要。
