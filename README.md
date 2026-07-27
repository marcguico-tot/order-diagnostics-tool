# Order Diagnostics Tool

A Chrome extension for Token of Trust ops/support that pulls a Shopify order's raw JSON directly from `admin.shopify.com` and checks it against the usual reasons excise tax fails to calculate.

Shopify only, for now — BigCommerce and WordPress storefronts aren't supported.

## What it checks

Given an order, it runs 8 diagnostic passes and flags anything worth a closer look:

1. **Coupons / discounts** — discount codes or order-level discounts that might affect the taxable subtotal
2. **Product metadata (PMD)** — line items missing `taxable` or `tax_lines`
3. **Order modification** — edited quantities or refunds that may predate/postdate the original tax calc
4. **Address mismatch** — missing ship-to state, or ship-to/bill-to states that don't match
5. **Payment method** — non-standard gateways (manual, COD, bogus) that can bypass the checkout flow that triggers tax apps
6. **State-specific rate config** — surfaces the ship-to state for cross-checking against the compliance calendar
7. **Cart size / SKU count** — unusually large carts that may hit tax-app limits
8. **Vendor / product specific** — lists vendors and SKUs for manual cross-check against exemption lists

Each check shows a `Flag` / `OK` / `Info` badge and expands for detail pulled straight from the order JSON.

## Why an extension

Fetching `https://admin.shopify.com/store/{handle}/orders/{id}.json` from a regular web page (e.g. a GitHub Pages tool) gets blocked by CORS — Shopify doesn't return headers that let a different origin read the response, even with a valid logged-in session cookie.

Extensions aren't bound by that restriction for origins listed in `host_permissions`. This extension declares `https://admin.shopify.com/*`, so its popup can `fetch()` the order JSON directly and read the result — using whatever Shopify admin session is already active in your browser. No API tokens, no backend, nothing installed server-side.

## Install (unpacked)

This isn't published to the Chrome Web Store — load it as an unpacked extension:

1. Clone or download this repo somewhere permanent (not a temp/Downloads folder Chrome might lose track of)
2. Go to `chrome://extensions`
3. Turn on **Developer mode** (top right)
4. Click **Load unpacked** and select the repo folder
5. Pin the extension to your toolbar

To pick up changes after editing the source, click the reload icon on the extension's card in `chrome://extensions`.

## Usage

1. Open the popup and pick a **storefront** from the dropdown
2. Enter the **order ID**, or paste the full `admin.shopify.com/store/.../orders/...` URL — pasting a full URL also auto-fills the storefront and syncs its store handle (see below)
3. Click **Fetch order JSON**
   - If you're not logged into that store's admin, you'll get a 401/403 — open the store in Shopify to log in, then fetch again
   - If fetch fails for any other reason, use **Open in Shopify ↗** to view the order, copy the JSON, and paste it into the manual box as a fallback
4. Review the diagnostics panel and the raw JSON below it
5. Click **⤢ Full view** to open the same UI in a full tab if the popup feels cramped

## Configuration

### Storefront → store handle mapping

The store handle is the segment after `admin.shopify.com/store/` in that storefront's URLs. It's not always derivable from the storefront's public domain, so it's kept as an editable table under **Storefront config**.

- Ships with the handles known at the time of writing (see `DEFAULT_CONFIG` in `popup.js`)
- Edits are saved to `chrome.storage.local` — persists across restarts, but is local to your Chrome profile and not synced to this repo
- **Auto-sync**: pasting a full order URL for a domain with no handle saved fills it in automatically; pasting one with a *different* handle than what's stored overwrites it (so if a store's handle ever changes, the next paste keeps things current)
- **Reset to defaults** reverts to the `DEFAULT_CONFIG` shipped in source

If you want your local edits to become the actual shipped defaults for teammates loading a fresh copy, update the `DEFAULT_CONFIG` array in `popup.js` by hand and commit it.

### Compliance sheet (optional)

A field for a published Google Sheets CSV URL, intended for cross-referencing ship-to state against a compliance mirror. Currently just persisted — not yet wired into the "State-specific rate config" check.

## File structure

```
.
├── manifest.json   # MV3 manifest, host_permissions for admin.shopify.com
├── popup.html      # Popup markup + styles
├── popup.js        # All logic: config, fetch, diagnostics, JSON rendering
└── README.md
```

## Privacy / scope notes

- No external servers involved — everything runs client-side in the extension
- The only host permission requested is `admin.shopify.com`; it can't read or modify any other site
- Storefront config and the compliance sheet URL are stored locally via `chrome.storage.local`, never transmitted anywhere by this extension

## Known limitations

- Chrome/Chromium only (Manifest V3); untested on Firefox or Safari
- Requires you to already be authenticated in `admin.shopify.com` for the store you're querying — the extension rides your existing session, it doesn't log in for you
- Store handles for custom domains aren't auto-discoverable and must be added manually the first time
- Not published to the Chrome Web Store — every user loads it as unpacked, and reinstalling/removing the extension clears its local config

## Roadmap ideas

- Export current storefront config as a ready-to-paste `DEFAULT_CONFIG` block
- Wire the compliance sheet CSV into the state-rate check automatically
- Package/sign for the Chrome Web Store (internal or unlisted) so teammates don't need Developer Mode
