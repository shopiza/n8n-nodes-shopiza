# Changelog

## 0.2.1 (2026-11-12)

- Fix: the Shopiza API credential showed a broken icon (it pointed at a PNG that is not in the package); it now uses the node's SVG icon.

## 0.2.0 (2026-11-11)

- Built and linted with the official `@n8n/node-cli`; released from GitHub Actions with npm provenance (staged, approved by a maintainer).
- SVG node icon.
- Product actions renamed to "Update a product" / "Update a variant"; the order update options are now "Update Fields".
- Errors that are not API errors are wrapped as node errors; a failed webhook removal on deactivation is logged instead of ignored.

## 0.1.0 (2026-11-11)

- First release: Shopiza Trigger (orders, payments, products, customers) and Shopiza node (orders, products, variants, customers, shop).
