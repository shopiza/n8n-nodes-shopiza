# Changelog

## 0.2.0 (2026-11-11)

- Built and linted with the official `@n8n/node-cli`; published from GitHub Actions with npm provenance.
- SVG node icon.
- Product actions renamed to "Update a product" / "Update a variant"; the order update options are now "Update Fields".
- Errors that are not API errors are wrapped as node errors; a failed webhook removal on deactivation is logged instead of ignored.

## 0.1.0 (2026-11-11)

- First release: Shopiza Trigger (orders, payments, products, customers) and Shopiza node (orders, products, variants, customers, shop).
