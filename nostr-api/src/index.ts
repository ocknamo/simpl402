/**
 * x402 over Lightning Network - Cloudflare Workers Implementation
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { createInvoice, verifyPayment, decodeBolt11 } from './lightning';
import { encodeBase64, decodeBase64 } from './utils';
import type { PaymentRequired, PaymentSignature } from './types';

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);

		// GET /nostr/secret-key エンドポイント (x402 protected)
		if (request.method === 'GET' && url.pathname === '/nostr/secret-key') {
			return handleSecretKeyEndpoint(request, env);
		}

		// その他のルート - 404
		return new Response('Not Found', { status: 404 });
	},
} satisfies ExportedHandler<Env>;

/**
 * Handle /nostr/secret-key endpoint with x402 payment protection
 */
async function handleSecretKeyEndpoint(request: Request, env: Env): Promise<Response> {
	const paymentSigHeader = request.headers.get('PAYMENT-SIGNATURE');

	// No payment signature - require payment
	if (!paymentSigHeader) {
		return requirePayment(env);
	}

	// Payment signature provided - verify payment
	try {
		const paymentSig = decodeBase64<PaymentSignature>(paymentSigHeader);

		// Validate signature structure
		if (paymentSig.scheme !== 'lightning' || paymentSig.network !== 'bitcoin' || !paymentSig.invoice) {
			return new Response('Invalid payment signature', { status: 400 });
		}

		// Decode invoice to get payment hash
		const decoded = decodeBolt11(paymentSig.invoice);

		// Check if invoice is expired
		const now = Math.floor(Date.now() / 1000);
		if (decoded.timeExpireDate < now) {
			return new Response('Invoice expired', { status: 402 });
		}

		// Check if invoice has already been used
		const usedKey = `used:${decoded.paymentHash}`;
		const alreadyUsed = await env.USED_INVOICES.get(usedKey);
		if (alreadyUsed) {
			return new Response('Invoice already used', { status: 402 });
		}

		// Verify payment with Lightning node
		const apiKey = env.COINOS_API_KEY;
		if (!apiKey) {
			return new Response('Server configuration error: API key not set', { status: 500 });
		}

		console.log('[DEBUG] Verifying payment for invoice:', paymentSig.invoice.substring(0, 50) + '...');
		console.log('[DEBUG] Invoice details:', {
			paymentHash: decoded.paymentHash,
			satoshis: decoded.satoshis,
			timestamp: decoded.timestamp,
			timeExpireDate: decoded.timeExpireDate,
			currentTime: now,
		});

		const isPaid = await verifyPayment(env.COINOS_API_URL, apiKey, paymentSig.invoice);

		console.log('[DEBUG] Payment verification result:', isPaid);

		if (!isPaid) {
			return new Response('Payment not confirmed', { status: 402 });
		}

		// Mark invoice as used (TTL: 24 hours)
		await env.USED_INVOICES.put(usedKey, 'true', { expirationTtl: 86400 });

		// Payment verified - return the secret key
		const response = {
			secretKey: 'nsec1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
		};

		return new Response(JSON.stringify(response), {
			status: 200,
			headers: {
				'Content-Type': 'application/json',
			},
		});
	} catch (error) {
		console.error('Payment verification error:', error);
		return new Response('Invalid payment signature', { status: 400 });
	}
}

/**
 * Return 402 Payment Required response with Lightning invoice
 */
async function requirePayment(env: Env): Promise<Response> {
	try {
		const apiKey = env.COINOS_API_KEY;
		if (!apiKey) {
			return new Response('Server configuration error: API key not set', { status: 500 });
		}

		// Create Lightning invoice
		const invoiceData = await createInvoice(
			env.COINOS_API_URL,
			apiKey,
			parseInt(env.INVOICE_AMOUNT_SATS),
			parseInt(env.INVOICE_EXPIRY_SECONDS)
		);

		const paymentRequired: PaymentRequired = {
			scheme: 'lightning',
			network: 'bitcoin',
			invoice: invoiceData.text,
		};

		return new Response(null, {
			status: 402,
			headers: {
				'PAYMENT-REQUIRED': encodeBase64(paymentRequired),
			},
		});
	} catch (error) {
		console.error('Invoice creation error:', error);
		return new Response('Failed to create payment invoice', { status: 500 });
	}
}
