# x402 仕様完全準拠への移行計画

## 目標

現在の Lightning Network 実装を x402 HTTP Transport 仕様（v2）に完全準拠させる。

## 移行戦略

### フェーズ 1: 型定義の更新
既存の簡易型を x402 仕様準拠の型に置き換える。

### フェーズ 2: コア実装の更新
リクエスト/レスポンス処理を x402 仕様に準拠させる。

### フェーズ 3: テストとドキュメント更新
新しい実装のテストとドキュメントを整備する。

---

## 詳細な実装計画

### ステップ 1: 型定義の拡張 (`src/types.ts`)

#### 1.1 x402 コア型の追加

```typescript
// x402 v2 Core Types
export interface X402Resource {
  url: string;
  description: string;
  mimeType: string;
}

export interface X402PaymentMethod {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo?: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
}

export interface X402PaymentRequired {
  x402Version: 2;
  error: string;
  resource: X402Resource;
  accepts: X402PaymentMethod[];
}

export interface X402PaymentPayload {
  x402Version: 2;
  resource: X402Resource;
  accepted: X402PaymentMethod;
  payload: Record<string, unknown>;
}

export interface X402SettlementResponse {
  success: boolean;
  transaction?: string;
  network?: string;
  payer?: string;
  errorReason?: string;
  extra?: Record<string, unknown>;
}
```

#### 1.2 Lightning Network 固有の型

```typescript
// Lightning Network specific types for x402 extra field
export interface LightningPaymentMethod extends X402PaymentMethod {
  scheme: 'lightning';
  network: 'bitcoin';
  asset: 'BTC';
  extra: {
    invoice: string; // BOLT11 invoice string
  };
}

export interface LightningPaymentPayload {
  invoice: string; // Simply return the received invoice as-is
}

export interface LightningSettlementExtra {
  invoice: string; // The paid invoice
  settledAt: number;
}
```

**設計方針:**
- ✅ **シンプルさ重視**: クライアントは受け取った invoice をそのまま返すだけ
- ✅ **クライアント負担軽減**: preimage や paymentHash の抽出は不要
- ✅ **サーバー側で処理**: invoice のデコードや検証はサーバー側で実施

---

### ステップ 2: ユーティリティ関数の追加 (`src/utils.ts`)

#### 2.1 リソース情報の生成

```typescript
/**
 * Create x402 resource object from request
 */
export function createResourceFromRequest(request: Request): X402Resource {
  const url = new URL(request.url);
  
  // Map endpoints to descriptions
  const descriptions: Record<string, string> = {
    '/nostr/secret-key': 'Access to Nostr secret key',
  };
  
  return {
    url: url.toString(),
    description: descriptions[url.pathname] || 'Protected resource',
    mimeType: 'application/json',
  };
}
```

#### 2.2 Lightning 支払い方法の生成

```typescript
/**
 * Create Lightning payment method from invoice
 */
export function createLightningPaymentMethod(
  invoice: string,
  amountMillisats: number,
  expirySeconds: number
): LightningPaymentMethod {
  return {
    scheme: 'lightning',
    network: 'bitcoin',
    amount: amountMillisats.toString(), // Amount in millisatoshis
    asset: 'BTC',
    maxTimeoutSeconds: expirySeconds,
    extra: {
      invoice: invoice, // Just include the invoice, no decoding needed
    },
  };
}
```

**重要な変更:**
- ✅ **amount の単位**: millisatoshis を使用（Lightning Network の標準単位）
- ✅ **extra フィールド**: invoice のみを含む（シンプル化）
- ✅ **デコード不要**: paymentHash や expiresAt の抽出を削除

---

### ステップ 3: メインハンドラーの更新 (`src/index.ts`)

#### 3.1 `requirePayment` 関数の更新

**変更前:**
```typescript
const paymentRequired: PaymentRequired = {
  scheme: 'lightning',
  network: 'bitcoin',
  invoice: invoiceData.text,
};
```

**変更後:**
```typescript
const resource = createResourceFromRequest(request);
const lightningMethod = createLightningPaymentMethod(
  invoiceData.text,
  parseInt(env.INVOICE_AMOUNT_SATS),
  parseInt(env.INVOICE_EXPIRY_SECONDS)
);

const paymentRequired: X402PaymentRequired = {
  x402Version: 2,
  error: 'PAYMENT-SIGNATURE header is required',
  resource: resource,
  accepts: [lightningMethod],
};
```

#### 3.2 `handleSecretKeyEndpoint` 関数の更新

**支払い検証部分の変更:**

```typescript
// Decode payment payload
const paymentPayload = decodeBase64<X402PaymentPayload>(paymentSigHeader);

// Validate x402 version
if (paymentPayload.x402Version !== 2) {
  return createErrorResponse(
    'Unsupported x402 version',
    400,
    'unsupported_version'
  );
}

// Validate resource matches
const currentResource = createResourceFromRequest(request);
if (paymentPayload.resource.url !== currentResource.url) {
  return createErrorResponse(
    'Resource mismatch',
    400,
    'resource_mismatch'
  );
}

// Validate payment method is Lightning
if (paymentPayload.accepted.scheme !== 'lightning') {
  return createErrorResponse(
    'Unsupported payment scheme',
    400,
    'unsupported_scheme'
  );
}

// Extract Lightning-specific payload
const lightningPayload = paymentPayload.payload as LightningPaymentPayload;
const invoice = lightningPayload.invoice;

if (!invoice) {
  return createErrorResponse(
    'Missing invoice in payload',
    400,
    'missing_invoice'
  );
}
```

**支払い成功時のレスポンス:**

```typescript
// Payment verified - create settlement response
const settlementResponse: X402SettlementResponse = {
  success: true,
  transaction: invoice, // Use invoice as transaction identifier
  network: 'bitcoin',
  payer: 'anonymous', // Lightning doesn't expose payer identity by default
  extra: {
    invoice: invoice,
    settledAt: Math.floor(Date.now() / 1000),
  } as LightningSettlementExtra,
};

// Return the secret key with settlement response header
const response = {
  secretKey: 'nsec1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
};

return new Response(JSON.stringify(response), {
  status: 200,
  headers: {
    'Content-Type': 'application/json',
    'PAYMENT-RESPONSE': encodeBase64(settlementResponse),
  },
});
```

**変更点:**
- ✅ **transaction フィールド**: invoice をそのまま使用（デコード不要）
- ✅ **extra.invoice**: 支払われた invoice を記録
- ✅ **シンプル化**: paymentHash の抽出を削除

**支払い失敗時のレスポンス:**

```typescript
// Payment not confirmed - return 402 with settlement response
const settlementResponse: X402SettlementResponse = {
  success: false,
  errorReason: 'payment_not_confirmed',
  network: 'bitcoin',
};

const resource = createResourceFromRequest(request);
const paymentRequired: X402PaymentRequired = {
  x402Version: 2,
  error: 'Payment not confirmed',
  resource: resource,
  accepts: [/* regenerate payment methods */],
};

return new Response(JSON.stringify(paymentRequired), {
  status: 402,
  headers: {
    'Content-Type': 'application/json',
    'PAYMENT-REQUIRED': encodeBase64(paymentRequired),
    'PAYMENT-RESPONSE': encodeBase64(settlementResponse),
  },
});
```

#### 3.3 エラーハンドリング関数の追加

```typescript
/**
 * Create error response with x402 settlement response
 */
function createErrorResponse(
  message: string,
  status: number,
  errorReason: string,
  request?: Request
): Response {
  const settlementResponse: X402SettlementResponse = {
    success: false,
    errorReason: errorReason,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'PAYMENT-RESPONSE': encodeBase64(settlementResponse),
  };

  // If 402, also include PAYMENT-REQUIRED
  if (status === 402 && request) {
    const resource = createResourceFromRequest(request);
    const paymentRequired: X402PaymentRequired = {
      x402Version: 2,
      error: message,
      resource: resource,
      accepts: [], // Would need to regenerate invoice
    };
    headers['PAYMENT-REQUIRED'] = encodeBase64(paymentRequired);
  }

  return new Response(JSON.stringify({ error: message }), {
    status,
    headers,
  });
}
```

---

### ステップ 4: Lightning 統合の更新 (`src/lightning.ts`)

既存の関数は基本的にそのまま使用可能。必要に応じて以下を追加:

```typescript
/**
 * Extract invoice from x402 payment payload
 */
export function extractInvoiceFromPayload(payload: X402PaymentPayload): string | null {
  if (payload.accepted.scheme !== 'lightning') {
    return null;
  }
  
  const lightningPayload = payload.payload as LightningPaymentPayload;
  return lightningPayload.invoice || null;
}
```

---

### ステップ 5: テストの更新 (`test/index.spec.ts`)

#### 5.1 新しいテストケースの追加

```typescript
describe('x402 v2 compliance', () => {
  it('should return x402Version in PAYMENT-REQUIRED', async () => {
    const response = await SELF.fetch('https://example.com/nostr/secret-key');
    expect(response.status).toBe(402);
    
    const header = response.headers.get('PAYMENT-REQUIRED');
    const decoded = JSON.parse(atob(header!));
    
    expect(decoded.x402Version).toBe(2);
    expect(decoded.resource).toBeDefined();
    expect(decoded.accepts).toBeInstanceOf(Array);
  });

  it('should return PAYMENT-RESPONSE on success', async () => {
    // ... setup paid invoice ...
    
    const response = await SELF.fetch('https://example.com/nostr/secret-key', {
      headers: {
        'PAYMENT-SIGNATURE': encodeBase64(paymentPayload),
      },
    });
    
    expect(response.status).toBe(200);
    
    const settlementHeader = response.headers.get('PAYMENT-RESPONSE');
    const settlement = JSON.parse(atob(settlementHeader!));
    
    expect(settlement.success).toBe(true);
    expect(settlement.transaction).toBeDefined();
    expect(settlement.network).toBe('bitcoin');
  });

  it('should return PAYMENT-RESPONSE on failure', async () => {
    // ... setup unpaid invoice ...
    
    const response = await SELF.fetch('https://example.com/nostr/secret-key', {
      headers: {
        'PAYMENT-SIGNATURE': encodeBase64(paymentPayload),
      },
    });
    
    expect(response.status).toBe(402);
    
    const settlementHeader = response.headers.get('PAYMENT-RESPONSE');
    const settlement = JSON.parse(atob(settlementHeader!));
    
    expect(settlement.success).toBe(false);
    expect(settlement.errorReason).toBeDefined();
  });
});
```

---

### ステップ 6: ドキュメントの更新

#### 6.1 README.md の更新

- x402 v2 準拠であることを明記
- 新しいリクエスト/レスポンス例を追加
- Lightning Network 固有の `extra` フィールドの説明

#### 6.2 TESTING.md の更新

- 新しいペイロード形式の例
- `PAYMENT-RESPONSE` ヘッダーの確認方法

---

## 実装順序

1. ✅ **ステップ 1**: 型定義の拡張 (`src/types.ts`)
2. ✅ **ステップ 2**: ユーティリティ関数の追加 (`src/utils.ts`)
3. ✅ **ステップ 3**: メインハンドラーの更新 (`src/index.ts`)
4. ✅ **ステップ 4**: Lightning 統合の更新 (`src/lightning.ts`)
5. ✅ **ステップ 5**: テストの更新 (`test/index.spec.ts`)
6. ✅ **ステップ 6**: ドキュメントの更新 (`README.md`, `TESTING.md`)

---

## 後方互換性の考慮

### オプション A: 完全移行（推奨）
- 古い形式のサポートを削除
- クリーンな実装
- x402 標準に完全準拠

### オプション B: 段階的移行
- 古い形式と新しい形式の両方をサポート
- `x402Version` フィールドの有無で判定
- 移行期間を設ける

**推奨**: オプション A（完全移行）
- 現在の実装はまだ本番運用されていない想定
- クリーンな実装の方が保守性が高い

---

## 検証項目

### 機能テスト
- [ ] 402 レスポンスに正しい `PAYMENT-REQUIRED` ヘッダーが含まれる
- [ ] `x402Version: 2` が含まれる
- [ ] `resource` オブジェクトが正しく生成される
- [ ] `accepts` 配列に Lightning 支払い方法が含まれる
- [ ] 支払い成功時に `PAYMENT-RESPONSE` ヘッダーが返される
- [ ] 支払い失敗時に `PAYMENT-RESPONSE` ヘッダーが返される
- [ ] インボイスの再利用防止が機能する
- [ ] インボイスの有効期限チェックが機能する

### 互換性テスト
- [ ] x402 標準クライアントとの互換性確認
- [ ] 既存の Lightning Network 機能が正常動作

### エラーハンドリング
- [ ] 不正な `x402Version` の処理
- [ ] リソースミスマッチの処理
- [ ] サポートされていない支払い方法の処理
- [ ] 不正なペイロード形式の処理

---

## リスクと対策

### リスク 1: 既存クライアントの互換性喪失
**対策**: 
- 新しい形式のみをサポート（クリーンな移行）
- ドキュメントで明確に新形式を説明

### リスク 2: 実装の複雑化
**対策**:
- ユーティリティ関数で複雑性を隠蔽
- 型システムで安全性を確保

### リスク 3: テストの不足
**対策**:
- 包括的なテストケースを作成
- 実際の Lightning Network との統合テスト

---

## 完了基準

1. すべての型定義が x402 v2 仕様に準拠
2. すべてのエンドポイントが正しい x402 ヘッダーを返す
3. すべてのテストがパス
4. ドキュメントが最新の実装を反映
5. 実際の Lightning Network での動作確認

---

## 次のステップ

この計画に基づいて、以下の順序で実装を進めます:

1. `src/types.ts` の更新
2. `src/utils.ts` の更新
3. `src/index.ts` の更新
4. `src/lightning.ts` の更新（必要に応じて）
5. テストの更新
6. ドキュメントの更新
7. 動作確認

各ステップ完了後、動作確認を行いながら進めます。
