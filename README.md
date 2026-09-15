# Order Diagnostics Tool

A Chrome extension for Token of Trust ops/support that pulls an order's data directly from the platform admin and checks it against the usual reasons excise tax fails to calculate.

**Shopify** is the primary, most complete platform: pulls the order's raw JSON directly from `admin.shopify.com`, runs 9 diagnostic checks (plus 3 conditional ones) per order, and supports bulk scanning plus a separate HQ-side excise tax scan (see below). **BigCommerce** and **WooCommerce** (WordPress) are both supported too, in beta, with a smaller check set built against real client stores on each platform — see their own sections further down for exactly what's covered, what isn't yet, and the known fragility on each.

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

Given an order, it runs 9 diagnostic passes (plus a 10th, conditional one — see below) and flags anything worth a closer look:

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

### Excise tax vs. compliance sheet (10th check, conditional)

Only appears when the order actually has a `TOT_TAXLINE_` excise line item with a nonzero amount — it cross-references that amount against whether the ship-to state's compliance-sheet entry (column J) has any excise tax detail at all. If excise tax was charged but the ship-to state's entry is blank, that's flagged.

This is a different angle from check 5 above: Shopify's native `"___ State Tax"` lines name the state they calculated for, so check 5 can compare that name directly against the ship-to state. TOT's excise line item doesn't encode a state name in its title, so there's nothing to directly compare — this check instead works backward from the compliance sheet's ground truth (does this state require excise tax at all?) against the dollar amount actually charged.

**Confirmed real-world case this would have caught:** vaperanger.com order 567097775, shipping to Holden, MO, was charged $217.52 in Massachusetts excise tax — Missouri has no excise tax requirement. Root cause per dev (Charlie, 2026-08-05): TOT's `api/exciseTax/calculate` endpoint ignores `postalCode` entirely when the request has no `stateCode`, and geocodes off street + city alone, landing in the wrong state. That request payload isn't visible in the Shopify order JSON — the order's own `shipping_address` was correct throughout — so this check can't detect the bug's *trigger* directly. It flags the downstream *symptom* instead (excise tax charged where the compliance sheet says none should apply), which would catch this regardless of root cause, including any future regression once the endpoint fix ships.

**Known limitation:** if the wrong state resolved *does* have an excise tax requirement (e.g. two states that both charge excise tax, and the engine picked the wrong one of the two), this check won't catch it — it only catches "charged where nothing should be charged," not "charged the wrong amount for the wrong state that also charges something." Check 5 (native tax jurisdiction match) remains the one that catches wrong-state resolution by name where the state names appear in tax line titles.

Also skipped during bulk scan, same as check 7 (State-specific rate config) — see Bulk scan's known limitations below.

### Payment terms — Net 30 / B2B (11th check, conditional)

Only appears when the order carries Shopify's `payment_terms` object — i.e. a Shopify Companies / B2B order placed with deferred payment (Net 30, Net 60, etc.) rather than paid immediately at checkout. Shows the term name (e.g. "Net 30") and days-to-due; the raw `payment_terms` object is in the detail for anything not surfaced in the summary.

This existed in the order data and was visible in the front-end (Shopify's order Timeline shows "New payment terms were added to this order") all along, but wasn't previously surfaced by this tool — the "Payment method" check above only reads `payment_gateway_names`, which is typically empty on a deferred-payment order (there's no gateway charge yet), and that showed as an unexplained "no payment gateway recorded" rather than something clearly tied to Net 30/B2B. Both checks now cross-reference each other's detail text.

**Deliberately informational, not a flag:** dev has directly replicated the Net 30 + Shopify Companies + "Login as Customer" checkout workflow and gotten correct excise tax calculation every time (2026-08-06) — so Net 30 on its own is not a confirmed cause of missed excise tax. This exists for fast correlation (e.g. against the open wholesale/B2B `transactionType` pattern under investigation) so "was this order Net 30" never again requires a manual look at the order timeline — not as a verdict that Net 30 is the problem.

### Tax exemption flag (12th check, conditional)

Only appears when `order.tax_exempt` or `order.customer.tax_exempt` is `true`. Surfaces this directly since it's otherwise buried in the raw order JSON. Status is `info`, not `flag`.

**Origin, and why it's informational rather than a flag:** on order MMS1099 (mmschainportal.com), the PMD check showed every real line item with `taxable: true` but `tax_lines: 0` — products configured correctly, but no tax of any kind (native Shopify sales tax *or* TOT's excise line) landed on the order. That looked like it might mean the whole checkout was treated as tax-exempt, so this check was added on the hypothesis that TOT's excise tax extension might key off this same Shopify field. **That hypothesis was tested and disproven the same day (2026-08-06):** TOT's own HQ excise-tax-calculator trace for this order showed `customerExemption.isExempt: false` — correctly and independently determined by TOT's own system — even though this Shopify customer's `tax_exempt` was `true`, and TOT still correctly calculated $40.26 owed. So Shopify's `tax_exempt` and TOT's own excise exemption tracking are separate, unrelated fields; this flag being `true` doesn't predict or explain an excise tax miss. Kept visible since it's still a real fact about the customer/order worth knowing (e.g. for native sales-tax troubleshooting), just not evidence of this class of bug — and deliberately excluded from the "Worth flagging" note for the same reason.

**What MMS1099's trace pointed at instead:** with jurisdiction, exemption, and product config all confirmed correct by TOT's own trace, and the calculated amount itself correct, the actual gap is in whatever commits an already-correct calculation to the order — and the trace's `transactionType: "wholesale"` ties it to the same open wholesale-cluster pattern (see the vaperanger.com/MO case above), not to Net 30 or Companies specifically.

## Worth flagging

Below the diagnostics, the tool generates a note when there's something actually worth flagging — mirroring the manual notes your team already adds to individual orders in the daily Active Monitoring Slack report (e.g. `1543: Status: [:bangbang:] - Excise tax incorrect (tot-excise-tax-incorrect tag)`). If nothing's notable, this panel doesn't appear at all — no empty `[:+1:]` noise.

It includes a **Copy** button for the line to paste into today's report if you're logging one — this is a per-order helper, not a replacement for the Active Monitoring tool itself.

What it currently detects:
- **Excise tax incorrect** (`tot-excise-tax-incorrect` tag)
- **TOT verification rejected or pending** (`tot-rejected` / `tot-not-verified` tags)
- **Missing PMD** (reusing the diagnostics check above, same ancillary-item exclusions)
- **Wrong-state tax calculated** (reusing the Tax jurisdiction match check above) — a `___ State Tax` line that doesn't match the ship-to state, e.g. a city/place name existing in two states getting geocoded wrong
- **Excise tax charged to a state with no excise tax requirement** (reusing the Excise tax vs. compliance sheet check above) — only when a compliance sheet URL is set, since this note needs the sheet loaded; not evaluated during bulk scan for the same reason
- **Manual payment gateway** — flags orders that look manually entered
- **Store credit** — notes if store credit was used as (part of) payment
- **Net 30 / B2B order** (reusing the Payment terms check above) — informational only, since Net 30 alone has been tested and ruled out as a standalone cause of missed excise tax
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
2. **Excise tax line item presence** — if present, shows the state and amount, and flags (not just notes in the detail text — this was a latent bug where a title/ship-to mismatch only showed up if you expanded the row) any mismatch between the state named in the excise line's title (`"{State} Excise Tax"`) and the actual ship-to state; also independently cross-references the compliance sheet even when the title matches ship-to, in case the wrong-state resolution corrupted the whole line item rather than just the title (same failure signature as the confirmed vaperanger.com MO/MA incident below). If the excise line is absent entirely, cross-references your compliance sheet for the ship-to state and flags it if that state's entry has substantive excise tax detail
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

### Fixed 2026-08-24: silently-wrong status/details on stores upgraded to BigCommerce's newer "Orders V2" admin

Found by chance while poking at customer-group visibility on a live demo store (VapeRanger), not something a client had reported: that store has been switched to BigCommerce's newer React-based Orders admin. Navigating to the classic order-search URL this tool fetches (`/admin/index.php?searchId=...&ToDo=viewOrders`, used by `bcParseStatus`/`bcParseOrderList` in both the single-order lookup and bulk scan) no longer returns the classic server-rendered search-results page — it redirects straight into the new `/manage/orders` React UI, which serves an app shell instead.

**The dangerous part wasn't that it failed — it was that it didn't look like it failed.** Every selector `bcParseStatus`/`bcParseOrderList` runs against that shell HTML just comes back empty or null, same as it would for a genuinely-not-found order. Before this fix, that meant a store on the new admin would silently produce empty/misleading results (no status found, no orders found in a bulk range) with no indication that the real cause was "this store's admin has moved," not "nothing here."

**Fix:** `fetchBcHtml()` now checks the fetched response's post-redirect URL (`res.url`, standard `fetch()` behavior) against the URL it requested. If a `/admin/...` request comes back having landed on `/manage/...`, it throws a specific, readable error instead of returning shell HTML for the parsers to silently churn through — surfaced through the same error-handling paths `runBcTest()` and the bulk-scan handler already had (`err.message` shown in the status line), so no new UI was needed. Deliberately narrow: it only fires on an actually-observed redirect away from `/admin/`, so it can't false-positive on a store that's genuinely fine and just happens to have no matching order.

**Not yet confirmed:** whether the `/admin/order/{id}/details` endpoint `bcParseDetails()` uses can also redirect this way — on the one live Orders V2 store checked, it didn't (still returned real classic markup), only the search/list page did. The fix covers it either way if that ever changes, since the guard is generic to any `/admin/` → `/manage/` redirect, not specific to one endpoint. Also unconfirmed: whether any of TOT's actual client stores (as opposed to this demo store) have been auto-upgraded to Orders V2 — worth testing against a real client order.

### Not implemented

- Customer-level **TOT Excise Tax Exemption Start Date** field — lives on the customer record, not the order, so an exempt customer with no excise line would currently be flagged as a false positive
- Actual excise tax **amount correctness** — would require parsing and applying each state's specific tax formula per product/quantity, a substantially bigger undertaking than presence/jurisdiction checking
- Worth-flagging note format matches Shopify's

## WooCommerce diagnostics (beta — 4 automatic checks + 1 on-demand)

Only two known clients so far (Vape Society Supply, Vape Depot USA), fetched by directly requesting the order-edit admin page and parsing WordPress's generic custom-fields ("postmeta") editor plus a few structured form fields — no free-text address parsing needed here, unlike BigCommerce.

**Genuinely different from Shopify/BigCommerce in two ways:**
1. **No shared platform suffix.** WooCommerce is self-hosted — each client runs on their own domain, so there's no `*.myshopify.com`-style wildcard. Every new client needs its own `host_permissions` entry added to `manifest.json` manually, and the extension reloaded. Manageable at 2 clients; would need a different approach (or accepting a longer permissions list) if this scales to many.
2. **Two incompatible URL structures exist for the exact same feature.** Vape Society Supply uses the classic order-edit screen (`post.php?post={id}&action=edit`); Vape Depot USA uses WooCommerce's newer HPOS order storage (`admin.php?page=wc-orders&action=edit&id={id}`). Both were confirmed to expose identical underlying markup (custom-fields editor, address fields, payment method select) — only the fetch URL differs, so this is tracked per-domain in the Storefront config table (domain → `classic`/`hpos`), not auto-detected.

### Checks implemented

1. **Verification status** — reads the `tot_status` custom field. `isCleared` → OK. If the field is entirely absent *and* no related quarantine fields exist either, that store simply doesn't use this module (Info, not a problem) — confirmed via the excise-focused store, which has none of these fields at all. If quarantine-related fields (`tot_quarantined`, `tot_quarantine_manually_removed`) are present but `tot_status` isn't cleanly `isCleared`, it's flagged — confirmed against a real order that was quarantined then manually released by staff. **No confirmed example yet of a clean rejected/pending case** — the flag fires correctly regardless, but the detail shown is the raw fields rather than a specific "why," same honesty as BigCommerce's `product_tax_code` ambiguity.
2. **Excise tax collected** — reads `totTaxCollected`. **Important finding from real data:** `exciseTaxStatus` itself does *not* distinguish collected vs. not-required — both read `RECONCILED` on two real orders from the same store, one with tax collected and one without. The actual signal is whether `totTaxCollected` is `0` or a real amount. When `$0`, cross-references the compliance sheet by ship-to state (same sheet/logic as Shopify and BigCommerce) to decide whether that's expected or worth a flag.
3. **Address mismatch** — direct comparison of `_billing_state` vs. `_shipping_state` form field values. These are clean, structured `<input>` values on both classic and HPOS stores — no regex/free-text parsing needed, unlike BigCommerce's shipping address block.
4. **Payment method** — reads the `_payment_method` `<select>`'s selected option (value + label), flags COD/other/unset gateways same as Shopify/BigCommerce.

**Not yet built:** cart size, vendor/product listing, coupons check. This is a first real pass on two clients, not a full port of Shopify's 9.

### Product & price check (beta), 2026-08-24 — WooCommerce's version of the PMD/live-price check

WooCommerce's version of this check hits a different wall than BigCommerce's. Digging into `wordpress-plugin`'s source turned up an architectural fact that changes what's even checkable here: TOT's `retailPrice`/`wholesalePrice`/`msrp`/`wholesaleCost` fields (defined in `Abstract_Product_Sync.php`) are manually-typed admin fields that get pushed to and pulled from **TOT HQ's API directly** (`Product::send_update_requests`/`send_get_requests` in `Product_Sync.php`) — they are never stored as WooCommerce postmeta locally. There is nothing on a product's own admin page to read them from, so unlike BigCommerce (where the problem is one collapsed field) or Shopify (opaque HQ-side build), WooCommerce's problem is that the relevant fields simply aren't on this page at all.

What IS checkable, and what this builds instead: each line item's charged unit price (line total ÷ quantity, read from the order-edit page's `line_total`/`order_item_qty` hidden inputs) against the product's **current live WooCommerce price** — `_sale_price` if set, else `_regular_price`, both stable core field IDs on the product's own edit page (`post.php?post={id}&action=edit`). This mirrors what checkout itself actually charges: `ExciseService.php`'s `get_transactionLines()` uses `$_product->get_price()` (sale price if set else regular price) for every excise-tax code path (frontend cart calc, admin recalculate, reconciliation) — so comparing against the same live WooCommerce price checkout uses is the closest available proxy, even though it can't see TOT's own pricing fields.

**Variable products are explicitly skipped (Info, not Flag or OK).** A variation line item's product-edit link resolves back to the *parent* product, whose top-level `_regular_price`/`_sale_price` describe a range default, not the specific variation actually ordered — comparing against that would manufacture false mismatches more often than catch real ones.

**A price mismatch here is a weaker signal than BigCommerce's/Shopify's equivalent, for three stacked reasons, not one:** the order may have used wholesale-role pricing (`ExciseService.php` confirms WooCommerce does explicitly signal `transactionType: 'wholesale'` via `Wholesale::user_has_wholesale_role()`, but this check has no visibility into whether a wholesale-specific price plugin changed what was charged); a coupon/discount could have been applied at checkout (line total is post-discount); or the catalog price could have simply changed since the order was placed. Treat a flag here as a lead worth a human look, same posture as the other two platforms' product checks — more so here, given the extra unknowns.

**Not yet confirmed against a live order.** Everything else in this WooCommerce section was verified against real orders from Vape Society Supply / Vape Depot USA. The line-item parser (`wcParseLineItems`) reads WooCommerce CORE's admin order-items markup (`html-order-item.php` — `tr.item[data-order_item_id]`, `.wc-order-item-sku`, `order_item_qty[ID]`/`line_total[ID]` hidden inputs), which is stable across recent WooCommerce versions but hasn't been spot-checked against either real store the way the rest of this section has. Worth diffing the parsed line items against a real order's raw HTML the first time this runs for real.

## HQ Excise Tax scan (proposed, beta — needs review before real use)

Added 2026-08-18, not yet reviewed or merged into a released version. Automates the manual Active Monitoring sweep against HQ's internal Excise Tax Order API (`app.tokenoftrust.com/hq/api-docs/excise-tax-order`), which is unrelated to the Shopify/BigCommerce/WooCommerce storefront checks above — this tab talks to Token of Trust's own HQ, not a client's platform.

### What it does

For each org in the configurable queue, it drives a real HQ browser tab through the same steps a person does by hand:

1. Navigate to `hq/choose-app`, search and select the org (simulating the Vue Select component's input events — there's no simpler API for this, see "Why `chrome.scripting`" below).
2. Navigate to the API docs page, click **Reset token** then **Generate a new access token** to force a fresh mint (the page's own auto-token can go stale across org switches — this bit us during manual testing and is why the scan always forces a fresh one rather than trusting whatever's already showing).
3. Decode the resulting token and check its `referrerOrigin` actually matches the org just selected before trusting it for anything — `calc-detail` returns an empty `200` instead of a `404` for domain-mismatched orders (see known API bugs below), so this check has to happen before scanning, not after.
4. Pull orders (either a fixed ID range or a "last N hours" window via the list endpoint) and flag any order where `exciseTaxCollected === "0"` but recomputing tax from the per-rule `calc-detail` breakdown gives a nonzero amount — the wholesale `error.incorrectCollection` pattern.

### Why `chrome.scripting` instead of a direct `fetch()` like the other tabs

Every other tab in this extension works by calling `fetch()` directly from the side panel against a host-permission-covered origin (see "Why an extension" above). That doesn't work here: selecting an org and minting a token both happen through in-page app state (a Vue Select component, and an in-page token-mint flow) rather than a documented, directly-callable endpoint discovered during manual testing. So this tab instead opens a real tab on `app.tokenoftrust.com` and uses `chrome.scripting.executeScript` to run the same DOM-driving steps a person would — same idea as the other checks, just automating clicks instead of calling an API directly for the org-switch/token-mint steps. The actual excise-tax API calls in step 4 run as ordinary same-origin `fetch()` calls from inside that injected script, since they execute in the real page's own context.

**New permission classes this requires**, not previously used by this extension: `scripting` and `tabs` (to inject and run code in a tab), plus `https://app.tokenoftrust.com/*` in `host_permissions`. These are meaningfully broader than a plain host permission — `scripting` lets the extension run arbitrary code in any tab matching its host permissions — which is why this whole tab is marked proposed rather than merged directly.

### Fixed 2026-08-18: org switch wasn't fully committing before minting a token

First version navigated straight from "Choose App Domain" to the API docs page after selecting an org, and minted tokens that came back scoped to the wrong org (in one case, `tokenoftrust.com` itself rather than the intended client). Root cause, confirmed directly: selecting an org auto-redirects to an intermediate `/hq/configuration-check` page ("Checking your configuration") that needs its own **Continue** click before the org actually becomes the backend session's current org — the "(domain)" label on the API docs page updates immediately and looks correct, but the token minted before this gate clears reflects whatever org was previously committed. The scan now waits for the real tab URL to move off `/hq/choose-app`, clicks **Continue** if it lands on the configuration-check gate, waits for that to clear too, and only then navigates to mint a token. A failed/wrong-scope token now retries the *entire* org-switch sequence, not just the token mint, since re-minting alone on an uncommitted org switch doesn't fix anything.

### Usability fixes, 2026-08-18 (later same day)

- **Domain is now a dropdown**, sourced from an editable "Known domains" list (its own list, separate from the Shopify storefront config — HQ's app domain isn't always the same string as a store's public domain, e.g. `bigdvapor.net` here vs. `bigdvapor.com` on the Shopify tab). Typing a domain by hand is no longer possible in the queue table, to rule out typos at the point of use; fix a domain once in "Known domains" and it's correct everywhere it's used.
- **"Last N hours" is now a fixed 24h checkbox**, not a typed number — checking it clears the ID range fields (and vice versa), rather than trusting whichever one happens to be filled in.
- **"Reset to defaults" now clears results too**, along with the queue, so a fresh run doesn't start with a stale scan's results still showing.
- **Mismatches render as a table** (Order ID / Region / Type / Collected / Should've collected / Rule(s) applied) instead of a raw JSON dump, so a flagged order's specifics are readable without manually parsing anything.

### Open-ended ID range, 2026-08-19 — for when you know the start but not the end

You often know the last order checked in the previous Active Monitoring pass (so the next start ID), but not what the newest order number is at scan time. Leaving **ID end** blank now handles this: the scan walks forward one ID at a time from **ID start**, and stops once it hits 15 consecutive misses (order IDs that don't exist) in a row — a single missing ID isn't treated as "the end," since gaps of a few IDs can happen legitimately (e.g. a cancelled/test order never landing in this API), but a run of 15 in a row is a reasonable signal you've passed the newest real order. There's also a hard cap of 3,000 checked in one row as a runaway-loop backstop, not expected to matter in normal use.

The results panel shows the newest order ID actually found in this mode, specifically so it can be copied into the next cycle's start ID — closing the loop without needing to know the ending number in advance either time.

**Trade-off to know about:** this makes one request per ID until it finds the true end, so an open-ended row costs more requests than a tight fixed range would (though so does guessing too generous an end ID). Fine for a twice-daily catch-up scan; would want a smarter approach (e.g. binary-searching for the boundary) if this needs to run much more often or over much larger gaps.

### Derived per-org status breakdown, 2026-08-19 (later same day)

Each org's result now also shows a breakdown labeled with the actual tag names used internally, e.g.:

```
88 checked:
  6 tot-excise-tax-not-required
  80 tot-excise-tax-collected
  2 tot-excise-tax-incorrect
```

Computed from data the scan already pulls per order (no extra requests):

- **not required** — no excise tax rule applied to the order at all (`ruleKeys` empty).
- **incorrect** — a rule applied *and* the existing under-collection mismatch pattern was hit. Same orders as the mismatch table above, just rolled into the count.
- **collected** — a rule applied and that specific mismatch pattern was *not* hit.

Worth being precise about what "collected" means here: it's "this one known failure mode (excise tax owed, `exciseTaxCollected` shows `0`) wasn't detected" — not a confirmation that the exact dollar amount collected was correct. We looked at using this to derive the four `tot-excise-tax-*` tags flagged internally (`not-required` / `collected` / `incorrect` / `reconciled`) and confirmed via live schema inspection (`OrderData`, `CalcDetailEvent`) that the Excise Tax Order API has no literal tag or verification field — `CalcDetailEvent.status` (`pending`/`confirmed`/`cancelled`) is a checkout lifecycle state, not a tax-correctness signal, and doesn't distinguish a known-mismatched order from a clean one. So three of the four tags are approximated from data already in hand; there's no clean equivalent here for `tot-excise-tax-reconciled`, and the actual verification-tag question (a separate, higher-classification "Verify Person" API, keyed by person/reservation rather than order ID) is being left for a follow-up rather than folded into this pass.

### Overcharge detection (stale catalog price), 2026-08-20

Added after investigating a real client-reported case (vaperanger.com — excise tax calculated off the original/catalog price instead of the actual sale price, in "price-based" jurisdictions). The root cause there turned out to be that `GET /api/exciseTax/order/{orderId}` returns a `products` object embedded in the same response as `transactionLines` — a per-SKU catalog snapshot (`wholesalePrice`/`msrp`/`retailPrice`, always synced to one value) sitting right next to the real transaction price for that SKU (`unitSalesPrice`/`unitDiscountedPrice`). For specific SKUs, that catalog price had drifted higher than what the store was actually charging, and the excise tax calc appears to price off the catalog value — producing an over-collection, not an under-collection (the opposite of the existing mismatch check above).

Each scanned order is now also checked for this: any transaction line where the catalog `retailPrice` exceeds the actual `unitSalesPrice` by more than a cent gets flagged, with the SKU, product name, quantity, actual price, catalog price, and per-unit delta all surfaced in a new table in the results panel (label: "order(s) with a line where TOT's saved catalog price is above what was actually charged"). This needs no calc-detail call at all — it's derived entirely from the order lookup's own embedded catalog snapshot, which also means it still works when calc-detail comes back empty (as it did for one of the three vaperanger.com orders during that investigation).

Deliberately conservative about what this claims: it flags a **price gap**, not a confirmed tax dollar amount overcharged. Converting the price delta into an actual overcharged-tax dollar figure would need the tax rate/rule in effect for that SKU + jurisdiction (visible in calc-detail's `appliedRules`, when calc-detail happens to be populated) — and different rule types (percentage-of-price vs. flat-per-unit vs. per-volume) would need different math, which isn't reliably inferable across all cases. So this surfaces "here's where TOT's saved price looks stale, go look" rather than "you were overcharged exactly $X" — the latter still needs a human (or a future, more targeted check) to confirm per case, ideally alongside calc-detail data when it's available.

### Overcharge $ estimate — learned tax-rate directory, 2026-08-20 (later same day)

Added a way to turn the price-gap flag above into an actual estimated dollar amount, without needing calc-detail to be populated on the specific order being checked.

The trick: whenever calc-detail *is* populated for some order (any order, any org, any time this tool scans one), it shows both the per-unit tax actually charged (`appliedRules[].unitTax`) and the catalog price it was computed against (`retailPrice`) for that SKU. Dividing the two gives an effective tax rate for that jurisdiction + SKU-type combination — e.g. `US.regionCode.PA::vape` → confirmed ~40%, `US.regionCode.AK::vape` → confirmed ~55% (these two differ, as expected — different jurisdictions really do have different rates, confirming this needs to be learned per jurisdiction rather than assumed to be one universal number). This is saved to a small persisted directory (`chrome.storage.local`, key `totHqRateDirectory`) as a running average per key, and gets more complete the more this tool is used, across every org, not just one at a time. It's deliberately **not** cleared by "Reset to defaults" — that button resets the scan queue and results, not this cross-org learned directory, since wiping it on every reset would throw away rate knowledge for no reason.

To apply a learned rate, we only need data already on the order lookup itself: `shippingLocation.regionCode` gives the jurisdiction half of the key, and `products[sku].type` (confirmed via live lookup to exactly match calc-detail's `ruleSet` values — `"nicotinePouch"` for ZYN-style pouches, `"vape"` for vape products) gives the rest. So the estimate can be shown even on orders where calc-detail itself came back empty (the WA case from the original investigation), as long as *some* other order has already taught the tool that jurisdiction+type's rate.

What shows up in the overcharge table now, per flagged line: an estimated dollar amount overcharged (e.g. "~$3.46"), the rate used and how many samples it's based on (e.g. "rate 40.0%, n=3"), or "no learned rate yet" if this tool hasn't seen a calc-detail sample for that jurisdiction+type combination. Coverage improves automatically over time and across orgs — there's no manual rate table to maintain. Each org's result also rolls this up into a running estimated-overcharge-total line, with an explicit count of how many flagged lines had a rate to estimate from vs. how many are still showing the raw price gap only.

Worth repeating even though it's said above: this stays an **estimate**, derived from rates observed on other orders, not a confirmed dollar amount owed back — worth a sanity check before it's used to justify a specific refund or credit, especially early on when sample counts (`n=`) are still low.

### Open-ended ID range: gaps can exceed the miss-streak limit, 2026-08-21

Found on vapesocietysupplies.com: an open-ended scan starting at a known order ID reported "newest order found: (that same ID)" after hitting 15 consecutive 404s — reading as "no new orders since then." Checked directly against the API and that was wrong: TOT had 241 orders for that store in the prior 48 hours, the newest just minutes old. The real cause was a 50-ID-long gap in the sequence starting right after the scan's start ID (confirmed by checking every ID in the gap individually) — bigger than the 15-miss stop threshold, so the scan gave up before reaching where real orders resumed.

Deliberately not "fixed" by raising `MISS_STREAK_LIMIT` — that just moves the same failure mode to a bigger gap on some other store, it doesn't remove it. The actual fix is using the right mode for the store: **"Last 24h" doesn't have this failure mode at all**, since it lists whatever TOT actually recorded rather than walking a guessed ID space and deciding when to stop. Recommendation: use open-ended ID-range mode for lower-volume stores where gaps tend to be small and you're picking up from a known last-checked order; use "Last 24h" for higher-volume stores, or any store where you're not confident gaps stay small.

### Token read could fail on a live page-load race, 2026-08-21

Hit while testing "Last 24h" mode on vapesocietysupplies.com: a scan failed immediately with `no-token` — the injected script found no token value on the page at all (different from `wrong-scope`, where a token exists but for the wrong domain). Root cause was the same class of issue as the earlier org-switch timing bug: the code waited a fixed 1 second and assumed the docs page had finished rendering before clicking "Generate a new access token" and reading the result — if the page was still loading, both the click and the read came up empty, with nothing to retry against.

Fixed by polling for either token-related button or the token element itself to actually exist (bounded at 8s) before touching anything, and by giving token minting up to 4 more seconds to actually populate the element after the click, instead of checking exactly once. This doesn't replace the existing one-retry-of-the-full-org-switch-sequence behavior in `runHqScan` — it just makes a single attempt much less likely to fail on a slow page load in the first place.

### "Newest order found" hint was missing for Last 24h and fixed-range scans, 2026-08-21

Noticed after a "Last 24h" scan on vapesocietysupplies.com completed with no way to tell what the highest order ID reached was — the results panel had no "Newest order found" hint at all, even though the underlying scan code computes `highestFoundId` unconditionally for every scan mode (ID-range, open-ended ID-range, and Last N hours alike). The render logic in `renderHqResults()` was wrongly gating the hint's display behind `r.openEnded &&`, so it only ever showed up for open-ended ID-range scans.

Fixed by removing that gate — the hint now shows for every scan mode whenever at least one order was found, so you no longer have to eyeball the results table (or worse, only the flagged-orders subset) to figure out where to start the next check.

### Overcharge flag was firing on tax-exempt lines, 2026-08-21

Found via a real false positive on vapesocietysupplies.com: order 2447704 flagged a $7 catalog-vs-actual price gap on a Vaporesso XROS 6 Kit "part" SKU (`SV30788`), with an estimated ~$2.94 overcharge attached from the learned MN vape rate. Checked directly in HQ's own "How was this tax calculated" tool and found the real per-line record for that SKU: `appliedRules: []`, `isExempt: true`, `tax: 0`. The item is tagged `isPart`/`isExempt` — a kit component excluded from tax entirely — so it contributes zero tax no matter which price (catalog or actual) is used. A stale catalog price on an exempt line is tax-irrelevant by definition; it was never going to cause a real overcharge.

The order-lookup catalog snapshot (`order.products[sku]`) already carries an `isExempt` field alongside `retailPrice`/`msrp`/`wholesalePrice`/`type` (same one used in the earlier vaperanger.com investigation), but the overcharge check wasn't consulting it — it flagged any price gap over a penny regardless of exemption status. Fixed by skipping exempt SKUs before computing a delta at all. This should reduce (not necessarily eliminate) the flagged-line counts on past scans — re-run to get corrected numbers; the fix doesn't retroactively re-check anything already shown in a previous run's results panel.

Worth noting for whoever picks this up next: this SKU still had a learned rate applied to it (42%, from other MN vape-type orders) despite being exempt on this specific line — meaning `type` alone isn't a reliable stand-in for "this SKU is taxable on this order." `isExempt` needs to be checked per-line, not inferred from product type.

### A second false-positive class: whole orders where no rule matched at all, 2026-08-21

Same session, a second flagged order (vapesocietysupplies.com #2447753, PA) turned out to also be a false positive, for a different reason than the isExempt one above. HQ's "How was this tax calculated" tool showed `jurisdictionResolution.products[].rules: {}` for every line on the order — no excise tax rule matched anything — and both **Tax collected on order** and **Recalculated tax (Historical)** were $0.00. A catalog-price gap on a line that was never taxed at all can't produce an overcharge; there's no collected amount to have been inflated.

This one's trickier than the isExempt case because we can't tell "no rule applies to this order" apart from "calc-detail came back back empty due to the known bug" (see "Known API bugs" below) just by looking at calc-detail — both show up as an empty rules object. Deliberately did NOT try to resolve that ambiguity via calc-detail. Instead, added a guard using a field that's always present regardless of calc-detail availability: `order.exciseTaxCollected`. If it's `"0"`, the order never had any tax collected in the first place, so overcharge lines aren't computed for it at all. This doesn't affect orders with genuine nonzero collected tax — including the original vaperanger.com WA case, where calc-detail itself was empty but the order still had real, nonzero, confirmed-overcharged tax.

Between this and the isExempt fix above, both known false-positive causes found so far are addressed. That doesn't mean the heuristic is now airtight — it's still a price-gap proxy, not a confirmed per-line tax recomputation — just that these two specific failure modes are closed. Re-run past scans to see corrected (likely lower) flagged-line counts.

### A third false-positive class: jurisdictions that don't tax by price at all, 2026-08-22

Order 2447866 (vapesocietysupplies.com, VA) flagged two lines with a real ~$4/unit catalog-vs-actual price gap, but HQ's "How was this tax calculated" tool showed **Tax collected** and **Recalculated tax (Historical)** both at $15.07, and the page states Virginia's rule outright: a flat **$0.11 per mL** on nicotine vape products. That's a per-volume rate — price never enters the formula, so a stale catalog price cannot cause an overcharge here regardless of how big the gap is. Different mechanism from the two false positives already fixed (not an exempt line, not a zero-collected order — tax was genuinely collected here), so neither existing guard catches it.

This one isn't fixable with a third boolean guard the way the other two were — there's no field on the order or catalog snapshot that says "this jurisdiction taxes by volume, not price." What we can do (and did) is stop the tool from implying "no learned rate yet" just means "check back later." It doesn't distinguish two very different situations: not enough calc-detail samples seen yet for that jurisdiction+type, versus this jurisdiction+type may never get a rate because its tax genuinely doesn't scale with price. Reworded both the per-line tooltip and the results-panel summary to say this explicitly, with Virginia's $0.11/mL rule as a concrete example, and to point at HQ's own "How was this tax calculated" tool as the way to actually confirm a flagged line before treating it as a real lead.

Longer-term, the more correct fix would be teaching the rate-learning logic to recognize a per-volume relationship (`unitTax` tracking `volumeInMl` rather than `retailPrice`) and route those jurisdiction+type combos into "not price-based, don't flag" instead of "no rate yet" — flagged here as a real next step, not attempted in this pass since it needs more real calc-detail samples across jurisdictions to validate against before trusting it.

In the meantime, added `CONFIRMED_NON_PRICE_BASED` — a small, manually-curated `Set` of jurisdiction+type keys (same `US.regionCode.<state>::<type>` format as the rate directory) that are skipped before a delta is even computed. This is deliberately NOT auto-populated or stored in `chrome.storage` like the learned-rate directory — adding to it should be a reviewed decision each time, made only after directly confirming a specific combo the way VA::vape was confirmed here (HQ's own "How was this tax calculated" tool showing Historical recalculation matching collected tax exactly, plus the rule text stating the flat per-mL rate outright). Seeded with `US.regionCode.VA::vape` from this investigation. Add more entries here as they get manually confirmed rather than waiting for the real automatic fix above.

### Two more confirmed false positives, plus one that was actively misleading, 2026-08-24

Same afternoon, two more flagged vapesocietysupplies.com orders got manually checked against HQ's "How was this tax calculated" tool and both turned out to be false positives, each for a different reason than VA above:

- **Order 2447910 (OH):** Collected and Recalculated Historical both $15.60. HQ's own rule text: Ohio charges a flat **$0.10 per mL** on nicotine vape products — same mechanism as Virginia, just a different state and rate. Added `US.regionCode.OH::vape` to `CONFIRMED_NON_PRICE_BASED`.
- **Order 2447918 (CO):** Collected and Recalculated Historical both $25.20. HQ's rule text: Colorado charges **56% of wholesale cost**, not retail price. Confirmed with the actual numbers: `wholesaleCost` was a stable $9 across every line on the order (only the unrelated `retailPrice` catalog field was stale), and 56% × $9 × 5 units = $25.20 exactly, matching both figures. This is a different flavor of false positive than VA/OH — Colorado's rule genuinely is a percentage-of-price rule, it's just anchored to `wholesaleCost` instead of `retailPrice`, so comparing catalog `retailPrice` against the actual charged price is checking a field the rule doesn't even use, while the field it does use (`wholesaleCost`) hadn't drifted at all. Folded into the same `CONFIRMED_NON_PRICE_BASED` skip-list for now, since the practical effect is identical (this heuristic can't detect an overcharge for this combo), even though the name is a bit imprecise for this case — see the comment in code.

The OH case is worse than a normal "no learned rate yet" miss: this tool had already "learned" a **27.3% rate from 145 samples** for `US.regionCode.OH::vape` before this fix, and was presenting that as a confidence-inspiring estimate. Since Ohio's real rule is flat-per-mL, not a percentage of price, that 27.3% was very likely a spurious correlation (larger e-liquid bottles tend to cost more, so price and volume drift together across a catalog even though volume is what actually drives the tax) rather than a real rate — a large sample count made a wrong assumption look more trustworthy, not less. Purged the existing stored entry for this key on next run (see the one-time cleanup loop in code) and skip re-learning it going forward, for any key now in `CONFIRMED_NON_PRICE_BASED`.

Also worth recording since it surfaced in the same rule text: Boulder, CO charges 40% of *retail* — a city-level rule that genuinely is price-based, layered on top of the state's wholesale-cost-based rule. Adding the state-level `US.regionCode.CO::vape` key to the skip-list should not suppress a real Boulder-level overcharge if one ever gets sampled, since a city-level rule almost certainly carries its own distinct `ruleId` — but this hasn't been directly tested, so worth a second look if a Boulder rate ever shows up in the learned-rate directory.

Three for three false positives across three different states in one afternoon of spot-checks (VA, OH, CO) is enough to say plainly: this isn't a rare edge case. Most vape/nicotine excise rules checked so far turn out to not be a simple percentage of retail price — which is the one assumption the entire overcharge-detection feature is built on. Every dollar estimate this tool shows, including ones with a rate and a large sample count behind them, should be treated as unconfirmed until individually checked against HQ's own recalculation tool — not just the ones flagged "no learned rate yet."

### Replaced the denylist with an allowlist sourced from TaxOps Portal's State Tax Rules page, 2026-08-24

After three false positives in one afternoon (VA, OH, CO — see above), Marc pointed the tool at an internal source that settles this properly: TaxOps Portal's **State Tax Rules** page (Vapor Products / Nicotine Pouches tabs, kept current via that page's own "Refresh from sheet"). It lists the actual tax basis for all 51 states. The picture it gives: the overwhelming majority of states tax vapor/nicotine products by wholesale cost, wholesale price, a flat per-mL/per-unit/per-container amount, or don't tax them at all. Only a handful come close to "percentage of retail price," and a few of those are compound rules that split by SKU sub-type (open vs. closed system, cartridge vs. device) in a way this tool can't currently isolate.

Given that, patching one state at a time (the VA/OH/CO approach) was solving the wrong problem — the default assumption (catalog retail price is what tax is calculated from) is wrong far more often than it's right. Flipped the model: **skip every state by default, and only run the retailPrice-vs-actual check for states confirmed cleanly retail-based.** `RETAIL_PRICE_BASED` (an allowlist) replaces `CONFIRMED_NON_PRICE_BASED` (a denylist) — everything not explicitly allowlisted is skipped, which immediately covers the ~45+ states nobody had individually checked yet, not just the 3 that got checked by hand.

Full transcription and how each state was classified (Vapor Products tab unless noted):

- **No tax at all:** AL, AZ, AR, FL, ID, MI, MS, MO, MT, ND, OK, SC, SD, TX — skipped, no basis to compare against.
- **Wholesale cost/price basis (percentage, but not on retail price):** CA (51.08% wholesale + a separate 12.5% retail component — see below), DC (64%), HI (70%), ME (75%), MA (75%), MN (95%, sheet appears to be missing a "%" sign — flagged, not silently "corrected"), NV (30%), OR (65%), PA (40% "purchase price from the wholesaler" — see the important caveat below), TN (10%), UT (71%), VT (92%), WY (15%) — skipped, wrong price field for this heuristic even though the rule itself is a real percentage rate.
- **Flat per-volume/per-unit basis (price isn't an input at all):** DE ($0.05/mL), IA ($0.05/mL), KS ($0.05/mL), LA ($0.15/mL), NC ($0.05/mL), OH ($0.10/mL — already found), VA ($0.11/mL — already found), WV ($0.075/mL), WI ($0.05/mL) — skipped.
- **Compound rules split by sub-type, where a genuine retail-price component exists but this tool can't currently tell which SKUs fall into which sub-type:** IN (30% wholesale cost for closed cartridge/closed single-use, 30% of retail for other types), NJ ($0.30/mL on nicotine products, 30% of retail sales price — exact split unclear from the summary view), CA (51.08% wholesale + 12.5% retail, i.e. two separate taxes on the same sale). Skipped for now rather than risk flagging the wrong subset; would need a SKU-level open/closed or device/e-liquid classification this tool doesn't have to split correctly. Worth revisiting if that classification ever becomes available.
- **Compound rules with NO retail component in either branch (safe to skip entirely, no sub-type ambiguity risk):** CT ($0.40/mL closed, 10% wholesale open), GA (5¢/mL closed, 7% wholesale open/device), KY (15% wholesale open, $1.50/unit closed), NE ($0.05/mL ≤3mL, 10% wholesale >3mL), NH ($0.30/mL closed, 8% wholesale open), NM (12.5% "product value" + $0.50/cartridge — leans wholesale per the sheet's own basis tag), RI ($0.50/mL closed, 10% wholesale open).
- **"Local rules only" (no state-level base rate shown; would need per-city drill-down this tool doesn't do):** AK, CO, IL, MD — skipped, unresolved. (Colorado's *state* rule, separately, is the 56%-wholesale-cost one already confirmed and allowlisted-out above; Boulder specifically charges 40% of retail on top of that, per the same page — a real city-level exception that should get its own rule key rather than colliding with the state one, though this hasn't been directly tested.)
- **Confirmed retail-price-based, added to `RETAIL_PRICE_BASED`:** NY (20% of retail price of all vapor products — clean, no wholesale component at all) and WA (95% of "selling price" — matches the original vaperanger.com WA finding, though "selling price" as worded on this page is a little ambiguous about whether it means end-consumer retail or a distributor-level price; kept in since it lines up with confirmed real-world data).

Nicotine Pouches tab: same exercise, but the screenshots reviewed initially only covered ID through WY alphabetically — AL through HI was a gap at first. Of what was covered, only WA (95% of "selling price," identical wording and rate to its vape entry — possibly a copy artifact in the source sheet, not independently confirmed) looked retail-based; everything else was no-tax, wholesale-basis, or flat per-container/per-pouch (IN, IA, ME, NC, OR, UT, VT all flat/tiered per-unit; LA, MN, NE, NV, NH, NJ, NM, NY(pouches — note: 75% of *wholesale* price, unlike NY's retail-based vape rule), RI wholesale-basis; WY only taxes tobacco-leaf-derived nicotine at 20% of wholesale, a sub-classification this tool doesn't have either but moot since it's wholesale-based anyway). Added `US.regionCode.WA::nicotinePouch` to the allowlist on the same cautious basis as WA vape; nothing else changed for pouches since nothing else qualified.

Some of the AL–HI gap got filled in afterward: Alabama, Alaska, and Arizona are "Local rules only" for nicotine pouches too (same category as the vapor-product local-only states — AK/CO/IL/MD — just a different set of states for this product type, since AL/AZ have "No tax" for vapor but local-only rules for pouches specifically). No functional change needed — "local rules only" states were already being skipped by default, same as before — but worth documenting precisely rather than lumping them into "not yet transcribed." Full state-level (AL–HI) pouch transcription otherwise still isn't done.

**Correction:** an earlier version of this note claimed a data-quality mismatch — Alaska place names ("Juneau County," "Fairbanks North Star Borough") appearing to show up under Alabama's and Arizona's "local rules only" rows. That was wrong, and it was our misreading, not a sheet error: a later screenshot of the Vapor Products tab confirmed Alaska's own expanded city list is exactly those six entries — Anchorage (55%), Matanuska-Susitna Borough (55%), Juneau County (45%), Petersburg County (45%), NW Arctic Borough (45%), Fairbanks North Star Borough (20%), all wholesale-price-based — correctly attributed to Alaska both times. The rows had just been misattributed to the neighboring Alabama/Arizona headers when first reviewed. No action needed on the sheet; retracting the earlier flag. Also confirmed from the same pass: Illinois's local rules (Chicago $1.50/unit and $1.20/mL, Cook County $0.20/mL) and Maryland's (Montgomery County 30% of wholesale price) are all non-retail, and Colorado's Boulder rule is confirmed exactly as expected — 40% of *retail*, a real city-level exception layered on the state's wholesale-cost rule, per the note above about it needing its own rule key.

Also filled in two more pieces of the nicotine-pouch AL–HI gap: Connecticut has no tax on nicotine pouches (explicitly excluded from its taxable vape/tobacco definition), and Delaware currently has none either (a bill is proposed but not yet passed/effective).

One finding worth flagging to whoever owns this data rather than quietly working around: **Pennsylvania's row says the basis is wholesale price/cost**, but the original vaperanger.com investigation found TOT's actual (buggy) tax on real PA orders tracked the catalog `retailPrice` field almost exactly, and matched the client-reported overcharge dollar amounts precisely. Both can't be TOT's real behavior for PA at once. Possibilities: TOT's engine has a second bug for PA specifically (using retailPrice when the rule calls for wholesale cost) separate from the BigCommerce discount-passing bug already tracked; or the field TOT labels "retailPrice" internally for PA-scoped orders doesn't mean what its name suggests. Did not change how PA is handled here either way (still not on the allowlist, so no longer auto-flagged by this tool) — but this is exactly the kind of discrepancy worth a direct question to Charlie or whoever owns the excise tax rule engine, since it might point at a second, undiscovered bug.

Also not attempted in this pass: teaching this tool to actually split compound rules by SKU sub-type (IN, NJ, CA), or resolving the "local rules only" states (AK, CO-city, IL, MD) — both would need richer per-SKU data (an open/closed or device/e-liquid classification, and city-level shipping granularity) than what's currently pulled from the order lookup.

### New check: possible missed tax from a silent isExempt fallback, 2026-08-24

Everything above hunts for overcharges. This one looks the other direction, and came out of reading BigCommerce's own source rather than a support ticket: Darrin granted Bitbucket access to the bigcommerce-app, shopify-app, and wordpress-plugin repos, and `modules/totProductBuilder/totProductBuilder.node.js` (the module that builds the catalog snapshot this tool already reads) shows that a `vape`-type product gets `isExempt: true` set automatically whenever it's missing `volumeInMl` or a classifiable `vapeSystemType` — a fallback for incomplete product data, not a real tax exemption. That's the same mechanism behind the SV30788 "kit part" false positive fixed earlier, but it cuts both ways: a genuinely sellable nicotine vape product that's missing its volume classification would look identical in the catalog snapshot (`isExempt: true`) to a legitimately-exempt kit accessory, except it should have been taxed and wasn't.

Added a new flag for lines where `isExempt: true`, `type: 'vape'`, `hasNicotine: true`, `volumeInMl` is missing, and the catalog price is more than a trivial amount (>$1, to filter out actual $0.01 kit filler parts). Shown in its own section per org, separate from the overcharge table.

Important caveats, more so than any other check in this tool:

- **Unconfirmed.** Every other false-positive fix and overcharge line in this tool traces back to a real order someone manually verified against HQ's "How was this tax calculated" tool. This one doesn't yet — it's a hypothesis derived from reading BigCommerce's builder source, not something confirmed against a live flagged order. Treat every hit as a lead to manually check, not a confirmed miss.
- **BigCommerce-sourced logic, applied across all platforms.** The `isExempt` fallback rule was read directly from the BigCommerce app's code. Whether Shopify's and WordPress's product data ends up in HQ's catalog the same way wasn't confirmed — the Shopify app's `productSync.node.js` module only pushes catalog fields that HQ already computed and sent it via webhook, so the actual field-building logic for Shopify products lives on HQ's backend, outside any repo access granted so far. This check is applied uniformly anyway since the catalog fields it reads (`isExempt`, `type`, `hasNicotine`, `volumeInMl`) are the same regardless of platform — but if HQ's Shopify-side builder works differently, this could under- or over-flag on Shopify stores specifically.
- **Scoped to vape only.** Nicotine pouches have their own pair of required fields (`weightInOz`/`pouchesPerContainer`) that haven't been confirmed present in this order endpoint's per-SKU catalog snapshot the way `hasNicotine`/`volumeInMl` have been — extending this check to pouches would need that confirmed first.

### New check: wholesale-cost-basis rate verification, 2026-08-24

The overcharge check earlier in this changelog is stuck checking only NY and WA vape/nicotinePouch, because everything else on the TaxOps Portal sheet taxes off a field other than retail price — and per `totProductBuilder.node.js` (BigCommerce), `retailPrice`/`wholesalePrice`/`msrp` are all literally the same underlying field, so comparing against "the wrong field" isn't a small correction, it's the whole heuristic falling apart for those states. But `wholesaleCost` isn't part of that collapse — it's sourced from a genuinely separate field (`variant.cost_price` / `product.cost_price`), confirmed distinct back when Colorado's rule (56% of wholesaleCost) was verified via order 2447918. That means for every state whose basis actually is a percentage of wholesaleCost, the correct tax is fully computable — no estimating, no price-field ambiguity, just `wholesaleCost × rate`.

Added `WHOLESALE_COST_BASED`, transcribed from the same TaxOps sheet used for the retail-price allowlist: CO (56%, confirmed), DC (64%), HI (70%), ME (75%), MA (75%), NV (30%), OR (65%), TN (10%), UT (71%), VT (92%), WY (15%). For each SKU where calc-detail's rate is one of these, computes `expectedUnitTax = wholesaleCost × rate` and compares directly against the actual `unitTax` charged — flagged in whichever direction it's actually wrong, over or under, not just "possible overcharge."

Deliberately left off the list:

- **CA** — compound (51.08% of wholesale + a separate 12.5% of retail on the same sale). A single rate can't represent two stacked taxes; would need to model both components and sum them, not attempted here.
- **MN** — sheet shows 95%, which reads like a missing "%" sign per the earlier note on it. Not trusted enough to verify against.
- **PA** — sheet says wholesale-basis, but this is the one state where we have direct contradicting evidence: the original vaperanger.com investigation found TOT's actual PA tax tracking catalog `retailPrice` almost exactly, not wholesale cost. Left off both allowlists until that discrepancy gets resolved with whoever owns the rule engine — it's a real open question, not obviously the sheet or the observed behavior being wrong.

Two things about this check that are less battle-tested than the CO/NY/WA numbers already in use: most of these rates are transcribed straight from the sheet and haven't individually been confirmed against a real flagged order the way CO was, and it's genuinely unconfirmed whether calc-detail's per-product entries expose a `wholesaleCost` field the same way they expose `retailPrice` — if they don't, this check will just quietly find nothing, which isn't the same as confirming everything's fine. Worth deliberately checking a real DC/HI/ME/etc. order the first time this runs, rather than trusting a clean result by default.

### New check: flat per-mL rate verification, 2026-08-24

Same idea as the wholesale-cost check just above, for the states where price and cost are both irrelevant to the tax — a flat dollar amount per mL of e-liquid. `FLAT_RATE_PER_ML` covers VA (11¢/mL, confirmed via order 2447866), OH (10¢/mL, confirmed via order 2447910), DE, IA, KS, WI (5¢/mL each), LA (15¢/mL), NC (5¢/mL), and WV (7.5¢/mL) — all transcribed from the same TaxOps sheet as everything else in this changelog. For each SKU, computes `expectedUnitTax = volumeInMl × rate` and compares directly to the actual unit tax from calc-detail, flagged in whichever direction it's wrong.

This is, in principle, the most trustworthy check in the whole tool: there's no price field involved at all, so none of the ambiguity that limits the overcharge check (which field is "the" price) or even the wholesale-cost check (is calc-detail's `wholesaleCost` actually populated) applies to the *rate* itself — a flat per-mL amount just is what it is. The same open question as the wholesale-cost check still applies to the *plumbing*, though: whether calc-detail's per-product entries reliably expose `volumeInMl` hasn't been directly confirmed (VA and OH's confirmations came from the order endpoint's catalog snapshot, not necessarily proof that calc-detail carries the same field).

### New check: B2B/wholesale + excise tax correlation, 2026-08-24

The existing "Payment terms (Net 30 / B2B)" check has been purely informational since it was added — Net 30 alone was tested and ruled out as a cause of missed excise tax. This adds a second, independent question on top of that: **was excise tax actually charged on this B2B/wholesale order at all** — and if so, was it computed off this customer's real wholesale price, or off the standard catalog price?

That question exists because of the totProductBuilder.node.js finding from earlier in this changelog: on BigCommerce, `wholesalePrice`, `msrp`, and `retailPrice` are all the same field (`variant.calculated_price`), so TOT's catalog structurally cannot represent a customer-group/wholesale price distinct from retail. Any B2B/wholesale order with excise tax charged in a catalog-price-based jurisdiction is a near-certain structural risk on BigCommerce. The check now escalates from informational to a flag specifically when `payment_terms` is present AND excise tax was actually charged (in both the single-order diagnostics panel and the auto-generated Slack note) — worded carefully as "worth checking," not "confirmed miss," since the actual field-building logic for Shopify orders lives on HQ's own backend, not in any repo access granted so far, so whether Shopify has the identical limitation is still an open question.

### Fixed 2026-08-24: the "collected" bucket had a strict-zero bug that let a real under-collection through as clean

Found via a real incident, not a hypothetical: kangerwholesaleusa.com order 771030 got Slack-alerted as "incorrect excise tax collected," but this scan's own most recent run had already checked that store and bucketed the order as `tot-excise-tax-collected` (clean), not `tot-excise-tax-incorrect`. HQ's own "How was this tax calculated" tool showed the real numbers directly: **$0.01 actually collected** against a **recalculated-current tax of $242.40** — a large, genuine under-collection, not a rounding blip.

The bug was a strict string-equality check: `mismatch` was only ever computed as `(order.exciseTaxCollected === '0' && taxSum > 0)` — testing whether the collected amount was the literal string `"0"`. `"0.01"` fails that comparison completely, so any order that collected some trivially small but nonzero amount — instead of genuinely nothing — was invisible to this check no matter how wrong the real amount was. **Fix:** compare the collected amount numerically against the recalculated sum with the same 2-cent rounding tolerance the wholesale-cost/flat-rate checks already use (`(taxSum - collectedNum) > 0.02`) instead of testing for exact literal zero. Deliberately still one-directional (under-collection only) — over-collection is already covered separately by the stale-catalog-price overcharge check earlier in this changelog, and merging both into one flag would blur which check actually caught something.

**Also confirmed while investigating, worth recording even though no rate-table change followed from it:** the live order's rule context showed `US.regionCode.WA.all.0: {transactionType: "wholesale", when: ["hasNicotine"]}` — direct, no-speculation confirmation that HQ's rule engine does branch on `transactionType: "wholesale"` for at least this Washington nicotine-vape rule. This had been the single most valuable open question flagged earlier in this project (whether HQ actually honors the wholesale transactionType flag Shopify/WooCommerce send) — now confirmed from a live response rather than inferred. It doesn't change `WHOLESALE_COST_BASED`/`RETAIL_PRICE_BASED` above (`US.regionCode.WA::vape` stays retail-price-based at 95% of selling price, per the existing confirmed entry) — this just confirms *when* that rule fires, not a different basis.

**Not yet pulled in, and worth a follow-up:** the same live tool's network response included a `diagnosticHistory` array on the order, containing an entry with `metric: "error.incorrectCollection"` timestamped 2026-08-21 — a full day before the Slack alert and before this scan's own "clean" pass. That means HQ's backend already computes and stores a ground-truth error signal per order that this tool isn't reading at all. Whether `/api/exciseTax/order/{id}` (the endpoint `scanOneOrder` already calls) carries this same field, or whether it's only exposed through the `getOrder`/`get-fields` endpoints the internal HQ admin tool used (a different auth pattern — `accessToken` query param rather than this scan's `Bearer` header, possibly a more privileged internal-only route) hasn't been confirmed — that needs a live look at the actual `/api/exciseTax/order/{id}` response shape before building against it, rather than guessing at an undocumented field. If it does carry it, checking for any `diagnosticHistory` entry with a `metric` starting `"error."` would be a strictly better signal than any of this tool's own inferred checks, since it's HQ's own internal finding rather than a reconstruction from the outside.

**Operational note, not a code fix:** the open-ended scan mode uses the highest order ID found as the next cycle's start point (see "Newest order found — use this as next cycle's start ID" above), which means an order already scanned and bucketed "clean" under the old buggy logic won't get automatically re-checked once this fix ships — the next run starts after it, not before it. kangerwholesaleusa.com (and any other store scanned before this fix) should get one manual re-run from an earlier start ID to catch any other orders that hit the same "trivial nonzero collection" pattern historically.

### Follow-up on the above, same day: checked HQ's own excise-tax-calculator tool directly for order 771030

Went back with live access to `app.tokenoftrust.com/hq/excise-tax/calculator` (the "How was this tax calculated?" tool this changelog already tells people to manually double-check against) specifically to look for the `diagnosticHistory`/`error.incorrectCollection` signal flagged as a follow-up above. Two real findings came out of it, one closing that follow-up (partially) and one bigger than originally expected:

**The ground-truth signal is real and already surfaced in HQ's UI, but its API shape still isn't confirmed.** Looking up order 771030 and opening "How was this tax calculated?" shows 24 timestamped snapshots for that order, and one of them is labeled distinctly as **"#21 · wrong amount · Aug 22, 06:49 AM"** (every other snapshot is labeled "recorded (order write)" or "calculated") — HQ's own history for this order literally flags it as wrong, a full day before the Slack alert and before this scan's own buggy "clean" pass. Opening that snapshot shows `Calculated tax: $484.80` against `Tax collected: $0.00`, with an explicit **"Mismatch"** badge. So the signal exists and is reliable enough that HQ's own tool leads with it. What's still unconfirmed: the actual API call this modal makes to fetch it. This session's browser automation couldn't capture it — network request logging only ever showed Mouseflow analytics beacons, and a direct script-based read of the request URLs was blocked by this environment's own safety guard against reading URLs that carry auth tokens in their query string (the same `accessToken=...` pattern visible in the original screenshots' Network tab). Someone with real DevTools access (not sandboxed browser automation) needs to confirm whether this is the same `/api/exciseTax/order/{id}` endpoint `scanOneOrder` already calls (in which case this scan may already be receiving `diagnosticHistory` in `orderBody.content` and just isn't reading it) or a separate, more privileged route, before this gets wired in.

**Bigger finding: WA's tax basis turned out to be per-org configurable, not a fixed platform fact — which this tool's whole rate-table approach doesn't account for.** The calculator page has a "Your Active Tax Rules" section (with a red "You have overridden excise tax rules — 35 rules overridden by your configuration" banner for this org) and a separate "Inactive Tax Rules" section below it. For Washington specifically:
- **Active for kangerwholesaleusa.com:** "95% of wholesale cost for liquid, closed cartridge, and closed single use products with nicotine" (wholesale-cost-basis) — and this is exactly what fired on order 771030 (rule `US.regionCode.WA.all.0`, confirmed unit tax $8.08 = $8.50 wholesale cost × 0.95).
- **Inactive for this same org:** "WA Vape 95% of selling price for products with nicotine" — this is the retail-price-basis rule, sitting right there in HQ's catalog but switched off for this org.

That inactive rule is *exactly* the one `AUTHORITATIVE_RATES`/`RETAIL_PRICE_BASED` above assumes is universally true for `US.regionCode.WA::vape`, sourced from the original vaperanger.com investigation. It's not wrong for vaperanger.com necessarily — but it's now confirmed wrong *for this org*, because HQ lets each org override which rule set is active, and 35 rules are overridden here. This means the single-global-rate-table design this whole section is built on has a real blind spot: the same jurisdiction+product-type key can be genuinely different bases for different orgs, and there's no way to tell from calc-detail data alone — only by checking that specific org's Active/Inactive Tax Rules page. Deliberately **not** flipping `WA::vape` from one table to the other over this — that would just break it for whichever org doesn't have the override. Flagging this as an open architectural question instead: does it make sense to add a per-org active-rules lookup before trusting either table for a given org, and if so, is there an API for the same "Active Tax Rules" data this page renders? Worth a decision before building further on top of these tables.

### Follow-up #2, same day: the diagnosticHistory endpoint is confirmed, and it's not the endpoint this scan uses

With the actual request URL in hand (captured from a real DevTools Network tab, not this session's browser automation — see below for why that distinction matters), the shape is now confirmed directly rather than inferred:

- **Endpoint:** `GET /hq/endpoint/excise/getOrder` on `app.tokenoftrust.com`, authenticated via an `accessToken` query parameter — a large encrypted/signed blob (`encryptionType`, `encryptedData`, `passwordSalt`, `cipherIv`, `hmac`) that separately decodes to include `apiKey`, `referrerOrigin`, and an `expires` timestamp. This is a **different endpoint on a different auth scheme** than `scanOneOrder`'s existing `/api/exciseTax/order/{id}` (`Authorization: Bearer <token>` header) — confirmed, not assumed.
- **Response shape:** `{"content": {"orderInfo": {...}}}` — note `orderInfo`, not `order`. Confirmed keys on `orderInfo`: `ts`, `city`, `postalCode`, `regionCode`, `region`, `productsOrdered`, `originalTax`, `newTax`, `diagnosticContext`, `diagnosticHistory`. This is a genuinely different data model from what `scanOneOrder` reads off `content.order` (`exciseTaxCollected`, `shippingLocation`, `transactionLines`, `products`) — so this **answers the open question from the follow-up above**: `diagnosticHistory` is not quietly sitting unread in the response `scanOneOrder` already fetches. It only exists on this separate endpoint.
- **`diagnosticHistory` confirmed shape:** an array of `{metric, ts, context}` entries. For order 771030, 24 entries total, with exactly 3 distinct `metric` values seen: `"recorded"`, `"calculated"`, and one `"error.incorrectCollection"` (timestamped `2026-08-21T22:49:33.643Z` — this is the "wrong amount" entry the UI highlighted). So the filter this changelog speculated about above is real and this simple: `diagnosticHistory.some(h => h.metric.startsWith('error.'))`.
- **Bonus third confirmation of the per-org-override finding above:** the `error.incorrectCollection` entry's `context.rules['US.regionCode.WA.all.0']` includes `"apikeyOverride": "kangerwholesaleusa.com"` — HQ's own data literally names this org as the one the wholesale-cost override applies to. Independent confirmation, from a third angle now (this org's Active/Inactive Tax Rules tables, the calculator's rule description text, and now this raw field), that WA's basis for this org specifically is a deliberate per-org override, not a platform default.

**Why this took a second pass:** this session's own browser automation (CDP-level network logging, monkey-patching `window.fetch`/`window.XMLHttpRequest` to capture only paths and JSON key-shapes, never query strings or values) never once caught the actual request — only third-party analytics beacons. The likely explanation is that the page's HTTP client bound its `fetch`/`XMLHttpRequest` reference at module-load time, before any script this automation can inject gets a turn to run — there's no "run before the page's own scripts" capability available here the way real DevTools has. A real human DevTools session is what finally produced the request URL directly. Noting this as a real limitation of trying to reverse-engineer this specific tool's network calls through browser automation alone, in case anyone else goes looking.

**What's still unsolved, and it's a real blocker before this can be wired into the scan:** even with the endpoint and response shape confirmed, `scanOneOrder` has no way to obtain a valid `accessToken` for it. It's not the same Bearer credential the scan already mints (per "Why this can't be fully unattended" below) — it's a separately-encrypted, `referrerOrigin`-scoped, expiring blob, and nothing in this session's investigation turned up where or how the calculator page itself requests one (same network-capture limitation as above). Pulling this signal into the automated scan needs either: someone who knows how this token gets minted (ideally a stable, scriptable way to get one, not just "load the calculator page as a human and copy it out of DevTools"), or confirmation that the existing Bearer token can be granted access to this same endpoint instead. Worth a direct question to whoever owns this API, rather than more guessing from here.

### Fixed 2026-08-24: the under-collection fix above was itself one-directional, and a second real incident hit the gap the same day

Found via a second real incident, same day as the fix above: vaperanger.com order 567098495 (Illinois) got the same `error.incorrectCollection` treatment from HQ's own `diagnosticHistory` — except this time it was **over**-collection ($183.86 collected vs $91.93 recalculated, the opposite direction from 771030). The scan still bucketed it as clean (`1 tot-excise-tax-collected, 0 tot-excise-tax-incorrect`).

Root cause: the fix above was deliberately written to only catch `taxSum - collectedNum > 0.02` (under-collection), on the reasoning that over-collection was already covered by the separate stale-catalog-price overcharge check (`overchargeLines`). That reasoning didn't hold up: `overchargeLines` is gated to a narrow allowlist (`RETAIL_PRICE_BASED` — NY::vape, WA::vape, WA::nicotinePouch), and Illinois isn't on it — so this order was invisible to both checks simultaneously. HQ's own `error.incorrectCollection` metric doesn't distinguish direction either (it fires the same way for both), so there was no real justification for this scan's primary check to.

Fix: `mismatch` is now `Math.abs(taxSum - collectedNum) > 0.02` — catches over- and under-collection the same way, for any state, not just the ones on the rate-basis allowlists. A new `mismatchDirection` field (`'under'` / `'over'` / `null`) rides alongside it so the results table can show which way it went without anyone doing the subtraction by hand; the mismatch table now has a Direction column for this.

**What this does not fix, on purpose:** it still doesn't tell you *why* the amount is wrong for a state like Illinois with wholesale-cost/per-unit/per-mL rules (45% of wholesale cost, $1.50/unit, $1.20/mL, $0.20/mL per the calculator's Active Tax Rules for this org) — Illinois isn't in `WHOLESALE_COST_BASED` or `FLAT_RATE_PER_ML` yet, so there's no line-level breakdown for it the way CO/WA/VA/OH orders get. Given the WA per-org override finding above (Active vs. Inactive Tax Rules differ per org, not just per state), adding IL rates needs the same care — checking whether IL's rates are also org-overridable before hardcoding a single number — so that's being tracked as separate follow-up work, not bundled into this fix.

### Spot-checked a "collected" (clean) order against the calculator too, same day — corrected below: this is still open, not clean

After the bidirectional fix above, spot-checked a "clean" order (kangerwholesaleusa.com 771292, status "Awaiting payment") against the calculator the same way as the two incidents, since a `$476.38` collected vs. calculator's default `$450.88` recalculated looked at first glance like the same kind of gap the fix above was meant to catch.

Three things ruled that out, in order:

- **`diagnosticHistory` had no `error.*` entry for this order at all** — different from both 771030 and 567098495, which both had one. (Could just mean HQ's error-detection hasn't evaluated this order yet since it's still "Awaiting payment," not necessarily that it's clean — the order status is a real difference from the two finalized orders behind the other two incidents, and wasn't resolved either way here.)
- **Toggling the calculator's "Transaction Type" from "Wholesale (app default)" to "Retail" didn't change the recalculated number at all** — still $450.88 either way. Ruled out a transaction-type mismatch between what the calculator defaults to and what the order actually used (this org's WA rule is an org-level override keyed to the org itself, not conditioned on transaction type, so that tracks).
- **Toggling "Product Metadata" from "Historical (at time of order)" to "Current" made the recalculated number jump to exactly $476.38** — an exact match to what was actually collected, not just close. At the time, this was read as proof the order was fine (correctly taxed against whatever data was live at checkout, with the $450.88 "historical" figure being the stale/mismatched number). **That read was wrong — corrected below.**

**Correction, same day:** got the actual definition of "Historical" vs "Current" from HQ's own documentation for this calculator, and it's specific: Historical recalculates using "the product metadata and tax calculations as they were exactly when the order was placed, reflecting how the product data and tax rules applied at that original time" — i.e., it's meant to answer "what should this order have been taxed, under what was true back then?" Current answers a different question — "what would this be taxed if placed today?" For judging whether a *past* order was billed correctly, Historical is the right standard, not Current. The exact match to Current was a coincidence (or at least not evidence of correctness) — by the actual correct standard, this order shows a **$25.50 over-collection** ($476.38 collected vs. $450.88 that should have applied), and calling it "clean" above was a mistake.

That said, not calling this a confirmed bug either — the calculator's own page separately discloses that coupons applied to an order are a legitimate, non-bug reason collected can differ from the Historical recalculation. Whether that applies to 771292 specifically hasn't been checked. Concrete next step: look at whether a coupon/discount was applied to this order; if not, this is very likely a real over-collection missed by HQ's own `diagnosticHistory` too (which has no `error.*` entry for this order — though that could also just mean HQ's error-detection hasn't evaluated it yet, since it's still "Awaiting payment," not completed). No sign either way of this having been corrected/resolved after the fact — nothing in `diagnosticHistory` shows any adjustment or refund event for it.

**Why this scan agreed with "Current" and not "Historical," and why that's a real problem, not just theoretical:** `scanOneOrder`'s `taxSum` comes from the Bearer-token `calc-detail` endpoint, which — based on this order — appears to reflect live/current catalog and rate data, not a snapshot of what was in effect at order time. Given Historical is the actually-correct basis for auditing a past order, that means this scan may be validating every order against the wrong basis whenever current data has drifted from order-time data — not just a future risk for older orders, but something that may already be happening here. Not fixing this yet — first need to confirm whether `calc-detail` can even be asked for historical-at-order-time data, or whether that only exists behind whatever endpoint powers the calculator's "Historical" mode (same unconfirmed-endpoint situation as the `diagnosticHistory` accessToken blocker above). Flagging as an open architectural question, upgraded in priority given this correction — worth a direct question to whoever owns the calc-detail API about whether it supports a historical/as-of-order-date mode.

### Fixed 2026-08-26: org-switch "Continue" click could silently no-op, producing `no-token` for vapesocietysupplies.com

Marc reported a real "it's saying it doesn't have a token" failure when scanning vapesocietysupplies.com. Live investigation first went down a wrong path — reproducing the `/hq/configuration-check` gate (see "Fixed 2026-08-18" above) by manually replaying only `hqStageSelectOrg`'s steps and then navigating straight to the docs page, which skipped `settleOrgSwitch` entirely and made it look like there was no code handling this gate at all. That was wrong: `settleOrgSwitch` already existed and was already wired into `scanOneOrg` between the org-select step and the docs-page navigation.

The real bug was subtler and inside that existing function. Measured live (polling the page every 200ms through a real org switch to vapesocietysupplies.com): the tab's URL flips to `/hq/configuration-check` via client-side routing roughly 1-2 seconds into the switch, but the "Continue" button doesn't actually mount in the DOM until **another ~1-1.5 seconds after that** — the route change fires before the Vue app finishes rendering the new page. `settleOrgSwitch`'s click step was a single, immediate `chrome.scripting.executeScript` query-and-click (`if (btn) btn.click();`) fired right as `pollUntilUrlChangesAway` first detected the URL change — landing inside that gap often enough to matter. When it did, the click found nothing, did nothing, and nothing errored: the function just polled for a URL change away from `/hq/configuration-check` that was never coming, timed out silently after 6s, and returned. `scanOneOrg` then navigated to the docs page anyway regardless of whether the gate was actually cleared, landing on it with the org switch never confirmed server-side — which left the docs page's own Vue app unable to establish a valid token-minting context, surfacing later as `{ok: false, reason: 'no-token'}`. This is a different failure shape than the original 2026-08-18 bug (wrong-org token) — no token at all, because the switch never completed rather than completing against the wrong org.

Fixed the same way `waitForTokenUiReady` (in `hqStageScan`, added 2026-08-21 for an analogous render-timing gap) already handles this class of problem: the injected script now polls for the "Continue" button to actually exist (checking every 300ms, bounded at 6s) instead of assuming it's already there, and clicks it the moment it appears. No change to the outer timeouts or retry behavior in `scanOneOrg`/`runHqScan`.

**Still open:** whether the empty "The following configuration issues were found for Vape Society Supply:" list on the configuration-check page itself (no issues actually listed, just a Continue button) is expected behavior or a separate HQ-side bug worth reporting to whoever owns that page — this fix works around the render-timing gap either way, but doesn't explain why this specific org hits that gate on every single switch while others (e.g. zuluvape.com) don't.

### Fixed 2026-08-26 (later same day): the main mismatch check flagged orders where calc-detail returned nothing at all as full-amount overcharges

Marc caught this manually: vapesocietysupplies.com order #2448091 showed up in the results table as "Over-collected, $22 collected / $0 should've collected," but checking it directly in HQ's own "How was this tax calculated" tool — both Historical and Current tabs — showed $22 collected against $22 recalculated. No mismatch at all; a real, correctly-taxed VA order.

Root cause: `scanOneOrder`'s calc-detail response for this order came back completely empty — `cd.rules: {}`, `cd.products: []` — even though a real rule genuinely applied and $22 was correctly charged. `taxSum` (derived from `cd.products[].appliedRules[].taxForQty`) is naturally `0` when `cd.products` is empty, and the mismatch check compared that `0` against the real `$22` collected and called it a full over-collection. The tool already has a concept for exactly this situation — `ruleKeys.length === 0` (also derived from an empty calc-detail response) is what the notRequired/incorrect/collected breakdown treats as "calc-detail found no rule for this order" — but the mismatch flag feeding the results table wasn't checking `ruleKeys` at all, so an order calc-detail said nothing about was being scored as if calc-detail had confidently confirmed the correct tax was zero.

An empty calc-detail response isn't evidence the correct answer is $0 — it's the same class of gap as the already-documented "empty `200` instead of `404`" API bug (whatever causes it for this specific order isn't confirmed — this order wasn't cross-org, so it's not that exact known cause, just the same shape of problem: calc-detail silently returning nothing instead of erroring). Fix: `mismatch` and `mismatchDirection` are now only computed when `ruleKeys.length > 0`, i.e. only when calc-detail actually returned at least one rule to compare against. An order with an empty calc-detail response now lands in `notRequired` only, the same bucket it was already implicitly claiming to belong to, and no longer appears in the mismatch table.

**What this doesn't fix:** if a real rule genuinely should apply to an order but calc-detail wrongly comes back empty *and* nothing was actually collected either, that under-collection is still invisible — same pre-existing blind spot as the notRequired bucket always had, just no longer paired with a false "over-collected" claim in the other direction. Also still open: why calc-detail returned nothing for this specific order at all — worth a look if this pattern recurs, since the previously-known trigger for an empty calc-detail response (org/token scope mismatch) doesn't apply here.

**Operational note:** any past scan result showing a mismatch with an empty "Rule(s) applied" column (the `—` in that column is the tell) should be treated as unconfirmed until re-run — some of those may be the same false-positive pattern as #2448091, not real overcharges.

### Why this can't be fully unattended

There's no service credential involved — the "access token" that gets minted is the same interactive-testing token the API docs page's "Try It Now" panel uses, which only exists because a signed-in human has an active HQ session with an org selected. If HQ logs you out mid-scan (its passwordless-login session is short-lived), the scan pauses and tells you to sign back in and click **Start / Resume**; nothing already scanned is lost. This is a meaningful step up from doing it by hand, but it's still not the "runs on a schedule with no one watching" version — that would need a real service credential from whoever owns this API, which is a separate ask (see the internal proposal doc shared alongside this change).

### Known API bugs a scan can hit (report these regardless of what happens with this tab)

- `GET /api/exciseTax/orders` returns a 500 ("Server timeout during read query") on wide `since`/`until` ranges (e.g. multi-year spans), regardless of `limit`. Narrow ranges (~30 days) work fine — keep "last N hours" queues reasonably narrow.
- `GET /api/exciseTax/orders/{appTransactionId}/calc-detail` returns an empty `200` (`count:0, events:[]`) instead of a `404` when the token is scoped to a different org than the order belongs to. Confirmed this is not a cross-tenant data leak — the body is genuinely empty — but it means a mis-scoped token silently looks like "no mismatch" rather than erroring, which is exactly why step 3 above verifies `referrerOrigin` before scanning rather than trusting the response.

### Usage

1. Sign into HQ normally in this browser.
2. Open this tab, edit the **Scan queue** table (domain + either an ID range or "last N hours" — not both), or use the defaults.
3. Click **Start / Resume**. A tab opens (or an existing one is reused) and runs in the foreground — deliberately not backgrounded, since Chrome throttles timers in background tabs and this scan's timing (waiting for the docs app to mint a token, etc.) depends on that not happening.
4. Watch the **Run** panel's status line and progress list. If it pauses for a login, sign in on that tab and click **Start / Resume** again.
5. Results appear in the **Results** panel as each org finishes — no need to wait for the whole queue.

### Known limitations

- Depends on the API docs page's current DOM structure (button labels, the `#collapsed-token-value` element's `data-full-token` attribute, the Vue Select's `input.vs__search` class) — any redesign of that page would silently break this until updated, same fragility class as the BigCommerce HTML-scraping checks above.
- One retry on a failed token mint/scan per org, then it's recorded as an error and the queue moves on — doesn't retry indefinitely.
- No support yet for scanning the same org with multiple non-contiguous ranges in one run (one queue row per org).
- Not tested against a very large "last N hours" result set — the underlying list endpoint's own wide-range 500 bug (above) is the practical ceiling.

### Export Taxlines CSV (beta, added 2026-08-27) — rebuilding the manual S3 taxlines export from this API

**Why this exists:** Haroon's Slack message (2026-08-26) explained that with vapesocietysupplies.com's WordPress backend no longer reachable, the "Taxlines Full"/"Taxlines Filtered" reports (used to prepare Excise Reports) were being generated via an "order sync method" instead — and Taxlines Filtered was coming back completely empty. Digging into the actual CSV Haroon sent confirmed why: all 5,978 line items across 1,687 orders had `totalTax` empty and `taxCollectionStatus: not_fulfilled:pending`, with no exceptions — the sync fallback has no way to learn fulfillment/tax-collected state without live backend access.

Checking `app.tokenoftrust.com/hq/configuration-check` and the Integration tab confirmed the underlying cause is real and current: HQ's own **Two-Way Connection Test** for vapesocietysupplies.com returns `Status: Failed` right now. But that same investigation surfaced a way around it — `calc-detail` (the same endpoint the scan above already calls) is a *durable* record TOT's own tax engine wrote at calculation time, independent of live WordPress connectivity. Two real August orders were pulled live to confirm: order 2445971 came back a true empty skeleton (`partial: true, source: "skeleton"` — no calculation was ever bound to it), but order 2447023 came back with a full, real calc-detail event — complete per-SKU product data, correctly showing zero applied rules because the shipping address was an APO/AE (military) address with no vape excise rule configured, not because of any data gap. So calc-detail isn't uniformly empty for these orders — it has real signal that the order-sync export doesn't.

**What it does:** two ways to gather the same taxline rows, sharing one CSV export. Path 1 (original) reuses `scanOneOrder`'s existing two fetches per order (`GET /exciseTax/order/{id}` and `GET /exciseTax/orders/{id}/calc-detail}` — no new API calls) and, from the same `order`/`cd` objects already pulled for the mismatch scan, also builds one CSV row per transaction line — this only covers whatever order-ID range the scan queue happened to walk. Path 2 (added 2026-08-27, see below) fetches by actual date range instead, independent of the scan queue. Either path downloads the same two files: `taxlines-full-<range>.csv` (every line the run saw) and `taxlines-filtered-<range>.csv` (narrowed to lines with `taxCollectionStatus: calculated` and `totalTax > 0` — Haroon's own definition, "all taxable product with the tax collected on them").

**Column-by-column, what's real vs. computed vs. deliberately blank**, joining three sources by SKU (confirmed from the Excise Tax Order API's schema docs, not guessed):

- `order`, `sku`, `productId`, `quantity`, `country`/`state`/`city`/`postalCode` — direct from the API (`order.transactionLines[]` for quantity, `order.shippingLocation` for the address fields that survive PII filtering).
- `productName`, `productBrand`, `volumeInMl`, `wholesaleCost`, `wholesalePrice`, `retailPrice`, `msrp`, `productTags` — from calc-detail's per-product snapshot when present (the metadata as it stood at calculation time), falling back to the order endpoint's current catalog snapshot (`order.products{sku}`) when calc-detail didn't carry it.
- `totalTax` — summed `appliedRules[].taxForQty` for that SKU; left blank (not `0`) when there's no real calc-detail event for the order, so an unknown amount is never confused with a confirmed zero.
- `taxCollectionStatus` — **not** copied from the original file's misleading `not_fulfilled:pending`. Derived fresh from what this pull actually observed: `no_calculation_data` (skeleton/partial event, or no event at all), `not_in_calc_detail` / `skipped:<reason>` (line missing from calc-detail, with the API's own skip reason when it gave one), `exempt`, `no_rules_for_jurisdiction`, or `calculated`.
- `date` — `order.timestamp`, an ISO datetime, not reformatted to match the original file's `MM/DD/YYYY` — documented here rather than silently changed.
- `totalPrice` — **computed** (`quantity × unitDiscountedPrice`, falling back to `unitSalesPrice`), since `TransactionLineSummary` has no line-total field of its own.
- `closedVolumeMl`, `openVolumeMl`, `totalSalesOfOpenSystems`, `totalSalesOfClosedSystems`, `totalSalesOfSingleUseSystems`, `wholesalePriceOfOpenSystems`, `wholesalePriceOfClosedSystems`, `wholesaleValueOfSingleUseSystems` — **computed** as this tool's own per-order rollup (summed by the `isOpen`/`isClosed`/`closedSingleUse` tag flags), not independently confirmed to match whatever formula originally produced these eight columns in the S3 export. Treat as a documented approximation.
- `isVape`, `isExempt`, `hasNicotine`, `isOpen`, `isClosed`, `closedRefillable`, `closedCartridge`, `closedSingleUse`, `batteryOnly` — `1`/`0` derived from the product's `tags` array.
- `customer.fullName`, the street portion of `shippingAddress`, and `county` — **left blank, on purpose**. The API's `shippingLocation` schema explicitly excludes `givenName`/`familyName`/`line1`/`line2` as PII, and has no `county` field at all. Not recoverable from this API by design.
- `DO NOT USE`, `numErrors`, `error1`, `error2`, `error3` — left blank; nothing in this API corresponds to them, and they were blank in the real sample file too.

**Usage (path 1, scan-queue-based):** since the "last N hours" toggle above is fixed at a short window, the practical way to cover a full month with this path is the open-ended ID-range mode already built for the scan: add a queue row, pick the domain, set **ID start** to a known order ID from early in the target period (e.g. the CSV export's own first row) and leave **ID end** blank so it auto-walks forward. Run the scan, then click **Export Taxlines CSV (beta)**.

### Export Taxlines CSV by date range (beta, added 2026-08-27) — no more guessing a starting order ID

Path 1 above has a real gap: it can only cover whatever ID range the scan queue happens to walk, so covering "August" meant finding a real order ID from early August by hand and hoping the auto-walk didn't stop short. The Excise Tax Order API's own `GET /exciseTax/orders` list endpoint already supports `since`/`until` filtering directly — this adds a second, independent panel ("Export Taxlines CSV for a date range") that uses it instead.

**What it does:** `hqStageTaxlinesExport(domain, sinceIso, untilIso)` is a new self-contained injected function (parallel to `hqStageScan`, not sharing code with it — `chrome.scripting.executeScript` functions can't close over anything else in `popup.js`'s outer scope, so the token-mint boilerplate and the per-line join logic are duplicated by hand rather than shared) that: mints a token the same way the scan does, then calls `GET /exciseTax/orders?since=...&until=...&limit=1000` to collect order IDs for the window. Since that endpoint has no offset/cursor param, a window that comes back with exactly 1,000 results (the API's own cap, so truncation is ambiguous) is recursively split in half and each half is queried again, deduping by `orderId` — this handles vapesocietysupplies.com's ~1,700 orders/month without assuming any particular sort order from the API. Each resulting order ID is then fetched (order + calc-detail, same per-line join logic as path 1's `taxlineRows` block, kept in sync by hand) and rolled up the same way. The orchestration wrapper, `exportTaxlinesForDateRange`, drives the org-switch and API-docs navigation exactly like `scanOneOrg` does for the regular scan.

**Usage:** pick a **Domain** from the dropdown (same known-domains list as elsewhere), a **Since** date, and optionally an **Until** date (blank = now), then click **Fetch & Export CSV**. This runs independently of the scan queue/results above — it replaces whatever taxline rows were last gathered, by either path, and immediately downloads the Full/Filtered CSV pair once the fetch finishes.

**Filename fix (also 2026-08-27):** both paths now stamp the two downloaded filenames with the actual min/max order date found in the fetched rows (`taxlines-full-2026-08-01_to_2026-08-27.csv`) instead of today's export date. The original version used today's date, which made it impossible to tell a downloaded file's actual coverage without opening it — especially confusing for path 1, where the true coverage depends on wherever the ID auto-walk happened to stop.

**Loading indicator, 2026-08-27 (later same day):** neither path had any visible "still working" signal beyond the status-line text sitting on one message — easy to mistake for stuck, especially on the date-range path, which makes exactly one round trip into the injected page and only gets a result back once the entire date-bisection fetch + every order's calc-detail pull has finished (no per-order tick surfaces here the way the scan queue gets between orgs). Added the same `<span class="spinner">⟳</span>` treatment already used elsewhere in the extension (live price check, product backfill, order investigation) to both the Start/Resume scan button (relabels to "Running…" and disables for the whole run, not just between status messages) and the Fetch & Export CSV button, plus spun the in-progress status-line messages on both paths (switching orgs, retrying, fetching, building the CSV).

**Fixed 2026-08-27 (later still): the date-range spinner text was landing in the wrong panel.** The date-range path reused `setHqStatus`, whose `#hqStatus` element lives up in the Run panel above — so "Fetching..." appeared next to the Start/Resume scan button while the user was watching the domain/date inputs and Fetch & Export CSV button lower down, reading as if nothing had happened down there. Gave the date-range panel its own status line (`#hqTaxlinesStatus`, via a new `setHqTaxlinesStatus`) and pointed all of that path's messages — validation errors, the fetching/building spinner text, and the final "Exported N full / M filtered" line — at it instead. `hqExportTaxlinesCsvs()` now takes an optional status-setter argument so its completion message can land in either panel depending on which button triggered it.

**Live percentage + ETA, 2026-08-27 (later still):** the spinner said "still working" but not "how much longer." The blocker was architectural — `hqStageTaxlinesExport` runs as a single `chrome.scripting.executeScript` call into the HQ tab that only returns once the entire date-bisection listing *and* every order's fetch is done, so the popup had no way to see partway through. Fixed by having that injected function ping progress back live via `chrome.runtime.sendMessage` (content-script-style injected functions have access to a subset of `chrome.*` APIs, `runtime.sendMessage` included, even though they can't share JS scope with `popup.js`) — one message once order listing finishes (`{phase:'listed', total}`), then one after each order is fetched (`{phase:'fetching', done, total}`), fire-and-forget so a missing/slow listener never adds latency to the fetch loop itself. `popup.js` registers a `chrome.runtime.onMessage` listener once at load that turns these into: a live percentage, an ETA (`elapsed / done × (total − done)`, so it firms up as more orders complete rather than being a single upfront guess), and a thin progress bar (`#hqTaxlinesProgressTrack`/`#hqTaxlinesProgressFill`) under the status line. The regular ID-range scan queue doesn't get the same treatment yet — the open-ended "walk forward until N misses" mode doesn't know its own total order count in advance, so a percentage isn't always meaningful there the way it is for a fixed date range.

**Known limitations:** taxline rows are kept in memory only for the run just completed (not saved to `chrome.storage.local` — see the code comment at `HQ_TAXLINE_ROWS` for why: this extension only has the plain `storage` permission, and a scan this size would risk the quota if folded into the same value that's re-saved after every queue item). Closing the popup before exporting loses them, same as any other in-progress run state. The date-range path fetches sequentially, one order at a time — not parallelized, since this internal API's tolerance for concurrent calls from one token hasn't been tested. It hasn't yet been cross-checked end-to-end against a real finished Excise Report to confirm the Filtered definition and the eight computed rollup columns line up with what TaxOps actually needs — worth doing before this replaces the manual process rather than supplementing it.

**Removed 2026-08-27 (later still): path 1's export button.** Decided the date-range fetch is the only export path actually needed going forward, so the Run panel's own "Export Taxlines CSV (beta)" button (path 1, scan-queue-based — the "Usage (path 1...)" paragraph above is now historical) was removed; `hqExportTaxlinesCsvs()` is reachable only from the date-range panel now and always reports through `setHqTaxlinesStatus`. Not removed: `scanOneOrder`'s `taxlineRows` computation itself, or its accumulation into `HQ_TAXLINE_ROWS` during a regular ID-range/mismatch scan — that's harmless dead weight (the data just sits unused in memory unless a date-range fetch later overwrites it) and stripping it out wasn't asked for; worth a follow-up cleanup pass if this sticks around.

### New check: Tax Ops Hq effective-rules cross-check (2026-09-01) — see the same-day follow-up below, the endpoint this was originally built on turned out to be dead

Marc asked this extension's own maintainer to look through Token of Trust's GitHub org for something useful to bring back into this tool. Found via `tokenoftrust/tot-taxes` (private): the TaxOps Portal referenced throughout this changelog — "State Tax Rules" page, the compliance sheet this tool's compliance-sheet check reads, the RETAIL_PRICE_BASED/WHOLESALE_COST_BASED/FLAT_RATE_PER_ML tables above — isn't just a spreadsheet-backed page. It's a real app ("Tax Ops Hq" in-product, `tot-taxes` in the repo), deployed at `taxes.tokenoftrust.com` (prod) / `taxes.test.tokenoftrust.com` (test), with its own REST API behind a session cookie (`tot_auth`, set by signing in with a `@tokenoftrust.com`/`@team.tokenoftrust.com` email — same passwordless-code flow HQ itself uses).

**The endpoint that matters:** `GET /api/effective-rules?clientId=<domain>` (`src/server/effective-rules-routes.ts` in that repo). It merges the same global S3 rule set (`excise-taxes/config/vapeTaxRules.json` / `nicotinePouchTaxRules.json` — the literal source of the State Tax Rules page and this tool's tables) with that specific org's own rule overrides (`src/services/effective-rules-engine.ts`), and returns per state: `{rate, basis}` plus a `source` of `'global' | 'override' | 'excluded'`.

**Why this matters more than it might sound like:** the per-org override merge is exactly this project's own single most-flagged open architectural question — first surfaced 2026-08-24 (see "Follow-up #2" above) when kangerwholesaleusa.com's WA rule turned out to be silently overridden from the 95%-of-selling-price default this tool has hardcoded to 95%-of-wholesale-cost, discoverable at the time only by manually opening HQ's "Active/Inactive Tax Rules" page for that one org. This endpoint answers that exact question programmatically, for any org, without a manual per-org page visit — plus it gives a live, sourced RATE NUMBER per state, directly resolving the kind of transcription ambiguity that produced the MN "95%, missing a %?" note and the spurious 27.3%-from-145-samples OH rate earlier in this changelog.

**What was added:** a new pass inside `hqStageScan`/`scanOneOrder`, gated on a `taxOpsRules` argument fetched once per org (`fetchTaxOpsEffectiveRules(domain)`, cached) in the side panel's own context — same cross-origin `fetch(url, {credentials:'include'})` pattern already used for the Google Sheets compliance CSV, and deliberately kept OUT of the injected `hqStageScan` function itself, since that function's own fetches are intentionally same-origin relative URLs against `app.tokenoftrust.com` (see "Why `chrome.scripting` instead of a direct `fetch()`" above) — a cross-origin call to a different domain (`taxes.tokenoftrust.com`) from inside that injected context wasn't worth the CORS uncertainty when fetching in the side panel and passing the result in as a plain argument works and is already a proven pattern. `GET /auth/whoami` is checked first so "not signed into Tax Ops Hq" shows as a clear per-org badge (`taxOpsStatus`) instead of a confusing silent no-op.

For every calc-detail rule actually applied to a scanned order, this flags:
- **A per-org override is active** (`source: 'override'`) — regardless of rate, since this tool has zero other visibility into overrides.
- **The live rate disagrees** with whatever `AUTHORITATIVE_RATES`/`WHOLESALE_COST_BASED`/`FLAT_RATE_PER_ML` already assumes for that state+type.
- **The state isn't on any of this tool's tables at all**, but Tax Ops Hq has a real nonzero rate for it — a coverage gap, not just a wrong number.

**Deliberately does NOT do:** recompute "the correct tax" from the live `rate`+`basis` and flag a dollar mismatch the way the existing wholesale-cost/flat-rate checks do. Dug into `tot-taxes`' own `src/server/services/test-calc.ts` (used by its "rule workbench" draft-vs-live testing panel) to check, and its `basis` handling only distinguishes two values — `'ad_valorem'` (rate × qty × unitPrice) and `'per_unit'` (rate × qty) — with no separate per-mL/wholesale-cost basis at all, and that file's own header comment says it's "designed to be swapped for an external calculator API call." That's a strong signal it's a simplified stand-in for the workbench's own what-if tool, not necessarily the real production engine's basis vocabulary or its retailPrice-vs-wholesaleCost-vs-volume field selection — trying to recompute a dollar figure from it risked a confidently-wrong flag, the opposite of this project's usual verify-before-trust posture. So this check only surfaces the disagreement for a human to check via HQ's "How was this tax calculated" tool, same as every other unconfirmed lead in this changelog.

**Known limitations, not yet resolved:**
- **Not run against a real signed-in session yet.** Everything above was confirmed by reading `tot-taxes`' source directly (routes, the merge engine, the S3 rule schema via `rule-shape-validator.ts`, the auth cookie flow) — the endpoint's actual response shape on a real order/org hasn't been observed live. Whether `clientId` in this API means the same string as the "domain" this tool already uses for its Known HQ domains (it should — `effective-rules-routes.ts` passes it straight through to the TOT platform API's `/api/clients/{appId}` the same way HQ itself would resolve an app) is inferred, not confirmed.
- **`taxes.test.tokenoftrust.com` exists as a separate environment** (confirmed via `infrastructure/resources.env.json`) but only the production host is in `host_permissions` — add it if this tool ever needs to check against test data.
- If nobody's ever signed into Tax Ops Hq in this browser profile, every org shows the "not signed in" badge and the cross-check silently contributes nothing — this is intentional (fails open, never blocks or slows down the rest of the scan) but means a clean run doesn't mean "checked and found nothing," it might mean "never actually checked."

### Fixed 2026-09-01 (later same day): `/api/effective-rules` is dead — rebuilt on two working endpoints, now verified live

Marc asked again whether there was something useful to pull in from the repos. Before touching code, tested the check above's one load-bearing assumption against a real signed-in Tax Ops Hq session for the first time — and it didn't hold up: `GET /api/effective-rules?clientId=vaperanger.com` returns `200 {"productTypes":[]}` unconditionally. Not a session/auth problem (no 401, no redirect — `/api/clients/vaperanger.com` on the exact same session returns a large, fully-populated payload) and not specific to one org. The route exists and responds; it just never returns real rule data for anyone. Whatever wired it to the S3 rule set in `tot-taxes` either never shipped or broke afterward — out of scope to chase down further from this side, but worth flagging to whoever owns that repo.

Rather than ship a check that silently does nothing forever, rebuilt `fetchTaxOpsEffectiveRules` on two endpoints that ARE confirmed live and populated on the same session:

- **`GET /api/clients/<domain>`** — already used elsewhere for storefront config; turns out its `client.options.exciseTax.ruleOverrides.<'vape'|'nicotinePouch'>.US.regionCode.<ST>` holds exactly this org's own per-state override rules (real nested objects, confirmed via a live `Object.keys()` walk — not a flat dotted key). This is the source of per-org OVERRIDE detection, replacing what `/api/effective-rules` was supposed to provide. **Also resolved two open questions from the entry above, live:** kangerwholesaleusa.com's WA nicotine rule uses `attr: "product.wholesaleCost"` while vaperanger.com's uses `attr: "unitDiscountedPrice"` for the same nominal 95% rate — confirming the per-org override blind spot flagged 2026-08-24 is real and org-specific, not a one-off. And vaperanger.com's PA override is `{attr: "unitDiscountedPrice", pct: 40, description: "40% wholesale price..."}` — the human `description` says "wholesale price," but the field actually driving the calculation is the discounted selling price. So the PA sheet-vs-observed-behavior contradiction noted under `WHOLESALE_COST_BASED` below isn't a transcription bug in this tool — it's TOT's own config describing itself inaccurately. **Caution while reading this endpoint:** the same response also carries this org's Stripe/webhook/HubSpot secrets — the code reads only `options.exciseTax.ruleOverrides` and must never touch, log, or persist the rest.
- **`GET /api/tax-calendar/rules`** — global, not client-scoped; the literal data behind TaxOps Portal's "State Tax Rules" page. Keyed by 51 full state names (confirmed, "District of Columbia" included) with a `"Vapor Products"`/`"Nicotine Pouches"` array per state — no separate numeric rate field at all, just a free-text `description` ("40% of the purchase price from the wholesaler", "$1.50 per unit", "No tax", or CA's stacked "51.08% of wholesale cost\n\n12.5% of retail selling price on products with nicotine"). Also confirmed a handful of 2-letter-code keys living in the *same* object (AK, CO, IL, MD, AL, AZ) that are actually county/city overlay entries (each carries its own `jurisdiction` field — AK→Anchorage, CO→Boulder, IL→Chicago, MD→Montgomery County) layered over the real state entry, not the state rate itself — skipped, since this tool's key format can't represent a locality and silently taking a city rate as the state rate would be actively wrong.

Since neither replacement returns a clean `{rate, basis}` pair, added `taxOpsParseDescriptionRate` — a deliberately conservative text parser that only ever extracts a rate when exactly one unambiguous percentage or one `$X per <unit>` figure is present, and returns nothing (skips the state+type entirely) for anything stacked or ambiguous like CA's two components — same "don't guess" posture as everywhere else in this file. Global rates are fetched once and shared across every org in a scan (`/api/tax-calendar/rules` isn't client-scoped); per-org overrides still merge on top per domain, per-org winning on any key it covers, mirroring the dead endpoint's documented merge behavior.

**Verified live, end-to-end, same session (not just unit-tested against fixtures):** ran the real rewritten code against the real endpoints. `fetchTaxOpsEffectiveRules('vaperanger.com')` → PA: `{rate:0.4, basis:'ad_valorem', source:'override'}`; WA: `{rate:0.95, basis:'ad_valorem', source:'override'}`; CA: absent (stacked description correctly skipped); NY: `{rate:0.2, source:'global'}` (matches this tool's own `AUTHORITATIVE_RATES` entry exactly); MO: `{rate:0, basis:'none', source:'global'}` ("No tax" case). `fetchTaxOpsEffectiveRules('kangerwholesaleusa.com')` → WA: `{rate:0.95, source:'override'}`, same rate as vaperanger.com's WA as expected (both are nominally "95%" states) even though the underlying `attr` differs — this check still only surfaces rate/override/coverage-gap, not the `attr` field, so it correctly won't flag a rate disagreement here even though the two orgs' real tax bases differ; that distinction still requires a human to check via HQ's "How was this tax calculated" tool, same limitation as before.

**Still open, unchanged from the entry above:** this does not recompute a dollar amount from the live rate — same `test-calc.ts` "designed to be swapped for an external calculator" caveat applies, now more so, since the rate now sometimes comes from parsed free text rather than any structured field at all. `taxes.test.tokenoftrust.com` still isn't in `host_permissions`. Coverage is also necessarily narrower than `/api/effective-rules` would have provided: the global source only yields one rate per state (skipping compounds like CA entirely, where the old dead endpoint's documented shape suggests it might have returned a locality-aware or multi-component structure) — so a "no live rate" result now more often means "genuinely nothing to compare" than a coverage gap worth chasing.

### Fixed 2026-09-02: `notRequired` bucket was misclassifying orders that actually collected tax

Found via vapesocietysupplies.com order 2448826 (Westerville, OH): this scan's HQ Excise Tax tab tagged it `tot-excise-tax-not-required`, but this extension's own Order Investigation tool showed a `needs_review` verdict — "0 rules fired for the resolved jurisdiction," but $20.00 charged to the customer and $20.00 on a fresh live recalculation — and HQ's own "How was this tax calculated" tool independently confirmed the same: Collected $20.00, Recalculated (current) $20.00, exact match. So real tax genuinely was collected and correctly recalculated by two independent tools, while this scan called it "not required."

Root cause: `notRequired` was computed purely from `ruleKeys.length === 0` (calc-detail returned no rules for the order), with no check against `order.exciseTaxCollected` at all. This is the same "empty calc-detail response isn't evidence the correct tax is $0" gap already documented and fixed for the mismatch/overcharge computation on 2026-08-26 (see that entry above, also found on a vapesocietysupplies.com order) — that fix only guarded `mismatch`/`mismatchDirection`, it never touched this bucket, which had the identical blind spot the whole time.

Fix: `notRequired` now also requires `exciseTaxCollected` to be zero/absent — an order with empty `ruleKeys` AND a real nonzero collected amount lands in a new `unverifiedCollected` bucket instead, surfaced in the results panel with its own badge and a per-order table (Order ID / Region / Collected). Deliberately not folded into either `notRequired` (wrong — money was collected) or `collected` (overclaims — this scan has no rule data from calc-detail to verify the amount against, so it can't actually confirm these are clean). Same posture Order Investigation's own `needs_review` verdict already takes on this exact pattern: flag it, don't guess which way it resolves. Verified against a hand-built case matching #2448826's exact shape ($20 collected, empty `ruleKeys`) plus the three unaffected cases (genuine not-required, clean collected, real mismatch) — all four land in the correct bucket.

Also fixed in passing: the Tax Ops Hq cross-check badge's description text still said "Proposed 2026-09-01, needs live verification" and named the dead `/api/effective-rules` endpoint — stale copy left over from before the same-day rebuild documented above. Updated to describe the two live endpoints actually in use now.

**Still open:** `unverifiedCollected` doesn't attempt to guess whether the collected amount is correct — same as before, that still needs a human via HQ's "How was this tax calculated" tool or the Order Investigation tab. Also unconfirmed whether this pattern (real collection, empty calc-detail) clusters around specific states/orgs the way the 2026-08-26 case did (VA, this one OH) — worth watching for a pattern across future scans rather than treating each one as independent.

**Fixed 2026-09-02 (later same day): the fix above computed the right numbers but they never reached the screen.** Marc re-ran the scan on the exact same order (#2448826) after updating and saw `0` across all three of `notRequired`/`collected`/`incorrect` with 1 order checked — the fix had correctly pulled the order out of `notRequired` (down from 1 to 0), but the new `unverifiedCollected` count and list weren't showing anywhere, not even a badge. Root cause: `hqStageScan`'s injected function (which does the real per-order classification and returns `unverifiedCollectedCount`/`unverifiedCollected` correctly) is a separate execution context from `runHqScan`'s orchestration code in the side panel, which copies specific named fields out of that result into what actually gets pushed onto `HQ_RESULTS` — the object `renderHqResults()` reads from. That copy is a manual field-by-field list, and the two new fields were never added to it, so they got silently dropped between "computed correctly" and "saved for the UI to read." `notRequired` looked right because its *value* had already been fixed at the classification step, before this copy ever happens — but the new bucket's data lived entirely in fields that just weren't on the whitelist. Fixed by adding `unverifiedCollectedCount`/`unverifiedCollected` to that copy. Worth remembering for next time a field gets added to `hqStageScan`'s return value: it has to be threaded through this second spot too, or it'll compute correctly and go nowhere.

**2026-09-02 (later still): dropped the "(proposed)"/"(beta)" tags from the top-level tab bar** (HQ Excise Tax, Product Backfill, Order Investigation), at Marc's request, for visual uniformity with the Shopify/BigCommerce/WooCommerce tabs, which never carried one. The maturity/caveat labels inside each tab's own content (section headers, e.g. "HQ Excise Tax scan (proposed — needs team review before real use)", "Order Investigation (beta — wraps HQ's new Excise Order Investigation API)") are unchanged — the detail lives there, not in the nav.

### 2026-09-02 (later still): auto-verify the `unverifiedCollected` bucket via the Order Investigation API

Marc's question after the fix above: "is there something we can do to confirm and verify it so that it won't be unverifiable?" Every order in `unverifiedCollected` was previously left as a flat list requiring a manual trip to the Order Investigation tab, one order at a time, to actually resolve.

Fix: `runHqScan` now automatically calls the extension's own Order Investigation API wrapper (`invLoadCreds`/`invGetToken`/`invFetchInvestigation` — same code the Order Investigation tab itself uses, a separate `ops.tokenoftrust.com` API key/secret pair with `diagnostic:investigate` scope, not the HQ session cookie the rest of the scan runs on) for every order that lands in `unverifiedCollected`, right before the scan's results are pushed to the panel. New `investigateUnverifiedCollected(targetAppDomain, entries)` function does this per-order, degrading gracefully rather than failing the whole scan:

- No Order Investigation credentials saved on this tab → every entry gets `investigation: {ok:false, reason:'no-creds'}`, table shows "no Order Investigation credentials saved."
- A specific order's investigation call throws (network error, 403, 404, etc.) → that entry alone gets `investigation:{ok:false, reason:<error message>}`, table shows "check failed: …" — doesn't block the other orders in the same batch.
- Success → the investigation's verdict code (e.g. `healthy`, `needs_review`) renders as a color-coded badge (reusing `invVerdictStyle`, the same styling the Order Investigation tab's own dossier uses), plus the API's fresh `recalculatedNow` amount so it can be eyeballed against the collected amount in the same row.

The `unverifiedCollected` table (Order ID / Region / Collected) gained two columns: "Order Investigation verdict" and "Recalculated." A status-line spinner ("checking N unverifiable order(s) via Order Investigation...") shows while this runs, since it adds one API round-trip per flagged order on top of the scan itself.

**Deliberately not fully automatic:** this doesn't reclassify `unverifiedCollected` orders into `notRequired`/`collected`/`incorrect` even on a clean `healthy` verdict — it surfaces the Investigation API's independent read so a human can resolve it in one screen instead of two, matching the posture change documented in the 2026-09-02 entry above (flag, don't guess). Also inherits the Investigation API's own limitations: it needs its own credential pair saved (separate from the HQ session the rest of the scan runs on), and a `needs_review` verdict from Investigation just means Investigation itself couldn't fully resolve it either — the bucket isn't guaranteed empty of genuinely ambiguous cases, just no longer requiring a manual second lookup to find out.

Verified: `node /tmp/investigate_test.js` — 4 cases (no-creds short-circuit, successful investigation matching #2448826's real shape — `needs_review`, `recalculatedNow: 20.00` — a per-order failure, and an empty-entries short-circuit), all pass. `node --check popup.js` clean. Not yet exercised against a live scan with real credentials in this session — Marc should confirm the badge/table render as expected on the next real run against vapesocietysupplies.com.

### Fixed 2026-09-03: wide results tables clipped their rightmost column at the panel edge

Found via a screenshot of alternativepods.com's flat per-mL rate mismatch table: the `DIRECTION` column's badge was cut off mid-word ("UNDERCHAR…") right at the side panel's edge, with no visible way to see the rest.

Root cause: every wide results table (mismatch, overcharge, possibly-missed-tax, unverified-collected, wholesale-cost mismatch, flat-rate mismatch, Tax Ops cross-check — 7 tables total, all built on the shared `table.cfg` style) rendered a bare `<table class="cfg" style="width:100%">` with no scrollable wrapper. With 7-10 columns, that forced every column to squeeze into the side panel's fixed width, and the whole *page* became horizontally scrollable rather than just the table — so the fix required scrolling the entire panel (header, controls, everything) sideways to reach columns like `Direction`, and in practice that scroll affordance wasn't obvious, so the rightmost column just looked clipped and lost.

Fix: added a `.table-scroll` wrapper (`overflow-x:auto`, table sized to `width:max-content` with `min-width:100%`, cells `white-space:nowrap`) and wrapped all 7 wide results tables' `<table>` output in it, in each of `renderMismatchTable`/`renderOverchargeTable`/`renderPossiblyMissedTaxTable`/`renderUnverifiedCollectedTable`/`renderWholesaleCostMismatchTable`/`renderFlatRateMismatchTable`/`renderTaxOpsCrossCheckTable`. Each table now scrolls independently within its own box — the rest of the panel stays put, and the table sizes its columns to their actual content instead of getting squeezed. Deliberately left the shorter editable config tables (`renderCfgTable`/`renderHqQueueTable`/`renderHqDomainsTable`) untouched — they don't hit this problem and forcing `nowrap` on them could make some of their longer free-text fields worse, not better.

Verified: rendered the actual CSS + a flat-rate-mismatch table matching the reported case in a headless browser at a 420px width (a realistic side-panel width) — confirmed `table-scroll`'s `scrollWidth` (932px) now exceeds its `clientWidth` (294px), i.e. it's genuinely scrolling internally rather than being squeezed, and a screenshot after scrolling shows the full `DIRECTION` column with the complete "UNDERCHARGED" badge, unclipped.

### Fixed 2026-09-03 (later same day): CLEAN badge and a status badge sitting far apart in the results header

Found via screenshot: alternativepods.com's result header showed the `CLEAN` badge right next to the domain name, then a big gap, then the `1 ORDER(S) W/ FLAT-RATE MISMATCH` badge way out at the far right edge — same row, just spread across nearly the whole row width.

Root cause: `.diag-head` (the row holding the domain name + status badges) is `display:flex;justify-content:space-between`, and every badge — the main Clean/mismatch badge plus each conditional extra (`overchargeBadge`, `wholesaleCostBadge`, `flatRateBadge`, etc.) — was rendered as its own direct flex child, not grouped together. With `space-between`, flexbox distributes the row's free space evenly between *every* pair of adjacent children, so with 3 children (title, badge 1, badge 2) the two badges landed nowhere near each other — the free space got split into two roughly-equal gaps, one after the title and a much bigger one after the first badge, since the first badge is much narrower than the remaining row width.

Fix: wrapped all the badge spans in a single `.diag-badges` flex group (`display:flex;flex-wrap:wrap;gap:6px`), so `.diag-head` now only ever has two direct children — the title and the badge group — and `space-between` does what it was actually meant to do: push the title left and the whole badge cluster right, tightly spaced internally by `gap` instead of by leftover row space. Removed the now-redundant per-badge `margin-left:6px` inline styles in favor of the group's own `gap`.

Verified: rendered the actual CSS with two badges (Clean + flat-rate mismatch) in a headless browser at 960px width in `full-tab` mode (matching the width Marc's screenshot was taken in) — both badges now sit directly next to each other at the row's right edge, no gap between them and the rest of the row. Also checked at a much narrower (380px, side-panel-width) viewport: the badge group gracefully wraps onto its own line(s) under the title instead of overflowing or spreading — a reasonable fallback for narrow widths, not a regression from before (a single very long badge string could already run close to a narrow panel's edge regardless of this change).

### Fixed 2026-09-03 (later same day): `FLAT_RATE_PER_ML`'s WI::vape entry was wrong — Wisconsin doesn't tax vapes at all

Found via alternativepods.com order 304939 (Stevens Point, WI): the flat-rate mismatch check flagged all 28 vape line items on it "undercharged" against an assumed $0.05/mL rate, but HQ's own live "How was this tax calculated" page for this exact order states, in its per-state rule reference: **"Vape: Wisconsin is exempt from excise taxes on vapes."** ($0.00 collected and $0.00 recalculated both agree with that — it's correct, not missed.) The same page shows WI *does* charge for Hemp, which is the likely source of the original error: the `WI::vape` rate in this table was one of the entries "transcribed from the TaxOps sheet and unverified" (per the comment already on this table — only VA and OH had ever been confirmed against a real order) — it looks like the sheet's WI rate applies to Hemp, not Vape, and got attributed to the wrong category when this table was built.

Fix: removed `'US.regionCode.WI::vape': 0.05` from `FLAT_RATE_PER_ML` entirely. No replacement rate needed — WI is exempt for this category, so there's nothing to check a mismatch against. Left the comment on the table noting that a real WI vape rate, if one's ever needed, needs the same live-order confirmation bar VA/OH already cleared, not another sheet transcription.

This wasn't a per-order or per-org bug — the table is shared across every scanned org, so this same false positive would have fired on any WI vape order from any org, not just alternativepods.com.

Verified: `node /tmp/wi_exempt_test.js` — 3 cases (order 304939's real shape now produces zero flat-rate mismatches; VA::vape, an actually-confirmed entry, still fires correctly on a genuine mismatch to confirm the removal didn't touch anything else; a hypothetical WI::hemp key, never on this table either way, stays unflagged). All pass. `node --check popup.js` clean.

**Separate, still-open thread — not resolved by this fix:** order 304939 is also tagged "Unsupported order — placed via a mechanism that skips tax calculation" by HQ, the same banner from the original alternativepods.com Trello report weeks ago. That's a different question (why does HQ consider this order's calculation mechanism unsupported at all) from today's fix (the assumed WI rate itself was wrong). Today's fix means this order — and any other WI vape order — won't be falsely flagged by this tool's flat-rate check anymore, regardless of its "unsupported" status. Whether "unsupported order" is itself a real problem worth chasing for alternativepods.com remains open from before and hasn't been investigated further.

**Corrected 2026-09-03 (same day): the fix above overreached — the WI exemption is scoped to alternativepods.com, not to Wisconsin generally.** Marc caught this directly: "the Wisconsin rule here only applies to alternativepods client." HQ's "How was this tax calculated" page is per-order, and its rule reference reflects that *client's* effective rules (including any org-level overrides), not a global state-law lookup — the same "per-org override wins over global" shape already documented for the Tax Ops Hq cross-check's `ruleOverrides`. Removing `WI::vape` from `FLAT_RATE_PER_ML` entirely, as the fix above did, would have silently suppressed a genuine undercharge on any *other* org's real WI vape order — trading one false positive (alternativepods.com flagged when it shouldn't be) for a worse false negative (every other org's real WI vape misses going undetected).

Fix: reverted the removal — `WI::vape` is back in `FLAT_RATE_PER_ML` at $0.05/mL as the global default. Added a new `PER_ORG_RATE_EXCEPTIONS` map instead, checked before the table on every flat-rate check: `{ 'alternativepods.com': Set(['US.regionCode.WI::vape']) }`. Only alternativepods.com's WI vape lines are now skipped; every other org's WI vape orders are checked against the normal $0.05/mL rate exactly as before. The map is deliberately positioned and commented as a narrow, evidence-gated exception list — a domain only belongs on it with the same kind of direct, live, per-client confirmation this entry has, never inferred from a sheet or from one order's pattern without checking that specific client's own HQ rule reference.

Verified: `node /tmp/wi_exception_test.js` — 3 cases: alternativepods.com's WI::vape lines (order 304939's real shape) now correctly produce zero mismatches; the exact same line pattern under a *different* domain (vapesocietysupplies.com) still gets flagged as undercharged, confirming the override doesn't leak across orgs — this is the specific case the first version of the fix got wrong; and alternativepods.com's own VA::vape rule (a different, genuinely-confirmed key) still fires normally, confirming the exception is scoped to the exact ruleKey and not the whole org. All pass. `node --check popup.js` clean.

### Added 2026-09-03: inline Sentry event search in the Order Investigation tab

Came out of a separate TaxOps thread: Engineering handed off a set of internal excise-diagnostic CLI scripts (Trello 9369, 8/31 snapshot) for a TaxOps epic to evaluate for portability. Marc asked whether anything in that handoff was worth folding into this extension. Direct source inspection of all 10 scripts found eight are hard-coupled to the ToT monolith (`SystemServices`/`commonUtils`/Cassandra, no HTTP fallback) — not portable into a browser extension at all. One, `sentry-order-lookup.js`, is a genuine exception: its Sentry-querying functions (`fetchSentryIssue`, `searchSentryEvents`) call `https://sentry.io/api/0/organizations/{org}/...` directly over plain HTTPS with a Bearer token — confirmed no monolith dependency, since the script's own `--sentry-only` flag exits before ever requiring `SystemServices` (that require only happens later, in the separate order-fetch/recalculate step).

This extension already had a half-version of this: the Investigation dossier's "Sentry links" section generates clickable search-UI links using `excise.appDomain`/`excise.appTransactionId` tags, but never actually queried Sentry — you had to click out and read the results yourself.

Added: a new Sentry auth token (stored the same way as the Investigation API key — local extension storage only, one token per person if shared) plus `sentrySearchEvents()`, ported from the script's `searchSentryEvents()` with the same query shape, field list, sort, and 25-result cap. Wired in two places — a standalone "Sentry event search" panel (app domain + optional order ID, works without running a full investigation, mirroring the script's own `--sentry-only` mode) and a "Search Sentry now" button added directly to the dossier's existing "Sentry links" block, which reuses that investigation's own domain/order ID and renders results (timestamp, error type, SKU, order, source, message) inline in a scrollable table instead of just linking out.

Deliberately not ported: `fetchSentryIssue`-by-ID (nothing in this extension currently takes a raw Sentry issue ID as input — no use for it yet) and the script's order-fetch/recalculate half (this extension already has that, via the existing Investigation API).

**Known limitation, not new to this addition:** event messages and tag values render through `sentryEsc`/`invEsc` (`escapeAttr`), which only escapes double quotes, not `<`/`>` — the same escaping the rest of this extension's API-sourced HTML already uses throughout the Investigation dossier. A Sentry event whose message or tag contained raw HTML could in principle render as markup rather than text. This mirrors the codebase's existing pattern rather than introducing a new gap, but is worth a real fix (escaping `<`/`>` too) if it ever becomes a practical concern — flagging here rather than silently leaving it undocumented.

Verified: `node --check popup.js` clean. `node` logic test against a mocked `fetch` — 5 cases (query string matches the source script's shape exactly for domain+order+project, domain-only with project omitted, missing-credentials short-circuit, missing-appDomain short-circuit, and a 401 correctly surfacing Sentry's own error detail), all pass. Separate render test confirms the results table renders and correctly escapes a SKU containing `<`/`>`. Not yet exercised against a live Sentry org/token in this session — needs a real Sentry auth token to verify end-to-end.

### 2026-09-03 (later): confirmed live against a real Sentry token, then two follow-up fixes from Marc's first real test run

Marc created his own personal Sentry auth token (`token-of-trust` org, `event:read` + `org:read` scopes only — confirmed via the Permissions Preview showing exactly `event:read, org:read`) and ran the extension end-to-end against a real order (huffandpuffers.com #48936, flagged `collected_but_engine_says_zero` by the Order Investigation tab). The Sentry search itself worked as built — 0 events found is a legitimate, correctly-reported result (no Sentry errors were logged for this order), not a failure of the search. Two things came out of watching that real run:

**Removed: the "Fixed 2026-09-02..." changelog narrative that was rendering inside the live `unverifiedCollected` results.** That paragraph (explaining the 2026-09-02 auto-verify fix, written for this README) had been left inline in `renderHqResults()`'s actual results output, so it re-rendered in full on every single scan from then on — clutter with no ongoing value once the fix itself is old news. Trimmed the live UI copy down to just what's operationally useful ("cross-checked against the Order Investigation API... check manually if it didn't run"); the full fix history stays here in the changelog, which is where changelog content belongs.

**Added: the Sentry search's App domain field is now a dropdown**, sharing the exact same `HQ_DOMAINS` list/storage as the Investigate tab's Target app domain select and the HQ Excise Tax Scan tab's Known domains table (`domainOptionsHtml`/`loadHqDomains`, see the comment on `invRenderTargetDomainSelect` above) — previously free-typed text, inconsistent with the rest of the extension's domain-entry pattern. Same "Other… (type manually)" fallback for a domain not yet in the list. huffandpuffers.com wasn't in `HQ_DOMAINS` yet when Marc tested — add it via the HQ Excise Tax Scan tab's Known domains table (or just use "Other…" in the Sentry panel) if it's a domain worth tracking going forward.

Verified: `node --check popup.js` clean. Playwright DOM test — loaded the real `popup.js` in a headless browser against a stubbed `chrome.storage.local`, confirmed the new `sentryAppDomainSelect` renders the identical 15-domain list (same values, same order) as `invTargetDomainSelect`, confirmed picking a real domain sets the hidden text input and hides it, confirmed picking "Other…" clears it and reveals it for manual entry, and confirmed the removed narrative string no longer appears anywhere in rendered output.

### Fixed 2026-09-03 (later): 5 copy-to-clipboard buttons gave no visible confirmation on click

Marc flagged this on the Order Investigation dossier's handoff "Copy" button specifically — clicking it did something (the clipboard write itself worked), but nothing on screen told you it had. Checking the rest of the extension found the identical gap in four other places: the main order panel's `copyNoteBtn`, BigCommerce's `bcCopyNoteBtn`, WooCommerce's `wcCopyNoteBtn`, and this one, `invCopyHandoffBtn`. All four of those did call a status-line function (`setStatus`/`setBcStatus`/`setWcStatus`/`invSetStatus`) on success — but that status line sits far from the button (near the top of the panel, not next to the button itself), easy to miss if you're not looking there, and `invCopyHandoffBtn` specifically didn't even have that: no `try/catch` at all, so a clipboard failure (permissions, focus loss — `navigator.clipboard.writeText` can silently reject) would throw into the void with zero feedback either way.

Turned out a working pattern already existed in the codebase, just applied in exactly one place: `copyJsonBtn` (the raw order-JSON copy button) already called a `flashCopied(btn)` helper — swaps the button's own text to "Copied ✓", disables it briefly, reverts after 1.4s, all right at the point of the click, impossible to miss. Applied that same helper to all four other copy buttons, and added the missing `try/catch` to `invCopyHandoffBtn` (matching the error-message pattern the other three already had) so a real failure now says "Could not copy automatically — select the text... and copy manually" instead of doing nothing.

Verified: `node --check popup.js` clean. Playwright DOM test — rendered the actual dossier HTML via `invRenderDossier`, wired the real click handler, clicked it, and confirmed all three things happen: the clipboard actually receives the text (`navigator.clipboard.readText()` matches), the button's own text flips to "Copied ✓" and disables immediately (not just eventually), and it reverts back to "Copy" after the timeout.

## Product Backfill (beta — built for zuluvape.com, may generalize)

Built for a specific situation: zuluvape.com has gone 3+ weeks without completing their product metadata in TOT, and isn't being responsive about it. Rather than wait indefinitely, this cross-references HQ's excise-tax "missing data" list against the store's real BigCommerce catalog, fills in whatever's genuinely derivable, and exports a CSV in HQ's exact "Load Excise Tax Products" upload format for manual review and manual upload — **it never uploads anything itself**; that step is done by hand via HQ's own UI at `/hq/supportOnly/exciseTaxProducts`, same as always.

Nothing here is ever guessed from a product title, tag, or description. A field either comes from real TOT data (the missing-data JSON) or real BigCommerce data (the store's own catalog), or it's left blank with a plain-language explanation appended to a trailing `NOTES` column — confirmed safe against HQ's own CSV importer, whose FAQ states trailing extra columns past the spec are ignored during parsing.

### Why this needs a pasted URL each run

The missing-data endpoint (`/hq/endpoint/excise/products?accessToken=...&quickView=missingData`) uses the same auth pattern as the HQ Excise Tax scan's `getOrder` endpoint above: an encrypted, `referrerOrigin`-scoped, expiring `accessToken` blob minted by HQ's own frontend — not readable from `localStorage`/`sessionStorage`, and not mintable by this extension. This was directly tested against the alternative — using the Product Sync API's Bearer token (from `/hq/api-docs/product#/operations/createAccessToken`) instead — and confirmed **not interchangeable**: HQ's route middleware rejects it outright with `403 "Need a valid apiClient to access this endpoint."`. These are genuinely two separate auth systems on TOT's backend. So, same workaround as the HQ scan tab: grab a fresh URL from DevTools each run.

**To get the URL:** sign into HQ, open `/hq/excise-tax/products`, select the "Missing Data" quick-view filter, open DevTools → Network → filter to Fetch/XHR, and copy the full request URL for the `products?accessToken=...&quickView=missingData` call. Paste that into the box below — not the browser's address bar URL, which is a different page entirely.

### What it does with the data

This was originally scoped to just steps 1–2 of a 5-step recipe a colleague (Darrin) described from a similar past project: list missing products, extract available platform data, derive variant fields from parent/related products, classify unclassified items, and — for whatever's still missing — attempt derivation from related products with human sign-off. Steps 4 and 5 were added after live-testing against zuluvape's real data showed what was actually feasible for this org (2026-08-25) — see below.

1. Fetches TOT's **full** excise-tax product catalog for the org, not just the missing-data slice — confirmed live that the same `accessToken` works with `quickView` dropped entirely, returning every record including the ~3,000+ already-complete ones. That's what makes steps 4–5 below possible: there's nothing to derive a missing field from if the tool only ever sees the broken records.
2. Items typed `vape` are checked against their own product name for signs of being filed under the wrong type — e.g. "Zimo 6mg Nicotine Pouches" (a confirmed real case: 16+ SKUs are stored as `Vape` in TOT despite being nicotine pouches by name). Anything matching goes into a separate **re-type review list** instead of being "completed" as a vape row.
3. The rest get cross-referenced against BigCommerce's internal catalog API, one SKU at a time, pulling the SKU's own variant record — not just its parent product's, since parent-level cost/option fields are frequently blank even when the specific variant has real data.
4. Each of the 16 spec columns is filled from TOT's own data first, BigCommerce data second (only where a field maps cleanly — e.g. a size/volume-named variant option for `VOLUME_ML`), then a same-product-family **sibling** third for a couple of structural fields (below), and left blank with a `NOTES` explanation when none of those have it.
5. Completely unclassified records (`type: undefined` — no name, no SKU, no type in TOT at all) are skipped, not processed. **This was tried and rolled back (2026-08-25)** — see "Orphan check: tried and removed" below for why.

**Sibling derivation.** For `VAPE_SYSTEM_TYPE` and `PRODUCT_BRAND`, when a SKU's own record and BigCommerce both come up empty, the tool checks other SKUs in the same product family (same name with a trailing "Pick N" / "Box of N" stripped off — confirmed live that e.g. every "Lost Mary MT35000" pack-size variant shares the same system type) for an already-confirmed value. It's only used when every sibling found agrees; a split vote leaves the field blank instead of guessing which one's right. Either way, a derived value is written into the CSV cell **and** flagged in `NOTES` (e.g. "derived from 59 sibling SKUs... verify before uploading") — it's filled in for convenience, never treated as equivalent to the SKU's own confirmed data. `VAPE_SYSTEM_TYPE` needed this on most remaining rows: it's a required CSV field, but TOT has no "vape system category map" configured for zuluvape.com at all (an org-level config gap, confirmed live, not a per-product one), so it's never present directly on the record itself.

`HAS_NICOTINE` deliberately does **not** use sibling derivation — nicotine strength can genuinely differ within the same product family (e.g. a 2% vs. 5% variant), so a sibling's value isn't a safe stand-in the way system type or brand is.

### Orphan check: tried and removed

An earlier version of this tool gave completely unclassified records (no name, no SKU, no type — 985 of them on zuluvape's org) their own pass: look up each `productId` live against BigCommerce, recover the real name/SKU into a downloadable "orphaned records" report if it resolves, or flag it as a likely stale reference for TOT/ExciseOps cleanup if it doesn't. A 50-record spot-check suggested this would mostly come back empty, but it was shipped anyway to see what a full run found.

**A real run against zuluvape's actual full 984-record unclassified bucket recovered zero.** Every single one came back "not found on BigCommerce." That confirms it wasn't a sampling fluke — it's the actual shape of this data — and since the check is a live BigCommerce lookup per record (easily the slowest part of a full run), it was pure runtime cost for zero return. Removed back out to a flat skip. The code comment where it was removed notes this so nobody re-adds it blind; if a different org's unclassified bucket ever looks meaningfully different (e.g. it actually has BigCommerce IDs that still resolve), it'd be worth re-enabling there specifically rather than by default.

### Usage

1. Open the **Product Backfill** tab.
2. Paste the missing-data URL (see above) and the store's BigCommerce subdomain (the part before `.mybigcommerce.com`).
3. Click **Fetch & cross-reference**. Runs sequentially with a small delay between products, same as the BigCommerce product & price check.
4. Review the **Results** panel — re-type flags and any row with a note are listed there; the full sets are in the downloadable CSVs regardless of what's shown inline.
5. Download the vape CSV and/or the re-type review list. Upload the vape CSV via HQ yourself after checking the `NOTES` column; use the review list to manually re-type the flagged items in HQ first.

### Known limitations

- Built and tested against zuluvape.com's BigCommerce catalog specifically — the catalog JSON shape and the vape CSV format should generalize to other orgs/platforms, but the BigCommerce cross-reference step is BigCommerce-only for now (no Shopify/WooCommerce equivalent yet — deliberately held off on building this speculatively until a Shopify or WooCommerce merchant actually needs it).
- Only the **vape** CSV format is implemented. Hemp and Nicotine Pouch formats aren't wired in yet — the re-type review list only tells you an item probably isn't a vape product, it doesn't generate a ready-to-upload row for its actual type.
- `IS_EXEMPT` and `PACK_CONFIG` are always left blank with no note — these are optional fields with no reliable derivation path found (the `isExempt`-related HQ error message on the missing-data items looks like an artifact of the same category-map gap as `VAPE_SYSTEM_TYPE`, not a genuine separate signal worth chasing).
- Depends on the accuracy of a plain name-pattern match (`pouch`, `cbd`, `delta-8/9`, `thc`, `hemp`, plus apparel/merch words like `shirt`, `hat`, `sticker`, `gift card`) for catching mistyped items — this is a recall aid for a human reviewer, not a certainty; it can both miss real mistypes with unusual naming and occasionally flag something that's genuinely a vape product with one of those words in its name. The apparel/merch check exists because a live check (2026-08-25) found TOT's own `type` field isn't fully reliable even on named, complete records — a literal "Off-Stamp Tee Shirt XXXL" was filed as `type: vape` — though none of the actual missing-data items being processed at the time matched it.
- Sibling derivation depends on the "Pick N" / "Box of N" naming convention actually being used consistently — a product family named differently won't group correctly and will just fall through to a blank + note, same as before this feature existed. It's a bonus recovery path, not a replacement for the existing fallbacks.
- Completely unclassified records are skipped outright (see "Orphan check: tried and removed" above) — there's currently no path in this tool that does anything with them at all.

## Order Investigation (beta — new, 2026-08-26)

Wraps HQ's new, internal-only **Excise Order Investigation API** (`GET /api/exciseTax/orders/{appTransactionId}/investigation`, from the `[ExciseDiagnostics] Add Agent-Assisted Excise Order Investigation to TaxOps` epic) for one-order deep dives. Discovered via a Trello card marked done and confirmed live by reading the API docs at `app.tokenoftrust.com/hq/api-docs/excise-tax-investigation`.

### What it does

A single read-only call returns the full evidence set HQ holds for one order: five tax values each with their own `present`/`absent`/`degraded` state (never coerced to zero — an absent value and a genuine $0 are different findings, and the API is explicit about this), the resolved vs. input jurisdiction, which rules fired or didn't and why, per-product metadata drift since the order, a verdict (`healthy` / `jurisdiction_mismatch` / `collected_but_engine_says_zero` / `should_have_collected` / `computed_but_not_collected` / `amount_drift` / `needs_review`) with a confidence level, Sentry links, and a sanitized Markdown handoff meant for pasting into a ticket or an agent prompt. This is a first-party replacement for a lot of what the HQ Excise Tax Scan tab above does by hand (`calc-detail` parsing, the manually-transcribed state rate tables) — intended for one-off "why was this order wrong" investigations rather than a bulk sweep. See the API docs themselves for the full evidence model; not duplicated here beyond what's needed to explain this tab's code.

### A fundamentally different credential than the rest of this extension

Everything else in this extension either calls a client-facing API directly or automates a signed-in HQ browser session to mint a short-lived, session-scoped token. This endpoint doesn't work that way: it's gated behind `diagnostic:investigate`, held only by `api:diagnosticAdmin`/`api:opsAdmin` — confirmed live (2026-08-26) that this extension's usual session-minted bearer token gets a clean `403 ApiManager:insufficientPermissions` against it (`diagnostic:read`, which every ordinary key gets, is a separate and much less guarded grant). Access instead requires a standalone `ops.tokenoftrust.com` API key/secret pair (`totApiKey`/`totSecretKey`), exchanged for a bearer token via `POST /api/accessToken`.

That's a meaningfully more sensitive credential than anything this extension has handled before — long-lived, not scoped to a single browser session, and carrying real elevated access. It's stored only in this browser's local extension storage (`chrome.storage.local`), entered once via the tab's own input fields, never logged or printed, and never included in any exported file. If this extension is ever shared with teammates, each person should use their own key rather than a shared one — every call is audited by actor, so a shared key misattributes who actually ran what investigation.

### Fixed 2026-08-26: token exchange was missing a required field

The first version of this tab guessed at the `POST /api/accessToken` request/response shape — the HQ session investigating it lost its org context mid-session (`/hq/choose-app` started showing "NO ORGANIZATION" / "No User Name") before the `AccessTokenRequest`/`AccessTokenResponse` schema pages could be read directly, so `invExchangeToken` only sent `{totApiKey, totSecretKey}`. Marc then pulled up the real "Create an access token" docs page directly: the request body is actually **three** required fields — `totApiKey`, `totSecretKey`, and `appDomain` ("Domain associated with API keys," e.g. `tokenoftrust.com` for an internal/ops-scoped key). Missing `appDomain` would have failed every single call with a 422, so this tab as originally shipped was non-functional. Added an `appDomain` field to the credentials panel and to the exchange request.

Confirmed at the same time: the response token lives at `content.accessToken` (one of the originally-guessed candidates, kept first in the fallback chain now that it's known correct) and the token is valid 24 hours — replacing the earlier defensive 10-minute assumption used when the actual value wasn't known.

### Where the real credentials actually come from

Not obtained by asking anyone to provision a special key — `ops` is its own vendor inside HQ, with the same self-service "REST API Integration" panel every vendor gets. To get a working key pair: log into HQ, select **ops** as the vendor (same `choose-app` flow used everywhere else in this extension), then open the **Integration** tab. That page shows `appDomain: ops.tokenoftrust.com` plus a `totApiKey`/`totSecretKey` pair — confirmed live (2026-08-26) that this exact combination authenticates *and* carries `diagnostic:investigate` (`api:opsAdmin` — the role name lines up with the vendor name, which is presumably not a coincidence). The `tokenoftrust.com` domain shown as the generic example on the API docs page itself was a red herring; the real value is `ops.tokenoftrust.com`.

One thing this resolved that's worth recording: an earlier test using a different, unrelated key/domain pair 403'd with `insufficientPermissions` on the investigation call, which looked at the time like conclusive proof that ordinary keys structurally lack this permission. That conclusion held up (it does), but the specific test wasn't actually using the `ops` vendor's own key at all — so don't over-read a single 403 without first confirming the key/domain pair being tested is actually the right one.

### Usage

1. Open the **Order Investigation** tab.
2. Get your key pair from HQ → select **ops** as the vendor → **Integration** tab (see above) — not from any API docs page's own example values.
3. Enter `totApiKey`, `totSecretKey`, and `appDomain` (`ops.tokenoftrust.com`), then click **Save & test credentials** — this exchanges them for a token immediately so a bad key pair or wrong domain fails fast rather than on your first real lookup.
4. Enter an order ID (the order-of-record id your platform sent — Shopify `order_number`, BigCommerce `order.id`, WooCommerce transaction id). **Leave "Target app domain" on "(use my key's own domain)"** unless you're deliberately investigating a different tenant's order — it defaults to your key's own domain (`ops.tokenoftrust.com`, which has no real orders on it), so an order belonging to an actual client store needs its real domain picked from the dropdown (e.g. `vapesocietysupplies.com`) or the call 404s with "No recorded order was found for that appTransactionId and appDomain." The dropdown is populated from the same **Known domains** list as the HQ Excise Tax Scan tab (add or fix domains there); pick **Other… (type manually)** for a client domain that isn't in the list yet.
5. Click **Investigate**. The dossier renders below — verdict first, then the five-value table, jurisdiction, rules fired, product drift, skipped products, degradations, Sentry links, and the copyable handoff Markdown.

Confirmed working end-to-end (2026-08-26): order 2448120 (vapesocietysupplies.com) returned a clean `healthy` verdict via the real `ops` credentials.

### 2026-08-26: Plain-English labels for the five tax values

The values table used the raw API field names (`collected`, `reconcileReported`, `checkoutCalculated`, `recordCalculated`, `recalculatedNow`) as the only label, which reads fine once you've read the API docs but isn't self-explanatory otherwise. Each row now shows a plain-English name first, with the raw field name kept underneath as a small mono subline so it's still traceable back to the API docs:

- **Charged to customer** — `collected` (platform) — what the order record shows as actually collected.
- **Reported in reconciliation** — `reconcileReported` (platform) — what a later reconciliation pass reported, if one ran.
- **Calculated at checkout** — `checkoutCalculated` (engine) — what the tax engine calculated live at checkout time.
- **Calculated when order was saved** — `recordCalculated` (engine) — what the engine's own stored metric said at order-save time.
- **Recalculated just now** — `recalculatedNow` (engine) — what the engine calculates if asked fresh, right now, with today's rules/data.

The verdict banner's `A/B/C` confidence line was relabeled to match (`A (charged to customer)`, `B (calculated when saved)`, `C (recalculated now)`).

### 2026-08-26: Target app domain is now a dropdown

Was a free-text input; replaced with a `<select>` populated from the same shared `HQ_DOMAINS` list/storage the HQ Excise Tax Scan tab's "Known domains" table already manages, instead of maintaining a second copy of the client-domain list. First option is "(use my key's own domain)" (the old blank-input default); a trailing "Other… (type manually)" option reveals a text input again for a domain not yet in the list. Add or fix domains from either tab — both read/write the same storage key.

### Not yet done

- No caching/history of past investigations across popup reopens — each lookup is fresh.
- Doesn't attempt to replace the HQ Excise Tax Scan tab's bulk sweep. Deliberately left as a standalone single-order tool for now — the scan's mismatch heuristics stay as-is until this endpoint's real-world latency/volume characteristics are known (see the epic's own `includeProductHistory=false` escape hatch for large orders, which reads like a sign this wasn't built for tight-loop bulk calling).
- The `whatIf` region-override rendering and `vendorContext`/`defaultRuleJurisdictionCounts` fields from the response aren't surfaced in the UI yet — present in the raw response, just not rendered.

## Roadmap ideas

- Export current storefront config as a ready-to-paste `DEFAULT_CONFIG` block
- Package/sign for the Chrome Web Store (internal or unlisted) so teammates don't need Developer Mode
- BigCommerce: exemption field support, bulk scan equivalent, and validating the status vocabulary against more client stores
- Product Backfill: Hemp and Nicotine Pouch CSV formats, Shopify/WooCommerce cross-referencing
