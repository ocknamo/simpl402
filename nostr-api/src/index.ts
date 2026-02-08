/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		
		// GET /nostr/secret-key エンドポイント
		if (request.method === 'GET' && url.pathname === '/nostr/secret-key') {
			const response = {
				secretKey: 'nsec1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
			};
			return new Response(JSON.stringify(response), {
				status: 200,
				headers: {
					'Content-Type': 'application/json',
				},
			});
		}
		
		// その他のルート
		switch (url.pathname) {
			case '/message':
				return new Response('Hello, World!');
			case '/random':
				return new Response(crypto.randomUUID());
			default:
				return new Response('Not Found', { status: 404 });
		}
	},
} satisfies ExportedHandler<Env>;
