/**
 * Utility functions for x402 protocol
 */

/**
 * Encode object to Base64 JSON string
 */
export function encodeBase64(obj: unknown): string {
	const json = JSON.stringify(obj);
	// Use btoa for browser/Cloudflare Workers compatibility
	return btoa(json);
}

/**
 * Decode Base64 JSON string to object
 */
export function decodeBase64<T>(value: string): T {
	const json = atob(value);
	return JSON.parse(json) as T;
}
