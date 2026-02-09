/**
 * Utility functions for x402 protocol
 */

import type { X402Resource, X402PaymentMethod, X402PaymentRequired, X402SettlementResponse, LightningPaymentMethod } from './types';

/**
 * Encode object to Base64 JSON string
 */
export function encodeBase64(obj: unknown): string {
	const json = JSON.stringify(obj);
	return btoa(json);
}

/**
 * Decode Base64 JSON string to object
 */
export function decodeBase64<T>(value: string): T {
	const json = atob(value);
	return JSON.parse(json) as T;
}

/**
 * Create x402 resource object from request
 */
export function createResourceFromRequest(request: Request): X402Resource {
	const url = new URL(request.url);

	const descriptions: Record<string, string> = {
		'/nostr/secret-key': 'Access to Nostr secret key',
	};

	return {
		url: url.toString(),
		description: descriptions[url.pathname] || 'Protected resource',
		mimeType: 'application/json',
	};
}

/**
 * Create Lightning payment method from invoice
 */
export function createLightningPaymentMethod(
	invoice: string,
	amountSats: number,
	expirySeconds: number
): LightningPaymentMethod {
	return {
		scheme: 'lightning',
		network: 'bitcoin',
		amount: (amountSats * 1000).toString(), // Convert sats to millisatoshis
		asset: 'BTC',
		maxTimeoutSeconds: expirySeconds,
		extra: {
			invoice: invoice,
		},
	};
}

/**
 * Create x402 PaymentRequired response object
 */
export function createPaymentRequired(
	resource: X402Resource,
	accepts: X402PaymentMethod[],
	error: string = 'PAYMENT-SIGNATURE header is required'
): X402PaymentRequired {
	return {
		x402Version: 2,
		error,
		resource,
		accepts,
	};
}

/**
 * Create x402 SettlementResponse for success
 */
export function createSuccessSettlement(invoice: string): X402SettlementResponse {
	return {
		success: true,
		transaction: invoice,
		network: 'bitcoin',
		payer: 'anonymous',
		extra: {
			invoice: invoice,
			settledAt: Math.floor(Date.now() / 1000),
		},
	};
}

/**
 * Create x402 SettlementResponse for failure
 */
export function createFailureSettlement(errorReason: string): X402SettlementResponse {
	return {
		success: false,
		errorReason,
		network: 'bitcoin',
	};
}
