# Order Diagnostics Tool

A Chrome extension for Token of Trust ops/support that pulls a Shopify order's raw JSON directly from `admin.shopify.com` and checks it against the usual reasons excise tax fails to calculate.

Shopify only, for now — BigCommerce and WordPress storefronts aren't supported.

## TOT status (ground truth, from order tags)

Above the diagnostics, the tool reads Token of Trust's own tags directly off the order — this is authoritative status straight from TOT, not something inferred from checkout mechanics. Two independent tags are surfaced:

**Verification:**
| Tag | Meaning |
|---|---|
| `tot-cleared` | Passed verification |
| `tot-not-verified` | Pending — hasn't cleared yet, don't fulfill |
| `tot-rejected` | Failed (e.g. under minimum age) — don't fulfill |
| `tot-not-required` | All items are `tot-no-verification` product-tagged, so no check ran |

**Excise tax:**
| Tag | Meaning |
|---|---|
| `tot-excise-tax-collected` | Required and correctly collected |
| `tot-excise-tax-not-required` | Not required for this order |
| `tot-excise-tax-incorrect` | Required but *not* collected correctly — the core problem this tool exists to troubleshoot |

**Important caveat:** if excise informational tags are disabled in Shopify settings, `not-required`/`collected` may be suppressed — but `incorrect` always shows. So a missing excise tag doesn't necessarily mean the order is fine; it's shown as informational ("no tag found"), not assumed OK.

## What it checks

Given an order, it runs 8 diagnostic passes and flags anything worth a closer look:

1. **Coupons / discounts** — discount codes or order-level discounts that might affect the taxable subtotal
2. **Product metadata (PMD)** — line items missing `taxable` or `tax_lines`. Excludes TOT's own injected excise-tax line item (`vendor: "TOT"`, SKU prefix `TOT_TAXLINE_`) and Route's shipping-protection line item (`vendor: "Route"`, SKU prefix `ROUTEINS`) — both are legitimately non-taxable by design, not compliance gaps
3. **Order modification** — edited quantities or refunds that may predate/postdate the original tax calc
4. **Address mismatch** — missing ship-to state, or ship-to/bill-to states that don't match
5. **Payment method** — non-standard gateways (manual, COD, bogus) that can bypass the checkout flow that triggers tax apps
6. **State-specific rate config** — matches the ship-to state against your PACT & Excise compliance sheet and shows the licensing agency, fees, and excise tax detail for that state
7. **Cart size / SKU count** — unusually large carts that may hit tax-app limits
8. **Vendor / product specific** — lists vendors and SKUs for manual cross-check against exemption lists

Each check shows a `Flag` / `OK` / `Info` badge and expands for detail pulled straight from the order JSON.

## Worth flagging

Below the diagnostics, the tool generates a note when there's something actually worth flagging — mirroring the manual notes your team already adds to individual orders in the daily Active Monitoring Slack report (e.g. `1543: Status: [:bangbang:] - Excise tax incorrect (tot-excise-tax-incorrect tag)`). If nothing's notable, this panel doesn't appear at all — no empty `[:+1:]` noise.

It includes a **Copy** button for the line to paste into today's report if you're logging one — this is a per-order helper, not a replacement for the Active Monitoring tool itself.

What it currently detects:
- **Excise tax incorrect** (`tot-excise-tax-incorrect` tag)
- **TOT verification rejected or pending** (`tot-rejected` / `tot-not-verified` tags)
- **Missing PMD** (reusing the diagnostics check above, same ancillary-item exclusions)
- **Manual payment gateway** — flags orders that look manually entered
- **Store credit** — notes if store credit was used as (part of) payment
- **Refunds on record**

**Known gap:** the manual "overcharged / undercharged (no coupon)" check your team does by eyeballing the live storefront price isn't replicated here — that requires the *current* product price, which isn't present in the order JSON. Automating it would mean also fetching the product from Shopify's Products API and comparing; not yet built.

## Bulk scan (beta)

`admin.shopify.com/store/{handle}/orders.json` — the same `.json` trick used for individual orders — also works on the order **list** page, and returns a page of orders (classic Shopify REST shape, 50 by default; the tool requests `?limit=250`). This means a range of recent orders can be scanned client-side without hitting each one individually.

**Usage:** pick the storefront (same dropdown as single lookup), enter an order number range (`153800-153900`) or a comma-separated list, and click **Scan for issues**. Every matched order is run through the same `generateAutoNotes` logic as "Worth flagging" — only orders with at least one `Flag`-level note are shown in the results. Click a result to load its full diagnostics/JSON into the main panels without a second fetch (the order data is already in memory from the scan).

**How pagination works:** the tool follows the response's `Link: <...>; rel="next"` header (standard Shopify REST cursor pagination) up to 6 pages, and stops early once a page's lowest order number drops below the requested range's minimum — since the list is sorted newest-first, nothing older can still be in range. There's no confirmed documentation for this internal endpoint's exact behavior (page size, sort order, whether `Link` is even present) — this is inferred from observed responses, not guaranteed. Very old order numbers, or endpoints that don't paginate the way assumed, may not be fully reachable.

**Known limitations:**
- Compliance-sheet state lookups are skipped during bulk scan (would mean re-fetching/matching the CSV per order) — only the tag-based and PMD-based checks run
- No visibility into orders scanned-but-not-flagged beyond the summary count — if you need to review "everything," use single-order lookup
- Safety-capped at 6 pages (~1,500 orders at the observed page size) to avoid runaway fetches

## Why an extension

Fetching `https://admin.shopify.com/store/{handle}/orders/{id}.json` from a regular web page (e.g. a GitHub Pages tool) gets blocked by CORS — Shopify doesn't return headers that let a different origin read the response, even with a valid logged-in session cookie.

Extensions aren't bound by that restriction for origins listed in `host_permissions`. This extension declares `https://admin.shopify.com/*`, so it can `fetch()` the order JSON directly and read the result — using whatever Shopify admin session is already active in your browser. No API tokens, no backend, nothing installed server-side.

## Install (unpacked)

This isn't published to the Chrome Web Store — load it as an unpacked extension:

1. Clone or download this repo somewhere permanent (not a temp/Downloads folder Chrome might lose track of)
2. Go to `chrome://extensions`
3. Turn on **Developer mode** (top right)
4. Click **Load unpacked** and select the repo folder
5. Pin the extension to your toolbar

Clicking the toolbar icon opens the tool as a **side panel** docked to the edge of the browser window — it sits alongside the page rather than floating on top of it, so it never covers the order you're looking at. This requires Chrome 114+ (or another Chromium browser with Side Panel API support).

To pick up changes after editing the source, click the reload icon on the extension's card in `chrome://extensions`.

## Usage

**If you're already on a Shopify order page** (`admin.shopify.com/store/.../orders/...`), just open the side panel — it detects that and auto-fetches the order for you, no typing needed.

Otherwise:

1. Open the side panel and pick a **storefront** from the dropdown
2. Enter the **order ID**, or paste the full `admin.shopify.com/store/.../orders/...` URL — pasting a full URL also auto-fills the storefront and syncs its store handle (see below)
3. Click **Fetch order JSON**
   - If you're not logged into that store's admin, you'll get a 401/403 — open the store in Shopify to log in, then fetch again
   - If fetch fails for any other reason, use **Open in Shopify ↗** to view the order, copy the JSON, and paste it into the manual box as a fallback
4. Review the diagnostics panel and the raw JSON below it
5. Click **⤢ Full view** if you'd rather have it in its own full browser tab instead of the docked panel

## Configuration

### Storefront → store handle mapping

The store handle is the segment after `admin.shopify.com/store/` in that storefront's URLs. It's not always derivable from the storefront's public domain, so it's kept as an editable table under **Storefront config**.

- Ships with the handles known at the time of writing (see `DEFAULT_CONFIG` in `popup.js`)
- Edits are saved to `chrome.storage.local` — persists across restarts, but is local to your Chrome profile and not synced to this repo
- **Auto-sync**: pasting a full order URL for a domain with no handle saved fills it in automatically; pasting one with a *different* handle than what's stored overwrites it (so if a store's handle ever changes, the next paste keeps things current)
- **Reset to defaults** reverts to the `DEFAULT_CONFIG` shipped in source

If you want your local edits to become the actual shipped defaults for teammates loading a fresh copy, update the `DEFAULT_CONFIG` array in `popup.js` by hand and commit it.

### Compliance sheet

Optional, but wires directly into the "State-specific rate config" check.

Paste a **published CSV export URL** for your PACT & Excise compliance sheet, e.g.:
```
https://docs.google.com/spreadsheets/d/SHEET_ID/export?format=csv&gid=0
```
(This only works if the sheet is shared "Anyone with the link can view." If not, use File → Share → Publish to web → select the tab → CSV format instead, and use the link it gives you.)

Expected column layout (0-indexed), matching the PACT & Excise tab:

| Col | Field |
|---|---|
| A | State (full name, e.g. `California`) |
| B–D | PACT: Licensing Agency, Required License, Fees |
| E | PACT: Registration Portal |
| F | (blank spacer) |
| G–H | Excise: Licensing Agency, Required License |
| I | Excise: Registration Portal |
| J | Excise Tax detail (free text, may include multiple sub-jurisdiction lines) |

Rows 1–2 are treated as headers; data is read starting at row 3. The order's `shipping_address.province` (or `province_code`, mapped to a full state name) is matched case-insensitively against column A. The sheet is fetched once per panel session and cached — close and reopen the side panel (or reload the extension) to pick up sheet edits.

If the state isn't found in the sheet, or the fetch fails (e.g. sharing settings changed), the check flags it rather than failing silently.

## File structure

```
.
├── manifest.json   # MV3 manifest, host_permissions for admin.shopify.com + docs.google.com
├── background.js   # Service worker: opens the side panel on toolbar icon click
├── popup.html      # UI markup + styles (used for the side panel and the full-tab view)
├── popup.js        # All logic: config, fetch, diagnostics, JSON rendering
├── icon16.png
├── icon32.png
├── icon48.png
├── icon128.png
└── README.md
```

## Privacy / scope notes

- No external servers involved — everything runs client-side in the extension
- The only host permissions requested are `admin.shopify.com` (order lookup) and `docs.google.com` (compliance sheet, only used if you set one) — it can't read or modify any other site
- Storefront config and the compliance sheet URL are stored locally via `chrome.storage.local`, never transmitted anywhere by this extension

## Why the side panel instead of a popup

The tool started as a `default_popup`, which has two real problems: it floats on top of the page as a disconnected overlay (so it covers whatever you were looking at — the order's fraud banner, shipping/billing info, etc.), and Chrome destroys the entire popup and its JS state the instant it loses focus, so an accidental click-away meant losing your place.

Switching to the **Side Panel API** fixes both: it docks alongside the page instead of covering it, and it stays alive as long as it's open rather than getting torn down on blur. The last-order restore behavior (via `chrome.storage.local`) is still in place as a backstop in case the panel does get closed and reopened, but it's no longer doing as much heavy lifting as it was when this was a popup.

If you're on an older Chromium browser without Side Panel API support (pre-Chrome 114), this extension won't work as-is — it would need `default_popup` added back to `manifest.json`'s `action` as a fallback.

While a fetch is in flight (auto-detected order page, or clicking Fetch), the panel shows a pulsing skeleton in the shape of the TOT status, diagnostics, and JSON sections, instead of staying collapsed and then suddenly expanding once data arrives. On any fetch failure, it collapses back to the empty state rather than leaving stale skeleton bars on screen.

## Known limitations

- Chrome/Chromium only (Manifest V3), and specifically **Chrome 114+** for Side Panel API support; untested on Firefox or Safari
- Requires you to already be authenticated in `admin.shopify.com` for the store you're querying — the extension rides your existing session, it doesn't log in for you
- Store handles for custom domains aren't auto-discoverable and must be added manually the first time
- Not published to the Chrome Web Store — every user loads it as unpacked, and reinstalling/removing the extension clears its local config

## Roadmap ideas

- Export current storefront config as a ready-to-paste `DEFAULT_CONFIG` block
- Package/sign for the Chrome Web Store (internal or unlisted) so teammates don't need Developer Mode
