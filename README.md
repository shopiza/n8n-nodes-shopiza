# n8n-nodes-shopiza

n8n community nodes for [Shopiza](https://shopiza.io), the e-commerce platform.

- **Shopiza Trigger**: starts a workflow when a shop gets a new order, an order is paid, changed, cancelled or refunded, a product is created, updated or deleted, or a customer creates an account. Every request is signature-checked.
- **Shopiza**: get orders, products and customers; mark an order shipped (with tracking, and the customer's shipped email); update price, sale price, stock and visibility of a product or a variant.

## Installation

In n8n: **Settings > Community Nodes > Install**, enter `n8n-nodes-shopiza`. See the [n8n community nodes guide](https://docs.n8n.io/integrations/community-nodes/installation/).

## Credentials

1. In your Shopiza admin open **Settings > Integrations > API keys** and choose **New API key**.
2. Tick the permissions the workflow needs. The trigger needs **Manage webhooks** plus read access to what it listens to (for example **Read orders** for order events).
3. Copy the key (it is shown once) into a new **Shopiza API** credential in n8n.

## Trigger notes

Shopiza only sends webhooks to public **https** addresses, so the trigger works on n8n Cloud and on self-hosted n8n that is reachable from the internet over https, not on `localhost`. Activating the workflow subscribes the webhook; deactivating it removes it. Failed deliveries are retried for about a day.

## Resources

- API and webhook reference: https://shopiza.io/developers
- OpenAPI: https://shopiza.io/api/v1/openapi.json
- Support: hello@shopiza.io

## Development

```sh
npm ci
npm run lint
npm run build
SHOPIZA_TEST_KEY=sz_live_... npm test   # runs the built nodes against a test shop
```

Releases are published by GitHub Actions with npm provenance when a version tag is pushed (see `.github/workflows/publish.yml`).

## License

MIT
