/**
 * x402 Protocol Types - v2 Specification Compliant
 */

// ============================================================
// x402 v2 Core Types
// ============================================================

/**
 * Describes the resource being accessed
 */
export interface X402Resource {
	url: string;
	description: string;
	mimeType: string;
}

/**
 * A payment method accepted by the server
 */
export interface X402PaymentMethod {
	scheme: string;
	network: string;
	amount: string;
	asset: string;
	payTo?: string;
	maxTimeoutSeconds?: number;
	extra?: Record<string, unknown>;
}

/**
 * 402 Payment Required response payload (PAYMENT-REQUIRED header)
 */
export interface X402PaymentRequired {
	x402Version: 2;
	error: string;
	resource: X402Resource;
	accepts: X402PaymentMethod[];
}

/**
 * Payment payload sent by client (PAYMENT-SIGNATURE header)
 */
export interface X402PaymentPayload {
	x402Version: 2;
	resource: X402Resource;
	accepted: X402PaymentMethod;
	payload: Record<string, unknown>;
}

/**
 * Settlement response from server (PAYMENT-RESPONSE header)
 */
export interface X402SettlementResponse {
	success: boolean;
	transaction?: string;
	network?: string;
	payer?: string;
	errorReason?: string;
	extra?: Record<string, unknown>;
}

// ============================================================
// Lightning Network Specific Types
// ============================================================

/**
 * Lightning Network payment method (extends X402PaymentMethod)
 */
export interface LightningPaymentMethod extends X402PaymentMethod {
	scheme: 'exact';
	network: 'lightning:bitcoin';
	asset: 'BTC';
	extra: {
		invoice: string;
	};
}

/**
 * Lightning Network payment payload (inside X402PaymentPayload.payload)
 * Client simply returns the received invoice as-is
 */
export interface LightningPaymentPayload {
	invoice: string;
}

/**
 * Lightning Network settlement extra info
 */
export interface LightningSettlementExtra {
	invoice: string;
	settledAt: number;
}

// ============================================================
// Internal Types (unchanged)
// ============================================================

export interface DecodedInvoice {
	paymentHash: string;
	satoshis: number;
	timestamp: number;
	timeExpireDate: number;
}

export interface CoinosInvoiceResponse {
	amount: number;
	tip: number;
	type: string;
	prompt: boolean;
	rate: number;
	hash: string;
	text: string;
	currency: string;
	uid: string;
	received: number;
	created: number;
}

export interface CoinosPaymentResponse {
	id: string;
	hash: string;
	amount: number;
	confirmed: boolean;
	received: boolean;
}
