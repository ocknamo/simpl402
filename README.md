# simpl402

An implementation of x402 over Lightning Network. Uses the HTTP 402 (Payment Required) protocol to enable micropayments via Lightning Network.

[日本語版はこちら](./README.ja.md)

## About This Repository

[x402](https://github.com/x402-foundation/x402) is a payment protocol that leverages the HTTP 402 status code. This repository implements a REST API compliant with the x402 HTTP Transport Specification v2, running on Cloudflare Workers. Lightning Network (via coinos.io API) is used as the payment layer.

## Directory Structure

| Directory | Description |
|---|---|
| [`nostr-api/`](./nostr-api/README.md) | Main app. x402-compliant REST API running on Cloudflare Workers |
| [`docs/`](./docs/) | Design documents (architecture, NIP-58, payment scheme spec) |

## Quick Start

```bash
cd nostr-api
npm install
cp .dev.vars.example .dev.vars
# Set your coinos.io API key in .dev.vars
npm run dev
```

See [`nostr-api/README.md`](./nostr-api/README.md) for details.

## Tech Stack

- **Cloudflare Workers** – Serverless runtime
- **TypeScript** – Type safety
- **Lightning Network** – Payment layer (coinos.io API)
- **Cloudflare KV** – Invoice deduplication
- **x402 v2** – HTTP payment protocol
- **NIP-58** – Nostr badge issuance

## References

- [x402](https://github.com/x402-foundation/x402) – x402 protocol specification
- [x402 HTTP Transport Specification v2](https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/http.md)
- [coinos.io API](https://coinos.io)

## License

MIT
