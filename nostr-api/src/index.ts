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
import type { X402PaymentPayload, LightningPaymentPayload } from './types';
import { npubToHex, nsecToHex, createBadgeAwardEvent, signEvent, getPublicKey, publishToRelays } from './nostr';
import { MAINNET_BTC_NETWORK_ID, SCHEME_EXACT } from './constants';

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
 * Verified payment result returned on successful verification
 */
interface VerifiedPayment {
	invoice: string;
	paymentHash: string;
	decoded: import('./types').DecodedInvoice;
}

/**
 * Verify Lightning payment from PAYMENT-SIGNATURE header.
 * Implements verification steps from the exact scheme specification:
 *   1. Extract requirements from payload.accepted
 *   2. Verify x402Version is 2
 *   3. Verify the network matches
 *   4. Verify payload.invoice matches payload.accepted.extra.invoice
 *   5. Verify the invoice was issued by this server (via Lightning API)
 *   6. Decode the BOLT11 invoice
 *   7. Verify the invoice has not expired
 *   8. Verify the invoice amount matches requirements.amount
 *   9. Verify the invoice has not already been used
 *  10. Query the Lightning node to verify the invoice has been paid
 *
 * Returns VerifiedPayment on success, or a Response on failure.
 */
async function verifyLightningPayment(
	paymentSigHeader: string,
	expectedAmountSats: number,
	env: Env,
): Promise<VerifiedPayment | Response> {
	// 1. Extract requirements from payload.accepted
	const paymentPayload = decodeBase64<X402PaymentPayload>(paymentSigHeader);

	// 2. Verify x402Version is 2
	if (paymentPayload.x402Version !== 2) {
		return createErrorResponse('Unsupported x402 version', 400, 'unsupported_version');
	}

	// 3a. Verify scheme is exact
	if (paymentPayload.accepted.scheme !== SCHEME_EXACT) {
		return createErrorResponse('Unsupported payment scheme', 400, 'unsupported_scheme');
	}

	// 3b. Verify the network matches
	if (paymentPayload.accepted.network !== MAINNET_BTC_NETWORK_ID) {
		return createErrorResponse('Unsupported payment network', 400, 'unsupported_network');
	}

	// Extract Lightning-specific payload
	const lightningPayload = paymentPayload.payload as unknown as LightningPaymentPayload;
	const invoice = lightningPayload.invoice;

	if (!invoice) {
		return createErrorResponse('Missing invoice in payload', 400, 'missing_invoice');
	}

	// 4. Verify payload.invoice matches payload.accepted.extra.invoice exactly
	if (invoice !== paymentPayload.accepted.extra?.invoice) {
		return createErrorResponse('Invoice in payload does not match accepted invoice', 400, 'invoice_mismatch');
	}

	// 6. Decode the BOLT11 invoice
	const decoded = decodeBolt11(invoice);

	// 7. Verify the invoice has not expired
	const now = Math.floor(Date.now() / 1000);
	if (decoded.timeExpireDate < now) {
		return createErrorResponse('Invoice expired', 402, 'invoice_expired');
	}

	// 8. Verify the invoice amount matches requirements.amount exactly
	const acceptedAmountSats = parseInt(paymentPayload.accepted.amount) / 1000; // Convert millisats to sats
	if (decoded.satoshis !== expectedAmountSats || decoded.satoshis !== acceptedAmountSats) {
		return createErrorResponse('Invoice amount does not match required amount', 400, 'invoice_amount_mismatch');
	}

	// 9. Verify the invoice has not already been used
	const usedKey = `used:${decoded.paymentHash}`;
	const alreadyUsed = await env.USED_INVOICES.get(usedKey);
	if (alreadyUsed) {
		return createErrorResponse('Invoice already used', 402, 'invoice_already_used');
	}

	// 5 & 10. Query the Lightning node to verify the invoice has been paid
	const apiKey = env.COINOS_API_KEY;
	if (!apiKey) {
		return new Response('Server configuration error: API key not set', { status: 500 });
	}

	const isPaid = await verifyPayment(env.COINOS_API_URL, apiKey, invoice);

	if (!isPaid) {
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

	return { invoice, paymentHash: decoded.paymentHash, decoded };
}

/**
 * Handle /test/uuid endpoint with x402 payment protection
 */
async function handleUuidEndpoint(request: Request, env: Env): Promise<Response> {
	const paymentSigHeader = request.headers.get('PAYMENT-SIGNATURE');

	if (!paymentSigHeader) {
		return requirePayment(request, env);
	}

	try {
		const result = await verifyLightningPayment(paymentSigHeader, parseInt(env.INVOICE_AMOUNT_SATS), env);

		// Verification failed - return the error response
		if (result instanceof Response) {
			return result;
		}

		// Payment verified - return a UUID v4 with PAYMENT-RESPONSE header
		const settlementResponse = createSuccessSettlement(result.invoice, result.paymentHash);

		return new Response(JSON.stringify({ uuid: crypto.randomUUID() }), {
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
 * **This is an experimental feature.** It is probably safer to use it only with simple GET methods.
 */
async function handleBadgeChallengeEndpoint(
	request: Request,
	env: Env,
	ctx: ExecutionContext
): Promise<Response> {
	// Constants for badge configuration
	const BADGE_D_TAG = 'simpl402-challenge-success-00';
	const RELAY_URLS = ['wss://yabu.me', 'wss://relay.damus.io', 'wss://r.kojira.io', 'wss://relay.rodbishop.nz', 'wss://nostr.bitcoiner.social', 'wss://nostr.land', 'wss://nostr.mom'];
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
		return requirePayment(request, env, BADGE_AMOUNT_SATS);
	}

	// STEP 3: Payment signature provided - verify payment
	try {
		const result = await verifyLightningPayment(paymentSigHeader, BADGE_AMOUNT_SATS, env);

		// Verification failed - return the error response
		if (result instanceof Response) {
			return result;
		}

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
		const settlementResponse = createSuccessSettlement(result.invoice, result.paymentHash);

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
