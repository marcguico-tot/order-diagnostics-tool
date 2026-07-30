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

Given an order, it runs 9 diagnostic passes and flags anything worth a closer look:

1. **Coupons / discounts** — discount codes or order-level discounts that might affect the taxable subtotal
2. **Product metadata (PMD)** — line items missing `taxable` or `tax_lines`. Excludes TOT's own injected excise-tax line item (`vendor: "TOT"`, SKU prefix `TOT_TAXLINE_`) and Route's shipping-protection line item (`vendor: "Route"`, SKU prefix `ROUTEINS`) — both are legitimately non-taxable by design, not compliance gaps
3. **Order modification** — edited quantities or refunds that may predate/postdate the original tax calc
4. **Address mismatch** — missing ship-to state, or ship-to/bill-to states that don't match
5. **Tax jurisdiction match** — compares the state named in each `"___ State Tax"` line against the order's actual ship-to state, catching cases where the tax engine resolved the wrong state entirely (e.g. a city name that exists in two different states — Concordia, KS vs. Concordia Parish, LA — geocoded to the wrong one)
6. **Payment method** — non-standard gateways (manual, COD, bogus) that can bypass the checkout flow that triggers tax apps
7. **State-specific rate config** — matches the ship-to state against your PACT & Excise compliance sheet and shows the licensing agency, fees, and excise tax detail for that state
8. **Cart size / SKU count** — unusually large carts that may hit tax-app limits
9. **Vendor / product specific** — lists vendors and SKUs for manual cross-check against exemption lists

Each check shows a `Flag` / `OK` / `Info` badge and expands for detail pulled straight from the order JSON.

## Worth flagging

Below the diagnostics, the tool generates a note when there's something actually worth flagging — mirroring the manual notes your team already adds to individual orders in the daily Active Monitoring Slack report (e.g. `1543: Status: [:bangbang:] - Excise tax incorrect (tot-excise-tax-incorrect tag)`). If nothing's notable, this panel doesn't appear at all — no empty `[:+1:]` noise.

It includes a **Copy** button for the line to paste into today's report if you're logging one — this is a per-order helper, not a replacement for the Active Monitoring tool itself.

What it currently detects:
- **Excise tax incorrect** (`tot-excise-tax-incorrect` tag)
- **TOT verification rejected or pending** (`tot-rejected` / `tot-not-verified` tags)
- **Missing PMD** (reusing the diagnostics check above, same ancillary-item exclusions)
- **Wrong-state tax calculated** (reusing the Tax jurisdiction match check above) — a `___ State Tax` line that doesn't match the ship-to state, e.g. a city/place name existing in two states getting geocoded wrong
- **Manual payment gateway** — flags orders that look manually entered
- **Store credit** — notes if store credit was used as (part of) payment
- **Refunds on record**

**The manual "overcharged / undercharged (no coupon)" check** your team does by eyeballing the live storefront price is now partially automated — see **Live price check** below.

## Live price check (beta)

Compares what each line item was actually charged against the product's **current** listed price — `admin.shopify.com/store/{handle}/products/{product_id}.json` works the same way the order `.json` trick does, and stays within the same `admin.shopify.com` permission already granted (no new host permission needed, unlike the earlier storefront-AJAX idea which would've required per-domain access to every client's public storefront).

**Usage:** load an order, then click **Check current prices** in its own panel — this is a manual, on-demand action, not run automatically. Each unique product on the order is fetched once (deduped, in parallel), then each line item's `price` is compared against the matching variant's current `price`. A progress bar and spinner track completion as each parallel fetch resolves (not strictly sequential order, since requests are in flight simultaneously), and the button disables itself while running.

**Why this is on-demand, not automatic:**
- It costs a separate network request per unique product on the order — fine for a deliberate check, wasteful to run on every single lookup
- **A price mismatch is only real evidence for same-day orders.** Prices legitimately change over time (sales, repricing, promotions), so flagging every historical order with a different price than today's would mostly just be noise, not signal. This fits the tool's original Active Monitoring use case (checking today's orders) much better than it fits investigating something from weeks ago.

**Known limitations:**
- Ancillary line items (TOT's excise tax line, Route's shipping protection) are excluded from the comparison — same exclusion as the PMD check, since they aren't real priced products
- If a product's been deleted, archived, or a specific variant removed since the order was placed, that line item shows as informational ("could not check") rather than a false flag
- Compares against the **variant's** price specifically (matched by `variant_id`), not the product's base price, so multi-variant products are compared correctly

## Bulk scan (beta)

`admin.shopify.com/store/{handle}/orders.json` — the same `.json` trick used for individual orders — also works on the order **list** page, and returns a page of orders (classic Shopify REST shape, 50 by default; the tool requests `?limit=250`). This means a range of recent orders can be scanned client-side without hitting each one individually.

**If this fails with `Failed to fetch` (not an HTTP error status like 404):** that specific error means the request never got a response at all — a network/CORS-level failure, not a normal error page. The individual-order `.json` endpoint works via `fetch()`; if the order-list endpoint internally redirects to the store's legacy `{handle}.myshopify.com/admin/...` domain to actually serve the data, a `fetch()` call only follows that redirect successfully if `host_permissions` also covers the redirect target — which is why `*.myshopify.com` is included. This is inferred from the symptom pattern (works via direct browser navigation, works via `fetch()` for individual orders, fails via `fetch()` only for the list endpoint, regardless of order or query params) rather than confirmed directly.

**If a real, existing order isn't found even though it should be within reach:** the order-list request includes `status=any` specifically because Shopify's classic order-list API defaults to showing only *open* orders — closed/archived orders (a common end state for orders that are fully paid and fulfilled) are silently excluded otherwise, regardless of how many pages are fetched. Without this, both single lookup and bulk scan could report "not found" for a perfectly real order that's simply been archived.

**Usage:** pick the storefront (same dropdown as single lookup), enter a range (`GV153890-GV153896` or `153890-153896`) or a comma-separated list — paste straight from the store's order list, prefix and all (e.g. `GV153896`), it's stripped automatically. Click **Scan for issues**. Every matched order is run through the same `generateAutoNotes` logic as "Worth flagging" — only orders with at least one `Flag`-level note are shown in the results. Click a result to load its full diagnostics/JSON into the main panels without a second fetch (the order data is already in memory from the scan). **Clear** wipes the range input and results in one click, useful when a scan turns up a lot of flagged orders and you want a clean slate for the next one.

**Matching is based on the order's `name` field** (the digits after the store's prefix, e.g. `153890` in `GV153890`) — not `order_number` — since on some storefronts those two diverge. `order_number` is checked as a fallback only if an order's `name` has no trailing digits.

**How pagination works:** the tool follows the response's `Link: <...>; rel="next"` header (standard Shopify REST cursor pagination) up to 6 pages. For a range (not a comma list), it also stops early once a page's lowest name-derived number drops below the range's minimum — since the list is sorted newest-first, nothing older can still be in range; a comma list always checks the full 6 pages since there's no single cutoff to reason about. There's no confirmed documentation for this internal endpoint's exact behavior (page size, sort order, whether `Link` is even present) — this is inferred from observed responses, not guaranteed. Very old order numbers, or endpoints that don't paginate the way assumed, may not be fully reachable.

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

**The storefront dropdown auto-selects itself, too** — not just for order pages, but any page under a store's `admin.shopify.com/store/{handle}/...` (the orders list, dashboard, anywhere), as long as that handle is already in your storefront config. This is meant to prevent the dropdown being left on the wrong store while you're focused on typing a bulk range or order name — it matches whatever store's admin tab is actually active. Since the side panel persists across tab switches (unlike a popup), it keeps re-checking as you switch tabs and updates the dropdown live if you move to a different store's admin — a status line confirms when it does. If the last order you viewed belongs to a different store than the one currently detected, it won't be restored on open (to avoid showing stale data next to a dropdown pointed at a different storefront).

Otherwise:

1. Open the side panel and pick a **storefront** from the dropdown
2. Enter one of three things in the order field:
   - **Order name** (e.g. `GV153847`) — what actually shows up in the store's order list, and what the Active Monitoring process is based on
   - **Order number** (e.g. `153847`) — the plain number, without the store's prefix
   - The **full admin order URL** (or just the internal order ID, e.g. `7193953272054`)
3. Click **Fetch order JSON**
   - If you're not logged into that store's admin, you'll get a 401/403 — open the store in Shopify to log in, then fetch again
   - If fetch fails for any other reason, use **Open in Shopify ↗** to view the order, copy the JSON, and paste it into the manual box as a fallback
4. Review the diagnostics panel and the raw JSON below it
5. Click **⤢ Full view** if you'd rather have it in its own full browser tab instead of the docked panel

**Why order name/number needs a lookup, not a direct fetch:** Shopify's admin order URL is keyed on the order's internal ID (`7193953272054`), which has no derivable relationship to the order name or order_number — and on some storefronts, the order name isn't even numerically consistent with order_number. So entering a name or number triggers a search of the storefront's order list (same mechanism as Bulk scan below) to resolve it to the right order, rather than guessing at a URL. Pasting a full admin URL (or the raw internal ID) skips that search and fetches directly — it's the faster path if you already have it.

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
├── manifest.json   # MV3 manifest, host_permissions for admin.shopify.com + *.myshopify.com + docs.google.com
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
- The only host permissions requested are `admin.shopify.com` (order lookup), `*.myshopify.com` (see note below), and `docs.google.com` (compliance sheet, only used if you set one) — it can't read or modify any other site
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

## BigCommerce diagnostics (beta)

Unlike Shopify, there's no `.json`-equivalent trick for BigCommerce's admin — this is genuine HTML scraping via `DOMParser`, against two fetched endpoints per order:
- `{sub}.mybigcommerce.com/admin/order/{id}/details` — line items, excise tax line item, shipping address, payment method
- `{sub}.mybigcommerce.com/admin/index.php?searchId={id}&ToDo=viewOrders&orderFrom={id}&orderTo={id}` — the order-list search page, for reading verification status

**Why HTML scraping is inherently more fragile than the Shopify side:** there's no schema. A class-name change on BigCommerce's end breaks parsing silently — no error, just wrong or missing data. Everything below was built and verified against real order HTML from **three different client stores** (VapeRanger, LightFire Holdings, Zuluvape), not guessed at from a single sample.

### What TOT looks like on BigCommerce (no tag system exists here)

BigCommerce has no order-tagging system like Shopify's `tot-*` tags. TOT's integration instead uses two different mechanisms, confirmed via direct internal documentation:

- **Excise tax**: modeled as its own line-item *product* (SKU `TOT_EXCISE_TAX`, named `"{State} Excise Tax"`), added to the order like any other product — **not** a proper tax line the way Shopify's `tax_lines` work. BigCommerce's native "Tax" field in the order summary reflects only its own "Basic Tax" provider and is `$0.00` even on orders with a valid excise charge.
- **Verification status**: a **custom order status** TOT provisions via API/webhook — `"Manual Verification Required"` — confirmed to exist with identical exact text at the same status-list position across all three stores checked, despite those same stores customizing *other* native statuses independently (e.g. one store renamed "Partially Shipped" to "Partially Shipped-Pre Order"). This is the functional equivalent of Shopify's `tot-not-verified`/`tot-rejected` tags, just implemented as a status value instead of a tag.

There is **no BigCommerce equivalent** of Shopify's `tot-excise-tax-collected`/`-incorrect`/`-not-required` outcome tags — TOT's own guidance is that excise tax *correctness* (not just presence) is determined by manual reconciliation, not something the platform surfaces automatically. This tool checks **presence and jurisdiction**, not whether the dollar amount itself is correct.

### Checks implemented (7 automatic + 1 on-demand — 8 of Shopify's 9, see Product & price check below for the 8th)

1. **Order status** — flags `Manual Verification Required`, `Declined`, or `Disputed`; treats `Cancelled`/`Refunded`/`Partially Refunded` as informational context rather than a problem
2. **Excise tax line item presence** — if present, shows the state and amount; if absent, cross-references your compliance sheet for the ship-to state and flags it if that state's entry has substantive excise tax detail
3. **Jurisdiction match** — compares the state named in the excise line (`"NC Excise Tax"` → North Carolina) against the actual ship-to state, same concept as Shopify's tax jurisdiction check
4. **Payment method** — same manual/COD/bogus gateway flag as Shopify
5. **Address mismatch** — compares billing vs. shipping state, same as Shopify. Both addresses use the same free-text block format, so this reuses the same state-extraction logic — verified against real data with an actual mismatch (order 567097350: billing North Carolina, shipping Iowa)
6. **Coupons / discounts** — detects shipping-level coupon codes (`.shipping-discount`, e.g. `"$32.98 off using AMVFREESHIPPING code"`). Only confirmed for shipping-level discounts — no confirmed example yet of how a product-level line-item discount renders, so those may not be caught
7. **Cart size / SKU count** — sums quantity across line items (excluding the excise tax line itself) and flags unusually large carts, same thresholds as Shopify

**Vendor / product specific** — listed as informational (brand names per order), not a flag-worthy check, same as its Shopify counterpart

### Checks that don't have a BigCommerce equivalent — real data-model gaps, not unfinished work

- **Order modification (refund records/amounts)** — order status already surfaces `Refunded`/`Partially Refunded` as a broad signal, but the granular refund line-items/amounts Shopify's `refunds` array provides aren't present in this endpoint's data.

### Bulk scan (beta)

Scans a range of BigCommerce order IDs, flagging only the ones worth a closer look — same idea as Shopify's bulk scan, but a genuinely different architecture underneath, since BigCommerce has no single endpoint that returns full order detail for many orders at once.

**The key discovery that makes this possible:** the legacy admin's `admin/index.php?ToDo=viewOrders&orderFrom={min}&orderTo={max}` endpoint (the same one single-order status lookup already used) treats `orderFrom`/`orderTo` as a genuine **range filter**, not just a single-order lookup with redundant params — confirmed directly: fetching a 4-order range returned all four orders' `data-order-id` and status `<select>` elements in one response, not just one. This is separate from BigCommerce's newer `/manage/orders` admin UI, which is a client-side app shell with no data in the initial HTML at all (confirmed via a real fetch returning nothing but `<div id="root"></div>`) — that path is a dead end for `fetch()` regardless of query params, since the actual content only exists after JavaScript runs in a real browser.

**Usage:** enter a range in the format `768170-768173` (a continuous range only — unlike Shopify's bulk scan, no comma-separated list support, since BigCommerce's range filter only accepts a from/to pair) and click **Scan for issues**.

**Why it's slower than Shopify's bulk scan:** the range fetch only gives status — not excise tax lines, addresses, or anything else needed for real diagnostics. So this is a genuine N+1 pattern: one fetch for the range's statuses, then one more `/admin/order/{id}/details` fetch per matched order to run the full check suite. Sequential with a small delay between orders (same reasoning as Product & price check — keeps load on BigCommerce's servers reasonable, and keeps failures traceable in the console rather than a burst of simultaneous requests).

**Known limitation:** capped at 100 orders per range fetch (no automatic pagination for larger ranges yet) — a range spanning more than 100 orders would silently only scan the first 100 returned.

### Product & price check (beta) — closes most of the PMD gap, plus a BigCommerce Live Price Check

Order HTML alone doesn't expose per-item taxability (that was the original PMD blocker) — but BigCommerce's internal catalog API does, once you can map a line item's SKU to its catalog product. It's on the same `.mybigcommerce.com` domain already covered by `host_permissions`.

**Line-item SKUs on an order are often variant SKUs, not base product SKUs** — e.g. an order's line item might read `litty-thca-thcp-hd9-afblend-cart-1g-rainbow-cotton-candy`, while the actual product's SKU is `litty-thca-thcp-hd9-afblend-cart-1g` (the trailing segment is a flavor/variant suffix). The exact-match lookup (`internalapi/v1/catalog/products/?sku={sku}`) only searches base SKUs, so a variant SKU comes back as a genuine, honest zero results — confirmed via a real order's raw response (`total: 0, too_many: false`), not an error or a block. Two-tier resolution handles this:
1. Try the exact SKU match first (works directly for non-variant products)
2. If empty, fall back to `internalapi/v1/controlpanel/search?q={sku}` — BigCommerce's own fuzzy admin search, which can resolve a variant SKU back to its parent product and returns a numeric product ID directly. A **prefix-match safety check** (the order's SKU must start with the search result's base SKU) guards against trusting a fuzzy top-scoring match that's actually a different, similarly-named product.

This powers two checks, run on-demand (network calls per unique product on the order, not automatic — and processed sequentially with a small delay rather than in parallel, since a large order can mean many unique products):

- **`product_tax_code` presence** — the closest BigCommerce equivalent to PMD. Confirmed via real data: a product TOT HQ's dashboard shows as actually taxed had a non-empty code (`"SPTXKW03"`); a comparison product had it empty. **Important caveat, direct from internal knowledge**: an empty code doesn't necessarily mean a bug — it can also mean the product is genuinely non-taxable, or simply hasn't been configured in TOT yet. Same as Shopify's PMD check, this surfaces something worth a human look, not a definitive verdict.
- **Live price check equivalent** — compares the order's charged unit price (line total ÷ quantity) against the product's current `calculated_price`/`price`. Same "only meaningful for same-day orders" caveat as the Shopify version applies here too.

**What ruled out `tax_class_id` as the taxability signal, worth knowing:** it looked like a plausible candidate at first, but checking multiple real products — including one confirmed taxed via the TOT dashboard — showed it's `0` across the board regardless of tax status. A field that never varies can't discriminate between taxable and non-taxable, so it was dropped in favor of `product_tax_code`, which does vary in a way that matches real confirmed cases.

**Still-open limitation:** the search-fallback path hasn't been tested against a case where it *should* fail safely — e.g. a genuinely nonexistent SKU, or a variant suffix that happens to also prefix-match some unrelated product. The prefix-match guard is a real safeguard, not a formal guarantee.

**Price check likely false-positives on wholesale/B2B orders.** Observed directly on a real order billed to a wholesale-looking account ("Infinity Wholesale Group Inc"): charged price was consistently ~$8.75 against a listed price of $29.99 across two different product variants — a consistent ratio, not a random discrepancy, which looks like a genuine wholesale pricing tier rather than a bug. The `internalapi` endpoint's `price`/`calculated_price` fields reflect the public catalog listing; they have no visibility into customer-group-specific negotiated pricing that BigCommerce B2B stores commonly use. Treat price-mismatch flags on B2B/wholesale orders with extra skepticism.

### Known fragility, being upfront about it

- **Ship-to state extraction is genuinely fragile.** BigCommerce's shipping address is free text (`<br>`-separated lines), not a structured field like Shopify's `province_code`. The parser regex-matches a state name/abbreviation immediately before a ZIP code on the last address line — verified against all three real samples (including a multi-word state, "North Carolina," which an earlier version of this regex silently failed to catch — worth knowing that class of bug is possible here in ways it isn't on the Shopify side).
- **Compliance sheet cross-reference only checks whether text exists in that state's excise column** — it does not parse or apply the tax formula itself (e.g. "45% of wholesale cost"), so it can't verify the *amount* is correct, only that a line item exists when one plausibly should.
- **Only three stores' status vocabulary has been confirmed.** A store TOT hasn't fully provisioned the same way, or a status label that's been manually edited, wouldn't be caught.

### Not implemented

- Customer-level **TOT Excise Tax Exemption Start Date** field — lives on the customer record, not the order, so an exempt customer with no excise line would currently be flagged as a false positive
- Actual excise tax **amount correctness** — would require parsing and applying each state's specific tax formula per product/quantity, a substantially bigger undertaking than presence/jurisdiction checking
- Worth-flagging note format matches Shopify's

## WooCommerce diagnostics (beta — 4 checks)

Only two known clients so far (Vape Society Supply, Vape Depot USA), fetched by directly requesting the order-edit admin page and parsing WordPress's generic custom-fields ("postmeta") editor plus a few structured form fields — no free-text address parsing needed here, unlike BigCommerce.

**Genuinely different from Shopify/BigCommerce in two ways:**
1. **No shared platform suffix.** WooCommerce is self-hosted — each client runs on their own domain, so there's no `*.myshopify.com`-style wildcard. Every new client needs its own `host_permissions` entry added to `manifest.json` manually, and the extension reloaded. Manageable at 2 clients; would need a different approach (or accepting a longer permissions list) if this scales to many.
2. **Two incompatible URL structures exist for the exact same feature.** Vape Society Supply uses the classic order-edit screen (`post.php?post={id}&action=edit`); Vape Depot USA uses WooCommerce's newer HPOS order storage (`admin.php?page=wc-orders&action=edit&id={id}`). Both were confirmed to expose identical underlying markup (custom-fields editor, address fields, payment method select) — only the fetch URL differs, so this is tracked per-domain in the Storefront config table (domain → `classic`/`hpos`), not auto-detected.

### Checks implemented

1. **Verification status** — reads the `tot_status` custom field. `isCleared` → OK. If the field is entirely absent *and* no related quarantine fields exist either, that store simply doesn't use this module (Info, not a problem) — confirmed via the excise-focused store, which has none of these fields at all. If quarantine-related fields (`tot_quarantined`, `tot_quarantine_manually_removed`) are present but `tot_status` isn't cleanly `isCleared`, it's flagged — confirmed against a real order that was quarantined then manually released by staff. **No confirmed example yet of a clean rejected/pending case** — the flag fires correctly regardless, but the detail shown is the raw fields rather than a specific "why," same honesty as BigCommerce's `product_tax_code` ambiguity.
2. **Excise tax collected** — reads `totTaxCollected`. **Important finding from real data:** `exciseTaxStatus` itself does *not* distinguish collected vs. not-required — both read `RECONCILED` on two real orders from the same store, one with tax collected and one without. The actual signal is whether `totTaxCollected` is `0` or a real amount. When `$0`, cross-references the compliance sheet by ship-to state (same sheet/logic as Shopify and BigCommerce) to decide whether that's expected or worth a flag.
3. **Address mismatch** — direct comparison of `_billing_state` vs. `_shipping_state` form field values. These are clean, structured `<input>` values on both classic and HPOS stores — no regex/free-text parsing needed, unlike BigCommerce's shipping address block.
4. **Payment method** — reads the `_payment_method` `<select>`'s selected option (value + label), flags COD/other/unset gateways same as Shopify/BigCommerce.

**Not yet built:** anything beyond these four — no cart size, no vendor/product listing, no coupons check. This is a first real pass on two clients, not a full port of Shopify's 9.

## Roadmap ideas

- Export current storefront config as a ready-to-paste `DEFAULT_CONFIG` block
- Package/sign for the Chrome Web Store (internal or unlisted) so teammates don't need Developer Mode
- BigCommerce: exemption field support, bulk scan equivalent, and validating the status vocabulary against more client stores
