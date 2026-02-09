# x402 移行計画サマリー

## フィードバック反映後の設計方針

### 🎯 シンプルさを重視した設計

ユーザーフィードバックに基づき、以下の方針で実装を簡略化します：

1. **✅ クライアント負担の軽減**
   - preimage の要求を削除
   - paymentHash の抽出を削除
   - クライアントは受け取った invoice をそのまま返すだけ

2. **✅ サーバー側で処理**
   - invoice のデコードはサーバー側で実施
   - 検証ロジックはサーバーに集約

3. **✅ 正しい単位の使用**
   - amount の単位を millisatoshis に統一（Lightning Network の標準）

---

## 主要な変更点

### 型定義の簡略化

**LightningPaymentMethod:**
```typescript
export interface LightningPaymentMethod extends X402PaymentMethod {
  scheme: 'lightning';
  network: 'bitcoin';
  asset: 'BTC';
  extra: {
    invoice: string; // BOLT11 invoice のみ
  };
}
```

**LightningPaymentPayload:**
```typescript
export interface LightningPaymentPayload {
  invoice: string; // 受け取った invoice をそのまま返す
}
```

**LightningSettlementExtra:**
```typescript
export interface LightningSettlementExtra {
  invoice: string; // 支払われた invoice
  settledAt: number;
}
```

### ユーティリティ関数の簡略化

```typescript
export function createLightningPaymentMethod(
  invoice: string,
  amountMillisats: number, // ← millisatoshis に変更
  expirySeconds: number
): LightningPaymentMethod {
  return {
    scheme: 'lightning',
    network: 'bitcoin',
    amount: amountMillisats.toString(), // ← millisatoshis
    asset: 'BTC',
    maxTimeoutSeconds: expirySeconds,
    extra: {
      invoice: invoice, // ← invoice のみ（デコード不要）
    },
  };
}
```

### レスポンスの簡略化

**成功時:**
```typescript
const settlementResponse: X402SettlementResponse = {
  success: true,
  transaction: invoice, // ← invoice をそのまま使用
  network: 'bitcoin',
  payer: 'anonymous',
  extra: {
    invoice: invoice, // ← invoice を記録
    settledAt: Math.floor(Date.now() / 1000),
  },
};
```

---

## クライアント側の実装例

### 簡略化されたフロー

```typescript
// 1. 402 レスポンスを受け取る
const response = await fetch('/nostr/secret-key');
if (response.status === 402) {
  const paymentRequired = decodeBase64(
    response.headers.get('PAYMENT-REQUIRED')
  );
  
  // 2. invoice を取得（extra フィールドから）
  const invoice = paymentRequired.accepts[0].extra.invoice;
  
  // 3. Lightning ウォレットで支払い
  await payInvoice(invoice);
  
  // 4. 支払い後、invoice をそのまま返す（シンプル！）
  const paymentPayload = {
    x402Version: 2,
    resource: paymentRequired.resource,
    accepted: paymentRequired.accepts[0],
    payload: {
      invoice: invoice, // ← そのまま返すだけ
    },
  };
  
  // 5. リトライ
  const retryResponse = await fetch('/nostr/secret-key', {
    headers: {
      'PAYMENT-SIGNATURE': encodeBase64(paymentPayload),
    },
  });
  
  // 6. 成功レスポンスを取得
  const data = await retryResponse.json();
  console.log(data.secretKey);
}
```

**従来の複雑な実装（不要になった）:**
```typescript
// ❌ 不要: invoice のデコード
const decoded = decodeBolt11(invoice);

// ❌ 不要: paymentHash の抽出
const paymentHash = decoded.paymentHash;

// ❌ 不要: preimage の取得
const preimage = await getPreimage(invoice);
```

---

## サーバー側の実装変更

### 環境変数の変更

```bash
# 従来（satoshis）
INVOICE_AMOUNT_SATS=100

# 新しい（millisatoshis）
INVOICE_AMOUNT_MSATS=100000  # 100 sats = 100,000 msats
```

### createInvoice 関数の呼び出し

```typescript
// 従来
const invoiceData = await createInvoice(
  env.COINOS_API_URL,
  apiKey,
  parseInt(env.INVOICE_AMOUNT_SATS), // satoshis
  parseInt(env.INVOICE_EXPIRY_SECONDS)
);

// 新しい
const amountSats = parseInt(env.INVOICE_AMOUNT_SATS);
const amountMillisats = amountSats * 1000; // sats → msats 変換

const invoiceData = await createInvoice(
  env.COINOS_API_URL,
  apiKey,
  amountSats, // coinos API は sats を使用
  parseInt(env.INVOICE_EXPIRY_SECONDS)
);

// x402 では millisatoshis を使用
const lightningMethod = createLightningPaymentMethod(
  invoiceData.text,
  amountMillisats, // ← millisatoshis
  parseInt(env.INVOICE_EXPIRY_SECONDS)
);
```

---

## 実装の利点

### ✅ クライアント側

1. **実装が簡単**
   - invoice をそのまま返すだけ
   - デコードライブラリ不要
   - エラーハンドリングが簡単

2. **パフォーマンス向上**
   - クライアント側の処理が最小限
   - ネットワーク転送量が削減

3. **互換性向上**
   - どんな Lightning ウォレットでも対応可能
   - 特殊な機能（preimage 取得など）が不要

### ✅ サーバー側

1. **検証の一元化**
   - invoice の検証はサーバー側で完結
   - セキュリティ管理が容易

2. **柔軟性**
   - 検証ロジックの変更が容易
   - クライアントへの影響なし

3. **標準準拠**
   - Lightning Network の標準単位（millisatoshis）を使用
   - x402 仕様に完全準拠

---

## 次のステップ

1. ✅ 移行計画の更新完了
2. ⏭️ 型定義の実装（`src/types.ts`）
3. ⏭️ ユーティリティ関数の実装（`src/utils.ts`）
4. ⏭️ メインハンドラーの更新（`src/index.ts`）
5. ⏭️ テストの更新
6. ⏭️ ドキュメントの更新

実装を開始する準備ができました！
