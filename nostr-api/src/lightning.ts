/**
 * Lightning Network integration using coinos.io API
 */

import { decode } from 'light-bolt11-decoder';
import type { CoinosInvoiceResponse, CoinosPaymentResponse, DecodedInvoice } from './types';

/**
 * Create a Lightning invoice using coinos.io API
 */
export async function createInvoice(
	apiUrl: string,
	apiKey: string,
	amountSats: number,
	expirySeconds: number
): Promise<CoinosInvoiceResponse> {
	console.log('[DEBUG] Creating invoice with:', { apiUrl, amountSats });
	
	const response = await fetch(`${apiUrl}/invoice`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			invoice: {
				amount: amountSats,
				type: 'lightning',
			},
		}),
	});

	console.log('[DEBUG] Invoice creation response status:', response.status);

	if (!response.ok) {
		const errorText = await response.text();
		console.log('[DEBUG] Invoice creation error:', errorText);
		throw new Error(`Failed to create invoice: ${response.statusText}`);
	}

	const invoiceData: CoinosInvoiceResponse = await response.json();
	console.log('[DEBUG] Created invoice:', {
		hash: invoiceData.hash,
		text: invoiceData.text?.substring(0, 50) + '...',
		amount: invoiceData.amount,
		uid: invoiceData.uid,
	});

	return invoiceData;
}

/**
 * Verify if a payment has been received using coinos.io API
 * Uses GET /invoice/:hash to check the received amount
 * Note: The hash parameter should be the BOLT11 invoice string (from invoice.hash field)
 */
export async function verifyPayment(apiUrl: string, apiKey: string, bolt11Invoice: string): Promise<boolean> {
	console.log('[DEBUG] Fetching invoice from:', `${apiUrl}/invoice/${bolt11Invoice}`);
	
	const response = await fetch(`${apiUrl}/invoice/${bolt11Invoice}`, {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
		},
	});

	console.log('[DEBUG] Invoice fetch response status:', response.status);

	if (!response.ok) {
		const errorText = await response.text();
		console.log('[DEBUG] Invoice fetch error:', errorText);
		return false;
	}

	const invoice: CoinosInvoiceResponse = await response.json();
	console.log('[DEBUG] Invoice data:', {
		amount: invoice.amount,
		received: invoice.received,
		type: invoice.type,
		hash: invoice.hash,
	});
	
	// Check if the invoice has been paid (received >= amount)
	const isPaid = invoice.received >= invoice.amount;
	console.log('[DEBUG] Payment check: received >= amount?', `${invoice.received} >= ${invoice.amount} = ${isPaid}`);
	
	return isPaid;
}

/**
 * Decode BOLT11 invoice to extract payment hash and other details
 */
export function decodeBolt11(invoice: string): DecodedInvoice {
	const decoded = decode(invoice);

	// Extract payment hash
	const paymentHashSection = decoded.sections.find((s) => s.name === 'payment_hash');
	if (!paymentHashSection || !paymentHashSection.value) {
		throw new Error('Invalid invoice: payment_hash not found');
	}

	// Extract amount (in millisatoshis)
	const amountSection = decoded.sections.find((s) => s.name === 'amount');
	const satoshis = amountSection && typeof amountSection.value === 'string' ? parseInt(amountSection.value) / 1000 : 0;

	// Extract timestamp
	const timestampSection = decoded.sections.find((s) => s.name === 'timestamp');
	const timestamp = timestampSection && typeof timestampSection.value === 'number' ? timestampSection.value : 0;

	// Extract expiry
	const expirySection = decoded.sections.find((s) => s.name === 'expiry');
	const expiry = expirySection && typeof expirySection.value === 'number' ? expirySection.value : 3600;

	return {
		paymentHash: paymentHashSection.value as string,
		satoshis,
		timestamp,
		timeExpireDate: timestamp + expiry,
	};
}
