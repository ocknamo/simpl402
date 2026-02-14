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
import { npubToHex, nsecToHex, createBadgeAwardEvent, signEvent, getPublicKey, publishToRelays } from './nostr';

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);

		// GET /test/uuid エンドポイント (x402 protected)
		if (request.method === 'GET' && url.pathname === '/test/uuid') {
			return handleUuidEndpoint(request, env);
		}

		// POST /nostr/badge-challenge エンドポイント (x402 protected, 100 sats)
		if (request.method === 'POST' && url.pathname === '/nostr/badge-challenge') {
			return handleBadgeChallengeEndpoint(request, env, ctx);
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
 * Handle /test/uuid endpoint with x402 payment protection
 */
async function handleUuidEndpoint(request: Request, env: Env): Promise<Response> {
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

		// Payment verified - return a UUID v4 with PAYMENT-RESPONSE header
		const settlementResponse = createSuccessSettlement(invoice);

		// Generate UUID v4
		const uuid = crypto.randomUUID();

		const response = {
			uuid: uuid,
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
async function requirePayment(request: Request, env: Env, customAmountSats?: number): Promise<Response> {
	try {
		const apiKey = env.COINOS_API_KEY;
		if (!apiKey) {
			return new Response('Server configuration error: API key not set', { status: 500 });
		}

		// Create Lightning invoice
		const amountSats = customAmountSats || parseInt(env.INVOICE_AMOUNT_SATS);
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

/**
 * Handle /nostr/badge-challenge endpoint with x402 payment protection (100 sats)
 * Awards NIP-58 badge to the provided npub after payment verification
 */
async function handleBadgeChallengeEndpoint(
	request: Request,
	env: Env,
	ctx: ExecutionContext
): Promise<Response> {
	// Constants for badge configuration
	const BADGE_D_TAG = 'ocknamo-test-0001';
	const RELAY_URLS = ['wss://yabu.me', 'wss://relay.damus.io', 'wss://nos.lol'];
	const BADGE_AMOUNT_SATS = 100;

	const paymentSigHeader = request.headers.get('PAYMENT-SIGNATURE');

	// STEP 1: Validate request body BEFORE payment (to avoid payment loss)
	let requestBody: any;
	let npub: string;
	let recipientPubkeyHex: string;

	try {
		requestBody = await request.json();
	} catch (error) {
		return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	// Validate npub field exists
	if (!requestBody.npub || typeof requestBody.npub !== 'string') {
		return new Response(JSON.stringify({ error: 'Missing or invalid "npub" field in request body' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	npub = requestBody.npub;

	// Validate npub format and convert to hex
	try {
		recipientPubkeyHex = npubToHex(npub);
		console.log('[Badge] Validated npub:', npub, '-> hex:', recipientPubkeyHex);
	} catch (error) {
		return new Response(
			JSON.stringify({ error: 'Invalid npub format. Must be a valid Nostr public key (npub1...)' }),
			{
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}

	// STEP 2: Check payment status
	if (!paymentSigHeader) {
		// No payment signature - require payment (402)
		return requirePayment(request, env, BADGE_AMOUNT_SATS);
	}

	// STEP 3: Payment signature provided - verify payment
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

		// Verify correct amount (100 sats)
		if (decoded.satoshis !== BADGE_AMOUNT_SATS) {
			return createErrorResponse(
				`Invalid payment amount. Expected ${BADGE_AMOUNT_SATS} sats, got ${decoded.satoshis} sats`,
				400,
				'invalid_amount'
			);
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

		console.log('[Badge] Verifying payment for invoice:', invoice.substring(0, 50) + '...');

		const isPaid = await verifyPayment(env.COINOS_API_URL, apiKey, invoice);

		console.log('[Badge] Payment verification result:', isPaid);

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

		// STEP 4: Payment verified - Award badge
		// Get badge issuer private key from environment
		const badgeIssuerNsec = env.BADGE_ISSUER_NSEC;
		if (!badgeIssuerNsec) {
			console.error('[Badge] BADGE_ISSUER_NSEC not configured');
			return new Response('Server configuration error: Badge issuer key not set', { status: 500 });
		}

		let privateKey: Uint8Array;
		let issuerPubkeyHex: string;

		try {
			privateKey = nsecToHex(badgeIssuerNsec);
			issuerPubkeyHex = getPublicKey(privateKey);
			console.log('[Badge] Badge issuer pubkey:', issuerPubkeyHex);
		} catch (error) {
			console.error('[Badge] Invalid BADGE_ISSUER_NSEC format:', error);
			return new Response('Server configuration error: Invalid badge issuer key format', { status: 500 });
		}

		// Create Badge Award event (kind 8)
		// Use the first relay URL as the recommended relay in the p tag
		const eventTemplate = createBadgeAwardEvent(BADGE_D_TAG, issuerPubkeyHex, recipientPubkeyHex, RELAY_URLS[0]);

		// Sign the event
		const signedEvent = signEvent(eventTemplate, privateKey);

		console.log('[Badge] Created Badge Award event:', signedEvent.id);

		// Publish to all relays (non-blocking with ctx.waitUntil)
		ctx.waitUntil(
			publishToRelays(RELAY_URLS, signedEvent)
				.then(() => {
					console.log('[Badge] Successfully published badge award to relays');
				})
				.catch((error) => {
					console.error('[Badge] Failed to publish badge award to relays:', error);
				})
		);

		// Return success response immediately
		const settlementResponse = createSuccessSettlement(invoice);

		const response = {
			success: true,
			eventId: signedEvent.id,
			message: 'Badge awarded successfully',
		};

		return new Response(JSON.stringify(response), {
			status: 200,
			headers: {
				'Content-Type': 'application/json',
				'PAYMENT-RESPONSE': encodeBase64(settlementResponse),
			},
		});
	} catch (error) {
		console.error('[Badge] Payment verification error:', error);
		return createErrorResponse('Invalid payment signature', 400, 'invalid_payload');
	}
}
