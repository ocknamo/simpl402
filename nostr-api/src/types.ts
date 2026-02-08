/**
 * x402 Protocol Types
 */

export interface PaymentRequired {
	scheme: 'lightning';
	network: 'bitcoin';
	invoice: string;
}

export interface PaymentSignature {
	scheme: 'lightning';
	network: 'bitcoin';
	invoice: string;
}

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
	hash: string; // payment hash or bitcoin address
	text: string; // BOLT11 invoice or bitcoin URI
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
