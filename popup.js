const CONFIG_KEY = 'totExciseConfig';
const SHEET_KEY = 'totExciseSheetUrl';
const DEFAULT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1SfUcsK7z5yavPytlnuVxZZkhdhb4Y0yxjaamt8WkX2k/export?format=csv&gid=0';
const LAST_ORDER_KEY = 'totLastOrder';

const DEFAULT_CONFIG = [
  {domain:'fullsend.com', handle:'full-send-pouches'},
  {domain:'vitalarms.com', handle:'vitalarms'},
  {domain:'www.hipuffy.com', handle:'pzca5b-hv'},
  {domain:'www.mmschainportal.com', handle:'mmsvr'},
  {domain:'www.vaperistas.com', handle:'vaperista'},
  {domain:'wholesaletesting1289.myshopify.com', handle:'wholesaletesting1289'},
  {domain:'b2ctesting1289.myshopify.com', handle:'b2ctesting1289'},
  {domain:'justcbdstore.com', handle:'just-cbd-store'},
  {domain:'fistdistro.com', handle:'fistdistro'},
  {domain:'giantvapes.com', handle:'giantvapes'},
  {domain:'shopmmsdistro.com', handle:'j0udut-kt'},
  {domain:'highclassvapeco.com', handle:'high-class-vape-co'},
  {domain:'zulu-vapes.myshopify.com', handle:'zulu-vapes'},
  {domain:'thevaporshoppeusa.com', handle:'the-vapor-shoppe-usa'},
  {domain:'thevaporsupplier.com', handle:'b2bvapetest'},
  {domain:'alternative-pods-1284.myshopify.com', handle:'alternative-pods-1284'},
  {domain:'shop.noat.com', handle:'takenoat'},
  {domain:'bigdvapor.com', handle:'big-d-vapor'}
];

let CONFIG = [];

async function loadConfig(){
  const stored = await chrome.storage.local.get([CONFIG_KEY]);
  if(stored[CONFIG_KEY]) return stored[CONFIG_KEY];
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}
async function saveConfig(){
  await chrome.storage.local.set({[CONFIG_KEY]: CONFIG});
}

function renderDomainSelect(){
  const sel = document.getElementById('domainSelect');
  const prev = sel.value;
  sel.innerHTML = '';
  CONFIG.forEach((row,i)=>{
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = row.domain + (row.handle ? '' : '  (no handle set)');
    sel.appendChild(opt);
  });
  if(prev && CONFIG[prev]) sel.value = prev;
  updateHandleHint();
}
function updateHandleHint(){
  const i = document.getElementById('domainSelect').value;
  const row = CONFIG[i];
  const hint = document.getElementById('handleHint');
  if(!row){ hint.textContent=''; return; }
  hint.textContent = row.handle ? `Handle: ${row.handle}` : 'No handle saved yet — add it below, or paste a full order URL once to auto-save it.';
}

function renderCfgTable(){
  const body = document.getElementById('cfgBody');
  body.innerHTML = '';
  CONFIG.forEach((row,i)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" data-i="${i}" data-f="domain" value="${escapeAttr(row.domain)}"></td>
      <td><input type="text" data-i="${i}" data-f="handle" value="${escapeAttr(row.handle)}"></td>
      <td><button class="row-del" data-i="${i}" title="Remove">✕</button></td>`;
    body.appendChild(tr);
  });
  body.querySelectorAll('input').forEach(inp=>{
    inp.addEventListener('input', async e=>{
      const i = +e.target.dataset.i, f = e.target.dataset.f;
      CONFIG[i][f] = e.target.value.trim();
      await saveConfig();
      renderDomainSelect();
    });
  });
  body.querySelectorAll('.row-del').forEach(btn=>{
    btn.addEventListener('click', async e=>{
      CONFIG.splice(+e.target.dataset.i,1);
      await saveConfig();
      renderCfgTable();
      renderDomainSelect();
    });
  });
}
function escapeAttr(s){ return (s||'').replace(/"/g,'&quot;'); }

document.getElementById('addRowBtn').addEventListener('click', async ()=>{
  CONFIG.push({domain:'', handle:''});
  await saveConfig(); renderCfgTable(); renderDomainSelect();
});
document.getElementById('resetCfgBtn').addEventListener('click', async ()=>{
  if(!confirm('Reset storefront config to defaults? Any handles you added will be lost.')) return;
  CONFIG = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  await saveConfig(); renderCfgTable(); renderDomainSelect();
});
document.getElementById('domainSelect').addEventListener('change', updateHandleHint);

// ---- URL parsing ----
function parseOrderInput(val){
  val = val.trim();
  const m = val.match(/admin\.shopify\.com\/store\/([a-zA-Z0-9\-]+)\/orders\/(\d+)/);
  if(m) return {handle:m[1], orderId:m[2]};
  const idOnly = val.match(/^\d+$/);
  if(idOnly) return {handle:null, orderId:val};
  return {handle:null, orderId:null};
}

document.getElementById('orderInput').addEventListener('input', async e=>{
  const parsed = parseOrderInput(e.target.value);
  if(!parsed.handle) return;

  const existingIdx = CONFIG.findIndex(r=>r.handle===parsed.handle);
  if(existingIdx>=0){
    document.getElementById('domainSelect').value = existingIdx;
    updateHandleHint();
    return;
  }

  const selIdx = +document.getElementById('domainSelect').value;
  const row = CONFIG[selIdx];
  if(!row) return;

  if(!row.handle){
    row.handle = parsed.handle;
    await saveConfig();
    renderDomainSelect();
    renderCfgTable();
    document.getElementById('domainSelect').value = selIdx;
    updateHandleHint();
    setStatus(`Saved handle "${parsed.handle}" for ${row.domain}.`, 'ok');
  } else if(row.handle !== parsed.handle){
    const oldHandle = row.handle;
    row.handle = parsed.handle;
    await saveConfig();
    renderDomainSelect();
    renderCfgTable();
    document.getElementById('domainSelect').value = selIdx;
    updateHandleHint();
    setStatus(`Updated handle for ${row.domain}: "${oldHandle}" → "${parsed.handle}".`, 'ok');
  }
});

function currentStoreHandle(){
  const parsedFromInput = parseOrderInput(document.getElementById('orderInput').value);
  if(parsedFromInput.handle) return parsedFromInput.handle;
  const row = CONFIG[document.getElementById('domainSelect').value];
  return row ? row.handle : null;
}

// Shopify's internal order id (used in admin URLs) is a long number (10+ digits) and has
// no simple relationship to the order_number or name shown in the UI — some stores' order
// names don't even numerically match order_number. So a bare short number or a name like
// "GV153847" can't be turned into a URL directly; it has to be looked up against the
// storefront's order list instead.
function looksLikeInternalId(str){
  return /^\d{9,}$/.test(str);
}

function extractNumberFromQuery(q){
  const m = (q||'').match(/(\d+)\s*$/);
  return m ? parseInt(m[1],10) : null;
}

// The trailing digits in an order's `name` field (e.g. "GV153847" -> 153847) — this is what
// range/list matching should key off, since on some storefronts `order_number` doesn't match
// the digits in `name` at all. `order_number` is kept only as a secondary fallback check.
function extractOrderNameNumber(order){
  const m = (order.name||'').match(/(\d+)\s*$/);
  return m ? parseInt(m[1],10) : null;
}

function pageMinNameNumber(orders){
  const nums = orders.map(extractOrderNameNumber).filter(n=>n!==null);
  return nums.length ? Math.min(...nums) : null;
}

async function searchOrderByNameOrNumber(handle, query){
  const targetNum = extractNumberFromQuery(query);
  const queryLower = query.trim().toLowerCase();
  const MAX_PAGES = 8;
  let url = `https://admin.shopify.com/store/${handle}/orders.json?status=any&limit=250`;
  let pages = 0;
  while(url && pages < MAX_PAGES){
    const {orders, nextUrl} = await fetchOrdersPageWithFallback(url);
    pages++;
    for(const o of orders){
      if(o.name && o.name.trim().toLowerCase() === queryLower) return o;
      if(targetNum !== null && extractOrderNameNumber(o) === targetNum) return o;
      if(targetNum !== null && o.order_number === targetNum) return o; // fallback, in case name has no trailing digits
    }
    if(targetNum !== null && orders.length){
      const minOnPage = pageMinNameNumber(orders);
      if(minOnPage !== null && minOnPage < targetNum) break; // sorted newest-first; nothing older can match
    }
    url = nextUrl;
  }
  return null;
}

document.getElementById('openTabBtn').addEventListener('click', async ()=>{
  const raw = document.getElementById('orderInput').value.trim();
  const parsedUrl = parseOrderInput(raw);
  if(parsedUrl.handle && parsedUrl.orderId){
    chrome.tabs.create({url: `https://admin.shopify.com/store/${parsedUrl.handle}/orders/${parsedUrl.orderId}`});
    return;
  }
  const handle = currentStoreHandle();
  if(!handle){ setStatus('Select a storefront with a saved handle, and enter an order ID, name, or URL.', 'err'); return; }
  if(looksLikeInternalId(raw)){
    chrome.tabs.create({url: `https://admin.shopify.com/store/${handle}/orders/${raw}`});
    return;
  }
  if(!raw){ setStatus('Enter an order ID, name, or admin order URL.', 'err'); return; }
  setStatus(`Looking up ${raw} to open it…`);
  try{
    const found = await searchOrderByNameOrNumber(handle, raw);
    if(!found){ setStatus(`Couldn't find an order matching "${raw}" in recent orders on this store.`, 'err'); return; }
    chrome.tabs.create({url: `https://admin.shopify.com/store/${handle}/orders/${found.id}`});
  }catch(err){
    setStatus('Lookup failed — ' + (err.message || 'unknown error'), 'err');
  }
});

async function fetchOrderById(handle, orderId){
  const url = `https://admin.shopify.com/store/${handle}/orders/${orderId}.json`;
  setStatus('Fetching ' + url + ' …');
  showLoadingState();
  try{
    const res = await fetch(url, {credentials:'include'});
    if(res.status === 401 || res.status === 403){
      setStatus(`Not authenticated for this store (${res.status}). Open it in Shopify first to log in, then try Fetch again.`, 'err');
      resetToEmptyState();
      return;
    }
    if(!res.ok){
      setStatus(`Request returned ${res.status}. Check the store handle and order ID are correct.`, 'err');
      resetToEmptyState();
      return;
    }
    const data = await res.json();
    setStatus('Loaded order ' + url, 'ok');
    await handleOrderData(data.order || data);
  }catch(err){
    setStatus('Fetch failed — ' + (err.message || 'unknown error') + '. Try "Open in Shopify" and paste the JSON below instead.', 'err');
    resetToEmptyState();
  }
}

async function fetchOrder(){
  const raw = document.getElementById('orderInput').value.trim();
  if(!raw){ setStatus('Enter an order ID, name, or admin order URL.', 'err'); return; }

  const parsedUrl = parseOrderInput(raw);
  if(parsedUrl.handle && parsedUrl.orderId){
    await fetchOrderById(parsedUrl.handle, parsedUrl.orderId);
    return;
  }

  const handle = currentStoreHandle();
  if(!handle){ setStatus('Select a storefront with a saved handle first.', 'err'); return; }

  if(looksLikeInternalId(raw)){
    await fetchOrderById(handle, raw);
    return;
  }

  // Order name (e.g. GV153847) or order number (e.g. 153847) — search the order list for it.
  setStatus(`Looking up ${raw} on ${handle}…`);
  showLoadingState();
  try{
    const found = await searchOrderByNameOrNumber(handle, raw);
    if(!found){
      setStatus(`Couldn't find an order matching "${raw}" in recent orders on this store.`, 'err');
      resetToEmptyState();
      return;
    }
    setStatus(`Loaded order ${found.name || found.order_number}.`, 'ok');
    await handleOrderData(found);
  }catch(err){
    setStatus('Lookup failed — ' + (err.message || 'unknown error'), 'err');
    resetToEmptyState();
  }
}

document.getElementById('fetchBtn').addEventListener('click', fetchOrder);



// ---- Compliance sheet (PACT & Excise tab) ----
// Columns (0-indexed): 0 State | 1 PACT Agency | 2 PACT Required License | 3 PACT Fees
// | 4 PACT Registration Portal | 5 (blank spacer) | 6 Excise Agency | 7 Excise Required License
// | 8 Excise Registration Portal | 9 Excise Tax. Rows 0-1 are headers; data starts at row 2.
const STATE_ABBR_TO_NAME = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',
  CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',
  IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',
  ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',
  MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',
  NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',
  ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',
  RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',
  UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',
  WI:'Wisconsin',WY:'Wyoming',DC:'District of Columbia'
};

function parseCSV(text){
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for(let i=0;i<text.length;i++){
    const c = text[i];
    if(inQuotes){
      if(c === '"'){
        if(text[i+1] === '"'){ field += '"'; i++; }
        else { inQuotes = false; }
      } else { field += c; }
    } else {
      if(c === '"'){ inQuotes = true; }
      else if(c === ','){ row.push(field); field=''; }
      else if(c === '\n'){ row.push(field); rows.push(row); row=[]; field=''; }
      else if(c === '\r'){ /* skip, \r\n handled via \n */ }
      else { field += c; }
    }
  }
  if(field.length || row.length){ row.push(field); rows.push(row); }
  return rows;
}

let complianceCache = null; // {url, rows} | {url, error}

async function getComplianceRows(url){
  if(!url) return {rows:null, error:null};
  if(complianceCache && complianceCache.url === url) return complianceCache;
  try{
    const res = await fetch(url);
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    complianceCache = {url, rows: parseCSV(text), error:null};
  }catch(e){
    complianceCache = {url, rows:null, error: e.message || 'fetch failed'};
  }
  return complianceCache;
}

function findComplianceRow(rows, order){
  if(!rows) return null;
  const ship = order.shipping_address;
  if(!ship) return null;
  let stateName = ship.province;
  if(!stateName && ship.province_code) stateName = STATE_ABBR_TO_NAME[ship.province_code.toUpperCase()];
  if(!stateName) return null;
  return findComplianceRowByStateName(rows, stateName);
}

function findComplianceRowByStateName(rows, stateName){
  if(!rows || !stateName) return null;
  const target = stateName.trim().toLowerCase();
  for(let i=2;i<rows.length;i++){
    if(rows[i][0] && rows[i][0].trim().toLowerCase() === target) return rows[i];
  }
  return null;
}

function setStatus(msg, type){
  const el = document.getElementById('fetchStatus');
  el.textContent = msg;
  el.className = 'status-line show' + (type ? ' '+type : '');
}

function skeletonRows(count, widths){
  let html = '';
  for(let i=0;i<count;i++){
    const w = widths ? widths[i % widths.length] : (60 + (i*13)%35);
    html += `<div class="skeleton-row" style="width:${w}%;"></div>`;
  }
  return html;
}

function showLoadingState(){
  document.getElementById('totStatusPanel').style.display = 'block';
  document.getElementById('totStatusList').innerHTML = skeletonRows(2, [70, 55]);

  document.getElementById('diagEmpty').style.display = 'none';
  document.getElementById('diagList').innerHTML = skeletonRows(4, [90, 75, 85, 65]);

  document.getElementById('notesPanel').style.display = 'none';

  document.getElementById('jsonPanel').style.display = 'block';
  document.getElementById('orderMeta').textContent = '';
  document.getElementById('jsonView').innerHTML = `<div style="display:flex;flex-direction:column;gap:8px;">${skeletonRows(6, [80, 60, 90, 45, 70, 55])}</div>`;
}

function resetToEmptyState(){
  document.getElementById('totStatusPanel').style.display = 'none';
  document.getElementById('totStatusList').innerHTML = '';
  document.getElementById('diagList').innerHTML = '';
  document.getElementById('diagEmpty').style.display = 'block';
  document.getElementById('notesPanel').style.display = 'none';
  document.getElementById('jsonPanel').style.display = 'none';
  document.getElementById('livePricePanel').style.display = 'none';
  document.getElementById('livePriceResults').innerHTML = '';
}

document.getElementById('analyzePastedBtn').addEventListener('click', async ()=>{
  const raw = document.getElementById('pasteArea').value.trim();
  if(!raw){ return; }
  try{
    const data = JSON.parse(raw);
    await handleOrderData(data.order || data);
    setStatus('Loaded from pasted JSON.', 'ok');
  }catch(e){
    setStatus('Could not parse that as JSON — check for a stray character or truncated paste.', 'err');
  }
});

document.getElementById('copyJsonBtn').addEventListener('click', async ()=>{
  if(!currentOrderData){ setStatus('No order loaded yet.', 'err'); return; }
  try{
    await navigator.clipboard.writeText(JSON.stringify(currentOrderData, null, 2));
    setStatus('Copied order JSON to clipboard.', 'ok');
  }catch(e){
    setStatus('Could not copy automatically — select the text in the JSON panel and copy manually.', 'err');
  }
});

document.getElementById('clearBtn').addEventListener('click', async ()=>{
  await chrome.storage.local.remove([LAST_ORDER_KEY]);
  currentOrderData = null;
  document.getElementById('orderInput').value = '';
  document.getElementById('pasteArea').value = '';
  document.getElementById('jsonPanel').style.display = 'none';
  document.getElementById('totStatusPanel').style.display = 'none';
  document.getElementById('totStatusList').innerHTML = '';
  document.getElementById('diagList').innerHTML = '';
  document.getElementById('diagEmpty').style.display = 'block';
  document.getElementById('notesPanel').style.display = 'none';
  document.getElementById('notesList').innerHTML = '';
  document.getElementById('slackNoteLine').value = '';
  document.getElementById('livePricePanel').style.display = 'none';
  document.getElementById('livePriceResults').innerHTML = '';
  setStatus('Cleared.', 'ok');
});

document.getElementById('refreshBtn').addEventListener('click', ()=>{
  location.reload();
});

document.getElementById('fullTabBtn').addEventListener('click', ()=>{
  chrome.tabs.create({url: chrome.runtime.getURL('popup.html?full=1')});
});

if(new URLSearchParams(location.search).get('full')){
  document.body.classList.add('full-tab');
}

// ---- JSON syntax highlight ----
function syntaxHighlight(json){
  const str = JSON.stringify(json, null, 2)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return str.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false)\b|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    match=>{
      let cls='jv-num';
      if(/^"/.test(match)) cls = /:$/.test(match) ? 'jk' : 'jv-str';
      else if(/true|false/.test(match)) cls='jv-bool';
      else if(/null/.test(match)) cls='jv-null';
      return `<span class="${cls}">${match}</span>`;
    });
}

// Colorizes raw HTML markup as displayed text — not a full parser, same "good enough for
// readability" spirit as the JSON highlighter above. Tags/attributes/values/comments only.
function htmlSyntaxHighlight(html){
  let esc = html.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  esc = esc.replace(/&lt;!--[\s\S]*?--&gt;/g, m => `<span class="html-comment">${m}</span>`);
  esc = esc.replace(/&lt;(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:(?!&gt;)[\s\S])*?)(\/?)&gt;/g, (full, slash, tagName, attrsPart, selfClose) => {
    const highlightedAttrs = attrsPart.replace(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(\s*=\s*)("[^"]*"|'[^']*')/g,
      (m2, name, eq, val) => `<span class="html-attr">${name}</span>${eq}<span class="html-attr-val">${val}</span>`
    );
    return `<span class="html-tag">&lt;${slash}${tagName}</span>${highlightedAttrs}<span class="html-tag">${selfClose}&gt;</span>`;
  });
  return esc;
}

// ---- Diagnostics ----
function num(v){ const n = parseFloat(v); return isNaN(n) ? 0 : n; }

// Catches cases where the tax engine resolved the wrong state entirely — e.g. a city name
// that exists in two different states getting geocoded to the wrong one (Concordia, KS vs.
// Concordia Parish, LA). Compares the state named in each "___ State Tax" line against the
// order's actual ship-to state. Shared by the diagnostics check and the auto-notes flag.
function findWrongStateTaxLines(order){
  const ship = order.shipping_address;
  const shipStateName = ship ? (STATE_ABBR_TO_NAME[(ship.province_code||'').toUpperCase()] || ship.province) : null;
  const taxLineStates = (order.tax_lines || [])
    .map(t => (t.title||'').match(/^(.+?)\s+State Tax$/i))
    .filter(Boolean)
    .map(m => m[1].trim());
  const wrongStateTaxLines = shipStateName
    ? [...new Set(taxLineStates.filter(s => s.toLowerCase() !== shipStateName.toLowerCase()))]
    : [];
  return {shipStateName, taxLineStates, wrongStateTaxLines};
}

function analyzeOrder(order, compliance){
  const checks = [];
  const lineItems = order.line_items || [];

  const codes = order.discount_codes || [];
  const totalDiscount = num(order.total_discounts);
  const hasDiscount = codes.length>0 || totalDiscount>0;
  checks.push({
    label:'Coupons / discounts',
    status: hasDiscount ? 'flag' : 'ok',
    summary: hasDiscount
      ? `${codes.length} code(s) applied, $${order.total_discounts||'0.00'} total discount`
      : 'No discount codes or order-level discount applied',
    detail: hasDiscount
      ? 'Codes: ' + (codes.length ? codes.map(c=>`${c.code} (${c.type}, ${c.amount})`).join(', ') : 'none listed at order level, but discount_allocations exist on line items')
        + '\nConfirm the excise calc runs against the correct subtotal — some state formulas tax pre-discount value, others post-discount.'
      : null
  });

  const relevantItems = lineItems.filter(li=>!isAncillaryLineItem(li));
  const untaxed = relevantItems.filter(li => li.taxable === false || !li.tax_lines || li.tax_lines.length===0);
  checks.push({
    label:'Product metadata (PMD)',
    status: untaxed.length>0 ? 'flag' : (relevantItems.length ? 'ok' : 'info'),
    summary: relevantItems.length===0 ? 'No taxable-candidate line items on this order'
      : untaxed.length>0 ? `${untaxed.length} of ${relevantItems.length} item(s) missing tax config`
      : `All ${relevantItems.length} item(s) have tax_lines and taxable:true`,
    detail: untaxed.length>0
      ? untaxed.map(li=>`• ${li.title}  (SKU ${li.sku||'n/a'}, product_id ${li.product_id})\n   taxable: ${li.taxable}, tax_lines: ${(li.tax_lines||[]).length}`).join('\n')
      : null
  });

  const editedItems = lineItems.filter(li => li.current_quantity !== undefined && li.current_quantity !== li.quantity);
  const refunds = order.refunds || [];
  const wasModified = editedItems.length>0 || refunds.length>0;
  checks.push({
    label:'Order modification',
    status: wasModified ? 'flag' : 'ok',
    summary: wasModified
      ? `${editedItems.length} line item(s) edited, ${refunds.length} refund(s) on record`
      : 'No edits or refunds detected',
    detail: wasModified
      ? [
          editedItems.length ? editedItems.map(li=>`• ${li.title}: qty ${li.quantity} → current ${li.current_quantity}`).join('\n') : null,
          refunds.length ? refunds.map(r=>`• Refund ${r.id} on ${r.created_at}`).join('\n') : null
        ].filter(Boolean).join('\n') + '\nTax apps sometimes calculate at original-order time and don\'t re-run on later edits.'
      : null
  });

  const ship = order.shipping_address, bill = order.billing_address;
  const noShipState = !ship || !ship.province_code;
  const mismatch = ship && bill && ship.province_code && bill.province_code && ship.province_code !== bill.province_code;
  checks.push({
    label:'Address mismatch',
    status: noShipState ? 'flag' : (mismatch ? 'flag' : 'ok'),
    summary: noShipState ? 'No ship-to state on the order — excise calc has nothing to key off of'
      : mismatch ? `Ship-to state (${ship.province_code}) differs from bill-to (${bill.province_code})`
      : `Ship-to and bill-to both resolve to ${ship.province_code}`,
    detail: (noShipState || mismatch)
      ? `Shipping: ${ship ? [ship.address1, ship.city, ship.province_code, ship.zip].filter(Boolean).join(', ') : 'none'}\nBilling: ${bill ? [bill.address1, bill.city, bill.province_code, bill.zip].filter(Boolean).join(', ') : 'none'}`
      : null
  });

  const {shipStateName, taxLineStates, wrongStateTaxLines} = findWrongStateTaxLines(order);
  checks.push({
    label:'Tax jurisdiction match',
    status: !shipStateName ? 'info' : wrongStateTaxLines.length ? 'flag' : (taxLineStates.length ? 'ok' : 'info'),
    summary: !shipStateName ? 'No ship-to state to compare tax_lines against'
      : wrongStateTaxLines.length ? `Tax calculated for ${wrongStateTaxLines.join(', ')}, but order ships to ${shipStateName}`
      : taxLineStates.length ? `Tax lines match ship-to state (${shipStateName})`
      : 'No state-level tax_lines to check (may be a no-tax state, or excise-only order)',
    detail: wrongStateTaxLines.length
      ? `Ship-to: ${[ship.address1, ship.city, ship.province_code, ship.zip].filter(Boolean).join(', ')}\nThis usually means a city/place name that exists in more than one state was geocoded to the wrong one. Worth checking the address against the actual state before assuming the tax engine is broken generally.`
      : null
  });

  const gateways = order.payment_gateway_names || [];
  const unusual = gateways.some(g => ['manual','cash on delivery (cod)','bogus','free'].includes((g||'').toLowerCase()));
  checks.push({
    label:'Payment method',
    status: gateways.length===0 ? 'info' : (unusual ? 'flag' : 'ok'),
    summary: gateways.length===0 ? 'No payment gateway recorded on the order'
      : unusual ? `Non-standard gateway: ${gateways.join(', ')}`
      : `Gateway: ${gateways.join(', ')}`,
    detail: unusual ? 'Manual / COD / bogus gateways sometimes bypass the checkout flow that triggers the tax app.' : null
  });

  const state = ship ? (ship.province_code || ship.province) : null;
  let stateCheck;
  if(!state){
    stateCheck = { label:'State-specific rate config', status:'flag', summary:'No ship-to state to check', detail:null };
  } else if(!compliance || (!compliance.rows && !compliance.error)){
    stateCheck = { label:'State-specific rate config', status:'info', summary:`Ship-to state: ${state} — add a compliance sheet CSV URL below to auto-check`, detail:null };
  } else if(compliance.error){
    stateCheck = { label:'State-specific rate config', status:'flag', summary:`Ship-to state: ${state} — couldn't load compliance sheet`, detail:`Error: ${compliance.error}\nCheck the CSV URL is still valid (Google can revoke export links if sharing settings change).` };
  } else {
    const match = findComplianceRow(compliance.rows, order);
    if(!match){
      stateCheck = { label:'State-specific rate config', status:'flag', summary:`Ship-to state: ${state} — no matching row in compliance sheet`, detail:'Check the sheet\'s state-name spelling against this order\'s shipping address.' };
    } else {
      stateCheck = {
        label:'State-specific rate config',
        status:'info',
        summary:`Ship-to state: ${match[0]} — compliance details found`,
        detail: `PACT — Agency: ${match[1]||'n/a'} | License: ${match[2]||'n/a'} | Fees: ${match[3]||'n/a'}${match[4]?(' | Portal: '+match[4]):''}\n\nExcise — Agency: ${match[6]||'n/a'} | License: ${match[7]||'n/a'}${match[8]?(' | Portal: '+match[8]):''}\n${(match[9]||'No excise tax detail listed').trim()}`
      };
    }
  }
  checks.push(stateCheck);

  const totalQty = lineItems.reduce((s,li)=>s+(li.quantity||0),0);
  const bigCart = lineItems.length>15 || totalQty>50;
  checks.push({
    label:'Cart size / SKU count',
    status: bigCart ? 'flag' : 'ok',
    summary: `${lineItems.length} line item(s), ${totalQty} unit(s) total`,
    detail: bigCart ? 'Larger carts occasionally hit per-line-item limits or timeouts in third-party tax calculation apps.' : null
  });

  const vendors = [...new Set(lineItems.map(li=>li.vendor).filter(Boolean))];
  checks.push({
    label:'Vendor / product specific',
    status: 'info',
    summary: vendors.length ? `Vendors on this order: ${vendors.join(', ')}` : 'No vendor field set on line items',
    detail: lineItems.length ? lineItems.map(li=>`• ${li.title} — vendor: ${li.vendor||'n/a'}, SKU: ${li.sku||'n/a'}`).join('\n') : null
  });

  return checks;
}

function badgeLabel(status){
  return {flag:'Flag', ok:'OK', info:'Info', err:'Error'}[status] || status;
}

// ---- TOT tag vocabulary (authoritative — straight from TOT's own app, not inferred) ----
// Verification: tot-cleared | tot-not-verified | tot-rejected | tot-not-required
// Excise tax:    tot-excise-tax-collected | tot-excise-tax-not-required | tot-excise-tax-incorrect
// Note: if excise informational tags are disabled in Shopify settings, "not-required"/"collected"
// may be suppressed — but "incorrect" always shows. So a missing excise tag is NOT proof of "fine".
function parseTotTags(order){
  const tags = (order.tags || '').split(',').map(t=>t.trim().toLowerCase());
  const verification =
    tags.includes('tot-cleared') ? 'cleared' :
    tags.includes('tot-not-verified') ? 'not-verified' :
    tags.includes('tot-rejected') ? 'rejected' :
    tags.includes('tot-not-required') ? 'not-required' : null;
  const excise =
    tags.includes('tot-excise-tax-collected') ? 'collected' :
    tags.includes('tot-excise-tax-not-required') ? 'not-required' :
    tags.includes('tot-excise-tax-incorrect') ? 'incorrect' : null;
  return {verification, excise};
}

// Line items TOT/Route inject that are legitimately non-taxable by design (tax collection line
// itself, shipping protection add-on) — excluding these from PMD checks avoids false positives.
function isAncillaryLineItem(li){
  const vendor = (li.vendor || '').toLowerCase();
  const sku = (li.sku || '').toUpperCase();
  return vendor === 'tot' || vendor === 'route' || sku.startsWith('TOT_TAXLINE_') || sku.startsWith('ROUTEINS');
}

function renderTotStatus(order){
  const panel = document.getElementById('totStatusPanel');
  const list = document.getElementById('totStatusList');
  const {verification, excise} = parseTotTags(order);
  panel.style.display = 'block';
  list.innerHTML = '';

  const VERIFICATION_META = {
    'cleared': {status:'ok', text:'Cleared'},
    'not-verified': {status:'flag', text:'Not verified — pending, do not fulfill yet'},
    'rejected': {status:'err', text:'Rejected — do not fulfill'},
    'not-required': {status:'ok', text:'Not required (order is all no-verification items)'},
    null: {status:'info', text:'No verification tag found'}
  };
  const EXCISE_META = {
    'collected': {status:'ok', text:'Collected correctly'},
    'not-required': {status:'ok', text:'Not required for this order'},
    'incorrect': {status:'err', text:'Incorrect — required but not collected correctly'},
    null: {status:'info', text:'No excise tag found — informational tags may be off in settings, or this order predates tagging'}
  };

  const vMeta = VERIFICATION_META[verification];
  const eMeta = EXCISE_META[excise];

  const row = (label, meta) => `
    <div class="diag-summary" style="padding:3px 0;display:flex;align-items:center;gap:8px;">
      <span class="badge ${meta.status}">${badgeLabel(meta.status)}</span>
      <span><strong>${label}:</strong> ${meta.text}</span>
    </div>`;
  list.innerHTML = row('Verification', vMeta) + row('Excise tax', eMeta);
}

function generateAutoNotes(order){
  const lineItems = order.line_items || [];
  const notes = []; // {level:'flag'|'info', text}
  const {verification, excise} = parseTotTags(order);

  if(excise === 'incorrect'){
    notes.push({level:'flag', text:'Excise tax incorrect (tot-excise-tax-incorrect tag)'});
  }
  if(verification === 'rejected'){
    notes.push({level:'flag', text:'TOT verification rejected — do not fulfill'});
  } else if(verification === 'not-verified'){
    notes.push({level:'flag', text:'TOT verification pending — not yet cleared'});
  }

  const relevantItems = lineItems.filter(li=>!isAncillaryLineItem(li));
  const untaxed = relevantItems.filter(li => li.taxable === false || !li.tax_lines || li.tax_lines.length===0);
  if(untaxed.length && excise !== 'not-required'){
    notes.push({level:'flag', text:`Missing PMD on ${untaxed.length} item(s): ${untaxed.map(li=>li.title).join(', ')}`});
  }

  const {wrongStateTaxLines, shipStateName} = findWrongStateTaxLines(order);
  if(wrongStateTaxLines.length){
    notes.push({level:'flag', text:`Tax calculated for ${wrongStateTaxLines.join(', ')} but ships to ${shipStateName} — check for a city/place name collision`});
  }

  const gateways = (order.payment_gateway_names || []).map(g=>(g||'').toLowerCase());
  if(gateways.some(g=>g.includes('manual'))){
    notes.push({level:'flag', text:'This looks like a manual order (manual payment gateway)'});
  }
  if(gateways.some(g=>g.includes('store credit'))){
    notes.push({level:'info', text:'Store credit used as (part of) payment'});
  }

  const refunds = order.refunds || [];
  if(refunds.length){
    notes.push({level:'info', text:`${refunds.length} refund(s) on record`});
  }

  return notes;
}

function renderAutoNotes(order){
  const notes = generateAutoNotes(order);
  const panel = document.getElementById('notesPanel');

  if(!notes.length){
    panel.style.display = 'none';
    return;
  }

  const list = document.getElementById('notesList');
  const lineEl = document.getElementById('slackNoteLine');
  panel.style.display = 'block';
  list.innerHTML = '';

  notes.forEach(n=>{
    const row = document.createElement('div');
    row.className = 'diag-summary';
    row.style.padding = '2px 0';
    row.innerHTML = `<span class="badge ${n.level}" style="margin-right:6px;">${badgeLabel(n.level)}</span>${n.text}`;
    list.appendChild(row);
  });

  const hasFlag = notes.some(n=>n.level==='flag');
  const emoji = hasFlag ? ':bangbang:' : ':+1:';
  const orderRef = order.order_number || order.name || order.id || '';
  const noteText = ' - ' + notes.map(n=>n.text).join(' - ');
  lineEl.value = `${orderRef}: Status: [${emoji}]${noteText}`;
}

document.getElementById('copyNoteBtn').addEventListener('click', async ()=>{
  const text = document.getElementById('slackNoteLine').value;
  try{
    await navigator.clipboard.writeText(text);
    setStatus('Copied monitoring note to clipboard.', 'ok');
  }catch(e){
    setStatus('Could not copy automatically — select the text and copy manually.', 'err');
  }
});

// ---- Live price check (on-demand, not run automatically) ----
function setLivePriceStatus(msg, type, isHtml){
  const el = document.getElementById('livePriceStatus');
  if(isHtml) el.innerHTML = msg; else el.textContent = msg;
  el.className = 'status-line show' + (type ? ' '+type : '');
}

function resetLivePriceCheck(){
  document.getElementById('livePricePanel').style.display = 'block';
  document.getElementById('livePriceResults').innerHTML = '';
  document.getElementById('livePriceStatus').className = 'status-line';
  document.getElementById('livePriceStatus').textContent = '';
}

async function fetchProductVariants(handle, productId){
  const url = `https://admin.shopify.com/store/${handle}/products/${productId}.json`;
  const res = await fetch(url, {credentials:'include'});
  if(!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  return (data.product && data.product.variants) || [];
}

async function checkLivePrices(order, handle, onProgress){
  const lineItems = (order.line_items || []).filter(li=>!isAncillaryLineItem(li));
  const productIds = [...new Set(lineItems.map(li=>li.product_id).filter(Boolean))];
  const variantsByProduct = {};
  let completed = 0;
  await Promise.all(productIds.map(async pid=>{
    try{
      variantsByProduct[pid] = await fetchProductVariants(handle, pid);
    }catch(e){
      variantsByProduct[pid] = null; // deleted/archived product, or fetch failed
    }
    completed++;
    if(onProgress) onProgress(completed, productIds.length);
  }));

  return lineItems.map(li=>{
    const variants = variantsByProduct[li.product_id];
    if(!variants){
      return {title: li.title, chargedPrice: li.price, currentPrice: null, note: 'Could not fetch current product data (deleted, archived, or request failed)'};
    }
    const variant = variants.find(v=>v.id === li.variant_id);
    if(!variant){
      return {title: li.title, chargedPrice: li.price, currentPrice: null, note: 'This variant no longer exists on the current product'};
    }
    const charged = parseFloat(li.price), current = parseFloat(variant.price);
    return {title: li.title, chargedPrice: li.price, currentPrice: variant.price, mismatch: Math.abs(charged-current) > 0.001};
  });
}

function renderLivePriceResults(results){
  const container = document.getElementById('livePriceResults');
  container.innerHTML = '';
  results.forEach(r=>{
    const badgeClass = r.mismatch ? 'flag' : (r.currentPrice===null ? 'info' : 'ok');
    const badgeText = r.mismatch ? 'Flag' : (r.currentPrice===null ? 'Info' : 'OK');
    const row = document.createElement('div');
    row.className = 'diag-item';
    row.innerHTML = `
      <div class="diag-head">
        <div class="diag-title">${r.title}</div>
        <span class="badge ${badgeClass}">${badgeText}</span>
      </div>
      <div class="diag-summary">${r.currentPrice===null ? (r.note||'Could not check') : `Charged $${r.chargedPrice} — current listed price $${r.currentPrice}`}</div>
    `;
    container.appendChild(row);
  });
}

document.getElementById('checkLivePricesBtn').addEventListener('click', async ()=>{
  if(!currentOrderData){ setLivePriceStatus('No order loaded yet.', 'err'); return; }
  const handle = currentStoreHandle();
  if(!handle){ setLivePriceStatus('Select a storefront with a saved handle first.', 'err'); return; }

  const btn = document.getElementById('checkLivePricesBtn');
  const progressWrap = document.getElementById('livePriceProgressWrap');
  const progressBar = document.getElementById('livePriceProgressBar');
  btn.disabled = true;
  progressWrap.style.display = 'block';
  progressBar.style.width = '0%';
  setLivePriceStatus('<span class="spinner">⟳</span> Checking current prices…', null, true);
  document.getElementById('livePriceResults').innerHTML = '';

  try{
    const results = await checkLivePrices(currentOrderData, handle, (done, total)=>{
      progressBar.style.width = `${Math.round((done/total)*100)}%`;
      setLivePriceStatus(`<span class="spinner">⟳</span> Checked ${done} of ${total} product(s)…`, null, true);
    });
    renderLivePriceResults(results);
    const mismatches = results.filter(r=>r.mismatch).length;
    setLivePriceStatus(
      mismatches ? `${mismatches} of ${results.length} item(s) differ from the current listed price.` : `All ${results.length} item(s) match the current listed price.`,
      mismatches ? 'err' : 'ok'
    );
  }catch(err){
    setLivePriceStatus('Check failed — ' + (err.message || 'unknown error'), 'err');
  } finally {
    btn.disabled = false;
    progressWrap.style.display = 'none';
  }
});

// ---- Bulk scan ----
function setBulkStatus(msg, type){
  const el = document.getElementById('bulkStatus');
  el.textContent = msg;
  el.className = 'status-line show' + (type ? ' '+type : '');
}

function parseRangeInput(input){
  input = (input||'').trim();
  // Accepts plain numbers or prefixed order names (e.g. GV153890), range or comma list.
  const rangeMatch = input.match(/^[A-Za-z]*(\d+)\s*-\s*[A-Za-z]*(\d+)$/);
  if(rangeMatch){
    const min = parseInt(rangeMatch[1],10), max = parseInt(rangeMatch[2],10);
    return {mode:'range', min: Math.min(min,max), max: Math.max(min,max)};
  }
  const list = input.split(',')
    .map(s=>s.trim())
    .filter(Boolean)
    .map(s=>{ const m = s.match(/(\d+)\s*$/); return m ? parseInt(m[1],10) : NaN; })
    .filter(n=>!isNaN(n));
  if(list.length) return {mode:'list', set: new Set(list)};
  return null;
}

function orderMatchesRange(order, range){
  const n = extractOrderNameNumber(order);
  const fallback = order.order_number;
  const candidates = [n, fallback].filter(v => v !== undefined && v !== null);
  if(!candidates.length) return false;
  if(range.mode === 'range') return candidates.some(v => v >= range.min && v <= range.max);
  return candidates.some(v => range.set.has(v));
}

function extractLinkNext(linkHeader){
  if(!linkHeader) return null;
  const parts = linkHeader.split(',');
  for(const part of parts){
    const m = part.match(/<([^>]+)>;\s*rel="next"/);
    if(m) return m[1];
  }
  return null;
}

async function fetchOrdersPage(url){
  const res = await fetch(url, {credentials:'include'});
  if(!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  const nextUrl = extractLinkNext(res.headers.get('Link'));
  return {orders: data.orders || [], nextUrl};
}

// Some storefronts' order-list endpoint appears not to accept (or mishandles) a `limit` param —
// requests with it can fail outright at the network level ("Failed to fetch", not an HTTP error
// status). If that happens on a URL that included it, retry once without it before giving up.
async function fetchOrdersPageWithFallback(url){
  try{
    return await fetchOrdersPage(url);
  }catch(err){
    if(url.includes('limit=250')){
      const fallbackUrl = url.replace(/[?&]limit=250/, '').replace(/\?&/,'?');
      return await fetchOrdersPage(fallbackUrl);
    }
    throw err;
  }
}

document.getElementById('bulkClearBtn').addEventListener('click', ()=>{
  document.getElementById('bulkRangeInput').value = '';
  document.getElementById('bulkResultsPanel').style.display = 'none';
  document.getElementById('bulkResultsList').innerHTML = '';
  document.getElementById('bulkSummary').textContent = '';
  setBulkStatus('Cleared.', 'ok');
});

document.getElementById('bulkScanBtn').addEventListener('click', async ()=>{
  const handle = currentStoreHandle();
  if(!handle){ setBulkStatus('Select a storefront with a saved handle first.', 'err'); return; }
  const range = parseRangeInput(document.getElementById('bulkRangeInput').value);
  if(!range){ setBulkStatus('Enter a range like 153800-153900, or a comma-separated list of order numbers.', 'err'); return; }

  document.getElementById('bulkResultsPanel').style.display = 'none';
  setBulkStatus('Scanning…');

  const MAX_PAGES = 6;
  let url = `https://admin.shopify.com/store/${handle}/orders.json?status=any&limit=250`;
  let totalScanned = 0, pagesFetched = 0;
  let minSeen = null, maxSeen = null;
  const matches = [];

  try{
    while(url && pagesFetched < MAX_PAGES){
      const {orders, nextUrl} = await fetchOrdersPageWithFallback(url);
      pagesFetched++;
      totalScanned += orders.length;
      console.log(`[bulk scan] page ${pagesFetched}: ${orders.length} orders, ${orders[0]?.name || '?'} .. ${orders[orders.length-1]?.name || '?'}, next=${nextUrl || '(none)'}`);
      for(const order of orders){
        if(orderMatchesRange(order, range)) matches.push(order);
        const n = extractOrderNameNumber(order) ?? order.order_number;
        if(typeof n === 'number'){
          if(minSeen === null || n < minSeen) minSeen = n;
          if(maxSeen === null || n > maxSeen) maxSeen = n;
        }
      }
      if(orders.length){
        const minOnPage = pageMinNameNumber(orders);
        if(range.mode === 'range' && minOnPage !== null && minOnPage < range.min) break; // older pages can't contain anything in range
      }
      url = nextUrl;
      setBulkStatus(`Scanning… ${totalScanned} orders checked across ${pagesFetched} page(s)`);
    }
  }catch(err){
    setBulkStatus('Scan failed — ' + (err.message || 'unknown error') + '. If single-order lookup works fine on this store, this may be specific to the order-list endpoint — try again, or check you\'re logged into this store.', 'err');
    return;
  }

  const flagged = matches.map(order => ({order, notes: generateAutoNotes(order)}))
    .filter(r => r.notes.some(n=>n.level==='flag'));

  const coverageNote = (minSeen !== null && maxSeen !== null)
    ? ` Covered order numbers ${maxSeen} down to ${minSeen}${pagesFetched >= MAX_PAGES ? ' (hit the page cap — older orders weren\'t reachable)' : ''}.`
    : '';

  document.getElementById('bulkResultsPanel').style.display = 'block';
  document.getElementById('bulkSummary').textContent =
    `Checked ${totalScanned} recent order(s) across ${pagesFetched} page(s) to find your range — ${matches.length} matched, ${flagged.length} need attention.${coverageNote}`;

  const list = document.getElementById('bulkResultsList');
  list.innerHTML = '';
  if(!flagged.length){
    list.innerHTML = '<div class="empty-state">Nothing flagged in this range.</div>';
  } else {
    flagged.forEach(({order, notes})=>{
      const item = document.createElement('div');
      item.className = 'diag-item';
      item.style.cursor = 'pointer';
      const summary = notes.map(n=>n.text).join(' · ');
      item.innerHTML = `
        <div class="diag-head">
          <div class="diag-title">#${order.order_number}</div>
          <span class="badge flag">Flag</span>
        </div>
        <div class="diag-summary">${summary}</div>
      `;
      item.addEventListener('click', async ()=>{
        document.getElementById('orderInput').value = `https://admin.shopify.com/store/${handle}/orders/${order.id}`;
        await handleOrderData(order);
        setStatus(`Loaded order #${order.order_number} from bulk scan.`, 'ok');
      });
      list.appendChild(item);
    });
  }

  setBulkStatus(bulkDoneMessage(flagged.length, matches.length), 'ok');
});

function renderDiagnostics(checks){
  document.getElementById('diagEmpty').style.display = 'none';
  const list = document.getElementById('diagList');
  list.innerHTML = '';
  checks.forEach((c,i)=>{
    const item = document.createElement('div');
    item.className = 'diag-item';
    item.innerHTML = `
      <div class="diag-head">
        <div class="diag-title"><span class="diag-num">${String(i+1).padStart(2,'0')}</span>${c.label}</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="badge ${c.status}">${badgeLabel(c.status)}</span>
          ${c.detail ? '<span class="chevron">▸</span>' : ''}
        </div>
      </div>
      <div class="diag-summary">${c.summary}</div>
      ${c.detail ? `<div class="diag-detail">${c.detail}</div>` : ''}
    `;
    if(c.detail){
      item.querySelector('.diag-head').addEventListener('click', ()=> item.classList.toggle('expanded'));
    }
    list.appendChild(item);
  });
}

let currentOrderData = null;

async function handleOrderData(order, opts){
  currentOrderData = order;
  document.getElementById('jsonPanel').style.display = 'block';
  document.getElementById('jsonView').innerHTML = syntaxHighlight(order);
  document.getElementById('orderMeta').textContent =
    `#${order.order_number || order.name || order.id || ''} · ${order.created_at ? order.created_at.slice(0,10) : ''}`;

  const sheetUrl = document.getElementById('sheetUrl').value.trim();
  const compliance = sheetUrl ? await getComplianceRows(sheetUrl) : null;
  renderTotStatus(order);
  renderDiagnostics(analyzeOrder(order, compliance));
  renderAutoNotes(order);
  resetLivePriceCheck();

  if(!(opts && opts.skipPersist)){
    await chrome.storage.local.set({
      [LAST_ORDER_KEY]: {
        order,
        orderInputValue: document.getElementById('orderInput').value,
        domainIdx: document.getElementById('domainSelect').value
      }
    });
  }
}

async function init(){
  CONFIG = await loadConfig();
  renderDomainSelect();
  renderCfgTable();

  WC_CONFIG = await wcLoadConfig();
  wcRenderDomainSelect();
  wcRenderCfgTable();

  const sheetInput = document.getElementById('sheetUrl');
  const stored = await chrome.storage.local.get([SHEET_KEY]);
  sheetInput.value = stored[SHEET_KEY] || DEFAULT_SHEET_URL;
  if(!stored[SHEET_KEY]) chrome.storage.local.set({[SHEET_KEY]: DEFAULT_SHEET_URL});
  sheetInput.addEventListener('input', ()=> chrome.storage.local.set({[SHEET_KEY]: sheetInput.value.trim()}));

  // WooCommerce: independent of Shopify/BigCommerce detection below — a WooCommerce store's
  // domain can't match either platform's URL patterns, so no coordination needed between them.
  const wcDetected = await detectCurrentWooCommerceOrderTab();
  if(wcDetected){
    switchPlatformTab('woocommerce');
    document.getElementById('wcDomainSelect').value = wcDetected.rowIdx;
    wcUpdateSystemHint();
    document.getElementById('wcOrderId').value = wcDetected.orderId;
    await runWcTest();
  }

  // Experimental: if the current tab is a BigCommerce order search-results page, prefill and
  // auto-run the permission test. Independent of the Shopify flow below — URL patterns can't
  // overlap between the two platforms, so no coordination needed between them.
  const bcDetected = await detectCurrentBigCommerceOrderTab();
  if(bcDetected){
    switchPlatformTab('bigcommerce');
    document.getElementById('bcSubdomain').value = bcDetected.sub;
    document.getElementById('bcOrderId').value = bcDetected.orderId;
    await runBcTest();
  }

  // Auto-select the storefront dropdown from whatever store admin the current tab is on —
  // any page under admin.shopify.com/store/{handle}, not just an order page. This means
  // bulk scan (and anything else keyed off the dropdown) can't silently point at the wrong
  // store just because the dropdown was left on whatever it was last set to.
  const currentHandle = await detectCurrentTabStoreHandle();
  if(currentHandle){
    const idx = CONFIG.findIndex(r => r.handle === currentHandle);
    if(idx >= 0){
      document.getElementById('domainSelect').value = idx;
      updateHandleHint();
    }
  }

  // If that tab is specifically an order page, prefill from it and auto-fetch — this takes
  // priority over restoring the last order, since it reflects current intent.
  const detected = await detectCurrentOrderTab();
  if(detected){
    document.getElementById('orderInput').value = detected.url;
    document.getElementById('orderInput').dispatchEvent(new Event('input', {bubbles:true}));
    await fetchOrder();
    return;
  }

  // Otherwise, restore the last order looked at, since Chrome discards popup state entirely on
  // blur — but only if it belongs to the store currently open, to avoid showing stale data from
  // a different storefront than the one the dropdown now points at.
  const last = await chrome.storage.local.get([LAST_ORDER_KEY]);
  const saved = last[LAST_ORDER_KEY];
  if(saved && saved.order){
    const savedRow = CONFIG[saved.domainIdx];
    const mismatchedStore = currentHandle && savedRow && savedRow.handle !== currentHandle;
    if(mismatchedStore){
      setStatus(`On ${currentHandle}'s admin — not restoring the last viewed order since it was from a different store.`, 'ok');
    } else {
      document.getElementById('orderInput').value = saved.orderInputValue || '';
      if(!currentHandle && saved.domainIdx !== undefined && CONFIG[saved.domainIdx]){
        document.getElementById('domainSelect').value = saved.domainIdx;
        updateHandleHint();
      }
      document.getElementById('pasteArea').value = JSON.stringify(saved.order, null, 2);
      await handleOrderData(saved.order, {skipPersist:true});
      setStatus('Restored last order (popup state resets when it loses focus).', 'ok');
    }
  }
}

async function detectCurrentTabStoreHandle(){
  try{
    const tabs = await chrome.tabs.query({active:true, currentWindow:true});
    const tabUrl = tabs && tabs[0] && tabs[0].url;
    if(!tabUrl) return null;
    const m = tabUrl.match(/admin\.shopify\.com\/store\/([a-zA-Z0-9\-]+)/);
    return m ? m[1] : null;
  }catch(e){
    return null;
  }
}

async function detectCurrentOrderTab(){
  try{
    const tabs = await chrome.tabs.query({active:true, currentWindow:true});
    const tabUrl = tabs && tabs[0] && tabs[0].url;
    if(!tabUrl) return null;
    const m = tabUrl.match(/admin\.shopify\.com\/store\/([a-zA-Z0-9\-]+)\/orders\/(\d+)/);
    if(!m) return null;
    return {url: tabUrl, handle: m[1], orderId: m[2]};
  }catch(e){
    return null; // no tab access (e.g. opened via Full view, or permission not granted for this host)
  }
}

// The side panel persists across tab switches (unlike a popup), so if the user switches to a
// different store's admin tab while it's open, keep the dropdown in sync rather than leaving
// it pointed at whatever store was active when the panel first opened.
async function syncDropdownToActiveTab(){
  const currentHandle = await detectCurrentTabStoreHandle();
  if(!currentHandle) return;
  const select = document.getElementById('domainSelect');
  const currentRow = CONFIG[select.value];
  if(currentRow && currentRow.handle === currentHandle) return; // already correct
  const idx = CONFIG.findIndex(r => r.handle === currentHandle);
  if(idx >= 0){
    select.value = idx;
    updateHandleHint();
    setStatus(`Storefront switched to match the current tab (${currentHandle}).`, 'ok');
  }
}
if(chrome.tabs && chrome.tabs.onActivated){
  chrome.tabs.onActivated.addListener(()=> syncDropdownToActiveTab());
}
if(chrome.tabs && chrome.tabs.onUpdated){
  chrome.tabs.onUpdated.addListener((tabId, changeInfo)=>{ if(changeInfo.url) syncDropdownToActiveTab(); });
}

// ---- BigCommerce diagnostics (beta) ----
let currentBcOrder = null; // {sub, parsed} — set after a successful order fetch, used by the on-demand product & price check

function setBcStatus(msg, type, isHtml){
  const statusEl = document.getElementById('bcStatus');
  if(isHtml) statusEl.innerHTML = msg; else statusEl.textContent = msg;
  statusEl.className = 'status-line show' + (type ? ' '+type : '');
}

async function fetchBcHtml(url, extraHeaders){
  const res = await fetch(url, {credentials:'include', headers: extraHeaders || {}});
  if(!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}

// The order-list search page returns a full HTML page containing a table row for the matched
// order, with its status <select> — same page shape as the store's main "View orders" screen.
function bcParseStatus(listHtml, orderId){
  const doc = new DOMParser().parseFromString(listHtml, 'text/html');
  const select = doc.querySelector(`#status_${orderId}`) || doc.querySelector('select.status-select');
  if(!select) return null;
  const opt = select.options[select.selectedIndex];
  return opt ? opt.textContent.trim() : null;
}

// Reads a <dd> immediately following a <dt> whose visible label text matches, e.g. "Payment Method".
function bcGetDdByLabel(doc, labelText){
  const dts = doc.querySelectorAll('dt');
  for(const dt of dts){
    if(dt.textContent.trim().toLowerCase().includes(labelText.toLowerCase())){
      const sib = dt.nextElementSibling;
      if(sib && sib.tagName === 'DD') return sib.textContent.trim();
    }
  }
  return null;
}

function bcExtractStateFromAddressText(text){
  if(!text) return null;
  // Some stores render city/state/zip on separate lines (via <br>-separated text nodes with
  // real whitespace between them in the source) rather than one combined "City, State Zip"
  // line — confirmed via a real order where this caused "could not read state" despite the
  // address clearly showing one. Normalizing all whitespace into single spaces first means the
  // pattern can be found regardless of how the original markup broke it into lines.
  const normalized = text.replace(/\s+/g, ' ').trim();
  const m = normalized.match(/,\s*([A-Za-z][A-Za-z\s]*?)\s+(\d{5})(-\d{4})?\b/);
  if(!m) return null;
  const token = m[1].trim();
  if(STATE_ABBR_TO_NAME[token.toUpperCase()]) return STATE_ABBR_TO_NAME[token.toUpperCase()];
  const fullMatch = Object.values(STATE_ABBR_TO_NAME).find(name => name.toLowerCase() === token.toLowerCase());
  return fullMatch || null;
}

// Parses the order-details quick-view fragment: line items, excise tax line, ship-to state, payment method.
function bcParseDetails(detailsHtml){
  const doc = new DOMParser().parseFromString(detailsHtml, 'text/html');

  const lineItems = [...doc.querySelectorAll('dl.qview-product')].map(dl=>{
    const nameEl = dl.querySelector('.qview-product-name a');
    const totalEl = dl.querySelector('.qview-product-total');
    const qtyNote = dl.querySelector('.qview-product-name .note');
    const qtyMatch = qtyNote ? qtyNote.textContent.trim().match(/^(\d+)\s*x$/i) : null;
    const brandEl = dl.querySelector('.product-brand');
    const brand = brandEl ? brandEl.textContent.replace(/Brand:/i, '').trim() : null;
    let sku = null;
    const dts = dl.querySelectorAll('dt');
    for(const dt of dts){
      if(dt.textContent.trim().toLowerCase().includes('product sku')){
        const sib = dt.nextElementSibling;
        if(sib && sib.tagName === 'DD') sku = sib.textContent.trim();
        break;
      }
    }
    return {
      name: nameEl ? nameEl.textContent.trim() : (dl.querySelector('.qview-product-name')?.textContent.trim() || null),
      total: totalEl ? totalEl.textContent.trim() : null,
      sku,
      brand,
      qty: qtyMatch ? parseInt(qtyMatch[1],10) : null,
      raw: dl.textContent
    };
  });

  const exciseItem = lineItems.find(li => (li.sku||'').toUpperCase() === 'TOT_EXCISE_TAX' || /excise tax/i.test(li.name||''));
  let exciseState = null;
  if(exciseItem){
    const m = (exciseItem.name||'').match(/^([A-Za-z]{2})\s+Excise Tax$/i);
    if(m) exciseState = STATE_ABBR_TO_NAME[m[1].toUpperCase()] || null;
  }

  const shipAddrEl = doc.querySelector('[id^="qview-shippingaddress-"]');
  const shipState = bcExtractStateFromAddressText(shipAddrEl ? shipAddrEl.textContent : '');
  const billAddrEl = doc.querySelector('[id^="qview-billingaddress-"]');
  const billState = bcExtractStateFromAddressText(billAddrEl ? billAddrEl.textContent : '');

  const paymentMethod = bcGetDdByLabel(doc, 'Payment Method');
  const orderNumMatch = (doc.querySelector('h2')?.textContent || '').match(/#(\d+)/);

  const discountEl = doc.querySelector('.shipping-discount');
  const discountText = discountEl ? discountEl.textContent.trim() : null;

  const realItems = lineItems.filter(li => li !== exciseItem);
  const totalQty = realItems.reduce((s,li)=> s + (li.qty||0), 0);
  const brands = [...new Set(realItems.map(li=>li.brand).filter(Boolean))];

  return {
    orderNumber: orderNumMatch ? orderNumMatch[1] : null,
    lineItems,
    lineItemCount: realItems.length,
    totalQty,
    brands,
    exciseItem,
    exciseState,
    shipState,
    billState,
    paymentMethod,
    discountText
  };
}

function bcAnalyze(parsed, statusText, compliance){
  const checks = [];

  const flagStatuses = ['Manual Verification Required', 'Declined', 'Disputed'];
  const infoStatuses = ['Cancelled', 'Refunded', 'Partially Refunded'];
  checks.push({
    label: 'Order status',
    status: !statusText ? 'info' : flagStatuses.includes(statusText) ? 'flag' : infoStatuses.includes(statusText) ? 'info' : 'ok',
    summary: statusText || 'Could not read status from the order list page',
    detail: flagStatuses.includes(statusText) ? 'This status is set by TOT via API/webhook, not manually — treat it as the verification-outcome signal, similar to Shopify\'s tot-rejected/tot-not-verified tags.' : null
  });

  if(parsed.exciseItem){
    checks.push({
      label: 'Excise tax line item',
      status: 'ok',
      summary: `Present: ${parsed.exciseItem.name} — ${parsed.exciseItem.total}`,
      detail: parsed.exciseState && parsed.shipState && parsed.exciseState !== parsed.shipState
        ? `Ships to ${parsed.shipState}, but excise line is for ${parsed.exciseState} — possible jurisdiction mismatch, same pattern as Shopify's city/state name collisions.`
        : null
    });
  } else {
    const complianceRow = compliance && compliance.rows && parsed.shipState
      ? findComplianceRowByStateName(compliance.rows, parsed.shipState) : null;
    const exciseText = complianceRow ? (complianceRow[9] || '').trim() : null;
    const looksLikeExciseRequired = exciseText && !/^(n\/a|none|no excise)/i.test(exciseText);
    checks.push({
      label: 'Excise tax line item',
      status: looksLikeExciseRequired ? 'flag' : 'info',
      summary: looksLikeExciseRequired
        ? `No excise line item, but ${parsed.shipState}'s compliance entry lists excise tax detail`
        : parsed.shipState ? `No excise line item — no compliance data suggesting ${parsed.shipState} requires it` : 'No excise line item, and no ship-to state to cross-check',
      detail: looksLikeExciseRequired ? `Compliance sheet entry for ${parsed.shipState}: ${exciseText}` : null
    });
  }

  const gateway = (parsed.paymentMethod || '').toLowerCase();
  const unusualGateway = ['manual', 'cash on delivery', 'cod', 'bogus'].some(k => gateway.includes(k));
  checks.push({
    label: 'Payment method',
    status: !parsed.paymentMethod ? 'info' : unusualGateway ? 'flag' : 'ok',
    summary: parsed.paymentMethod || 'Not found in order details',
    detail: unusualGateway ? 'Non-standard payment method — worth confirming this order went through the normal checkout flow.' : null
  });

  const bothAddrKnown = parsed.shipState && parsed.billState;
  const addrMismatch = bothAddrKnown && parsed.shipState !== parsed.billState;
  checks.push({
    label: 'Address mismatch',
    status: !bothAddrKnown ? 'info' : addrMismatch ? 'flag' : 'ok',
    summary: !bothAddrKnown ? 'Could not read both billing and shipping state'
      : addrMismatch ? `Ship-to state (${parsed.shipState}) differs from bill-to (${parsed.billState})`
      : `Ship-to and bill-to both resolve to ${parsed.shipState}`,
    detail: null
  });

  checks.push({
    label: 'Coupons / discounts',
    status: parsed.discountText ? 'flag' : 'ok',
    summary: parsed.discountText ? `Discount applied: ${parsed.discountText}` : 'No discount code detected',
    detail: parsed.discountText ? 'Only shipping-level coupon codes are detected reliably — product-level line-item discounts may render differently and aren\'t confirmed checked here.' : null
  });

  const bigCart = parsed.lineItemCount > 15 || parsed.totalQty > 50;
  checks.push({
    label: 'Cart size / SKU count',
    status: bigCart ? 'flag' : 'ok',
    summary: `${parsed.lineItemCount} line item(s), ${parsed.totalQty} unit(s) total`,
    detail: bigCart ? 'Larger carts occasionally hit per-line-item limits or timeouts in third-party tax calculation apps.' : null
  });

  checks.push({
    label: 'Vendor / product specific',
    status: 'info',
    summary: parsed.brands.length ? `Brands on this order: ${parsed.brands.join(', ')}` : 'No brand field found on line items',
    detail: null
  });

  return checks;
}

function bcGenerateNotes(parsed, statusText, checks){
  const notes = [];
  const flagStatuses = ['Manual Verification Required', 'Declined', 'Disputed'];
  if(flagStatuses.includes(statusText)){
    notes.push({level:'flag', text:`Status: ${statusText}`});
  }
  checks.forEach(c=>{
    if(c.status === 'flag' && c.label !== 'Order status') notes.push({level:'flag', text:`${c.label}: ${c.summary}`});
  });
  return notes;
}

function badgeLabelBc(status){ return badgeLabel(status); }

// Shared wording for bulk scan completion, used by both Shopify and BigCommerce — avoids the
// confusing "0 of 6 matched orders flagged" framing, which read like something was incomplete
// rather than "checked and found nothing wrong."
function bulkDoneMessage(flaggedCount, matchedCount){
  if(matchedCount === 0) return 'Done — no orders matched in this range.';
  if(flaggedCount === 0) return `Done — no issues found across ${matchedCount} matched order(s).`;
  return `Done — ${flaggedCount} of ${matchedCount} order(s) flagged, listed below.`;
}

function bcRenderStatus(parsed, statusText, checks){
  const panel = document.getElementById('bcStatusPanel');
  const list = document.getElementById('bcStatusList');
  panel.style.display = 'block';
  const statusCheck = checks.find(c=>c.label==='Order status');
  const exciseCheck = checks.find(c=>c.label==='Excise tax line item');
  const row = (label, check) => `
    <div class="diag-summary" style="padding:3px 0;display:flex;align-items:center;gap:8px;">
      <span class="badge ${check.status}">${badgeLabelBc(check.status)}</span>
      <span><strong>${label}:</strong> ${check.summary}</span>
    </div>`;
  list.innerHTML = row('Verification', statusCheck) + row('Excise tax', exciseCheck);
}

function bcRenderDiagnostics(checks){
  const list = document.getElementById('bcDiagList');
  document.getElementById('bcDiagEmpty').style.display = 'none';
  list.innerHTML = '';
  checks.forEach((c,i)=>{
    const item = document.createElement('div');
    item.className = 'diag-item';
    item.innerHTML = `
      <div class="diag-head">
        <div class="diag-title"><span class="diag-num">${String(i+1).padStart(2,'0')}</span>${c.label}</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="badge ${c.status}">${badgeLabelBc(c.status)}</span>
          ${c.detail ? '<span class="chevron">▸</span>' : ''}
        </div>
      </div>
      <div class="diag-summary">${c.summary}</div>
      ${c.detail ? `<div class="diag-detail">${c.detail}</div>` : ''}
    `;
    if(c.detail){
      item.querySelector('.diag-head').addEventListener('click', ()=> item.classList.toggle('expanded'));
    }
    list.appendChild(item);
  });
}

function bcRenderNotes(notes, orderNumber){
  const panel = document.getElementById('bcNotesPanel');
  if(!notes.length){ panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  document.getElementById('bcNotesList').innerHTML = notes.map(n=>`
    <div class="diag-summary" style="padding:2px 0;">
      <span class="badge ${n.level}" style="margin-right:6px;">${badgeLabelBc(n.level)}</span>${n.text}
    </div>`).join('');
  const emoji = notes.some(n=>n.level==='flag') ? ':bangbang:' : ':+1:';
  document.getElementById('bcSlackNoteLine').value = `${orderNumber}: Status: [${emoji}] - ${notes.map(n=>n.text).join(' - ')}`;
}

document.getElementById('bcCopyNoteBtn').addEventListener('click', async ()=>{
  try{
    await navigator.clipboard.writeText(document.getElementById('bcSlackNoteLine').value);
    setBcStatus('Copied monitoring note to clipboard.', 'ok');
  }catch(e){
    setBcStatus('Could not copy automatically — select the text and copy manually.', 'err');
  }
});

document.getElementById('bcClearBtn').addEventListener('click', ()=>{
  document.getElementById('bcOrderId').value = '';
  document.getElementById('bcStatusPanel').style.display = 'none';
  document.getElementById('bcDiagList').innerHTML = '';
  document.getElementById('bcDiagEmpty').style.display = 'block';
  document.getElementById('bcNotesPanel').style.display = 'none';
  document.getElementById('bcRawPanel').style.display = 'none';
  document.getElementById('bcProductPanel').style.display = 'none';
  document.getElementById('bcProductResults').innerHTML = '';
  currentBcOrder = null;
  setBcStatus('Cleared.', 'ok');
});

async function runBcTest(){
  const sub = document.getElementById('bcSubdomain').value.trim();
  const orderId = document.getElementById('bcOrderId').value.trim();
  if(!sub || !orderId){ setBcStatus('Enter both the store subdomain and an order ID.', 'err'); return; }

  setBcStatus('Fetching order details and status…');
  ['bcStatusPanel','bcNotesPanel','bcRawPanel','bcProductPanel'].forEach(id=>document.getElementById(id).style.display='none');
  document.getElementById('bcDiagList').innerHTML = '';
  document.getElementById('bcDiagEmpty').style.display = 'block';
  document.getElementById('bcProductResults').innerHTML = '';
  currentBcOrder = null;

  try{
    const detailsUrl = `https://${sub}.mybigcommerce.com/admin/order/${orderId}/details`;
    const listUrl = `https://${sub}.mybigcommerce.com/admin/index.php?searchId=${orderId}&ToDo=viewOrders&orderFrom=${orderId}&orderTo=${orderId}`;

    const [detailsHtml, listHtml] = await Promise.all([
      fetchBcHtml(detailsUrl, {'X-Requested-With':'XMLHttpRequest'}),
      fetchBcHtml(listUrl)
    ]);

    const parsed = bcParseDetails(detailsHtml);
    const statusText = bcParseStatus(listHtml, orderId);

    const sheetUrl = document.getElementById('sheetUrl').value.trim();
    const compliance = sheetUrl ? await getComplianceRows(sheetUrl) : null;

    const checks = bcAnalyze(parsed, statusText, compliance);
    const notes = bcGenerateNotes(parsed, statusText, checks);

    bcRenderStatus(parsed, statusText, checks);
    bcRenderDiagnostics(checks);
    bcRenderNotes(notes, parsed.orderNumber || orderId);

    document.getElementById('bcProductPanel').style.display = 'block';
    currentBcOrder = {sub, parsed};

    document.getElementById('bcRawPanel').style.display = 'block';
    document.getElementById('bcResult').innerHTML =
      '--- order details fragment ---\n' + htmlSyntaxHighlight(detailsHtml.slice(0, 2000)) +
      '\n\n--- order list fragment ---\n' + htmlSyntaxHighlight(listHtml.slice(0, 2000));

    setBcStatus(`Loaded order #${parsed.orderNumber || orderId}.`, 'ok');
  }catch(err){
    setBcStatus('Fetch failed — ' + (err.message || 'unknown error') + '. Check the subdomain/order ID and that you\'re logged into this store.', 'err');
  }
}

function bcParseMoney(str){
  if(!str) return null;
  const n = parseFloat(String(str).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? null : n;
}

async function bcFetchProductById(sub, productId){
  const url = `https://${sub}.mybigcommerce.com/internalapi/v1/catalog/products/${productId}/`;
  const res = await fetch(url, {credentials:'include', headers:{'X-Requested-With':'XMLHttpRequest'}});
  if(!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  return data.data || null;
}

// The exact-SKU lookup only matches base product SKUs — it won't find a variant's SKU (e.g.
// "litty-thca-thcp-hd9-afblend-cart-1g-rainbow-cotton-candy", where the base product's real SKU
// is "litty-thca-thcp-hd9-afblend-cart-1g" and the rest is a flavor suffix). Confirmed via a real
// order: the exact lookup returns a genuine, honest zero results (not a rate limit or error) for
// variant SKUs. This fuzzy admin-search endpoint resolves a variant SKU back to its parent
// product — verified with a prefix-match safety check so a fuzzy top result isn't trusted blindly.
async function bcResolveProductViaSearch(sub, sku){
  const url = `https://${sub}.mybigcommerce.com/internalapi/v1/controlpanel/search?q=${encodeURIComponent(sku)}`;
  const res = await fetch(url, {credentials:'include', headers:{'X-Requested-With':'XMLHttpRequest'}});
  if(!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  const results = (data.data && data.data.results) || [];
  const productResult = results.find(r => r.type === 'products');
  const top = productResult && productResult.items && productResult.items[0];
  if(!top || !top.sku || !top.params || !top.params.productId) return null;
  if(!sku.toLowerCase().startsWith(top.sku.toLowerCase())) return null; // guard against a wrong fuzzy match
  return {productId: top.params.productId, baseSku: top.sku};
}

async function bcFetchProductBySku(sub, sku){
  const url = `https://${sub}.mybigcommerce.com/internalapi/v1/catalog/products/?sku=${encodeURIComponent(sku)}`;
  const res = await fetch(url, {credentials:'include', headers:{'X-Requested-With':'XMLHttpRequest'}});
  if(!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  let product = (data.data && data.data[0]) || null;

  if(!product){
    const resolved = await bcResolveProductViaSearch(sub, sku);
    if(resolved){
      product = await bcFetchProductById(sub, resolved.productId);
      if(product) console.log(`[product & price check] SKU "${sku}" resolved via search to base SKU "${resolved.baseSku}" (product ${resolved.productId})`);
    }
  }

  if(!product){
    console.log(`[product & price check] SKU "${sku}" — no match via exact lookup or search fallback.`);
  }
  return product;
}

function bcRenderProductResults(results){
  const container = document.getElementById('bcProductResults');
  container.innerHTML = '';
  results.forEach(r=>{
    const item = document.createElement('div');
    item.className = 'diag-item';
    const badgeClass = (r.priceMismatch || r.taxCodeMissing) ? 'flag' : (r.notFound ? 'info' : 'ok');
    const badgeText = r.notFound ? 'Info' : (r.priceMismatch || r.taxCodeMissing) ? 'Flag' : 'OK';
    let summary;
    if(r.notFound){
      summary = 'Product not found by SKU — may have been deleted/renamed since the order';
    } else {
      const priceLine = r.chargedUnit !== null
        ? `Charged ${r.chargedUnit.toFixed(2)} — current price ${r.currentPrice.toFixed(2)}${r.priceMismatch ? ' (differs)' : ''}`
        : 'Could not determine charged unit price';
      const taxLine = r.taxCodeMissing ? 'No product_tax_code set' : `product_tax_code: ${r.productTaxCode}`;
      summary = `${priceLine} · ${taxLine}`;
    }
    item.innerHTML = `
      <div class="diag-head">
        <div class="diag-title">${r.name || r.sku}</div>
        <span class="badge ${badgeClass}">${badgeText}</span>
      </div>
      <div class="diag-summary">${summary}</div>
    `;
    container.appendChild(item);
  });
}

document.getElementById('bcCheckProductsBtn').addEventListener('click', async ()=>{
  if(!currentBcOrder){ setBcStatus('Fetch an order first.', 'err'); return; }
  const {sub, parsed} = currentBcOrder;
  const realItems = (parsed.lineItems || []).filter(li => li !== parsed.exciseItem && li.sku);
  const uniqueSkus = [...new Set(realItems.map(li=>li.sku))];
  if(!uniqueSkus.length){ setBcStatus('No SKUs found on this order to check.', 'err'); return; }

  document.getElementById('bcProductResults').innerHTML = '';
  const btn = document.getElementById('bcCheckProductsBtn');
  const progressWrap = document.getElementById('bcProductProgressWrap');
  const progressBar = document.getElementById('bcProductProgressBar');
  btn.disabled = true;
  progressWrap.style.display = 'block';
  progressBar.style.width = '0%';

  // Sequential with a small delay, not parallel — a variant SKU (with a flavor/option suffix,
  // e.g. "...-rainbow-cotton-candy") needs a fallback search + a second fetch to resolve, so a
  // large order can mean well over one request per line item. Sequential keeps the load on
  // BigCommerce's internal API reasonable and keeps console logging readable if something fails.
  const productBySku = {};
  try{
    for(let i=0;i<uniqueSkus.length;i++){
      const sku = uniqueSkus[i];
      setBcStatus(`<span class="spinner">⟳</span> Checking product ${i+1} of ${uniqueSkus.length}…`, null, true);
      try{
        productBySku[sku] = await bcFetchProductBySku(sub, sku);
      }catch(e){
        console.log(`[product & price check] SKU "${sku}" — fetch failed:`, e.message);
        productBySku[sku] = null;
      }
      progressBar.style.width = `${Math.round(((i+1)/uniqueSkus.length)*100)}%`;
      if(i < uniqueSkus.length - 1) await new Promise(r=>setTimeout(r, 200));
    }

    const results = realItems.map(li=>{
      const product = productBySku[li.sku];
      if(!product){
        return {sku: li.sku, name: li.name, notFound: true};
      }
      const chargedTotal = bcParseMoney(li.total);
      const chargedUnit = (chargedTotal !== null && li.qty) ? chargedTotal / li.qty : null;
      const currentPrice = product.calculated_price ?? product.price ?? null;
      const priceMismatch = chargedUnit !== null && currentPrice !== null && Math.abs(chargedUnit - currentPrice) > 0.01;
      const taxCodeMissing = !product.product_tax_code || !product.product_tax_code.trim();
      return {
        sku: li.sku,
        name: product.name || li.name,
        chargedUnit,
        currentPrice,
        priceMismatch,
        productTaxCode: product.product_tax_code,
        taxCodeMissing
      };
    });

    bcRenderProductResults(results);
    const flaggedCount = results.filter(r=>r.priceMismatch || r.taxCodeMissing).length;
    setBcStatus(`Checked ${results.length} product(s), ${flaggedCount} worth a look. Price mismatches on wholesale/B2B orders may be expected (customer-specific pricing isn't visible to this check) rather than a bug.`, flaggedCount ? 'err' : 'ok');
  } finally {
    btn.disabled = false;
    progressWrap.style.display = 'none';
  }
});

document.getElementById('bcTestBtn').addEventListener('click', runBcTest);

// ---- BigCommerce bulk scan (beta) ----
function setBcBulkStatus(msg, type, isHtml){
  const el = document.getElementById('bcBulkStatus');
  if(isHtml) el.innerHTML = msg; else el.textContent = msg;
  el.className = 'status-line show' + (type ? ' '+type : '');
}

function bcParseIdRange(input){
  input = (input||'').trim();
  const m = input.match(/^(\d+)\s*-\s*(\d+)$/);
  if(!m) return null;
  const a = parseInt(m[1],10), b = parseInt(m[2],10);
  return {min: Math.min(a,b), max: Math.max(a,b)};
}

// Parses every order row's status <select> from a range-filtered order-list response —
// same underlying markup as the single-order status lookup, just many on one page.
function bcParseOrderList(listHtml){
  const doc = new DOMParser().parseFromString(listHtml, 'text/html');
  return [...doc.querySelectorAll('select[id^="status_"]')].map(sel=>{
    const orderId = sel.id.replace('status_', '');
    const opt = sel.options[sel.selectedIndex];
    return {orderId, statusText: opt ? opt.textContent.trim() : null};
  });
}

document.getElementById('bcBulkClearBtn').addEventListener('click', ()=>{
  document.getElementById('bcBulkRangeInput').value = '';
  document.getElementById('bcBulkResultsPanel').style.display = 'none';
  document.getElementById('bcBulkResultsList').innerHTML = '';
  document.getElementById('bcBulkSummary').textContent = '';
  setBcBulkStatus('Cleared.', 'ok');
});

document.getElementById('bcBulkScanBtn').addEventListener('click', async ()=>{
  const sub = document.getElementById('bcSubdomain').value.trim();
  if(!sub){ setBcBulkStatus('Enter the store subdomain in Look up order above first.', 'err'); return; }
  const range = bcParseIdRange(document.getElementById('bcBulkRangeInput').value);
  if(!range){ setBcBulkStatus('Enter a range like 768170-768173.', 'err'); return; }

  const btn = document.getElementById('bcBulkScanBtn');
  const progressWrap = document.getElementById('bcBulkProgressWrap');
  const progressBar = document.getElementById('bcBulkProgressBar');
  document.getElementById('bcBulkResultsPanel').style.display = 'none';
  btn.disabled = true;
  setBcBulkStatus('Fetching order list…');

  try{
    const listUrl = `https://${sub}.mybigcommerce.com/admin/index.php?ToDo=viewOrders&orderFrom=${range.min}&orderTo=${range.max}&limit=100`;
    const listHtml = await fetchBcHtml(listUrl);
    const orderRows = bcParseOrderList(listHtml);

    if(!orderRows.length){
      setBcBulkStatus('No orders found in that range.', 'err');
      return;
    }

    const sheetUrl = document.getElementById('sheetUrl').value.trim();
    const compliance = sheetUrl ? await getComplianceRows(sheetUrl) : null;

    progressWrap.style.display = 'block';
    progressBar.style.width = '0%';

    const flagged = [];
    for(let i=0;i<orderRows.length;i++){
      const {orderId, statusText} = orderRows[i];
      setBcBulkStatus(`<span class="spinner">⟳</span> Checking order ${i+1} of ${orderRows.length} (#${orderId})…`, null, true);
      try{
        const detailsHtml = await fetchBcHtml(
          `https://${sub}.mybigcommerce.com/admin/order/${orderId}/details`,
          {'X-Requested-With':'XMLHttpRequest'}
        );
        const parsed = bcParseDetails(detailsHtml);
        const checks = bcAnalyze(parsed, statusText, compliance);
        const notes = bcGenerateNotes(parsed, statusText, checks);
        if(notes.some(n=>n.level==='flag')){
          flagged.push({orderId, orderNumber: parsed.orderNumber || orderId, notes});
        }
      }catch(e){
        console.log(`[bulk scan] order ${orderId} failed:`, e.message);
      }
      progressBar.style.width = `${Math.round(((i+1)/orderRows.length)*100)}%`;
      if(i < orderRows.length - 1) await new Promise(r=>setTimeout(r, 200));
    }

    document.getElementById('bcBulkResultsPanel').style.display = 'block';
    document.getElementById('bcBulkSummary').textContent =
      `Checked ${orderRows.length} order(s) in range ${range.min}-${range.max} — ${flagged.length} need attention.`;

    const list = document.getElementById('bcBulkResultsList');
    list.innerHTML = '';
    if(!flagged.length){
      list.innerHTML = '<div class="empty-state">Nothing flagged in this range.</div>';
    } else {
      flagged.forEach(r=>{
        const item = document.createElement('div');
        item.className = 'diag-item';
        item.style.cursor = 'pointer';
        item.innerHTML = `
          <div class="diag-head">
            <div class="diag-title">#${r.orderNumber}</div>
            <span class="badge flag">Flag</span>
          </div>
          <div class="diag-summary">${r.notes.map(n=>n.text).join(' · ')}</div>
        `;
        item.addEventListener('click', async ()=>{
          document.getElementById('bcOrderId').value = r.orderId;
          await runBcTest();
        });
        list.appendChild(item);
      });
    }
    setBcBulkStatus(bulkDoneMessage(flagged.length, orderRows.length), flagged.length ? 'err' : 'ok');
  }catch(err){
    setBcBulkStatus('Scan failed — ' + (err.message || 'unknown error') + '. Check the subdomain and that you\'re logged into this store.', 'err');
  } finally {
    btn.disabled = false;
    progressWrap.style.display = 'none';
  }
});

// BigCommerce order pages don't have a clean /orders/{id} URL like Shopify — the tab's actual
// URL when "viewing" an order is the search-results page, with the order ID in a query param
// (orderFrom / searchId), not the path. The /admin/order/{id}/details endpoint is just an AJAX
// call fired in the background from that page, not something the browser navigates to directly.
async function detectCurrentBigCommerceOrderTab(){
  try{
    const tabs = await chrome.tabs.query({active:true, currentWindow:true});
    const tabUrl = tabs && tabs[0] && tabs[0].url;
    if(!tabUrl) return null;
    const hostMatch = tabUrl.match(/^https:\/\/([a-zA-Z0-9\-]+)\.mybigcommerce\.com\//);
    if(!hostMatch) return null;
    const sub = hostMatch[1];

    // Newer "manage" admin UI: clean path-based order ID, e.g. /manage/orders/768160
    const pathMatch = tabUrl.match(/\/manage\/orders\/(\d+)(?:[\/?#]|$)/);
    if(pathMatch) return {sub, orderId: pathMatch[1]};

    // Legacy admin UI: order ID in a query param instead (orderFrom/searchId/orderId)
    const u = new URL(tabUrl);
    const orderId = u.searchParams.get('orderFrom') || u.searchParams.get('searchId') || u.searchParams.get('orderId');
    if(!orderId) return null;
    return {sub, orderId};
  }catch(e){
    return null;
  }
}

// ---- WooCommerce (step 1: fetch + raw field display only, no diagnostics yet) ----
const WC_CONFIG_KEY = 'totWcConfig';
const WC_DEFAULT_CONFIG = [
  {domain:'vapesocietysupplies.com', system:'classic'},
  {domain:'vapedepotusa.com', system:'hpos'}
];
let WC_CONFIG = [];

async function wcLoadConfig(){
  const stored = await chrome.storage.local.get([WC_CONFIG_KEY]);
  if(stored[WC_CONFIG_KEY]) return stored[WC_CONFIG_KEY];
  return JSON.parse(JSON.stringify(WC_DEFAULT_CONFIG));
}
async function wcSaveConfig(){
  await chrome.storage.local.set({[WC_CONFIG_KEY]: WC_CONFIG});
}

function wcRenderDomainSelect(){
  const sel = document.getElementById('wcDomainSelect');
  const prev = sel.value;
  sel.innerHTML = '';
  WC_CONFIG.forEach((row,i)=>{
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = row.domain;
    sel.appendChild(opt);
  });
  if(prev && WC_CONFIG[prev]) sel.value = prev;
  wcUpdateSystemHint();
}
function wcUpdateSystemHint(){
  const i = document.getElementById('wcDomainSelect').value;
  const row = WC_CONFIG[i];
  const hint = document.getElementById('wcSystemHint');
  hint.textContent = row ? `Order system: ${row.system === 'hpos' ? 'HPOS (admin.php?page=wc-orders)' : 'Classic (post.php)'}` : '';
}

function wcRenderCfgTable(){
  const body = document.getElementById('wcCfgBody');
  body.innerHTML = '';
  WC_CONFIG.forEach((row,i)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" data-i="${i}" data-f="domain" value="${escapeAttr(row.domain)}"></td>
      <td>
        <select data-i="${i}" data-f="system" class="wc-system-select">
          <option value="classic" ${row.system==='classic'?'selected':''}>Classic</option>
          <option value="hpos" ${row.system==='hpos'?'selected':''}>HPOS</option>
        </select>
      </td>
      <td><button class="row-del" data-i="${i}" title="Remove">✕</button></td>`;
    body.appendChild(tr);
  });
  body.querySelectorAll('input[type="text"]').forEach(inp=>{
    inp.addEventListener('input', async e=>{
      const i = +e.target.dataset.i;
      WC_CONFIG[i].domain = e.target.value.trim();
      await wcSaveConfig();
      wcRenderDomainSelect();
    });
  });
  body.querySelectorAll('.wc-system-select').forEach(sel=>{
    sel.addEventListener('change', async e=>{
      const i = +e.target.dataset.i;
      WC_CONFIG[i].system = e.target.value;
      await wcSaveConfig();
      wcRenderDomainSelect();
    });
  });
  body.querySelectorAll('.row-del').forEach(btn=>{
    btn.addEventListener('click', async e=>{
      WC_CONFIG.splice(+e.target.dataset.i,1);
      await wcSaveConfig();
      wcRenderCfgTable();
      wcRenderDomainSelect();
    });
  });
}

document.getElementById('wcAddRowBtn').addEventListener('click', async ()=>{
  WC_CONFIG.push({domain:'', system:'classic'});
  await wcSaveConfig(); wcRenderCfgTable(); wcRenderDomainSelect();
});
document.getElementById('wcResetCfgBtn').addEventListener('click', async ()=>{
  if(!confirm('Reset WooCommerce storefront config to defaults?')) return;
  WC_CONFIG = JSON.parse(JSON.stringify(WC_DEFAULT_CONFIG));
  await wcSaveConfig(); wcRenderCfgTable(); wcRenderDomainSelect();
});
document.getElementById('wcDomainSelect').addEventListener('change', wcUpdateSystemHint);

function wcBuildUrl(domain, system, orderId){
  return system === 'hpos'
    ? `https://${domain}/wp-admin/admin.php?page=wc-orders&action=edit&id=${orderId}`
    : `https://${domain}/wp-admin/post.php?post=${orderId}&action=edit`;
}

// Same custom-fields postmeta editor markup confirmed present on both classic and HPOS order
// pages — WordPress's generic meta box, not something rewritten per order-storage backend.
function wcParseMetaFields(html){
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const keyInputs = doc.querySelectorAll('input[type="text"][id^="meta-"][id$="-key"]');
  const fields = [];
  keyInputs.forEach(input=>{
    const m = input.id.match(/^meta-(\d+)-key$/);
    if(!m) return;
    const rowId = m[1];
    const key = input.value;
    const valueEl = doc.getElementById(`meta-${rowId}-value`);
    const value = valueEl ? valueEl.textContent : null;
    fields.push({key, value});
  });
  return fields;
}

// Confirmed via real orders on both classic and HPOS stores: billing/shipping state and payment
// method all live in clean, structured form fields (input value / select selected option) — no
// free-text address parsing needed here, unlike BigCommerce's shipping address block.
function wcParseDetails(html){
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const fields = wcParseMetaFields(html);
  const billingState = doc.querySelector('#_billing_state')?.value || null;
  const shippingState = doc.querySelector('#_shipping_state')?.value || null;
  const paySelect = doc.querySelector('#_payment_method');
  const payOpt = paySelect ? paySelect.options[paySelect.selectedIndex] : null;
  const paymentMethod = payOpt ? {value: payOpt.value, text: payOpt.textContent.trim()} : null;
  const orderNumMatch = (doc.querySelector('title')?.textContent || '').match(/Order #?(\d+)/) ||
                         (doc.querySelector('h1')?.textContent || '').match(/#(\d+)/);
  return {
    fields, billingState, shippingState, paymentMethod,
    orderNumber: orderNumMatch ? orderNumMatch[1] : null
  };
}

function wcGetField(fields, key){
  const f = fields.find(x => x.key === key);
  return f ? f.value : undefined;
}

function wcAnalyze(parsed, compliance){
  const checks = [];
  const fields = parsed.fields;

  // Verification — only "isCleared" is a confirmed real "good" value so far. A store that has
  // none of the verification-related fields at all (like the excise-focused Vape Society Supply
  // store) simply doesn't use this module — that's informational, not a problem. But a store
  // that DOES use it (has tot_quarantined/tot_quarantine_manually_removed) and still lacks a
  // clean tot_status gets flagged — confirmed against a real quarantine-override order that
  // would've otherwise silently passed as "info" if absence of the field were always treated
  // as non-applicable.
  const totStatus = wcGetField(fields, 'tot_status');
  const totQuarantined = wcGetField(fields, 'tot_quarantined');
  const totQuarantineManuallyRemoved = wcGetField(fields, 'tot_quarantine_manually_removed');
  const hasVerificationModule = totStatus !== undefined || totQuarantined !== undefined || totQuarantineManuallyRemoved !== undefined;
  const isCleared = totStatus === 'isCleared';
  checks.push({
    label: 'Verification status',
    status: !hasVerificationModule ? 'info' : isCleared ? 'ok' : 'flag',
    summary: !hasVerificationModule
      ? 'This store doesn\'t appear to use the verification module (no tot_status/tot_quarantined fields at all)'
      : isCleared ? 'Cleared (tot_status: isCleared)' : `Not cleared${totStatus ? ` (tot_status: ${totStatus})` : ' (no tot_status set)'}`,
    detail: (hasVerificationModule && !isCleared)
      ? `tot_quarantined: ${totQuarantined === undefined ? '(not set)' : totQuarantined || '(empty)'}\ntot_quarantine_manually_removed: ${totQuarantineManuallyRemoved === undefined ? '(not set)' : totQuarantineManuallyRemoved}\nNo confirmed clean rejected/pending example yet — raw fields shown for manual judgment rather than a specific verdict.`
      : null
  });

  // Excise — confirmed via two real orders from the same store: exciseTaxStatus itself doesn't
  // distinguish collected vs. not-required (both read "RECONCILED"); totTaxCollected is the
  // actual signal.
  const totTaxCollectedRaw = wcGetField(fields, 'totTaxCollected');
  const totTaxCollected = totTaxCollectedRaw !== undefined ? parseFloat(totTaxCollectedRaw) : null;
  if(totTaxCollected !== null && totTaxCollected > 0){
    checks.push({
      label: 'Excise tax collected',
      status: 'ok',
      summary: `Collected: $${totTaxCollected.toFixed(2)}`,
      detail: null
    });
  } else {
    const stateName = parsed.shippingState ? (STATE_ABBR_TO_NAME[parsed.shippingState.toUpperCase()] || parsed.shippingState) : null;
    const complianceRow = compliance && compliance.rows && stateName
      ? findComplianceRowByStateName(compliance.rows, stateName) : null;
    const exciseText = complianceRow ? (complianceRow[9] || '').trim() : null;
    const looksLikeExciseRequired = exciseText && !/^(n\/a|none|no excise)/i.test(exciseText);
    checks.push({
      label: 'Excise tax collected',
      status: looksLikeExciseRequired ? 'flag' : 'info',
      summary: totTaxCollectedRaw === undefined
        ? 'No totTaxCollected field on this order'
        : looksLikeExciseRequired
          ? `$0 collected, but ${stateName}'s compliance entry lists excise tax detail`
          : stateName ? `$0 collected — no compliance data suggesting ${stateName} requires it` : '$0 collected, no ship-to state to cross-check',
      detail: looksLikeExciseRequired ? `Compliance sheet entry for ${stateName}: ${exciseText}` : null
    });
  }

  // Address mismatch — direct field comparison, no parsing needed (confirmed structured on both stores)
  const bothKnown = parsed.billingState && parsed.shippingState;
  const addrMismatch = bothKnown && parsed.billingState !== parsed.shippingState;
  checks.push({
    label: 'Address mismatch',
    status: !bothKnown ? 'info' : addrMismatch ? 'flag' : 'ok',
    summary: !bothKnown ? 'Could not read both billing and shipping state'
      : addrMismatch ? `Ship-to (${parsed.shippingState}) differs from bill-to (${parsed.billingState})`
      : `Ship-to and bill-to both resolve to ${parsed.shippingState}`,
    detail: null
  });

  // Payment method
  const pm = parsed.paymentMethod;
  const unusualGateway = pm && ['cod', 'other', ''].includes(pm.value);
  checks.push({
    label: 'Payment method',
    status: !pm ? 'info' : unusualGateway ? 'flag' : 'ok',
    summary: pm ? `${pm.text} (${pm.value || 'none'})` : 'Not found on this order',
    detail: unusualGateway ? 'Non-standard payment method — worth confirming this order went through the normal checkout flow.' : null
  });

  return checks;
}

function wcGenerateNotes(checks){
  return checks.filter(c => c.status === 'flag').map(c => ({level:'flag', text:`${c.label}: ${c.summary}`}));
}

function wcRenderStatus(checks){
  const panel = document.getElementById('wcStatusPanel');
  const list = document.getElementById('wcStatusList');
  panel.style.display = 'block';
  const verifCheck = checks.find(c => c.label === 'Verification status');
  const exciseCheck = checks.find(c => c.label === 'Excise tax collected');
  const row = (label, check) => `
    <div class="diag-summary" style="padding:3px 0;display:flex;align-items:center;gap:8px;">
      <span class="badge ${check.status}">${badgeLabel(check.status)}</span>
      <span><strong>${label}:</strong> ${check.summary}</span>
    </div>`;
  list.innerHTML = row('Verification', verifCheck) + row('Excise tax', exciseCheck);
}

function wcRenderDiagnostics(checks){
  const list = document.getElementById('wcDiagList');
  document.getElementById('wcDiagEmpty').style.display = 'none';
  list.innerHTML = '';
  checks.forEach((c,i)=>{
    const item = document.createElement('div');
    item.className = 'diag-item';
    item.innerHTML = `
      <div class="diag-head">
        <div class="diag-title"><span class="diag-num">${String(i+1).padStart(2,'0')}</span>${c.label}</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="badge ${c.status}">${badgeLabel(c.status)}</span>
          ${c.detail ? '<span class="chevron">▸</span>' : ''}
        </div>
      </div>
      <div class="diag-summary">${c.summary}</div>
      ${c.detail ? `<div class="diag-detail">${c.detail}</div>` : ''}
    `;
    if(c.detail){
      item.querySelector('.diag-head').addEventListener('click', ()=> item.classList.toggle('expanded'));
    }
    list.appendChild(item);
  });
}

function wcRenderNotes(notes, orderNumber){
  const panel = document.getElementById('wcNotesPanel');
  if(!notes.length){ panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  document.getElementById('wcNotesList').innerHTML = notes.map(n=>`
    <div class="diag-summary" style="padding:2px 0;">
      <span class="badge ${n.level}" style="margin-right:6px;">${badgeLabel(n.level)}</span>${n.text}
    </div>`).join('');
  const emoji = notes.some(n=>n.level==='flag') ? ':bangbang:' : ':+1:';
  document.getElementById('wcSlackNoteLine').value = `${orderNumber}: Status: [${emoji}] - ${notes.map(n=>n.text).join(' - ')}`;
}

document.getElementById('wcCopyNoteBtn').addEventListener('click', async ()=>{
  try{
    await navigator.clipboard.writeText(document.getElementById('wcSlackNoteLine').value);
    setWcStatus('Copied monitoring note to clipboard.', 'ok');
  }catch(e){
    setWcStatus('Could not copy automatically — select the text and copy manually.', 'err');
  }
});

function setWcStatus(msg, type, isHtml){
  const el = document.getElementById('wcStatus');
  if(isHtml) el.innerHTML = msg; else el.textContent = msg;
  el.className = 'status-line show' + (type ? ' '+type : '');
}

function wcRenderFields(fields){
  const panel = document.getElementById('wcFieldsPanel');
  const list = document.getElementById('wcFieldsList');
  if(!fields.length){
    panel.style.display = 'block';
    list.innerHTML = '<div class="empty-state">No custom fields found in the fetched page — parsing may need adjusting.</div>';
    return;
  }
  panel.style.display = 'block';
  list.innerHTML = fields.map(f=>`
    <div class="diag-summary" style="padding:2px 0;font-family:var(--mono);font-size:11px;">
      <strong>${f.key}</strong>: ${f.value === '' ? '<em style="color:var(--muted);">(empty)</em>' : f.value}
    </div>
  `).join('');
}

document.getElementById('wcClearBtn').addEventListener('click', ()=>{
  document.getElementById('wcOrderId').value = '';
  document.getElementById('wcStatusPanel').style.display = 'none';
  document.getElementById('wcDiagList').innerHTML = '';
  document.getElementById('wcDiagEmpty').style.display = 'block';
  document.getElementById('wcNotesPanel').style.display = 'none';
  document.getElementById('wcFieldsPanel').style.display = 'none';
  document.getElementById('wcFieldsList').innerHTML = '';
  setWcStatus('Cleared.', 'ok');
});

async function runWcTest(){
  const i = document.getElementById('wcDomainSelect').value;
  const row = WC_CONFIG[i];
  const orderId = document.getElementById('wcOrderId').value.trim();
  if(!row || !row.domain){ setWcStatus('Select (or add) a storefront domain first.', 'err'); return; }
  if(!orderId){ setWcStatus('Enter an order ID.', 'err'); return; }

  const url = wcBuildUrl(row.domain, row.system, orderId);
  setWcStatus(`Fetching ${url} …`);
  ['wcStatusPanel','wcNotesPanel','wcFieldsPanel'].forEach(id=>document.getElementById(id).style.display='none');
  document.getElementById('wcDiagList').innerHTML = '';
  document.getElementById('wcDiagEmpty').style.display = 'block';

  try{
    const res = await fetch(url, {credentials:'include'});
    if(res.status === 401 || res.status === 403){
      setWcStatus(`Not authenticated for this store (${res.status}). Log into ${row.domain}'s wp-admin first, then try again.`, 'err');
      return;
    }
    if(!res.ok){
      setWcStatus(`Request returned ${res.status}. Check the domain, order system setting, and order ID.`, 'err');
      return;
    }
    const html = await res.text();
    const parsed = wcParseDetails(html);

    const sheetUrl = document.getElementById('sheetUrl').value.trim();
    const compliance = sheetUrl ? await getComplianceRows(sheetUrl) : null;

    const checks = wcAnalyze(parsed, compliance);
    const notes = wcGenerateNotes(checks);

    wcRenderStatus(checks);
    wcRenderDiagnostics(checks);
    wcRenderNotes(notes, parsed.orderNumber || orderId);
    wcRenderFields(parsed.fields);

    setWcStatus(`Loaded order ${parsed.orderNumber || orderId} from ${row.domain}.`, 'ok');
  }catch(err){
    setWcStatus('Fetch failed — ' + (err.message || 'unknown error') + '. Check the domain is covered by host_permissions in manifest.json and the extension was reloaded after adding it.', 'err');
  }
}

document.getElementById('wcTestBtn').addEventListener('click', runWcTest);

// WooCommerce order-edit URLs are keyed by domain + system, both of which vary per self-hosted
// store — detection checks the current tab's hostname against configured domains, then matches
// whichever URL pattern (classic or HPOS) that store is configured for.
async function detectCurrentWooCommerceOrderTab(){
  try{
    const tabs = await chrome.tabs.query({active:true, currentWindow:true});
    const tabUrl = tabs && tabs[0] && tabs[0].url;
    if(!tabUrl) return null;
    const u = new URL(tabUrl);
    const rowIdx = WC_CONFIG.findIndex(r => r.domain && u.hostname === r.domain);
    if(rowIdx < 0) return null;
    const row = WC_CONFIG[rowIdx];
    if(row.system === 'classic'){
      const m = tabUrl.match(/\/wp-admin\/post\.php\?post=(\d+)&action=edit/);
      if(m) return {rowIdx, orderId: m[1]};
    } else {
      const m = tabUrl.match(/\/wp-admin\/admin\.php\?page=wc-orders&action=edit&id=(\d+)/);
      if(m) return {rowIdx, orderId: m[1]};
    }
    return null;
  }catch(e){
    return null;
  }
}

// ---- Platform tab switcher ----
function switchPlatformTab(platform){
  document.querySelectorAll('.platform-tab').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.platform === platform);
  });
  document.getElementById('platformShopify').classList.toggle('active', platform === 'shopify');
  document.getElementById('platformBigCommerce').classList.toggle('active', platform === 'bigcommerce');
  document.getElementById('platformWooCommerce').classList.toggle('active', platform === 'woocommerce');
}
document.querySelectorAll('.platform-tab').forEach(btn=>{
  btn.addEventListener('click', ()=> switchPlatformTab(btn.dataset.platform));
});

init();
