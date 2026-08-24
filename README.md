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

## Roadmap ideas

- Export current storefront config as a ready-to-paste `DEFAULT_CONFIG` block
- Package/sign for the Chrome Web Store (internal or unlisted) so teammates don't need Developer Mode
- BigCommerce: exemption field support, bulk scan equivalent, and validating the status vocabulary against more client stores
