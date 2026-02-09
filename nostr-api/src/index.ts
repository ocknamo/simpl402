/**
 * x402 over Lightning Network - Cloudflare Workers Implementation
 * Fully compliant with x402 HTTP Transport Specification v2
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { createInvoice, verifyPayment, decodeBolt11 } from './lightning';
import {
	encodeBase64,
	decodeBase64,
	createResourceFromRequest,
	createLightningPaymentMethod,
	createPaymentRequired,
	createSuccessSettlement,
	createFailureSettlement,
} from './utils';
import type { X402PaymentPayload, X402SettlementResponse, LightningPaymentPayload } from './types';

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
 * Create error response with x402 headers
 */
function createErrorResponse(message: string, status: number, errorReason: string, request?: Request): Response {
	const settlementResponse = createFailureSettlement(errorReason);

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		'PAYMENT-RESPONSE': encodeBase64(settlementResponse),
	};

	return new Response(JSON.stringify({ error: message }), {
		status,
		headers,
	});
}

/**
 * Handle /nostr/secret-key endpoint with x402 payment protection
 */
async function handleSecretKeyEndpoint(request: Request, env: Env): Promise<Response> {
	const paymentSigHeader = request.headers.get('PAYMENT-SIGNATURE');

	// No payment signature - require payment (402)
	if (!paymentSigHeader) {
		return requirePayment(request, env);
	}

	// Payment signature provided - verify payment
	try {
		const paymentPayload = decodeBase64<X402PaymentPayload>(paymentSigHeader);

		// Validate x402 version
		if (paymentPayload.x402Version !== 2) {
			return createErrorResponse('Unsupported x402 version', 400, 'unsupported_version');
		}

		// Validate payment method is Lightning
		if (paymentPayload.accepted.scheme !== 'lightning') {
			return createErrorResponse('Unsupported payment scheme', 400, 'unsupported_scheme');
		}

		// Extract Lightning-specific payload
		const lightningPayload = paymentPayload.payload as unknown as LightningPaymentPayload;
		const invoice = lightningPayload.invoice;

		if (!invoice) {
			return createErrorResponse('Missing invoice in payload', 400, 'missing_invoice');
		}

		// Decode invoice to get payment hash for dedup
		const decoded = decodeBolt11(invoice);

		// Check if invoice is expired
		const now = Math.floor(Date.now() / 1000);
		if (decoded.timeExpireDate < now) {
			return createErrorResponse('Invoice expired', 402, 'invoice_expired');
		}

		// Check if invoice has already been used
		const usedKey = `used:${decoded.paymentHash}`;
		const alreadyUsed = await env.USED_INVOICES.get(usedKey);
		if (alreadyUsed) {
			return createErrorResponse('Invoice already used', 402, 'invoice_already_used');
		}

		// Verify payment with Lightning node
		const apiKey = env.COINOS_API_KEY;
		if (!apiKey) {
			return new Response('Server configuration error: API key not set', { status: 500 });
		}

		console.log('[DEBUG] Verifying payment for invoice:', invoice.substring(0, 50) + '...');
		console.log('[DEBUG] Invoice details:', {
			paymentHash: decoded.paymentHash,
			satoshis: decoded.satoshis,
			timestamp: decoded.timestamp,
			timeExpireDate: decoded.timeExpireDate,
			currentTime: now,
		});

		const isPaid = await verifyPayment(env.COINOS_API_URL, apiKey, invoice);

		console.log('[DEBUG] Payment verification result:', isPaid);

		if (!isPaid) {
			// Payment not confirmed - return 402 with PAYMENT-RESPONSE
			const settlementResponse = createFailureSettlement('payment_not_confirmed');

			return new Response(JSON.stringify({ error: 'Payment not confirmed' }), {
				status: 402,
				headers: {
					'Content-Type': 'application/json',
					'PAYMENT-RESPONSE': encodeBase64(settlementResponse),
				},
			});
		}

		// Mark invoice as used (TTL: 24 hours)
		await env.USED_INVOICES.put(usedKey, 'true', { expirationTtl: 86400 });

		// Payment verified - return the secret key with PAYMENT-RESPONSE header
		const settlementResponse = createSuccessSettlement(invoice);

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
	} catch (error) {
		console.error('Payment verification error:', error);
		return createErrorResponse('Invalid payment signature', 400, 'invalid_payload');
	}
}

/**
 * Return 402 Payment Required response with x402 v2 headers
 */
async function requirePayment(request: Request, env: Env): Promise<Response> {
	try {
		const apiKey = env.COINOS_API_KEY;
		if (!apiKey) {
			return new Response('Server configuration error: API key not set', { status: 500 });
		}

		// Create Lightning invoice
		const amountSats = parseInt(env.INVOICE_AMOUNT_SATS);
		const expirySeconds = parseInt(env.INVOICE_EXPIRY_SECONDS);

		const invoiceData = await createInvoice(env.COINOS_API_URL, apiKey, amountSats, expirySeconds);

		// Build x402 v2 compliant response
		const resource = createResourceFromRequest(request);
		const lightningMethod = createLightningPaymentMethod(invoiceData.text, amountSats, expirySeconds);
		const paymentRequired = createPaymentRequired(resource, [lightningMethod]);

		return new Response(JSON.stringify({ error: 'Payment required' }), {
			status: 402,
			headers: {
				'Content-Type': 'application/json',
				'PAYMENT-REQUIRED': encodeBase64(paymentRequired),
			},
		});
	} catch (error) {
		console.error('Invoice creation error:', error);
		return new Response('Failed to create payment invoice', { status: 500 });
	}
}
