/**
 * Nostr integration for NIP-58 Badge Awards
 */

import { nip19, finalizeEvent, SimplePool, type EventTemplate, type NostrEvent } from 'nostr-tools';

/**
 * Validate and decode npub to hex pubkey
 */
export function npubToHex(npub: string): string {
	try {
		const decoded = nip19.decode(npub);
		if (decoded.type !== 'npub') {
			throw new Error('Invalid npub format');
		}
		return decoded.data;
	} catch (error) {
		throw new Error('Invalid npub format');
	}
}

/**
 * Decode nsec to hex private key
 */
export function nsecToHex(nsec: string): Uint8Array {
	try {
		const decoded = nip19.decode(nsec);
		if (decoded.type !== 'nsec') {
			throw new Error('Invalid nsec format');
		}
		return decoded.data;
	} catch (error) {
		throw new Error('Invalid nsec format');
	}
}

/**
 * Create a Badge Award event (kind 8) according to NIP-58
 * @param badgeDTag - The 'd' tag value of the Badge Definition (e.g., "ocknamo-test-0001")
 * @param issuerPubkeyHex - The hex pubkey of the badge issuer (from private key)
 * @param recipientPubkeyHex - The hex pubkey of the badge recipient
 * @param relayUrl - The relay URL where the badge can be found
 * @returns Unsigned event template
 */
export function createBadgeAwardEvent(
	badgeDTag: string,
	issuerPubkeyHex: string,
	recipientPubkeyHex: string,
	relayUrl: string
): EventTemplate {
	const aTag = `30009:${issuerPubkeyHex}:${badgeDTag}`;

	return {
		kind: 8,
		created_at: Math.floor(Date.now() / 1000),
		tags: [
			['a', aTag],
			['p', recipientPubkeyHex, relayUrl],
		],
		content: '',
	};
}

/**
 * Sign an event with a private key
 */
export function signEvent(eventTemplate: EventTemplate, privateKeyHex: Uint8Array): NostrEvent {
	return finalizeEvent(eventTemplate, privateKeyHex);
}

/**
 * Get hex pubkey from private key
 */
export function getPublicKey(privateKeyHex: Uint8Array): string {
	const { getPublicKey } = require('nostr-tools');
	return getPublicKey(privateKeyHex);
}

/**
 * Publish event to multiple Nostr relays using SimplePool from nostr-tools
 */
export async function publishToRelays(relayUrls: string[], event: NostrEvent): Promise<void> {
	const pool = new SimplePool();

	try {
		console.log('[Nostr] Publishing to relays:', relayUrls);

		// SimplePool.publish returns an array of promises (one per relay)
		const publishPromises = pool.publish(relayUrls, event, {
			maxWait: 10000, // 10 second timeout
		});

		// Wait for all publish operations to complete
		const results = await Promise.allSettled(publishPromises);

		// Check if at least one relay accepted the event
		const successfulPublishes = results.filter((result) => result.status === 'fulfilled');

		if (successfulPublishes.length > 0) {
			console.log(
				`[Nostr] Event successfully published to ${successfulPublishes.length}/${relayUrls.length} relay(s)`
			);
		} else {
			// All publishes failed
			const firstRejection = results.find((result) => result.status === 'rejected') as
				| PromiseRejectedResult
				| undefined;
			const errorMessage = firstRejection ? firstRejection.reason : 'Failed to publish to any relay';
			console.error('[Nostr] Publish failed to all relays:', errorMessage);
			throw new Error(errorMessage);
		}
	} finally {
		// Clean up the pool
		pool.destroy();
	}
}
