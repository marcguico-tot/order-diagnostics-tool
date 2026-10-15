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
    const res = await fetch(url, {credentials:'include'});
    console.log('[TOT DEBUG] compliance fetch status:', res.status, res.url);
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    console.log('[TOT DEBUG] first 300 chars of response:', text.slice(0,300));
    const parsedRows = parseCSV(text);
    console.log('[TOT DEBUG] parsed row count:', parsedRows.length, 'row 2 (first data row):', parsedRows[2], 'row 53 (should be Wisconsin):', parsedRows[53]);
    complianceCache = {url, rows: parsedRows, error:null};
  }catch(e){
    console.log('[TOT DEBUG] fetch threw:', e);
    complianceCache = {url, rows:null, error: e.message || 'fetch failed'};
  }
  return complianceCache;
}

function findComplianceRow(rows, order){
  if(!rows) return null;
  const ship = order.shipping_address;
  if(!ship) return null;
  // Try converting province_code to its canonical full name first (most reliable). If that's
  // missing/empty, also try converting the free-text province field AS an abbreviation before
  // assuming it's already a full name — some orders populate province with the 2-letter code
  // itself rather than the full name, with province_code left empty. Only fall back to using
  // province literally if neither conversion path applies. Confirmed as a real false-negative
  // on a real order where the naive "province_code first, else province as-is" logic missed this.
  let stateName = null;
  if(ship.province_code && STATE_ABBR_TO_NAME[ship.province_code.toUpperCase()]){
    stateName = STATE_ABBR_TO_NAME[ship.province_code.toUpperCase()];
  } else if(ship.province && STATE_ABBR_TO_NAME[ship.province.toUpperCase()]){
    stateName = STATE_ABBR_TO_NAME[ship.province.toUpperCase()];
  } else if(ship.province){
    stateName = ship.province;
  } else if(ship.province_code){
    stateName = ship.province_code;
  }
  if(!stateName) return null;
  console.log('[TOT DEBUG] ship.province_code:', ship.province_code, 'ship.province:', ship.province, '-> resolved stateName:', stateName);
  const result = findComplianceRowByStateName(rows, stateName);
  console.log('[TOT DEBUG] match found?', !!result, result);
  return result;
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

// Gives immediate feedback right on the button that was clicked (label flips to
// "Copied ✓" for a moment) instead of relying solely on a status line that may be
// scrolled out of view — e.g. #fetchStatus sits near the top of the panel, far from
// the Order JSON section's Copy button further down.
function flashCopied(btn, label){
  if(!btn) return;
  if(btn._copyTimeout) clearTimeout(btn._copyTimeout);
  if(!btn.dataset.originalLabel) btn.dataset.originalLabel = btn.textContent;
  btn.textContent = label || 'Copied ✓';
  btn.classList.add('copied');
  btn.disabled = true;
  btn._copyTimeout = setTimeout(()=>{
    btn.textContent = btn.dataset.originalLabel;
    btn.classList.remove('copied');
    btn.disabled = false;
  }, 1400);
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

document.getElementById('copyJsonBtn').addEventListener('click', async (evt)=>{
  if(!currentOrderData){ setStatus('No order loaded yet.', 'err'); return; }
  const btn = evt.currentTarget; // capture before the await — currentTarget is null once dispatch finishes
  try{
    await navigator.clipboard.writeText(JSON.stringify(currentOrderData, null, 2));
    flashCopied(btn);
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

function analyzeOrder(order, compliance, walletType, rawTxGateways){
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

  const exciseLines = lineItems.filter(li => (li.sku||'').startsWith('TOT_TAXLINE_'));
  if(exciseLines.length > 1){
    checks.push({
      label:'Duplicate excise tax line items',
      status:'flag',
      summary:`${exciseLines.length} separate "Excise Taxes" line items found (expected 1)`,
      detail: 'Confirmed root cause (GV143343, dev ticket "Double taxing of orders when customer logs in during checkout"): '
        + 'if a customer logs into their Shopify account mid-checkout after tax was already calculated, a new cart token is '
        + 'generated and the tax app can\'t find the original excise line, so it adds a second one. Look for a refund/adjustment '
        + 'correcting the duplicate — but note the correcting refund transaction can itself fail (e.g. "Partial refunds are not '
        + 'allowed until the transaction is settled"), so don\'t assume it\'s resolved just because an adjustment exists.\n'
        + exciseLines.map(li=>`• ${li.title} — $${li.price} (SKU ${li.sku}, fulfillment_status: ${li.fulfillment_status||'null'})`).join('\n')
    });
  }

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

  // Tax exemption flag — surfaces order.tax_exempt (and customer.tax_exempt, if present)
  // directly. Informational only: originally added as a flag on the hypothesis that TOT's
  // excise tax engine might key off this same Shopify field to decide whether to skip excise tax.
  // That hypothesis was tested and disproven on order MMS1099 (2026-08-06) — TOT's own HQ
  // excise-tax-calculator trace showed customerExemption.isExempt: false (correctly determined,
  // independently of Shopify) even though this Shopify customer had tax_exempt: true, and TOT
  // still correctly calculated $40.26 owed. So Shopify's tax_exempt and TOT's own excise
  // exemption tracking are separate, unrelated fields — this flag being true doesn't predict or
  // explain an excise tax miss. Kept visible since it's still a real, occasionally-useful fact
  // about the customer/order (e.g. for native sales-tax troubleshooting), just not evidence of
  // this class of bug.
  const orderTaxExempt = order.tax_exempt === true;
  const customerTaxExempt = !!(order.customer && order.customer.tax_exempt === true);
  if(orderTaxExempt || customerTaxExempt){
    checks.push({
      label:'Tax exemption flag',
      status:'info',
      summary: orderTaxExempt ? 'order.tax_exempt is true on this order' : "Customer is marked tax_exempt (order.tax_exempt itself is false/absent)",
      detail: `This is Shopify's own tax_exempt field, unrelated to TOT's excise tax exemption tracking — confirmed independent on order MMS1099 (2026-08-06), where TOT's HQ excise-tax-calculator trace showed customerExemption.isExempt: false (correctly, and used in a correct $40.26 calculation) despite this same Shopify flag being true. Shown here as a fact about the customer/order, not as an explanation for a missed excise tax.\norder.tax_exempt: ${order.tax_exempt}, customer.tax_exempt: ${order.customer ? order.customer.tax_exempt : 'n/a (no customer object)'}`
    });
  }

  const editedItems = lineItems.filter(li => li.current_quantity !== undefined && li.current_quantity !== li.quantity);
  const refunds = order.refunds || [];
  const wasModified = editedItems.length>0 || refunds.length>0;

  // Gap found 2026-09-08 on fistdistro.com order 5280: this order's own Timeline showed two
  // "[staff] edited this order" entries (Shopify's Order Editor — added/changed line items,
  // adjusted pricing, etc.), but this check still reported "OK — no edits or refunds detected."
  // Root cause: this check only ever looks at two REST fields — line_items[].current_quantity
  // (which only moves on a refund/removal) and order.refunds — and Order Editor changes don't
  // necessarily touch either one (e.g. adding a new line item, or a price adjustment, moves
  // neither). The Timeline/edit-history itself isn't in this payload at all: fetchOrderById()
  // above rides the admin session's own order.json (the classic REST-shaped Order resource),
  // and that resource has never carried timeline/comment-event data — that's a GraphQL-only
  // view (Order.events) that would need a separate authenticated call with its own scope, which
  // this tool doesn't currently request (by design — everything else here rides the existing
  // session instead of requiring separate API credentials).
  //
  // Until that GraphQL upgrade happens, order.updated_at is the best proxy available in data we
  // already have: it moves on real edits even when current_quantity/refunds don't. It's noisy on
  // its own (fulfillment/tag/note/risk-analysis writes bump it too), so this is deliberately kept
  // to 'info' (not 'flag') and only surfaces when nothing more precise already fired, with a
  // >1hr gap from creation to avoid flagging near-immediate automated post-processing. It cannot
  // say what changed — only that something did — so the fix is still "go look at the Timeline,"
  // not a replacement for the real fix (reading order.events via GraphQL).
  const createdAt = order.created_at ? new Date(order.created_at) : null;
  const updatedAt = order.updated_at ? new Date(order.updated_at) : null;
  const updateGapMs = (createdAt && updatedAt) ? (updatedAt - createdAt) : 0;
  const possiblyEditedLater = !wasModified && updateGapMs > 60*60*1000; // >1hr, arbitrary but conservative

  // 2026-09-09: tested against fistdistro.com order 5280, whose real Timeline shows two Order
  // Editor edits ~24h after creation — a gap that should trivially clear the >1hr threshold above.
  // possiblyEditedLater still came back false, meaning order.updated_at in this payload (from the
  // admin-session order.json endpoint) did NOT move to reflect those edits. So this proxy is
  // confirmed NOT reliable — updated_at apparently isn't bumped by Order Editor activity in the
  // data this tool can see, at least not in a way this endpoint returns. Downgraded to a diagnostic
  // aid rather than a detection method: created_at/updated_at are now always shown below so a
  // mismatch like this one is visible on inspection, but a real fix needs order.events via
  // GraphQL — treat 'OK' here as "nothing this check can see," not "confirmed unedited."
  const timestampNote = (createdAt && updatedAt)
    ? `created_at: ${order.created_at}, updated_at: ${order.updated_at} (gap: ${Math.round(updateGapMs/60000)}min)`
    : 'created_at/updated_at not both present on this order';

  // Status: 'flag' when real evidence was found (refund/quantity change). Otherwise always
  // 'info', never 'ok' — this check cannot confirm a clean order, only that two narrow fields
  // (order.refunds, current_quantity) didn't show anything. Confirmed 2026-09-09 on fistdistro.com
  // order 5280 that this can genuinely miss a real edit, so a green 'OK' here would overstate what
  // was actually verified. See timestampNote/detail below for what was actually checked.
  checks.push({
    label:'Order modification',
    status: wasModified ? 'flag' : 'info',
    summary: wasModified
      ? `${editedItems.length} line item(s) edited, ${refunds.length} refund(s) on record`
      : possiblyEditedLater
      ? `No refund/quantity changes on record, but order was last updated ${updatedAt.toISOString()} — ${Math.round(updateGapMs/3600000)}h after it was created`
      : 'No edits or refunds detected in the fields this check can see',
    detail: (wasModified
      ? [
          editedItems.length ? editedItems.map(li=>`• ${li.title}: qty ${li.quantity} → current ${li.current_quantity}`).join('\n') : null,
          refunds.length ? refunds.map(r=>`• Refund ${r.id} on ${r.created_at}`).join('\n') : null
        ].filter(Boolean).join('\n') + '\nTax apps sometimes calculate at original-order time and don\'t re-run on later edits.'
      : possiblyEditedLater
      ? 'This check can only see refund-driven quantity changes and order.refunds — it can\'t see Order Editor activity (added line items, price adjustments) because that lives in the order\'s Timeline/events, which this tool doesn\'t fetch. The update-time gap above is a proxy, not proof — open the order in Shopify and check its Timeline tab directly to see what actually changed. Tax apps sometimes calculate at original-order time and don\'t re-run on later edits.'
      : 'This check only sees refund-driven quantity changes (order.refunds, line_items current_quantity) and a created_at/updated_at gap over 1hr — none of that fired here. This is NOT proof the order is unedited: tested on fistdistro.com order 5280, whose Timeline showed real edits ~24h after creation that this check missed entirely (updated_at didn\'t reflect them in this payload). Always check the order\'s Timeline tab directly for anything that actually matters.'
    ) + `\n${timestampNote}`
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

  // Excise tax vs. compliance sheet — catches wrong-state geocoding on TOT's *excise* tax
  // specifically (separate from the native tax_lines check above, since TOT's injected
  // TOT_TAXLINE_ line item doesn't encode a state name in its title the way "___ State Tax"
  // does). Works backward from ground truth: does the ship-to state's compliance-sheet entry
  // say excise tax applies at all, versus whether excise tax was actually charged.
  //
  // Confirmed real-world case this would have caught: vaperanger.com order 567097775 (ship-to
  // Holden, MO) was charged $217.52 in Massachusetts excise tax; Missouri has no excise tax
  // requirement. Root cause per dev (Charlie, 2026-08-05): TOT's api/exciseTax/calculate
  // endpoint ignores `postalCode` entirely when the request has no `stateCode`, and geocodes
  // off street + city alone — landing in the wrong state. That request payload isn't visible
  // in the Shopify order JSON (the order's own shipping_address was correct throughout), so this
  // check can't detect the bug's trigger directly. It instead flags the downstream symptom —
  // excise tax charged where the ship-to state's compliance entry says none should apply —
  // which would catch this regardless of root cause, including future regressions.
  //
  // Not run during bulk scan, same as "State-specific rate config" above (would mean fetching
  // the compliance sheet per-order there) — this is single-order diagnostics only.
  const exciseLineTotal = exciseLines.reduce((s,li)=>s + num(li.price) * (li.quantity||1), 0);
  let exciseComplianceCheck = null;
  if(exciseLineTotal > 0){
    if(!shipStateName){
      exciseComplianceCheck = { label:'Excise tax vs. compliance sheet', status:'info', summary:`$${exciseLineTotal.toFixed(2)} excise tax charged, but no ship-to state to check it against`, detail:null };
    } else if(!compliance || (!compliance.rows && !compliance.error)){
      exciseComplianceCheck = { label:'Excise tax vs. compliance sheet', status:'info', summary:`$${exciseLineTotal.toFixed(2)} excise tax charged to ${shipStateName} — add a compliance sheet CSV URL below to auto-check`, detail:null };
    } else if(compliance.error){
      exciseComplianceCheck = { label:'Excise tax vs. compliance sheet', status:'info', summary:`$${exciseLineTotal.toFixed(2)} excise tax charged to ${shipStateName} — couldn't load compliance sheet to verify`, detail:null };
    } else {
      const complianceMatch = findComplianceRowByStateName(compliance.rows, shipStateName);
      const hasExciseRequirement = !!(complianceMatch && (complianceMatch[9]||'').trim());
      exciseComplianceCheck = hasExciseRequirement
        ? { label:'Excise tax vs. compliance sheet', status:'ok', summary:`$${exciseLineTotal.toFixed(2)} excise tax charged — ${shipStateName} does have an excise tax requirement on file`, detail:null }
        : {
            label:'Excise tax vs. compliance sheet',
            status:'flag',
            summary:`$${exciseLineTotal.toFixed(2)} excise tax charged, but ${shipStateName} has no excise tax requirement per the compliance sheet`,
            detail:`Same failure signature as the confirmed vaperanger.com MO/MA incident (order 567097775, 2026-08-05) — wrong-state tax resolution, not a coupon or PMD issue. The excise line item's title doesn't say which state it actually calculated for, so confirm by hand which state this amount corresponds to elsewhere in the PACT & Excise sheet.\nShip-to: ${[ship.address1, ship.city, ship.province_code, ship.zip].filter(Boolean).join(', ')}`
          };
    }
  }
  if(exciseComplianceCheck) checks.push(exciseComplianceCheck);

  const gateways = order.payment_gateway_names || [];
  const gatewayText = gateways.join(', ');
  // Name-list check: catches known DISPLAY labels. 'manual' is Shopify's own unrenamed default;
  // 'pay over the phone' added 2026-09-08 (fistdistro.com order 5280) is that store's custom
  // relabeling of the same underlying Manual Payment Methods feature.
  //
  // Tried and removed 2026-09-09: a name-agnostic supplement that checked transactions[].gateway
  // for a fixed 'manual' value, on the theory that Shopify keeps an unrenamable identifier
  // separate from the merchant's display label. Tested live on fistdistro.com order 5280:
  // transactions[].gateway came back as "Pay Over the Phone" too — the custom label propagates
  // all the way down, there's no hidden fixed value to key off. So this list will always be
  // incomplete (merchants can rename a manual payment method to anything), and the practical
  // backstop is the raw gateway name being visible in the summary line below on every order —
  // if something looks like an obviously custom/manual label, add it here. A truly name-agnostic
  // fix would need to read the store's actual Payment Settings (which manual methods are
  // configured) rather than infer it from transaction shape — a separate API surface, not
  // pursued here for the same reason the order.events/GraphQL fix wasn't: bigger lift than the
  // problem (hit once so far) currently justifies.
  const unusual = gateways.some(g => ['manual','cash on delivery (cod)','bogus','free','pay over the phone'].includes((g||'').toLowerCase()));
  const expressWalletNames = {google_pay:'Google Pay', apple_pay:'Apple Pay', shopify_pay:'Shop Pay'};
  const expressWallet = walletType && expressWalletNames[walletType];
  const paymentTerms = order.payment_terms || null; // Shopify B2B/Companies deferred-payment orders (e.g. Net 30) carry this instead of/alongside a gateway
  const paymentMethodHasFinding = !!expressWallet || unusual;
  checks.push({
    label:'Payment method',
    status: gateways.length===0 ? 'info' : (expressWallet ? 'flag' : (unusual ? 'flag' : 'ok')),
    summary: gateways.length===0
      ? (paymentTerms ? `No payment gateway recorded — expected for a deferred-payment (${paymentTerms.payment_terms_name || paymentTerms.payment_terms_type || 'net terms'}) order, see Payment terms check below` : 'No payment gateway recorded on the order')
      : expressWallet ? `Express payment detected: ${expressWallet} (via ${gatewayText})`
      : unusual ? `Non-standard gateway: ${gatewayText}`
      : `Gateway: ${gatewayText}`,
    detail: paymentMethodHasFinding
      ? [
          expressWallet
            ? 'Confirmed root cause (2026-08-03, BV147374): express payment methods (Google Pay, Apple Pay) bypass the standard Shopify checkout process, which is what the excise tax app hooks into. Orders paid this way calculate tax correctly but the tax app never gets the chance to add it to the collected total. Recommend the merchant disable express payment methods, or flag to dev for a fix on the tax app side. (Wallet type read from the order\'s Transactions API — payment_details.credit_card_wallet — not from payment_gateway_names, which only shows the processor, e.g. "authorize.net", regardless of wallet used.)'
            : 'Manual / COD / bogus / pay-over-the-phone gateways sometimes bypass the checkout flow that triggers the tax app — same underlying mechanism as the confirmed express-wallet bug (BV147374): the order completes without the standard payment-processing step the tax app hooks into. Confirm by checking whether an order using a standard gateway on this same store got a TOT_TAXLINE where this one didn\'t. If you see a gateway name here that looks like another custom manual-payment label (not yet on this tool\'s list), flag it to get it added.',
          `payment_gateway_names: [${gateways.join(', ')}] · transactions[].gateway: [${(rawTxGateways||[]).join(', ')}]`
        ].join('\n')
      : null
  });

  // Payment terms (Net 30 / B2B) — conditional, only appears when the order actually carries
  // Shopify's payment_terms object (Shopify Companies / B2B deferred-payment orders). This is a
  // genuinely different field than payment_gateway_names above and wasn't previously surfaced by
  // this tool at all, even though it's visible in the front-end (the order's Timeline shows
  // "New payment terms were added to this order" with the term name, e.g. Net 30).
  //
  // Net 30 alone has been tested and ruled out as a standalone cause of missed excise tax (dev
  // replicated the full Net 30 + Shopify Companies + "Login as Customer" workflow, 2026-08-06, and
  // tax calculated correctly both times) — so on its own this stays informational.
  //
  // 2026-08-24: escalated to a flag specifically when excise tax was actually charged on one of
  // these orders (exciseLineTotal computed above). Reason: BigCommerce's totProductBuilder.node.js
  // — read directly from source once Darrin granted Bitbucket access — shows wholesalePrice, msrp,
  // and retailPrice are all sourced from the exact same single field (variant.calculated_price).
  // TOT's BigCommerce catalog literally can't represent a customer-group/wholesale price distinct
  // from standard retail, so a B2B/wholesale order in a catalog-price-based jurisdiction is a
  // near-certain structural overcharge (or undercharge) risk on BigCommerce specifically. Whether
  // Shopify/HQ's own product-catalog build has the same limitation is unconfirmed — that logic
  // lives on HQ's backend, not in the shopify-app repo access granted so far (productSync.node.js
  // there only pushes catalog fields HQ already computed). So on a Shopify order like this one,
  // treat a hit as "worth checking the wholesale price against what tax was actually charged," not
  // as a confirmed miss the way it would be on BigCommerce.
  if(paymentTerms){
    const b2bExciseCharged = exciseLineTotal > 0;
    checks.push({
      label:'Payment terms (Net 30 / B2B)',
      status: b2bExciseCharged ? 'flag' : 'info',
      summary:`${paymentTerms.payment_terms_name || paymentTerms.payment_terms_type || 'Deferred payment terms'} on this order${paymentTerms.due_in_days!=null ? ` — due ${paymentTerms.due_in_days} days from issue` : ''}${b2bExciseCharged ? ` — $${exciseLineTotal.toFixed(2)} excise tax charged` : ''}`,
      detail: b2bExciseCharged
        ? `This is a Shopify Companies / B2B order with deferred payment terms, AND excise tax was charged on it — worth confirming the tax was computed off this customer's actual wholesale price, not the standard catalog price. Confirmed root cause on BigCommerce (totProductBuilder.node.js): wholesalePrice/msrp/retailPrice all trace back to the same single field, so TOT's catalog can't distinguish wholesale from retail pricing there. Not confirmed on Shopify/HQ's side — that build logic isn't visible in any repo access granted so far — so treat this as a lead to check, not a proven miss. (Separately, Net 30 by itself has been tested and ruled out as a standalone cause of missed excise tax — dev replicated Net 30 + Login-as-Customer on 2026-08-06 and got correct tax both times — this flag is about the wholesale-pricing angle, not Net 30 itself.)\nRaw payment_terms: ${JSON.stringify(paymentTerms)}`
        : `This is a Shopify Companies / B2B order with deferred payment terms, not a standard checkout. Net 30 alone has been tested and ruled out as a standalone cause of missed excise tax (dev replicated the full Net 30 + Login-as-Customer workflow, 2026-08-06, and tax calculated correctly both times) — shown here for correlation tracking, not as a confirmed root cause. No excise tax was charged on this order, so the wholesale-pricing angle doesn't apply here either.\nRaw payment_terms: ${JSON.stringify(paymentTerms)}`
    });
  }


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

  const exciseLineCount = (order.line_items||[]).filter(li => (li.sku||'').startsWith('TOT_TAXLINE_')).length;
  const dupeWarning = exciseLineCount > 1
    ? `\n    <div class=\"diag-summary\" style=\"padding:3px 0;display:flex;align-items:center;gap:8px;\">
      <span class=\"badge flag\">${badgeLabel('flag')}</span>
      <span><strong>Taxed twice:</strong> ${exciseLineCount} separate excise tax line items found on this order — see "Duplicate excise tax line items" below.</span>
    </div>`
    : '';

  const row = (label, meta) => `
    <div class="diag-summary" style="padding:3px 0;display:flex;align-items:center;gap:8px;">
      <span class="badge ${meta.status}">${badgeLabel(meta.status)}</span>
      <span><strong>${label}:</strong> ${meta.text}</span>
    </div>`;
  list.innerHTML = row('Verification', vMeta) + row('Excise tax', eMeta) + dupeWarning;
}

function generateAutoNotes(order, compliance){
  const lineItems = order.line_items || [];
  const notes = []; // {level:'flag'|'info', text}
  const {verification, excise} = parseTotTags(order);

  if(excise === 'incorrect'){
    notes.push({level:'flag', text:'Not charged', isExciseIncorrect:true});
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

  // Note: a tax_exempt-based note used to appear here. Removed — confirmed on order MMS1099
  // (2026-08-06) that Shopify's tax_exempt field is unrelated to TOT's own excise exemption
  // tracking, so it isn't evidence of an excise tax problem and doesn't belong in the
  // action-oriented "Worth flagging" note. Still visible, correctly downgraded to info, in the
  // Tax exemption flag diagnostics check above for anyone reviewing the full order.

  const {wrongStateTaxLines, shipStateName} = findWrongStateTaxLines(order);
  if(wrongStateTaxLines.length){
    notes.push({level:'flag', text:`Tax calculated for ${wrongStateTaxLines.join(', ')} but ships to ${shipStateName} — check for a city/place name collision`});
  }

  // Only checked when a compliance object is passed in — bulk scan intentionally skips this
  // (same documented limitation as the "State-specific rate config" diagnostics check, which
  // would mean re-fetching/matching the CSV per order). Single-order view passes it.
  if(compliance && compliance.rows && shipStateName){
    const exciseLinesForNotes = lineItems.filter(li => (li.sku||'').startsWith('TOT_TAXLINE_'));
    const exciseLineTotalForNotes = exciseLinesForNotes.reduce((s,li)=>s+num(li.price)*(li.quantity||1), 0);
    if(exciseLineTotalForNotes > 0){
      const complianceMatch = findComplianceRowByStateName(compliance.rows, shipStateName);
      const hasExciseRequirement = !!(complianceMatch && (complianceMatch[9]||'').trim());
      if(!hasExciseRequirement){
        notes.push({level:'flag', text:`$${exciseLineTotalForNotes.toFixed(2)} excise tax charged, but ${shipStateName} has no excise tax requirement on file — same signature as the confirmed vaperanger.com MO/MA wrong-state incident (order 567097775)`});
      }
    }
  }

  const gateways = (order.payment_gateway_names || []).map(g=>(g||'').toLowerCase());
  if(gateways.some(g=>g.includes('manual'))){
    notes.push({level:'flag', text:'This looks like a manual order (manual payment gateway)'});
  }
  if(gateways.some(g=>g.includes('store credit'))){
    notes.push({level:'info', text:'Store credit used as (part of) payment'});
  }

  // Net 30 alone has been tested and ruled out as a standalone cause of missed excise tax (dev
  // replicated Net 30 + Login-as-Customer, 2026-08-06, tax calculated correctly) — informational
  // by default. Escalated to a flag when excise tax was actually charged on this B2B/wholesale
  // order (2026-08-24) — see the "Payment terms (Net 30 / B2B)" diagnostics check for the full
  // reasoning (BigCommerce's confirmed single-price-field collapse, unconfirmed on Shopify/HQ's
  // own catalog build).
  if(order.payment_terms){
    const exciseLinesForB2B = lineItems.filter(li => (li.sku||'').startsWith('TOT_TAXLINE_'));
    const exciseTotalForB2B = exciseLinesForB2B.reduce((s,li)=>s+num(li.price)*(li.quantity||1), 0);
    const termsLabel = order.payment_terms.payment_terms_name || order.payment_terms.payment_terms_type || 'Deferred payment terms';
    if(exciseTotalForB2B > 0){
      notes.push({level:'flag', text:`${termsLabel} order (Shopify Companies / B2B) — $${exciseTotalForB2B.toFixed(2)} excise tax charged; worth confirming it was computed off this customer's actual wholesale price, not the standard catalog price`});
    } else {
      notes.push({level:'info', text:`${termsLabel} order (Shopify Companies / B2B)`});
    }
  }

  const refunds = order.refunds || [];
  if(refunds.length){
    notes.push({level:'info', text:`${refunds.length} refund(s) on record`});
  }

  return notes;
}

function renderAutoNotes(order, compliance){
  const notes = generateAutoNotes(order, compliance);
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
  const exciseNote = notes.find(n=>n.isExciseIncorrect);
  const otherNotes = notes.filter(n=>!n.isExciseIncorrect);
  let mainLine;
  if(exciseNote){
    // $ amount: collected tax is known (order.current_total_tax); the actual amount OWED
    // requires the HQ excise calculator (separate origin/auth, not wired in yet) — using
    // "$?.??" as an explicit placeholder rather than guessing a number.
    const collected = order.current_total_tax != null ? `$${order.current_total_tax}` : '$?.??';
    mainLine = `${orderRef} - ${collected} - Not charged`;
  } else {
    mainLine = `${orderRef}${otherNotes.length ? ' - ' + otherNotes.map(n=>n.text).join(' - ') : ''}`;
  }
  const trailingBullets = (exciseNote ? otherNotes : []).map(n=>`\n - ${n.text}`).join('');
  lineEl.value = `Status: [${emoji}] ${mainLine}${trailingBullets}`;
}

document.getElementById('copyNoteBtn').addEventListener('click', async (evt)=>{
  const btn = evt.currentTarget;
  const text = document.getElementById('slackNoteLine').value;
  try{
    await navigator.clipboard.writeText(text);
    flashCopied(btn);
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

async function fetchTransactionSignals(handle, orderId){
  const empty = {walletType:null, rawGateways:[]};
  try{
    const url = `https://admin.shopify.com/store/${handle}/orders/${orderId}/transactions.json`;
    const res = await fetch(url, {credentials:'include'});
    if(!res.ok) return empty;
    const data = await res.json();
    const txs = data.transactions || [];
    // Prefer a successful sale transaction with wallet info; wallet type lives in
    // payment_details.credit_card_wallet (e.g. "google_pay", "apple_pay", "shopify_pay").
    // Confirmed against a real transactions.json response for BV147374 (2026-08-04).
    const withWallet = txs.find(t => t.payment_details && t.payment_details.credit_card_wallet);

    // rawGateways: shown in the Payment method check's detail for transparency, not used for
    // auto-detection. Tried and removed 2026-09-09: a name-agnostic 'isManualGateway' signal that
    // checked this for a fixed 'manual' value, on the theory Shopify keeps an unrenamable
    // identifier separate from the merchant's display label. Tested live on fistdistro.com order
    // 5280: this came back as "Pay Over the Phone" too, same as payment_gateway_names — no hidden
    // fixed value to key off, the custom label propagates all the way down. Kept here only so the
    // raw value stays visible for manually spotting a new label worth adding to the name list in
    // analyzeOrder.
    const rawGateways = txs.map(t => (t.gateway || '')).filter(Boolean);

    return {
      walletType: withWallet ? withWallet.payment_details.credit_card_wallet : null,
      rawGateways
    };
  }catch(e){
    return empty; // Non-fatal — payment method check just falls back to gateway-name-only info.
  }
}

async function handleOrderData(order, opts){
  currentOrderData = order;
  document.getElementById('jsonPanel').style.display = 'block';
  document.getElementById('jsonView').innerHTML = syntaxHighlight(order);
  document.getElementById('orderMeta').textContent =
    `#${order.order_number || order.name || order.id || ''} · ${order.created_at ? order.created_at.slice(0,10) : ''}`;

  const sheetUrl = document.getElementById('sheetUrl').value.trim();
  const compliance = sheetUrl ? await getComplianceRows(sheetUrl) : null;
  const handle = currentStoreHandle();
  const txSignals = (handle && order.id) ? await fetchTransactionSignals(handle, order.id) : {walletType:null, rawGateways:[]};
  renderTotStatus(order);
  renderDiagnostics(analyzeOrder(order, compliance, txSignals.walletType, txSignals.rawGateways));
  renderAutoNotes(order, compliance);
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

// BigCommerce stores that have been switched to the newer "Orders V2" admin redirect classic
// /admin/... order URLs straight into the React-based /manage/orders UI, which serves an app
// shell — not the server-rendered search-results/order-details markup bcParseStatus,
// bcParseOrderList, and bcParseDetails all expect. Confirmed directly on a live store
// (VapeRanger, 2026-08-24): navigating to /admin/index.php?searchId=...&ToDo=viewOrders landed
// on /manage/orders?viewId=... instead. Left unchecked, that HTML still parses "successfully" —
// every selector below just comes back empty/null, which upstream code was reading as a clean
// "nothing here" rather than "this store couldn't be read at all." fetch() exposes the
// post-redirect URL as res.url (standard behavior, same-origin here since both paths are on the
// same subdomain) — checking that against the requested /admin/ path catches this reliably
// without having to sniff the HTML itself for shell-vs-classic markers, which would risk false
// positives on stores that are genuinely fine. Not yet confirmed whether the /admin/order/{id}
// /details endpoint specifically (as opposed to the /admin/index.php search page) ever redirects
// this way too — it didn't on the one live Orders V2 store checked — but this guard covers it
// automatically either way since it only fires on an actual observed redirect.
async function fetchBcHtml(url, extraHeaders){
  const res = await fetch(url, {credentials:'include', headers: extraHeaders || {}});
  if(!res.ok) throw new Error('HTTP ' + res.status);
  if(url.includes('/admin/') && /\/manage\//.test(res.url)){
    throw new Error('This store\'s admin looks like it\'s on BigCommerce\'s newer Orders UI — the classic page this fetch expects redirected to /manage/orders instead, so status/order-details can\'t be trusted for this store. Needs a different approach (likely the same internal API pattern the product & price check uses) for stores upgraded to the new admin.');
  }
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

  // Customer email (added 2026-09-14, NOT yet confirmed against a real order — ships as a
  // best-effort parse, same spirit as other speculative-but-caveated checks in this file).
  // Tries the same dt/dd label-match pattern already proven for "Payment Method" first (BC's
  // quick-view customer panel plausibly uses the same dl/dt/dd shape), then falls back to a
  // plain regex scan of the whole fragment's text in case email isn't under its own labeled
  // dt at all. If both come back empty on an order you know has one, that's a signal the
  // selector/label guess is wrong for this store's admin theme — worth flagging back rather
  // than assuming the order simply has no email.
  const emailFromLabel = bcGetDdByLabel(doc, 'Email');
  const emailMatch = (doc.body.textContent || '').match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const email = (emailFromLabel && /@/.test(emailFromLabel)) ? emailFromLabel.trim() : (emailMatch ? emailMatch[0] : null);

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
    discountText,
    email
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
    // Was previously always status:'ok' here even when the excise line's own title named a
    // different state than ship-to — the mismatch only showed up in the detail text, easy to
    // miss without expanding the row. Now actually flags it, same severity as Shopify's Tax
    // jurisdiction match check.
    const jurisdictionMismatch = !!(parsed.exciseState && parsed.shipState && parsed.exciseState !== parsed.shipState);

    // Second, independent check: even when the excise line's title matches ship-to (or the
    // title didn't parse to a state at all), confirm against the compliance sheet that ship-to
    // even requires excise tax. Catches the case where the wrong-state resolution corrupted the
    // whole line item (title included), not just a title/ship-to naming mismatch — same failure
    // signature as the confirmed vaperanger.com MO/MA incident (order 567097775, 2026-08-05):
    // TOT's api/exciseTax/calculate endpoint ignored postalCode when stateCode was missing on
    // the request and geocoded off street+city alone. That request payload isn't visible here
    // either, so this works backward from the compliance sheet like the Shopify equivalent does.
    let complianceMismatch = false, complianceDetail = null;
    if(!jurisdictionMismatch && parsed.shipState && compliance && compliance.rows){
      const complianceRow = findComplianceRowByStateName(compliance.rows, parsed.shipState);
      const exciseText = complianceRow ? (complianceRow[9]||'').trim() : null;
      const looksLikeExciseRequired = exciseText && !/^(n\/a|none|no excise)/i.test(exciseText);
      if(!looksLikeExciseRequired){
        complianceMismatch = true;
        complianceDetail = `Ships to ${parsed.shipState}, which has no excise tax requirement per the compliance sheet, but an excise line item (${parsed.exciseItem.total}) was charged. Same failure signature as the confirmed vaperanger.com MO/MA incident (order 567097775, 2026-08-05) — wrong-state tax resolution, not a coupon or PMD issue.`;
      }
    }

    checks.push({
      label: 'Excise tax line item',
      status: (jurisdictionMismatch || complianceMismatch) ? 'flag' : 'ok',
      summary: jurisdictionMismatch
        ? `Present: ${parsed.exciseItem.name} — ${parsed.exciseItem.total}, but ships to ${parsed.shipState}`
        : complianceMismatch
        ? `Present: ${parsed.exciseItem.name} — ${parsed.exciseItem.total}, but ${parsed.shipState} has no excise tax requirement per the compliance sheet`
        : `Present: ${parsed.exciseItem.name} — ${parsed.exciseItem.total}`,
      detail: jurisdictionMismatch
        ? `Ships to ${parsed.shipState}, but excise line is for ${parsed.exciseState} — possible jurisdiction mismatch, same pattern as Shopify's city/state name collisions.`
        : complianceMismatch ? complianceDetail : null
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

document.getElementById('bcCopyNoteBtn').addEventListener('click', async (evt)=>{
  const btn = evt.currentTarget;
  try{
    await navigator.clipboard.writeText(document.getElementById('bcSlackNoteLine').value);
    flashCopied(btn);
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
  document.getElementById('bcBulkEmailInput').value = '';
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
  const emailFilter = document.getElementById('bcBulkEmailInput').value.trim().toLowerCase();

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
    // Only populated when emailFilter is set. Every order in the range is checked against it
    // (not just ones bcGenerateNotes would otherwise flag), since the point here is finding a
    // specific order, not surfacing problems. emailsSeen collects whatever the parser actually
    // found across the range, win or not, so a "no match" result can still show Marc real
    // parsed emails to sanity-check the label/selector guess in bcParseDetails against.
    const emailMatches = [];
    const emailsSeen = [];
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
        if(emailFilter){
          if(parsed.email) emailsSeen.push({orderId, orderNumber: parsed.orderNumber || orderId, email: parsed.email});
          if(parsed.email && parsed.email.toLowerCase() === emailFilter){
            const statusCheck = checks.find(c=>c.label==='Order status');
            emailMatches.push({
              orderId,
              orderNumber: parsed.orderNumber || orderId,
              email: parsed.email,
              statusText,
              verificationSummary: statusCheck ? statusCheck.summary : (statusText || 'unknown'),
              verificationStatus: statusCheck ? statusCheck.status : 'info',
              flagNotes: notes.filter(n=>n.level==='flag')
            });
          }
        }
      }catch(e){
        console.log(`[bulk scan] order ${orderId} failed:`, e.message);
      }
      progressBar.style.width = `${Math.round(((i+1)/orderRows.length)*100)}%`;
      if(i < orderRows.length - 1) await new Promise(r=>setTimeout(r, 200));
    }

    document.getElementById('bcBulkResultsPanel').style.display = 'block';
    const list = document.getElementById('bcBulkResultsList');
    list.innerHTML = '';

    if(emailFilter){
      document.getElementById('bcBulkSummary').textContent =
        `Checked ${orderRows.length} order(s) in range ${range.min}-${range.max} for ${emailFilter} — ${emailMatches.length} match(es).`;

      if(emailMatches.length){
        emailMatches.forEach(m=>{
          const item = document.createElement('div');
          item.className = 'diag-item';
          item.style.cursor = 'pointer';
          item.innerHTML = `
            <div class="diag-head">
              <div class="diag-title">#${m.orderNumber}</div>
              <span class="badge ${m.verificationStatus}">Match</span>
            </div>
            <div class="diag-summary">Email: ${m.email}</div>
            <div class="diag-summary">Verification: ${m.verificationSummary}</div>
            ${m.flagNotes.length ? `<div class="diag-summary">${m.flagNotes.map(n=>n.text).join(' · ')}</div>` : ''}
          `;
          item.addEventListener('click', async ()=>{
            document.getElementById('bcOrderId').value = m.orderId;
            await runBcTest();
          });
          list.appendChild(item);
        });
      } else if(emailsSeen.length){
        list.innerHTML = `<div class="empty-state">No exact match for ${emailFilter}, but these emails were parsed in this range — worth eyeballing in case the address is slightly different, or click one to open that order:<br><br>${
          emailsSeen.map(e=>`<div class="diag-summary" style="cursor:pointer;" data-order="${escapeAttr(String(e.orderId))}">#${escapeAttr(String(e.orderNumber))} — ${escapeAttr(e.email)}</div>`).join('')
        }</div>`;
        list.querySelectorAll('[data-order]').forEach(el=>{
          el.addEventListener('click', async ()=>{
            document.getElementById('bcOrderId').value = el.getAttribute('data-order');
            await runBcTest();
          });
        });
      } else {
        list.innerHTML = '<div class="empty-state">No match, and no email address could be parsed from any order in this range — the email-parsing guess in bcParseDetails likely needs adjusting for this store\'s admin theme. Worth confirming by opening one order\'s details HTML directly and reporting back what the customer/email markup actually looks like.</div>';
      }
      setBcBulkStatus(emailMatches.length ? `Done — found ${emailMatches.length} matching order(s).` : 'Done — no exact match found.', emailMatches.length ? 'ok' : 'err');
    } else {
      document.getElementById('bcBulkSummary').textContent =
        `Checked ${orderRows.length} order(s) in range ${range.min}-${range.max} — ${flagged.length} need attention.`;

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
    }
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
let currentWcOrder = null; // {domain, parsed} — set after a successful order fetch, used by the on-demand product & price check

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

// NOT yet confirmed against a live order (unlike the rest of this file's WooCommerce parsing) —
// this reads WooCommerce CORE's admin order-items markup (html-order-item.php), which is stable
// across recent versions but hasn't been spot-checked against vapesocietysupplies.com or
// vapedepotusa.com the way the meta-field/address/payment parsing below has. Worth diffing
// wcRawPanel-equivalent output against a real order the first time this runs for real.
// Per-row hidden inputs (order_item_qty[ID], line_total[ID]) are read directly rather than the
// "view" display text, since those exist in the raw HTML regardless of edit/view mode.
function wcParseLineItems(html){
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const rows = doc.querySelectorAll('table.woocommerce_order_items tbody tr.item');
  const items = [];
  rows.forEach(row=>{
    const itemId = row.getAttribute('data-order_item_id');
    const nameLink = row.querySelector('.name a[href*="post="]');
    const nameCell = row.querySelector('.name');
    const name = (nameLink || nameCell)?.textContent.trim().split('\n')[0].trim() || null;
    const productIdMatch = nameLink ? (nameLink.getAttribute('href') || '').match(/post=(\d+)/) : null;
    const skuEl = row.querySelector('.wc-order-item-sku');
    const sku = skuEl ? skuEl.textContent.replace(/^SKU:\s*/i, '').trim() : null;
    const qtyInput = itemId ? row.querySelector(`input[name="order_item_qty[${itemId}]"]`) : null;
    const totalInput = itemId ? row.querySelector(`input[name="line_total[${itemId}]"]`) : null;
    const qty = qtyInput ? parseFloat(qtyInput.value) : null;
    const lineTotal = totalInput ? parseFloat(totalInput.value) : null;
    items.push({
      itemId,
      productId: productIdMatch ? productIdMatch[1] : null,
      name,
      sku,
      qty: isNaN(qty) ? null : qty,
      lineTotal: isNaN(lineTotal) ? null : lineTotal
    });
  });
  return items;
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
  const lineItems = wcParseLineItems(html);
  return {
    fields, billingState, shippingState, paymentMethod, lineItems,
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

document.getElementById('wcCopyNoteBtn').addEventListener('click', async (evt)=>{
  const btn = evt.currentTarget;
  try{
    await navigator.clipboard.writeText(document.getElementById('wcSlackNoteLine').value);
    flashCopied(btn);
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

function wcParseMoney(str){
  if(str === null || str === undefined) return null;
  const n = parseFloat(String(str).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? null : n;
}

// Reads a product's CURRENT live price straight off its own edit screen (_regular_price /
// _sale_price — stable WooCommerce core field IDs on the Product data > General panel) rather
// than TOT's retailPrice/wholesalePrice/msrp fields. Those TOT fields are NOT usable here: per
// Product_Sync.php, they're pushed to/pulled from HQ's API directly and never stored as
// WooCommerce postmeta locally, so there's nothing on this page to read them from. This mirrors
// checkout's real behavior (ExciseService.php's get_transactionLines() also uses
// $_product->get_price(), i.e. sale price if set else regular price) rather than TOT's own
// pricing fields — same tradeoff BigCommerce's product & price check makes, just for a different
// underlying reason (there it's a single collapsed field; here the real fields live off-page).
//
// Variable products are explicitly NOT price-checked: get_edit_post_link() on a variation line
// item links back to the parent product, whose top-level _regular_price/_sale_price describe the
// range default, not the specific variation that was actually ordered — comparing against that
// would produce a misleading mismatch far more often than a real one.
async function wcFetchProductInfo(domain, productId){
  const url = `https://${domain}/wp-admin/post.php?post=${productId}&action=edit`;
  const res = await fetch(url, {credentials:'include'});
  if(!res.ok) throw new Error('HTTP ' + res.status);
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const productType = doc.querySelector('select#product-type')?.value || null;
  const regularPrice = wcParseMoney(doc.querySelector('#_regular_price')?.value);
  const salePrice = wcParseMoney(doc.querySelector('#_sale_price')?.value);
  return {productType, regularPrice, salePrice};
}

function wcRenderProductResults(results){
  const container = document.getElementById('wcProductResults');
  container.innerHTML = '';
  results.forEach(r=>{
    const item = document.createElement('div');
    item.className = 'diag-item';
    const badgeClass = r.priceMismatch ? 'flag' : (r.notFound || r.variable || r.chargedUnit === null) ? 'info' : 'ok';
    const badgeText = r.priceMismatch ? 'Flag' : (r.notFound || r.variable || r.chargedUnit === null) ? 'Info' : 'OK';
    let summary;
    if(r.notFound){
      summary = 'Could not resolve a product edit page for this line item (no product link found, or fetch failed)';
    } else if(r.variable){
      summary = `Variable product — per-variation price not checked (charged ${r.chargedUnit !== null ? r.chargedUnit.toFixed(2) : 'unknown'})`;
    } else if(r.chargedUnit === null){
      summary = 'Could not determine charged unit price from the order';
    } else {
      summary = `Charged ${r.chargedUnit.toFixed(2)} — current price ${r.currentPrice.toFixed(2)}${r.priceMismatch ? ' (differs)' : ''}`;
    }
    item.innerHTML = `
      <div class="diag-head">
        <div class="diag-title">${r.name || r.sku || 'Unknown item'}</div>
        <span class="badge ${badgeClass}">${badgeText}</span>
      </div>
      <div class="diag-summary">${summary}</div>
    `;
    container.appendChild(item);
  });
}

document.getElementById('wcCheckProductsBtn').addEventListener('click', async ()=>{
  if(!currentWcOrder){ setWcStatus('Fetch an order first.', 'err'); return; }
  const {domain, parsed} = currentWcOrder;
  const items = (parsed.lineItems || []).filter(li => li.productId);
  if(!items.length){ setWcStatus('No line items with a resolvable product link found on this order.', 'err'); return; }

  document.getElementById('wcProductResults').innerHTML = '';
  const btn = document.getElementById('wcCheckProductsBtn');
  const progressWrap = document.getElementById('wcProductProgressWrap');
  const progressBar = document.getElementById('wcProductProgressBar');
  btn.disabled = true;
  progressWrap.style.display = 'block';
  progressBar.style.width = '0%';

  const uniqueProductIds = [...new Set(items.map(li=>li.productId))];
  const infoByProductId = {};
  try{
    for(let i=0;i<uniqueProductIds.length;i++){
      const pid = uniqueProductIds[i];
      setWcStatus(`<span class="spinner">⟳</span> Checking product ${i+1} of ${uniqueProductIds.length}…`, null, true);
      try{
        infoByProductId[pid] = await wcFetchProductInfo(domain, pid);
      }catch(e){
        console.log(`[wc product & price check] product ${pid} — fetch failed:`, e.message);
        infoByProductId[pid] = null;
      }
      progressBar.style.width = `${Math.round(((i+1)/uniqueProductIds.length)*100)}%`;
      if(i < uniqueProductIds.length - 1) await new Promise(r=>setTimeout(r, 200));
    }

    const results = items.map(li=>{
      const info = infoByProductId[li.productId];
      const chargedUnit = (li.lineTotal !== null && li.qty) ? li.lineTotal / li.qty : null;
      if(!info){
        return {sku: li.sku, name: li.name, notFound: true, chargedUnit};
      }
      if(info.productType === 'variable'){
        return {sku: li.sku, name: li.name, variable: true, chargedUnit};
      }
      const currentPrice = (info.salePrice !== null ? info.salePrice : info.regularPrice);
      const priceMismatch = chargedUnit !== null && currentPrice !== null && Math.abs(chargedUnit - currentPrice) > 0.01;
      return {
        sku: li.sku,
        name: li.name,
        chargedUnit,
        currentPrice,
        priceMismatch
      };
    });

    wcRenderProductResults(results);
    const flaggedCount = results.filter(r=>r.priceMismatch).length;
    setWcStatus(`Checked ${results.length} line item(s), ${flaggedCount} worth a look. A mismatch can also mean the price changed since this order, a coupon/discount was applied, or the order used wholesale pricing this check can't see — not necessarily a bug.`, flaggedCount ? 'err' : 'ok');
  } finally {
    btn.disabled = false;
    progressWrap.style.display = 'none';
  }
});

document.getElementById('wcClearBtn').addEventListener('click', ()=>{
  document.getElementById('wcOrderId').value = '';
  document.getElementById('wcStatusPanel').style.display = 'none';
  document.getElementById('wcDiagList').innerHTML = '';
  document.getElementById('wcDiagEmpty').style.display = 'block';
  document.getElementById('wcNotesPanel').style.display = 'none';
  document.getElementById('wcFieldsPanel').style.display = 'none';
  document.getElementById('wcFieldsList').innerHTML = '';
  document.getElementById('wcProductPanel').style.display = 'none';
  document.getElementById('wcProductResults').innerHTML = '';
  currentWcOrder = null;
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
  ['wcStatusPanel','wcNotesPanel','wcFieldsPanel','wcProductPanel'].forEach(id=>document.getElementById(id).style.display='none');
  document.getElementById('wcDiagList').innerHTML = '';
  document.getElementById('wcDiagEmpty').style.display = 'block';
  document.getElementById('wcProductResults').innerHTML = '';
  currentWcOrder = null;

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

    document.getElementById('wcProductPanel').style.display = 'block';
    currentWcOrder = {domain: row.domain, parsed};

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
  document.getElementById('platformHQ').classList.toggle('active', platform === 'hq');
  document.getElementById('platformBackfill').classList.toggle('active', platform === 'backfill');
  document.getElementById('platformInvestigate').classList.toggle('active', platform === 'investigate');
  document.getElementById('platformVerification').classList.toggle('active', platform === 'verification');
  document.getElementById('platformTaxRules').classList.toggle('active', platform === 'taxrules');
}
document.querySelectorAll('.platform-tab').forEach(btn=>{
  btn.addEventListener('click', ()=> switchPlatformTab(btn.dataset.platform));
});

init();

// =====================================================================
// HQ Excise Tax scan (PROPOSED — see README "HQ Excise Tax scan" section)
// =====================================================================
// Automates the manual Active Monitoring sweep: for each org in the queue,
// drive a real HQ tab through "Choose App Domain" -> API docs -> mint a
// fresh Try-It-Now token -> verify it's scoped to the right org -> pull
// recent orders and flag the wholesale error.incorrectCollection mismatch
// pattern (excise tax owed but exciseTaxCollected === "0").
//
// This intentionally does NOT try to call the Excise Tax Order API directly
// from this side panel via fetch(). Selecting an org in "Choose App Domain"
// and minting a token on the API docs page both happen through in-page app
// state (a Vue Select component's internal state, and an in-page token-mint
// flow) that isn't exposed as a documented, callable endpoint we've found —
// so this drives the real pages via chrome.scripting.executeScript instead,
// exactly like a person clicking through would, just automated.
//
// Needs "scripting" + "tabs" permissions and https://app.tokenoftrust.com/*
// in host_permissions (see manifest.json) — new capability classes for this
// extension, flagged for deliberate review rather than silently added.

const HQ_QUEUE_KEY = 'totHqQueue';
const HQ_RESULTS_KEY = 'totHqResults';
const HQ_DOMAINS_KEY = 'totHqDomains';
const HQ_RATE_DIRECTORY_KEY = 'totHqRateDirectory'; // learned tax-rate-per-jurisdiction+SKU-type directory — see overcharge $ estimate, 2026-08-20
const HQ_SCAN_HOURS = 24; // default hours for the time-window mode when first checked — editable per row from there, see the sinceHoursAgo input in renderHqQueueTable
const HQ_SCAN_HOURS_MAX = 24 * 14; // sanity cap (2 weeks) — guards against a mistyped huge value pulling in an unbounded order list
const HQ_ORIGIN = 'https://app.tokenoftrust.com';

// ---------------------------------------------------------------------------
// Tax Ops Hq effective-rules cross-check — see the README changelog entries
// dated 2026-09-01 for the full writeup (both the original proposal and the
// "endpoint is dead, rebuilt on two working endpoints" follow-up).
//
// Originally found by reading the tokenoftrust/tot-taxes GitHub repo
// (private): this extension's HQ Excise Tax scan has, since 2026-08-24,
// hand-maintained RETAIL_PRICE_BASED / WHOLESALE_COST_BASED / FLAT_RATE_PER_ML
// tables inside hqStageScan below, transcribed one screenshot at a time from
// TaxOps Portal's "State Tax Rules" page — with confirmed transcription bugs
// along the way (MN's "95%" that's probably missing a "%" sign, a spurious
// learned 27.3% OH rate that turned out to be a price/volume correlation, and
// PA's sheet-vs-observed-behavior contradiction, now explained below). That
// portal (rebranded "Tax Ops Hq" in-app) is deployed at
// taxes.tokenoftrust.com (prod) / taxes.test.tokenoftrust.com (test, not yet
// in host_permissions — add it if this ever needs to check test data), auth
// via a session cookie set by signing in with a @tokenoftrust.com /
// @team.tokenoftrust.com email, same as HQ itself.
//
// GET /api/effective-rules?clientId=<domain> — the endpoint the original
// 2026-09-01 proposal was built on — is CONFIRMED DEAD as of a live signed-in
// session the same day: it returns 200 {"productTypes":[]} unconditionally,
// for every domain tried, even ones with real rule data. Not an auth problem
// (no 401, no redirect) and not specific to one org — just an empty shape.
// Replaced with two endpoints that ARE confirmed live and populated:
//
// 1. GET /api/clients/<domain> → client.options.exciseTax.ruleOverrides.
//    <'vape'|'nicotinePouch'>.US.regionCode.<ST> — this ORG'S OWN override
//    rules (nested objects, confirmed via live Object.keys() walk: top-level
//    ruleOverrides has 'vape'/'nicotinePouch' keys, each with a single 'US'
//    key, then a single 'regionCode' key, then real 2-letter state codes).
//    A region code's value is either one rule object ({attr, pct|tax,
//    description, if?, when?, ...}) or {all: [...multiple rule objects]}
//    when more than one condition applies in that state (e.g. WA vape has 3:
//    two flat per-mL non-nicotine rules plus one 95%-of-price nicotine
//    rule). This is exactly the blind spot the HQ scan's own README
//    changelog flagged as its single most valuable open architectural
//    question (found via kangerwholesaleusa.com's WA rule being silently
//    overridden to 95%-of-wholesaleCost, vs. vaperanger.com's WA rule using
//    95%-of-unitDiscountedPrice for the same nominal "95%" state rate) —
//    confirmed live 2026-09-01 that the two orgs' WA overrides do in fact
//    differ this way. This same response also confirmed PA's real contract
//    for vaperanger.com: `attr: "unitDiscountedPrice"` even though the
//    human `description` says "wholesale price" — the sheet's PA row and
//    this tool's PA exclusion comment below were both describing a labeling
//    bug in TOT's own config, not a transcription error on this tool's side.
//    NOTE: this response also carries this org's Stripe/webhook/HubSpot
//    secrets alongside the tax data — this code reads only
//    options.exciseTax.ruleOverrides and must never log, store, or forward
//    the rest of the payload.
//
// 2. GET /api/tax-calendar/rules → global, non-client-specific reference
//    data (the literal source of TaxOps Portal's "State Tax Rules" page).
//    Confirmed live shape: `rules` is keyed by 51 full state names (incl.
//    "District of Columbia"), each with a `"Vapor Products"` and
//    `"Nicotine Pouches"` array of {state, productType, description,
//    attribute, source} — no separate numeric rate field; the rate lives
//    only inside the free-text `description` (e.g. "40% of the purchase
//    price from the wholesaler", "$1.50 per unit", "No tax", or CA's
//    stacked "51.08% of wholesale cost\n\n12.5% of retail selling price").
//    A handful of 2-letter-code keys also live in the same `rules` object
//    (AK, CO, IL, MD, AL, AZ confirmed) but are COUNTY/CITY overlay entries
//    (each carries its own `jurisdiction` field, e.g. AK→Anchorage,
//    CO→Boulder) layered on top of the state's real rule under its full
//    name — not the state rate itself, and skipped below since this tool's
//    key format can't represent a locality.
//
// Neither replacement endpoint returns a clean {rate, basis} pair the way
// the dead one was documented to — this file now does its own conservative
// text parsing (see taxOpsParseDescriptionRate) and only records a rate when
// exactly one unambiguous figure is found, skipping stacked/compound rates
// (like CA) entirely rather than guessing which figure applies.
//
// Same posture as before: this does NOT recompute "the correct tax" from the
// live rate — it only cross-checks the RATE NUMBER and the presence of a
// per-org OVERRIDE against what this tool's own hand-maintained tables
// assume, surfacing disagreements for a human to confirm via HQ's "How was
// this tax calculated" tool. GET /auth/whoami is checked first so "not
// signed into Tax Ops Hq" shows as a clear per-org badge instead of a
// confusing silent no-op or a raw 401.
const TAXOPS_ORIGIN = 'https://taxes.tokenoftrust.com';
const TAXOPS_PRODUCT_TYPE_KEY = { 'Vapor Products': 'vape', 'Nicotine Pouches': 'nicotinePouch' };
let TAXOPS_RULES_CACHE = {}; // domain -> {ok, states: {'US.regionCode.<ST>::<type>': {rate, basis, source}}, reason?}
let TAXOPS_GLOBAL_CACHE = null; // {ok, states, reason?} — /api/tax-calendar/rules isn't client-scoped, fetched once and shared across every domain in a scan

// Full state name -> 2-letter USPS code, needed because /api/tax-calendar/
// rules keys its 51 real state-level entries by full name (confirmed live
// 2026-09-01), while everywhere else in this tool (calc-detail's ruleId,
// AUTHORITATIVE_RATES/WHOLESALE_COST_BASED/FLAT_RATE_PER_ML, ruleOverrides'
// own regionCode keys) uses 2-letter codes.
const TAXOPS_STATE_NAME_TO_CODE = {
  'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR', 'California': 'CA',
  'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE', 'District of Columbia': 'DC',
  'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID', 'Illinois': 'IL',
  'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS', 'Kentucky': 'KY', 'Louisiana': 'LA',
  'Maine': 'ME', 'Maryland': 'MD', 'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN',
  'Mississippi': 'MS', 'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK', 'Oregon': 'OR',
  'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD',
  'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT', 'Vermont': 'VT', 'Virginia': 'VA',
  'Washington': 'WA', 'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY'
};

// Conservative single-figure parser for /api/tax-calendar/rules' free-text
// `description` field. Only ever returns a rate when exactly one unambiguous
// figure is found — a description with more than one percentage (e.g. CA's
// stacked wholesale + retail components) is deliberately left unparsed
// rather than guessing which figure is "the" rate, same caution this tool
// already applies to CA elsewhere (see the WHOLESALE_COST_BASED comment
// below). Returns null when nothing safe to extract is found.
function taxOpsParseDescriptionRate(description) {
  if (!description || typeof description !== 'string') return null;
  const text = description.trim();
  if (/^no tax\.?$/i.test(text)) return { rate: 0, basis: 'none' };
  const pctMatches = text.match(/\d+(?:\.\d+)?\s*%/g) || [];
  if (pctMatches.length === 1) {
    const n = parseFloat(pctMatches[0]);
    return isNaN(n) ? null : { rate: n / 100, basis: 'ad_valorem' };
  }
  if (pctMatches.length > 1) return null; // stacked/compound rate — can't collapse to one number
  const dollarMatch = text.match(/\$\s*(\d+(?:\.\d+)?)\s*per\b/i);
  if (dollarMatch) {
    const n = parseFloat(dollarMatch[1]);
    return isNaN(n) ? null : { rate: n, basis: 'per_unit' };
  }
  return null; // no single unambiguous figure found — skip rather than guess
}

// Extraction for the live client ruleOverrides shape: a region-code's value
// is either one rule object directly, or {all: [...]} when multiple
// conditional rules apply in that state (confirmed live on WA, 3 entries).
// Prefers a percentage-of-price rule (`pct`) over a flat per-unit rule
// (`tax`) when both exist in the same array, since this tool's own
// AUTHORITATIVE_RATES/WHOLESALE_COST_BASED tables it's compared against are
// percentage-based — falls back to the flat rule when that's all there is.
function taxOpsExtractRateBasisFromOverride(node) {
  if (node == null || typeof node !== 'object') return null;
  const entries = Array.isArray(node.all) ? node.all : [node];
  const valid = entries.filter(e => e && typeof e === 'object');
  if (!valid.length) return null;
  const pctEntry = valid.find(e => typeof e.pct === 'number');
  if (pctEntry) return { rate: pctEntry.pct / 100, basis: 'ad_valorem' };
  const taxEntry = valid.find(e => typeof e.tax === 'number');
  if (taxEntry) return { rate: taxEntry.tax, basis: 'per_unit' };
  return null;
}

// Global (non-client-specific) reference rates from TaxOps Portal's own
// "State Tax Rules" page data. Fetched once total, not once per org.
async function fetchTaxOpsGlobalRates() {
  if (TAXOPS_GLOBAL_CACHE) return TAXOPS_GLOBAL_CACHE;
  let result;
  try {
    const res = await fetch(`${TAXOPS_ORIGIN}/api/tax-calendar/rules`, {
      headers: { Accept: 'application/json' },
      credentials: 'include'
    });
    if (res.status === 401) {
      result = { ok: false, reason: 'not-signed-in' };
    } else if (!res.ok) {
      result = { ok: false, reason: `http-${res.status}` };
    } else {
      const body = await res.json();
      const states = {};
      Object.keys(body.rules || {}).forEach(stateKey => {
        const code = TAXOPS_STATE_NAME_TO_CODE[stateKey];
        if (!code) return; // not a recognized full state name — a locality-overlay entry (see comment above), skip
        const entry = body.rules[stateKey];
        Object.keys(TAXOPS_PRODUCT_TYPE_KEY).forEach(label => {
          const typeKey = TAXOPS_PRODUCT_TYPE_KEY[label];
          const rules = entry[label];
          if (!Array.isArray(rules) || !rules.length) return;
          const rb = taxOpsParseDescriptionRate(rules[0].description);
          if (!rb) return; // couldn't parse a single unambiguous rate (e.g. CA's stacked components) — skip rather than guess
          states[`US.regionCode.${code}::${typeKey}`] = { rate: rb.rate, basis: rb.basis, source: 'global' };
        });
      });
      result = { ok: true, states };
    }
  } catch (e) {
    result = { ok: false, reason: 'fetch-failed: ' + (e.message || e) };
  }
  // 2026-09-15: only cache a SUCCESS. This cache has no TTL and lives for as
  // long as the side panel document stays open, which can easily span many
  // scan runs across a browsing session. Caching a failure (e.g.
  // 'not-signed-in') unconditionally meant one 401 — from before signing in,
  // or a session that happened to be mid-refresh — got stuck for the rest of
  // that session even after actually signing in, exactly the "I was already
  // logged in" report from Marc on vapesocietysupplies.com. A failure is
  // cheap to retry (one extra fetch per scan at most); a stale false
  // negative silently disabling this whole cross-check for a session is not.
  if (result.ok) TAXOPS_GLOBAL_CACHE = result;
  return result;
}

async function fetchTaxOpsEffectiveRules(domain) {
  if (!domain) return { ok: false, reason: 'no-domain' };
  if (TAXOPS_RULES_CACHE[domain]) return TAXOPS_RULES_CACHE[domain];

  let result;
  try {
    const whoRes = await fetch(`${TAXOPS_ORIGIN}/auth/whoami`, { credentials: 'include' });
    if (whoRes.status === 401) {
      result = { ok: false, reason: 'not-signed-in' };
    } else {
      const globalRates = await fetchTaxOpsGlobalRates(); // shared cache, its own try/catch — never throws
      const clientRes = await fetch(`${TAXOPS_ORIGIN}/api/clients/${encodeURIComponent(domain)}`, {
        headers: { Accept: 'application/json' },
        credentials: 'include'
      });
      if (clientRes.status === 401) {
        result = { ok: false, reason: 'not-signed-in' };
      } else if (!clientRes.ok) {
        result = { ok: false, reason: `http-${clientRes.status}` };
      } else {
        const body = await clientRes.json();
        // Read ONLY the excise-tax rule overrides — this response also
        // carries this org's Stripe/webhook/HubSpot secrets, which must
        // never be touched, logged, or stored by this extension.
        const ruleOverrides = (body && body.client && body.client.options
          && body.client.options.exciseTax && body.client.options.exciseTax.ruleOverrides) || {};
        // Start from the global reference rates, then let this org's own
        // overrides win on any key they cover — mirrors the dead endpoint's
        // documented "global merged with per-org override" behavior.
        const states = Object.assign({}, globalRates.ok ? globalRates.states : {});
        Object.keys(TAXOPS_PRODUCT_TYPE_KEY).forEach(label => {
          const typeKey = TAXOPS_PRODUCT_TYPE_KEY[label];
          const regionCodes = ruleOverrides[typeKey] && ruleOverrides[typeKey].US && ruleOverrides[typeKey].US.regionCode;
          if (!regionCodes) return;
          Object.keys(regionCodes).forEach(code => {
            const rb = taxOpsExtractRateBasisFromOverride(regionCodes[code]);
            if (!rb) return;
            states[`US.regionCode.${code}::${typeKey}`] = { rate: rb.rate, basis: rb.basis, source: 'override' };
          });
        });
        result = {
          ok: true,
          states,
          globalRatesOk: globalRates.ok,
          globalRatesReason: globalRates.ok ? null : globalRates.reason
        };
      }
    }
  } catch (e) {
    result = { ok: false, reason: 'fetch-failed: ' + (e.message || e) };
  }
  // 2026-09-15: same fix as fetchTaxOpsGlobalRates just above — only cache a
  // SUCCESS, never a failure. TAXOPS_RULES_CACHE has no TTL and persists for
  // as long as the side panel stays open, so an early 401 (e.g. right after
  // opening the panel, before signing in on that tab) used to get stuck as
  // "not-signed-in" for every later scan in that session, even after
  // actually signing in — exactly what Marc saw on vapesocietysupplies.com
  // despite being logged in when the scan ran.
  if (result.ok) TAXOPS_RULES_CACHE[domain] = result;
  return result;
}

// Known HQ "Choose App Domain" org names — confirmed exact spellings from
// today's session. Note some of these differ from the Shopify storefront
// config elsewhere in this extension (e.g. bigdvapor.net here vs
// bigdvapor.com in the Shopify config) — HQ's app domain and a store's public
// storefront domain aren't always the same string, so this is kept as its
// own list rather than reusing DEFAULT_CONFIG. Manage via "Known domains"
// below the queue table.
const HQ_DEFAULT_DOMAINS = [
  'justcbdstore.com',
  'thevaporsupplier.com',
  'thevaporshoppeusa.com',
  'bigdvapor.net',
  'fistdistro.com',
  'fullsend.com',
  'vapedepotusa.com',
  'alternativepods.com',
  'zuluvape.com',
  'giantvapes.com',
  'kangerwholesaleusa.com',
  'mmschainportal.com',
  'vaperanger.com',
  'vapesocietysupplies.com',
];

// Seeded from the Active Monitoring list orgs still pending a re-check as of
// today's session — edit freely, this is just a starting point.
const HQ_DEFAULT_QUEUE = [
  { domain: 'thevaporshoppeusa.com', idStart: 100694, idEnd: 100715 },
  { domain: 'vapedepotusa.com', idStart: 29032, idEnd: 29033 },
  { domain: 'alternativepods.com', idStart: 303497, idEnd: 303525 },
  { domain: 'zuluvape.com', idStart: 408147, idEnd: 408190 },
  { domain: 'giantvapes.com', idStart: 157401, idEnd: 157456 },
  { domain: 'kangerwholesaleusa.com', idStart: 770485, idEnd: 770572 },
];

let HQ_QUEUE = [];
let HQ_RESULTS = [];
let HQ_DOMAINS = [];
let HQ_RUN_STATE = 'idle'; // idle | running | paused-login | stopped
let HQ_TAB_ID = null;
// In-memory-only accumulator for "Export Taxlines CSV" — see the comment at
// its one write site (in runHqScan) for why this deliberately isn't persisted
// to chrome.storage.local alongside HQ_RESULTS. Reset at the start of each run.
let HQ_TAXLINE_ROWS = [];

async function loadHqQueue() {
  const stored = await chrome.storage.local.get([HQ_QUEUE_KEY]);
  HQ_QUEUE = stored[HQ_QUEUE_KEY] || JSON.parse(JSON.stringify(HQ_DEFAULT_QUEUE));
}
async function saveHqQueue() {
  await chrome.storage.local.set({ [HQ_QUEUE_KEY]: HQ_QUEUE });
}
async function loadHqResults() {
  const stored = await chrome.storage.local.get([HQ_RESULTS_KEY]);
  HQ_RESULTS = stored[HQ_RESULTS_KEY] || [];
}
async function saveHqResults() {
  await chrome.storage.local.set({ [HQ_RESULTS_KEY]: HQ_RESULTS });
}
async function loadHqDomains() {
  const stored = await chrome.storage.local.get([HQ_DOMAINS_KEY]);
  HQ_DOMAINS = stored[HQ_DOMAINS_KEY] || JSON.parse(JSON.stringify(HQ_DEFAULT_DOMAINS));
}
async function saveHqDomains() {
  await chrome.storage.local.set({ [HQ_DOMAINS_KEY]: HQ_DOMAINS });
}

function setHqStatus(msg, type, isHtml) {
  const el = document.getElementById('hqStatus');
  if (isHtml) el.innerHTML = msg; else el.textContent = msg;
  el.className = 'status-line show' + (type ? ' ' + type : '');
}

// Separate status line living inside the date-range panel itself — the
// date-range fetch used to report through setHqStatus, whose #hqStatus
// element sits up in the Run panel above. That put "Fetching..." messages
// out of view of the button/inputs the user was actually looking at while
// waiting. This one renders right under the Fetch & Export CSV button instead.
function setHqTaxlinesStatus(msg, type, isHtml) {
  const el = document.getElementById('hqTaxlinesStatus');
  if (!el) return;
  if (isHtml) el.innerHTML = msg; else el.textContent = msg;
  el.className = 'status-line show' + (type ? ' ' + type : '');
}

// Toggles the Start/Resume button between its resting label and a spinning
// "Running..." state — the status line alone can sit on the same message for
// a long stretch of a big scan, so this gives a persistent, always-visible
// signal (independent of what setHqStatus happens to say) that a run is
// still going rather than stuck.
function setHqRunButtonBusy(busy) {
  const btn = document.getElementById('hqStartBtn');
  if (!btn) return;
  btn.disabled = busy;
  btn.innerHTML = busy ? '<span class="spinner">⟳</span> Running…' : 'Start / Resume scan';
}

// Live percentage/ETA for the date-range taxlines export. The fetch itself
// runs inside a single chrome.scripting.executeScript call that only returns
// once fully done, so hqStageTaxlinesExport (the injected function) pings
// progress back via chrome.runtime.sendMessage as it works — this listener
// turns those pings into the panel's status text and progress bar. Registered
// once at popup load; harmless if it fires with nothing listening on the
// panel (e.g. between runs) since the DOM lookups below just no-op.
let HQ_TAXLINES_FETCH_START_MS = null;
function formatHqEta(ms) {
  if (!isFinite(ms) || ms < 0) return '';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `~${m}m ${s}s remaining` : `~${s}s remaining`;
}
function setHqTaxlinesProgressBar(pct) {
  const track = document.getElementById('hqTaxlinesProgressTrack');
  const fill = document.getElementById('hqTaxlinesProgressFill');
  if (!track || !fill) return;
  if (pct == null) { track.className = 'progress-track'; return; }
  track.className = 'progress-track show';
  fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
}
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== 'hqTaxlinesProgress') return;
  if (msg.phase === 'listed') {
    HQ_TAXLINES_FETCH_START_MS = Date.now();
    if (!msg.total) {
      setHqTaxlinesStatus('No orders found in that range.', 'err');
      setHqTaxlinesProgressBar(null);
      return;
    }
    setHqTaxlinesStatus(`<span class="spinner">⟳</span> Found ${msg.total} order(s) — fetching details (0%)...`, null, true);
    setHqTaxlinesProgressBar(0);
    return;
  }
  if (msg.phase === 'fetching') {
    const pct = msg.total ? Math.round((msg.done / msg.total) * 100) : 0;
    let etaStr = '';
    if (HQ_TAXLINES_FETCH_START_MS && msg.done > 0 && msg.done < msg.total) {
      const elapsedMs = Date.now() - HQ_TAXLINES_FETCH_START_MS;
      const remainingMs = (elapsedMs / msg.done) * (msg.total - msg.done);
      const eta = formatHqEta(remainingMs);
      if (eta) etaStr = ` — ${eta}`;
    }
    setHqTaxlinesStatus(`<span class="spinner">⟳</span> Fetching order ${msg.done} of ${msg.total} (${pct}%)${etaStr}...`, null, true);
    setHqTaxlinesProgressBar(pct);
  }
});

function domainOptionsHtml(selected) {
  // Union in the row's current value even if it's since been removed from the
  // known-domains list, so an existing queue row never silently gets swapped
  // to whatever the dropdown happens to default to.
  const options = HQ_DOMAINS.slice();
  if (selected && !options.includes(selected)) options.push(selected);
  return options.map(d => `<option value="${escapeAttr(d)}" ${d === selected ? 'selected' : ''}>${escapeAttr(d)}</option>`).join('');
}

function renderHqQueueTable() {
  const body = document.getElementById('hqQueueBody');
  body.innerHTML = '';
  HQ_QUEUE.forEach((row, i) => {
    const sinceMode = row.sinceHoursAgo != null;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><select data-i="${i}" data-f="domain" style="width:150px;">
        <option value="" ${row.domain ? '' : 'selected'} disabled>Select a domain...</option>
        ${domainOptionsHtml(row.domain)}
      </select></td>
      <td><input type="text" data-i="${i}" data-f="idStart" value="${row.idStart ?? ''}" placeholder="idStart" style="width:70px;" ${sinceMode ? 'disabled' : ''}></td>
      <td><input type="text" data-i="${i}" data-f="idEnd" value="${row.idEnd ?? ''}" placeholder="blank = auto" title="Leave blank to auto-detect the end — the scan walks forward from ID start until it stops finding real orders." style="width:80px;" ${sinceMode ? 'disabled' : ''}></td>
      <td style="text-align:center; white-space:nowrap;">
        <input type="checkbox" data-i="${i}" data-f="sinceMode" ${sinceMode ? 'checked' : ''} title="Scan a time window instead of a fixed ID range">
        <input type="number" data-i="${i}" data-f="sinceHoursAgo" value="${row.sinceHoursAgo ?? HQ_SCAN_HOURS}" min="1" max="${HQ_SCAN_HOURS_MAX}" step="1" style="width:52px;" ${sinceMode ? '' : 'disabled'} title="Hours back to scan — default ${HQ_SCAN_HOURS}, editable up to ${HQ_SCAN_HOURS_MAX} (2 weeks). Raise it past 24 to cover a weekend or other gap.">
      </td>
      <td><button class="row-del" data-i="${i}" title="Remove">✕</button></td>`;
    body.appendChild(tr);
  });
  body.querySelectorAll('select[data-f="domain"]').forEach(sel => {
    sel.addEventListener('change', async e => {
      const i = +e.target.dataset.i;
      HQ_QUEUE[i].domain = e.target.value;
      await saveHqQueue();
    });
  });
  body.querySelectorAll('input[data-f="idStart"], input[data-f="idEnd"]').forEach(inp => {
    inp.addEventListener('change', async e => {
      const i = +e.target.dataset.i, f = e.target.dataset.f;
      const val = e.target.value.trim();
      HQ_QUEUE[i][f] = val === '' ? null : Number(val);
      await saveHqQueue();
    });
  });
  body.querySelectorAll('input[data-f="sinceMode"]').forEach(cb => {
    cb.addEventListener('change', async e => {
      const i = +e.target.dataset.i;
      if (e.target.checked) {
        // Restore whatever hours value this row last used (so re-checking
        // the box after unchecking it doesn't silently reset a
        // deliberately-widened weekend-catch-up window back to the 24h
        // default) — _lastSinceHoursAgo survives the uncheck below,
        // sinceHoursAgo itself doesn't.
        HQ_QUEUE[i].sinceHoursAgo = HQ_QUEUE[i]._lastSinceHoursAgo ?? HQ_SCAN_HOURS;
        HQ_QUEUE[i].idStart = null;
        HQ_QUEUE[i].idEnd = null;
      } else {
        if (HQ_QUEUE[i].sinceHoursAgo != null) HQ_QUEUE[i]._lastSinceHoursAgo = HQ_QUEUE[i].sinceHoursAgo;
        HQ_QUEUE[i].sinceHoursAgo = null;
      }
      await saveHqQueue();
      renderHqQueueTable();
    });
  });
  body.querySelectorAll('input[data-f="sinceHoursAgo"]').forEach(inp => {
    inp.addEventListener('change', async e => {
      const i = +e.target.dataset.i;
      let val = Number(e.target.value);
      if (!Number.isFinite(val) || val < 1) val = HQ_SCAN_HOURS;
      val = Math.min(val, HQ_SCAN_HOURS_MAX);
      HQ_QUEUE[i].sinceHoursAgo = val;
      HQ_QUEUE[i]._lastSinceHoursAgo = val;
      await saveHqQueue();
      renderHqQueueTable();
    });
  });
  body.querySelectorAll('.row-del').forEach(btn => {
    btn.addEventListener('click', async e => {
      HQ_QUEUE.splice(+e.target.dataset.i, 1);
      await saveHqQueue();
      renderHqQueueTable();
    });
  });
}

document.getElementById('hqAddRowBtn').addEventListener('click', async () => {
  HQ_QUEUE.push({ domain: '', idStart: null, idEnd: null, sinceHoursAgo: null });
  await saveHqQueue();
  renderHqQueueTable();
});
document.getElementById('hqResetQueueBtn').addEventListener('click', async () => {
  if (!confirm('Reset the scan queue to defaults? Any edits you made, and all current results, will be cleared.')) return;
  HQ_QUEUE = JSON.parse(JSON.stringify(HQ_DEFAULT_QUEUE));
  HQ_RESULTS = [];
  HQ_RUN_STATE = 'idle';
  await saveHqQueue();
  await saveHqResults();
  renderHqQueueTable();
  renderHqProgress();
  renderHqResults();
  setHqStatus('Reset to defaults — queue and results cleared.', 'ok');
});

// ---- Known HQ org domains (used to populate the queue's domain dropdown) ----
function renderHqDomainsTable() {
  const body = document.getElementById('hqDomainsBody');
  if (!body) return;
  body.innerHTML = '';
  HQ_DOMAINS.forEach((d, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" data-i="${i}" value="${escapeAttr(d)}" placeholder="example.com"></td>
      <td><button class="row-del" data-i="${i}" title="Remove">✕</button></td>`;
    body.appendChild(tr);
  });
  body.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('change', async e => {
      HQ_DOMAINS[+e.target.dataset.i] = e.target.value.trim();
      await saveHqDomains();
      renderHqQueueTable(); // dropdown options need refreshing
    });
  });
  body.querySelectorAll('.row-del').forEach(btn => {
    btn.addEventListener('click', async e => {
      HQ_DOMAINS.splice(+e.target.dataset.i, 1);
      await saveHqDomains();
      renderHqDomainsTable();
      renderHqQueueTable();
    });
  });
}
document.getElementById('hqDomainsAddRowBtn').addEventListener('click', async () => {
  HQ_DOMAINS.push('');
  await saveHqDomains();
  renderHqDomainsTable();
});
document.getElementById('hqDomainsResetBtn').addEventListener('click', async () => {
  if (!confirm('Reset the known-domains list to defaults?')) return;
  HQ_DOMAINS = JSON.parse(JSON.stringify(HQ_DEFAULT_DOMAINS));
  await saveHqDomains();
  renderHqDomainsTable();
  renderHqQueueTable();
});

function renderHqProgress() {
  const list = document.getElementById('hqProgressList');
  if (!HQ_QUEUE.length) { list.innerHTML = '<div class="hint">Queue is empty — nothing left to scan.</div>'; return; }
  list.innerHTML = HQ_QUEUE.map((row, i) => {
    const label = row.idStart != null
      ? (row.idEnd != null ? `orders ${row.idStart}-${row.idEnd}` : `orders ${row.idStart} onward (auto-detect end)`)
      : (row.sinceHoursAgo != null ? `last ${row.sinceHoursAgo}h` : '(no range set)');
    const isCurrent = i === 0 && HQ_RUN_STATE === 'running';
    return `<div class="hint">${isCurrent ? '<span class="spinner">⟳</span>' : '⏳'} ${escapeAttr(row.domain || '(no domain)')} — ${label}${isCurrent ? ' (in progress...)' : ''}</div>`;
  }).join('');
}

function renderMismatchTable(mismatches) {
  const rows = mismatches.map(m => `
    <tr>
      <td>${escapeAttr(String(m.id))}</td>
      <td>${escapeAttr(m.shippingRegion || '—')}</td>
      <td>${escapeAttr(m.transactionType || '—')}</td>
      <td>${m.mismatchDirection === 'over' ? 'Over-collected' : (m.mismatchDirection === 'under' ? 'Under-collected' : '—')}</td>
      <td>$${escapeAttr(String(m.exciseTaxCollected ?? '0'))}</td>
      <td>$${escapeAttr(String(m.recalculatedTaxSum ?? 0))}</td>
      <td>${escapeAttr((m.ruleKeys || []).join(', ') || '—')}</td>
    </tr>`).join('');
  return `
    <div class="table-scroll"><table class="cfg" style="margin-top:0;">
      <thead><tr><th>Order ID</th><th>Region</th><th>Type</th><th>Direction</th><th>Collected</th><th>Should've collected</th><th>Rule(s) applied</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function renderOverchargeTable(overcharged) {
  const rows = [];
  (overcharged || []).forEach(o => {
    (o.overchargeLines || []).forEach(l => {
      const hasEstimate = l.estimatedOvertaxTotal != null;
      rows.push(`
    <tr>
      <td>${escapeAttr(String(o.id))}</td>
      <td>${escapeAttr(o.shippingRegion || '—')}</td>
      <td>${escapeAttr(l.sku)}</td>
      <td>${escapeAttr(l.productName || '—')}</td>
      <td>${escapeAttr(String(l.qty))}</td>
      <td>$${escapeAttr(String(l.actualPrice))}</td>
      <td>$${escapeAttr(String(l.catalogPrice))}</td>
      <td>$${escapeAttr(String(l.delta))}</td>
      <td>${hasEstimate ? `~$${escapeAttr(String(l.estimatedOvertaxTotal))} <span style="opacity:0.65;" title="${l.rateSource === 'confirmed' ? 'Rate sourced directly from the State Tax Rules page, not inferred.' : 'Rate inferred from calc-detail samples on other orders — less certain than a sourced rate.'}">(rate ${escapeAttr(String(Math.round(l.rateUsed * 1000) / 10))}%${l.rateSource === 'confirmed' ? ', confirmed' : `, learned, n=${escapeAttr(String(l.rateSamples))}`})</span>` : '<span style="opacity:0.55;" title="This line is on the retail-price-based allowlist but has no rate yet — shouldn\'t normally happen since every allowlisted state has a documented rate; worth a second look if seen.">no rate available</span>'}</td>
    </tr>`);
    });
  });
  return `
    <div class="table-scroll"><table class="cfg" style="margin-top:0;">
      <thead><tr><th>Order ID</th><th>Region</th><th>SKU</th><th>Product</th><th>Qty</th><th>Actual price</th><th>Catalog price</th><th>Delta/unit</th><th>Est. tax overcharged</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table></div>`;
}

function renderPossiblyMissedTaxTable(flaggedOrders) {
  const rows = [];
  (flaggedOrders || []).forEach(o => {
    (o.possiblyMissedTaxLines || []).forEach(l => {
      rows.push(`
    <tr>
      <td>${escapeAttr(String(o.id))}</td>
      <td>${escapeAttr(o.shippingRegion || '—')}</td>
      <td>${escapeAttr(l.sku)}</td>
      <td>${escapeAttr(l.productName || '—')}</td>
      <td>${escapeAttr(String(l.qty))}</td>
      <td>$${escapeAttr(String(l.catalogPrice))}</td>
    </tr>`);
    });
  });
  return `
    <div class="table-scroll"><table class="cfg" style="margin-top:0;">
      <thead><tr><th>Order ID</th><th>Region</th><th>SKU</th><th>Product</th><th>Qty</th><th>Catalog price</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table></div>`;
}

// Verdict/Recalculated columns added 2026-09-02 — see investigateUnverifiedCollected
// for how `o.investigation` gets populated (auto-run once per order in this bucket,
// via the Order Investigation API, right after the scan). Three states per row:
// no `investigation` field at all (shouldn't normally happen post-2026-09-02, but
// covers stale saved results from before this existed), investigation.ok === false
// (either 'no-creds' — nobody's saved Order Investigation credentials yet — or a
// real per-order failure), and investigation.ok === true (a real verdict).
function renderUnverifiedCollectedTable(flaggedOrders) {
  const rows = (flaggedOrders || []).map(o => {
    const inv = o.investigation;
    let verdictCell, recalcCell;
    if (!inv) {
      verdictCell = `<span style="color:var(--muted);font-style:italic;">not checked</span>`;
      recalcCell = '—';
    } else if (!inv.ok) {
      verdictCell = inv.reason === 'no-creds'
        ? `<span style="color:var(--muted);font-style:italic;">no Order Investigation credentials saved</span>`
        : `<span style="color:var(--danger);font-style:italic;">check failed: ${escapeAttr(inv.reason)}</span>`;
      recalcCell = '—';
    } else {
      const vs = invVerdictStyle(inv.verdictCode);
      verdictCell = `<span class="badge" style="color:${vs.color};border-color:${vs.border};background:${vs.bg};">${escapeAttr(inv.verdictCode || 'unknown')}</span>`;
      recalcCell = inv.recalculatedNowState === 'present' ? `$${escapeAttr(String(inv.recalculatedNow))}` : `<span style="color:var(--muted);font-style:italic;">${escapeAttr(inv.recalculatedNowState || 'absent')}</span>`;
    }
    return `
    <tr>
      <td>${escapeAttr(String(o.id))}</td>
      <td>${escapeAttr(o.shippingRegion || '—')}</td>
      <td>$${escapeAttr(String(o.exciseTaxCollected))}</td>
      <td>${verdictCell}</td>
      <td>${recalcCell}</td>
    </tr>`;
  });
  return `
    <div class="table-scroll"><table class="cfg" style="margin-top:0;">
      <thead><tr><th>Order ID</th><th>Region</th><th>Collected</th><th>Order Investigation verdict</th><th>Recalculated</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table></div>`;
}

function renderWholesaleCostMismatchTable(flaggedOrders) {
  const rows = [];
  (flaggedOrders || []).forEach(o => {
    (o.wholesaleCostMismatches || []).forEach(m => {
      rows.push(`
    <tr>
      <td>${escapeAttr(String(o.id))}</td>
      <td>${escapeAttr(o.shippingRegion || '—')}</td>
      <td>${escapeAttr(m.sku || '—')}</td>
      <td>${escapeAttr(m.productName || '—')}</td>
      <td>${escapeAttr(m.ruleKey)}</td>
      <td>$${escapeAttr(String(m.wholesaleCost))}</td>
      <td>${escapeAttr(String(Math.round(m.rate * 1000) / 10))}%</td>
      <td>$${escapeAttr(String(m.expectedUnitTax))}</td>
      <td>$${escapeAttr(String(m.actualUnitTax))}</td>
      <td><span class="badge flag">${escapeAttr(m.direction)}</span></td>
    </tr>`);
    });
  });
  return `
    <div class="table-scroll"><table class="cfg" style="margin-top:0;">
      <thead><tr><th>Order ID</th><th>Region</th><th>SKU</th><th>Product</th><th>Rule</th><th>Wholesale cost</th><th>Rate</th><th>Expected unit tax</th><th>Actual unit tax</th><th>Direction</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table></div>`;
}

function renderFlatRateMismatchTable(flaggedOrders) {
  const rows = [];
  (flaggedOrders || []).forEach(o => {
    (o.flatRateMismatches || []).forEach(m => {
      rows.push(`
    <tr>
      <td>${escapeAttr(String(o.id))}</td>
      <td>${escapeAttr(o.shippingRegion || '—')}</td>
      <td>${escapeAttr(m.sku || '—')}</td>
      <td>${escapeAttr(m.productName || '—')}</td>
      <td>${escapeAttr(m.ruleKey)}</td>
      <td>${escapeAttr(String(m.volumeInMl))} mL</td>
      <td>$${escapeAttr(String(m.rate))}/mL</td>
      <td>$${escapeAttr(String(m.expectedUnitTax))}</td>
      <td>$${escapeAttr(String(m.actualUnitTax))}</td>
      <td><span class="badge flag">${escapeAttr(m.direction)}</span></td>
    </tr>`);
    });
  });
  return `
    <div class="table-scroll"><table class="cfg" style="margin-top:0;">
      <thead><tr><th>Order ID</th><th>Region</th><th>SKU</th><th>Product</th><th>Rule</th><th>Volume</th><th>Rate</th><th>Expected unit tax</th><th>Actual unit tax</th><th>Direction</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table></div>`;
}

function renderTaxOpsCrossCheckTable(flaggedOrders) {
  const rows = [];
  (flaggedOrders || []).forEach(o => {
    (o.taxOpsCrossCheck || []).forEach(m => {
      const flags = [];
      if (m.hasOverride) flags.push('<span class="badge flag">per-org override</span>');
      if (m.rateDisagrees) flags.push('<span class="badge flag">rate disagrees</span>');
      if (m.uncoveredButRated) flags.push('<span class="badge flag">not on any table here</span>');
      rows.push(`
    <tr>
      <td>${escapeAttr(String(o.id))}</td>
      <td>${escapeAttr(o.shippingRegion || '—')}</td>
      <td>${escapeAttr(m.sku || '—')}</td>
      <td>${escapeAttr(m.ruleKey)}</td>
      <td>${escapeAttr(m.assumedTable || '—')}${m.assumedRate != null ? ' (' + escapeAttr(String(Math.round(m.assumedRate * 1000) / 10)) + '%)' : ''}</td>
      <td>${m.liveRate != null ? escapeAttr(String(Math.round(m.liveRate * 1000) / 10)) + '%' : '—'} / ${escapeAttr(m.liveBasis || '—')}</td>
      <td>${escapeAttr(m.liveSource || '—')}</td>
      <td>${flags.join(' ')}</td>
    </tr>`);
    });
  });
  return `
    <div class="table-scroll"><table class="cfg" style="margin-top:0;">
      <thead><tr><th>Order ID</th><th>Region</th><th>SKU</th><th>Rule</th><th>This tool assumes</th><th>Tax Ops Hq says</th><th>Source</th><th>Flags</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table></div>`;
}

function renderHqResults() {
  const panel = document.getElementById('hqResultsPanel');
  const summary = document.getElementById('hqResultsSummary');
  const list = document.getElementById('hqResultsList');
  if (!HQ_RESULTS.length) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';

  const flagged = HQ_RESULTS.filter(r => r.mismatchCount > 0);
  const overchargedOrgs = HQ_RESULTS.filter(r => r.overchargedCount > 0);
  const possiblyMissedTaxOrgs = HQ_RESULTS.filter(r => r.possiblyMissedTaxCount > 0);
  const wholesaleCostOrgs = HQ_RESULTS.filter(r => r.wholesaleCostFlaggedCount > 0);
  const flatRateOrgs = HQ_RESULTS.filter(r => r.flatRateFlaggedCount > 0);
  const taxOpsOrgs = HQ_RESULTS.filter(r => r.taxOpsFlaggedCount > 0);
  const taxOpsUnavailableOrgs = HQ_RESULTS.filter(r => r.taxOpsStatus && r.taxOpsStatus !== 'ok');
  const investigationClearedOrgs = HQ_RESULTS.filter(r => r.investigationClearedMismatchesCount > 0);
  const errored = HQ_RESULTS.filter(r => r.error);
  summary.textContent = `Scanned ${HQ_RESULTS.length} org(s) — ${flagged.length} with mismatches, ${overchargedOrgs.length} with a stale catalog price (possible overcharge), ${possiblyMissedTaxOrgs.length} with a possible missed tax (isExempt fallback), ${wholesaleCostOrgs.length} with a wholesale-cost-basis rate mismatch, ${flatRateOrgs.length} with a flat per-mL rate mismatch, ${taxOpsOrgs.length} with a Tax Ops Hq cross-check hit, ${errored.length} couldn't be scanned.${taxOpsUnavailableOrgs.length ? ` Tax Ops Hq cross-check was unavailable for ${taxOpsUnavailableOrgs.length} org(s) — see below.` : ''}${investigationClearedOrgs.length ? ` ${investigationClearedOrgs.reduce((s, r) => s + r.investigationClearedMismatchesCount, 0)} mismatch(es) across ${investigationClearedOrgs.length} org(s) were cleared by Order Investigation and are shown separately, not counted above.` : ''}`;

  list.innerHTML = '';
  HQ_RESULTS.forEach((r, i) => {
    const item = document.createElement('div');
    item.className = 'diag-item';
    if (r.error) {
      item.innerHTML = `
        <div class="diag-head">
          <div class="diag-title">${escapeAttr(r.domain)}</div>
          <span class="badge err">Error</span>
        </div>
        <div class="diag-summary">Could not complete: ${escapeAttr(r.error)}</div>`;
    } else {
      const badge = r.mismatchCount > 0 ? 'flag' : 'ok';
      const badgeText = r.mismatchCount > 0 ? `${r.mismatchCount} mismatch(es)` : 'Clean';
      const overchargeBadge = r.overchargedCount > 0 ? `<span class="badge flag">${r.overchargedCount} order(s) w/ stale price</span>` : '';
      const possiblyMissedTaxBadge = r.possiblyMissedTaxCount > 0 ? `<span class="badge flag">${r.possiblyMissedTaxCount} order(s) w/ possible missed tax</span>` : '';
      const wholesaleCostBadge = r.wholesaleCostFlaggedCount > 0 ? `<span class="badge flag">${r.wholesaleCostFlaggedCount} order(s) w/ wholesale-cost mismatch</span>` : '';
      const flatRateBadge = r.flatRateFlaggedCount > 0 ? `<span class="badge flag">${r.flatRateFlaggedCount} order(s) w/ flat-rate mismatch</span>` : '';
      const taxOpsBadge = r.taxOpsFlaggedCount > 0 ? `<span class="badge flag">${r.taxOpsFlaggedCount} order(s) w/ Tax Ops Hq cross-check hit</span>` : '';
      const unverifiedCollectedBadge = r.unverifiedCollectedCount > 0 ? `<span class="badge flag">${r.unverifiedCollectedCount} order(s) collected but unverifiable</span>` : '';
      const taxOpsUnavailableBadge = (r.taxOpsStatus && r.taxOpsStatus !== 'ok') ? `<span class="badge">Tax Ops Hq cross-check: ${escapeAttr(r.taxOpsStatus === 'not-signed-in' ? 'not signed in to taxes.tokenoftrust.com' : r.taxOpsStatus)}</span>` : '';
      // 2026-09-09: see the investigationClearedMismatches comment near
      // investigateUnverifiedCollected's second call site (runHqScan) — these
      // are mismatches calc-detail flagged that Order Investigation's own
      // live recalculation verdicts "healthy" (e.g. a customer-level
      // exemption calc-detail never surfaces), so they're broken out of the
      // main mismatch badge/table rather than left clogging it.
      const investigationClearedBadge = r.investigationClearedMismatchesCount > 0 ? `<span class="badge ok">${r.investigationClearedMismatchesCount} order(s) cleared by Order Investigation</span>` : '';
      item.innerHTML = `
        <div class="diag-head">
          <div class="diag-title">${escapeAttr(r.domain)}</div>
          <div class="diag-badges"><span class="badge ${badge}">${badgeText}</span>${overchargeBadge}${possiblyMissedTaxBadge}${wholesaleCostBadge}${flatRateBadge}${taxOpsBadge}${taxOpsUnavailableBadge}${unverifiedCollectedBadge}${investigationClearedBadge}</div>
        </div>
        <div class="diag-summary">${r.checked} order(s) found and checked (${r.notFound} in the range didn't exist / 404'd) — ${r.mismatchCount} of those ${r.checked} show the mismatch pattern.${r.highestFoundId != null ? ` Newest order found: <strong>${r.highestFoundId}</strong> — use this as next cycle's start ID.` : ''}</div>
        <!-- 2026-09-09 (v3.17.29): the nav-check/server-session-check line lived
             here through the multi-org session-loss investigation (v3.17.26
             persisted it so it wouldn't only flash by in the status line) —
             Marc confirmed v3.17.28's fix holds, so this debug line no longer
             belongs in front of every clean scan. navDiag/sessionChecks are
             still collected and still stored on r (harmless, cheap, and worth
             keeping in case this ever needs debugging again) — just not
             rendered for a successful org anymore. Still shown on error
             entries below, where it's still useful. -->
        ${r.notRequired != null ? `<div class="diag-summary" style="margin-top:4px;">${r.checked} checked:<div style="margin-top:2px;padding-left:14px;font-family:monospace;line-height:1.6;">${r.notRequired} tot-excise-tax-not-required<br>${r.collected} tot-excise-tax-collected<br>${r.incorrect} tot-excise-tax-incorrect${r.unverifiedCollectedCount > 0 ? `<br>${r.unverifiedCollectedCount} collected but unverifiable (calc-detail empty)` : ''}</div></div>` : ''}
        ${r.unverifiedCollectedCount > 0 ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);"><div style="font-weight:600;margin-bottom:4px;">${r.unverifiedCollectedCount} order(s) collected excise tax but calc-detail returned no rules:</div><div class="diag-summary" style="margin-bottom:6px;">Cross-checked against the Order Investigation API (needs credentials saved on that tab) — the table below shows its verdict and recalculated amount where that check ran; if it didn't run or came back inconclusive, check the order manually via HQ's "How was this tax calculated" tool or the Order Investigation tab before drawing a conclusion.</div>${renderUnverifiedCollectedTable(r.unverifiedCollected)}</div>` : ''}
        ${r.mismatchCount > 0 ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);"><div style="font-weight:600;margin-bottom:4px;">Order IDs tagged tot-excise-tax-incorrect:</div>${renderMismatchTable(r.mismatches)}</div>` : ''}
        ${r.investigationClearedMismatchesCount > 0 ? `<div class="diag-summary" style="margin-top:4px;" title="Flagged by calc-detail as a mismatch, but Order Investigation's own live recalculation verdicts these orders healthy/exempt (e.g. a customer-level isExemptCustomer exemption calc-detail never surfaces) — no longer counted in tot-excise-tax-incorrect above.">${r.investigationClearedMismatchesCount} order(s) cleared by Order Investigation (healthy/exempt): ${r.investigationClearedMismatches.map(m => escapeAttr(String(m.id))).join(', ')}</div>` : ''}
        ${r.overchargedCount > 0 ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);"><div style="font-weight:600;margin-bottom:4px;">${r.overchargedCount} order(s) with a line where TOT's saved catalog price is above what was actually charged:</div><div class="diag-summary" style="margin-bottom:6px;">Estimated tax overcharged so far: <strong>~$${r.estimatedOverchargeTotal}</strong>. Only jurisdiction+SKU-type combos confirmed retail-price-based on TaxOps Portal's State Tax Rules page are checked at all (currently NY::vape and WA::vape/nicotinePouch) — everything else is skipped by default, since most states tax by wholesale cost/price, a flat per-mL/per-unit amount, or not at all, where a stale catalog retail price is irrelevant to the tax owed. This is still an estimate, not a confirmed dollar amount — always double-check against HQ's "How was this tax calculated" tool before acting on it.</div>${renderOverchargeTable(r.overcharged)}</div>` : ''}
        ${r.possiblyMissedTaxCount > 0 ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);"><div style="font-weight:600;margin-bottom:4px;">${r.possiblyMissedTaxCount} order(s) with a nicotine vape line marked exempt but missing its volume classification:</div><div class="diag-summary" style="margin-bottom:6px;">Speculative, unconfirmed lead — not a proven miss. Per BigCommerce's own totProductBuilder.node.js source, a vape product's isExempt gets set to true automatically whenever it's missing volumeInMl or a classifiable vapeSystemType, which is a fallback for incomplete product data rather than a genuine exemption. These lines match that pattern (isExempt, hasNicotine, no volumeInMl on file, non-trivial catalog price) but haven't been checked against a real order the way the overcharge findings above were. Verify each one manually via HQ's "How was this tax calculated" tool before treating it as a real missed tax.</div>${renderPossiblyMissedTaxTable(r.possiblyMissedTax)}</div>` : ''}
        ${r.wholesaleCostFlaggedCount > 0 ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);"><div style="font-weight:600;margin-bottom:4px;">${r.wholesaleCostFlaggedCount} order(s) with a wholesale-cost-basis tax mismatch:</div><div class="diag-summary" style="margin-bottom:6px;">These states (CO, DC, HI, ME, MA, NV, OR, TN, UT, VT, WY) tax as a percentage of wholesaleCost — a field distinct from retailPrice/wholesalePrice/msrp, so this is a direct expected-vs-actual comparison, not a price-gap estimate. Only CO is confirmed against a real order; the rest are transcribed from the TaxOps sheet and unverified — and it's unconfirmed whether calc-detail always exposes wholesaleCost the way it exposes retailPrice, so a quiet run isn't proof of a clean one either. "Direction" shows whether the actual unit tax charged was above or below the expected amount. Verify each hit via HQ's "How was this tax calculated" tool before acting on it.</div>${renderWholesaleCostMismatchTable(r.wholesaleCostFlagged)}</div>` : ''}
        ${r.flatRateFlaggedCount > 0 ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);"><div style="font-weight:600;margin-bottom:4px;">${r.flatRateFlaggedCount} order(s) with a flat per-mL rate mismatch:</div><div class="diag-summary" style="margin-bottom:6px;">These states (VA, OH, DE, IA, KS, LA, NC, WV, WI) tax a flat dollar amount per mL, with no price/cost field involved at all — the most reliable check in this tool, since there's no price-field ambiguity to get wrong. VA and OH are confirmed against real orders (2447866, 2447910); the rest are transcribed from the TaxOps sheet and unverified. "Direction" shows whether the actual unit tax charged was above or below the expected amount. Verify each hit via HQ's "How was this tax calculated" tool before acting on it.</div>${renderFlatRateMismatchTable(r.flatRateFlagged)}</div>` : ''}
        ${r.taxOpsFlaggedCount > 0 ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);"><div style="font-weight:600;margin-bottom:4px;">${r.taxOpsFlaggedCount} order(s) with a Tax Ops Hq effective-rules cross-check hit:</div><div class="diag-summary" style="margin-bottom:6px;">Live-verified 2026-09-01 — see the README changelog entries with that date. Compares this tool's hand-maintained rate tables against taxes.tokenoftrust.com's own per-org rule overrides (GET /api/clients/&lt;domain&gt;) and global reference rates (GET /api/tax-calendar/rules) — replaces the originally-proposed GET /api/effective-rules, confirmed dead (always empty) the same day. "per-org override" means Tax Ops Hq has an override active for this org that this tool has no other visibility into. "rate disagrees" means the live rate doesn't match what this tool assumes. "not on any table here" means Tax Ops Hq has a nonzero rate for this state+type but this tool currently skips it entirely. This does NOT recompute "the correct tax" from the live rate+basis — only flags the disagreement for a human to check via HQ's "How was this tax calculated" tool, since it's unconfirmed whether Tax Ops Hq's "basis" field maps to retailPrice/wholesaleCost/volume the same way this tool's own tables assume.</div>${renderTaxOpsCrossCheckTable(r.taxOpsFlagged)}</div>` : ''}`;
    }
    list.appendChild(item);
  });
}

document.getElementById('hqClearResultsBtn').addEventListener('click', async () => {
  HQ_RESULTS = [];
  await saveHqResults();
  renderHqResults();
  setHqStatus('Results cleared.', 'ok');
});

// ---- functions injected into the real HQ tab via chrome.scripting.executeScript ----
// These run in the PAGE's own context (same-origin as app.tokenoftrust.com), so
// fetch() calls here are ordinary same-origin requests — no CORS/host_permissions
// gymnastics needed for the actual API calls, only for injecting this code at all.
// Must be fully self-contained (no references to outer popup.js scope).

function hqStageSelectOrg(domain) {
  return (async () => {
    function setNativeValue(el, value) {
      const proto = Object.getPrototypeOf(el);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      desc.set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // 2026-09-09 diagnostic: a real session loss doesn't always show up as a
    // hard redirect to /hq/signin — live testing (giantvapes.com -> mmschainportal.com,
    // Marc's own recording) caught it landing back on /hq/choose-app with the
    // sidebar showing "NO ORGANIZATION."/"No User Name" and the org-search
    // dropdown coming back "Sorry, no matching options" for a domain that's
    // definitely real. The two checks below catch both shapes rather than
    // only the URL-redirect one, and tag which shape was actually seen so a
    // real session loss stops getting silently reported as "domain not
    // found in HQ" (see the not-found branch further down).
    if (location.pathname.includes('/hq/signin')) return { ok: false, reason: 'logged-out', detectedAfter: 'choose-app-entry (redirected to /hq/signin)' };
    const input = document.querySelector('input.vs__search');
    if (!input) return { ok: false, reason: 'logged-out', detectedAfter: 'choose-app-entry (no org search box on the page)' };
    input.click();
    input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    setNativeValue(input, domain);
    // 2026-09-09 (v3.17.23): was a flat 900ms sleep, then read whatever the
    // dropdown had at that instant. Video 5 caught this org-search coming back
    // "Sorry, no matching options" for mmschainportal.com right after Marc had
    // manually signed back in from a fresh /hq/signin — i.e. right when the
    // org list is most likely still loading, not warm/cached the way it would
    // be mid-session. A fixed 900ms can't tell "genuinely not in the list" from
    // "still loading," so this polls instead: keep checking for a real match,
    // and only accept "no matches" once vue-select's own empty-state <li>
    // ("Sorry, no matching options") has been the ENTIRE option list for a bit
    // (not just the first instant it appears, in case it flashes briefly while
    // the real list is still being fetched), or the timeout is hit.
    async function waitForDropdownSettled(timeoutMs) {
      const start = Date.now();
      let opts = [];
      let emptyStateSince = null;
      while (Date.now() - start < timeoutMs) {
        opts = Array.from(document.querySelectorAll('li'));
        const match = opts.find(l => l.textContent.trim() === domain);
        if (match) return { match, opts };
        const isEmptyState = opts.length === 1 && /no matching options/i.test(opts[0].textContent || '');
        if (isEmptyState) {
          if (emptyStateSince == null) emptyStateSince = Date.now();
          if (Date.now() - emptyStateSince > 1200) return { match: null, opts };
        } else {
          emptyStateSince = null;
        }
        await new Promise(r => setTimeout(r, 400));
      }
      return { match: null, opts };
    }
    const { match, opts } = await waitForDropdownSettled(4000);
    if (!match) {
      // "NO ORGANIZATION." is this app's own sidebar placeholder for
      // no-org-selected/no-session — a real domain typo or a not-yet-added
      // org wouldn't show this, only a session that's lost its org context.
      const sidebarLoggedOut = /no organization\./i.test(document.body.innerText || '');
      if (sidebarLoggedOut) return { ok: false, reason: 'logged-out', detectedAfter: `choose-app-search for ${domain} (sidebar shows "NO ORGANIZATION.", dropdown had no matches)`, opts: opts.map(o => o.textContent.trim()) };
      return { ok: false, reason: 'not-found', opts: opts.map(o => o.textContent.trim()) };
    }
    match.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    match.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    match.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 1000));
    return { ok: true };
  })();
}

// Export Taxlines CSV for a date range (2026-08-27) — injected into the real
// HQ tab the same way hqStageScan is, and for the same reason (see "Why
// chrome.scripting" in the README): org-switch and token-mint only happen
// through in-page app state, not a directly-callable endpoint.
//
// This is a separate injected function rather than a new branch reusing
// hqStageScan's own body, because chrome.scripting.executeScript's `func`
// option requires a fully self-contained function — it can't close over
// anything from popup.js's outer scope, including other functions defined
// there. That means the token-mint block below and the taxlineRows-building
// block are duplicates of the same code in hqStageScan/scanOneOrder rather
// than a shared helper — if the row shape ever changes, both copies need the
// update. Deliberately does NOT carry over the mismatch/overcharge/
// wholesale-cost/flat-rate diagnostic computations scanOneOrder does — none
// of that is needed for a CSV-only pull, so this stays smaller and faster.
function hqStageTaxlinesExport(domain, sinceIso, untilIso) {
  return (async () => {
    function findButtonByText(txt) {
      return Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === txt);
    }
    async function waitForTokenUiReady(timeoutMs) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (findButtonByText('Reset token') || findButtonByText('Generate a new access token') ||
            findButtonByText('Create a new access token') || document.getElementById('collapsed-token-value')) {
          return true;
        }
        await new Promise(r => setTimeout(r, 300));
      }
      return false;
    }
    await waitForTokenUiReady(8000);
    await new Promise(r => setTimeout(r, 1000));

    const resetBtn = findButtonByText('Reset token');
    if (resetBtn) { resetBtn.click(); await new Promise(r => setTimeout(r, 500)); }
    const createBtn = findButtonByText('Generate a new access token') || findButtonByText('Create a new access token');
    if (createBtn) { createBtn.click(); await new Promise(r => setTimeout(r, 1800)); }

    const codeEl = document.getElementById('collapsed-token-value');
    let full = codeEl && codeEl.getAttribute('data-full-token');
    if (!full || full === 'No token') {
      const start2 = Date.now();
      while ((!full || full === 'No token') && Date.now() - start2 < 4000) {
        await new Promise(r => setTimeout(r, 400));
        const el2 = document.getElementById('collapsed-token-value');
        full = el2 && el2.getAttribute('data-full-token');
      }
    }
    if (!full || full === 'No token') return { ok: false, reason: 'no-token' };

    let decoded;
    try { decoded = JSON.parse(atob(full)); } catch (e) { return { ok: false, reason: 'decode-failed: ' + e.message }; }
    if (decoded.referrerOrigin !== domain) return { ok: false, reason: `wrong-scope (token was for ${decoded.referrerOrigin})` };
    const token = full;

    // Paginate via date-bisection, not an offset/cursor — GET /exciseTax/orders
    // has neither, only since/until/limit (max 1000). Splitting the window in
    // half whenever a call comes back exactly at the cap works regardless of
    // what order the API returns results in, unlike paging by "last seen
    // timestamp" which would assume a sort order this API doesn't document.
    // depth is a safety backstop against a truly degenerate range, not
    // expected to matter for a normal month-sized export.
    async function fetchIdsInRange(since, until, depth) {
      const res = await fetch(`/api/exciseTax/orders?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&limit=1000`, {
        headers: { Accept: 'application/json', Authorization: 'Bearer ' + token }
      });
      if (res.status !== 200) return { error: `list-orders failed (status ${res.status}) for ${since}..${until}` };
      const body = await res.json();
      const orders = body?.content?.orders || [];
      if (orders.length < 1000 || depth > 12) return orders.map(o => o.orderId || o.id);
      const sinceMs = new Date(since).getTime(), untilMs = new Date(until).getTime();
      const midMs = sinceMs + Math.floor((untilMs - sinceMs) / 2);
      if (!(midMs > sinceMs) || !(midMs < untilMs)) return orders.map(o => o.orderId || o.id);
      const mid = new Date(midMs).toISOString();
      const [left, right] = await Promise.all([fetchIdsInRange(since, mid, depth + 1), fetchIdsInRange(mid, until, depth + 1)]);
      if (left && left.error) return left;
      if (right && right.error) return right;
      return Array.from(new Set([...left, ...right]));
    }

    // Best-effort progress ping back to the popup — this whole function only
    // returns once at the very end via chrome.scripting.executeScript, so
    // without this the popup has no way to show a percentage/ETA while it
    // waits. Fire-and-forget (not awaited) so a slow/missing listener (popup
    // closed, no one home) never adds latency to the actual fetch loop; wrapped
    // since sendMessage can throw synchronously if the extension context has
    // gone away mid-run.
    function reportProgress(payload) {
      try { chrome.runtime.sendMessage(Object.assign({ type: 'hqTaxlinesProgress' }, payload)).catch(() => {}); } catch (e) {}
    }

    const idResult = await fetchIdsInRange(sinceIso, untilIso, 0);
    if (idResult && idResult.error) return { ok: false, reason: idResult.error };
    const orderIds = idResult;
    reportProgress({ phase: 'listed', total: orderIds.length });

    // Same three-source SKU join as scanOneOrder's taxlineRows block — see
    // the comment there for the full source-by-source breakdown and the
    // deliberate PII/unavailable-field gaps. Kept in sync by hand; not
    // shared, per the note at the top of this function.
    async function fetchOneOrderTaxlines(id) {
      const orderRes = await fetch(`/api/exciseTax/order/${id}`, { headers: { Accept: 'application/json', Authorization: 'Bearer ' + token } });
      if (orderRes.status !== 200) return [];
      const orderBody = await orderRes.json();
      const order = orderBody?.content?.order;
      if (!order) return [];
      const calcRes = await fetch(`/api/exciseTax/orders/${id}/calc-detail`, { headers: { Accept: 'application/json', Authorization: 'Bearer ' + token } });
      const calcBody = calcRes.status === 200 ? await calcRes.json() : null;
      const events = calcBody?.content?.events || [];
      const calcEvent = events.find(e => e.eventType === 'calculation') || events[0] || {};
      const cd = calcEvent.calcDetail || {};
      const skeletonEvent = cd.partial === true || cd.source === 'skeleton';
      const calcProductsBySku = {};
      (cd.products || []).forEach(p => { if (p.sku) calcProductsBySku[p.sku] = p; });
      const skippedBySku = {};
      (cd.skippedProducts || []).forEach(p => { if (p.sku) skippedBySku[p.sku] = p; });
      const catalogBySku = order?.products || {};

      return (order?.transactionLines || []).map(line => {
        const sku = line.sku;
        const calcP = sku ? calcProductsBySku[sku] : null;
        const catalogP = sku ? catalogBySku[sku] : null;
        const meta = calcP || catalogP || {};
        const qty = parseFloat(line.quantity) || 0;
        const unitPrice = parseFloat(line.unitDiscountedPrice ?? line.unitSalesPrice) || 0;
        const tags = meta.tags || [];
        const hasTag = t => tags.includes(t);
        const appliedRules = (calcP && calcP.appliedRules) || [];
        const lineTax = appliedRules.reduce((s, r) => s + (r.taxForQty || 0), 0);

        let taxCollectionStatus;
        if (skeletonEvent || !events.length) taxCollectionStatus = 'no_calculation_data';
        else if (!calcP) taxCollectionStatus = skippedBySku[sku] ? ('skipped:' + (skippedBySku[sku].reason || 'unknown')) : 'not_in_calc_detail';
        else if (appliedRules.length === 0) taxCollectionStatus = meta.isExempt ? 'exempt' : 'no_rules_for_jurisdiction';
        else taxCollectionStatus = 'calculated';

        return {
          order: id,
          date: order?.timestamp || '',
          sku: sku || '',
          productName: meta.productName || '',
          productBrand: meta.productBrand || '',
          productId: line.productId || meta.productId || '',
          quantity: line.quantity ?? '',
          totalPrice: qty && unitPrice ? Math.round(qty * unitPrice * 100) / 100 : '',
          volumeInMl: meta.volumeInMl ?? '',
          wholesaleCost: meta.wholesaleCost ?? '',
          wholesalePrice: meta.wholesalePrice ?? '',
          retailPrice: meta.retailPrice ?? '',
          msrp: meta.msrp ?? '',
          productTags: tags.join(','),
          totalTax: calcP ? Math.round(lineTax * 100) / 100 : '',
          country: order?.shippingLocation?.countryCode || '',
          state: order?.shippingLocation?.regionCode || '',
          city: order?.shippingLocation?.locality || '',
          postalCode: order?.shippingLocation?.postalCode || '',
          isVape: hasTag('isVape') ? '1' : '0',
          isExempt: (meta.isExempt || hasTag('isExempt')) ? '1' : '0',
          hasNicotine: hasTag('hasNicotine') ? '1' : '0',
          isOpen: hasTag('isOpen') ? '1' : '0',
          isClosed: hasTag('isClosed') ? '1' : '0',
          closedRefillable: hasTag('closedRefillable') ? '1' : '0',
          closedCartridge: hasTag('closedCartridge') ? '1' : '0',
          closedSingleUse: hasTag('closedSingleUse') ? '1' : '0',
          batteryOnly: hasTag('batteryOnly') ? '1' : '0',
          taxCollectionStatus
        };
      });
    }

    let taxlineRows = [];
    let checked = 0, failed = 0;
    // Sequential, matching scanOneOrder's own pattern elsewhere in this file
    // — not parallelized, since this internal API's tolerance for concurrent
    // calls from one token hasn't been tested and isn't worth risking on an
    // export that already runs unattended-ish in the foreground tab.
    for (const id of orderIds) {
      try {
        const rows = await fetchOneOrderTaxlines(id);
        taxlineRows = taxlineRows.concat(rows);
        checked++;
      } catch (e) {
        failed++;
      }
      reportProgress({ phase: 'fetching', done: checked + failed, total: orderIds.length });
    }

    // Per-order rollup columns (closedVolumeMl, openVolumeMl, totalSalesOf...,
    // wholesalePriceOf...) — same approach as scanOneOrder: computed per
    // order, not independently confirmed against the original export's own
    // formula. Grouped by `order` since taxlineRows here spans many orders.
    const byOrder = {};
    taxlineRows.forEach(r => { (byOrder[r.order] = byOrder[r.order] || []).push(r); });
    const round2 = n => Math.round(n * 100) / 100;
    Object.values(byOrder).forEach(rows => {
      let closedVolumeMl = 0, openVolumeMl = 0;
      let totalSalesOfOpenSystems = 0, totalSalesOfClosedSystems = 0, totalSalesOfSingleUseSystems = 0;
      let wholesalePriceOfOpenSystems = 0, wholesalePriceOfClosedSystems = 0, wholesaleValueOfSingleUseSystems = 0;
      rows.forEach(r => {
        const qty = parseFloat(r.quantity) || 0;
        const vol = (parseFloat(r.volumeInMl) || 0) * qty;
        const wsVal = (parseFloat(r.wholesaleCost) || 0) * qty;
        const price = parseFloat(r.totalPrice) || 0;
        if (r.isOpen === '1') { openVolumeMl += vol; totalSalesOfOpenSystems += price; wholesalePriceOfOpenSystems += wsVal; }
        if (r.isClosed === '1' && r.closedSingleUse !== '1') { closedVolumeMl += vol; totalSalesOfClosedSystems += price; wholesalePriceOfClosedSystems += wsVal; }
        if (r.closedSingleUse === '1') { totalSalesOfSingleUseSystems += price; wholesaleValueOfSingleUseSystems += wsVal; }
      });
      rows.forEach(r => {
        r.closedVolumeMl = round2(closedVolumeMl) || '';
        r.openVolumeMl = round2(openVolumeMl) || '';
        r.totalSalesOfOpenSystems = round2(totalSalesOfOpenSystems) || '';
        r.totalSalesOfClosedSystems = round2(totalSalesOfClosedSystems) || '';
        r.totalSalesOfSingleUseSystems = round2(totalSalesOfSingleUseSystems) || '';
        r.wholesalePriceOfOpenSystems = round2(wholesalePriceOfOpenSystems) || '';
        r.wholesalePriceOfClosedSystems = round2(wholesalePriceOfClosedSystems) || '';
        r.wholesaleValueOfSingleUseSystems = round2(wholesaleValueOfSingleUseSystems) || '';
      });
    });

    return { ok: true, domain, since: sinceIso, until: untilIso, orderCount: orderIds.length, checked, failed, taxlineRows };
  })();
}

function hqMintToken(domain) {
  return (async () => {
    function findButtonByText(txt) {
      return Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === txt);
    }

    // 2026-09-09 (v3.17.23, next diagnostic — Marc: "it still breaks" after
    // v3.17.23's two fixes, no video this time). checkLoggedOut() below only
    // reads location.pathname on THIS page — it can't tell whether the
    // session already died server-side without this page's own bundle ever
    // re-checking or redirecting (Video 5 showed the /hq/signin redirect
    // landing a beat AFTER /hq/home rendered "NO ORGANIZATION.", not
    // instantly — the docs page may never re-validate session state against
    // the server at all once it's loaded). This adds a real server
    // round-trip at each checkpoint WITHOUT navigating the visible tab: a
    // plain fetch() to /hq/home carries the same session cookie a real
    // navigation would, and its response (final URL after any redirect, plus
    // the rendered markup) says whether the server still considers the
    // session valid RIGHT NOW, independent of whatever this page's own JS
    // believes. Purely diagnostic — never blocks the scan; a failed check
    // (network hiccup, unexpected shape, anything short of a clear
    // signed-out marker) reports ok:true, since this exists only to narrow
    // down when the session dies, not to gate anything.
    const sessionChecks = [];
    async function checkServerSessionAlive(stage) {
      let entry;
      // 2026-09-09 (v3.17.25 — this fetch had no timeout, and Marc's very next
      // run hung forever at "Switching to..." with no error ever surfacing.
      // The fetch below runs inside the injected page function; if that fetch
      // never settles (a stalled request, or the tab navigating away out from
      // under it — plausible right around the exact "Back to HQ"/choose-app
      // transition this whole investigation is about), the entire hqStageScan
      // call it's part of never resolves either, so nothing upstream ever gets
      // a chance to time out or report anything — this diagnostic itself was
      // the new hang, not a new discovery about the underlying bug. Bounded
      // with AbortController so it can never block the scan longer than 5s;
      // a timeout reports ok:true (inconclusive), same as any other failure
      // mode here — this check must never be able to hang anything.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch('/hq/home', { credentials: 'include', cache: 'no-store', redirect: 'follow', signal: controller.signal });
        let bodyText = '';
        try { bodyText = await res.text(); } catch (e) {}
        const finalUrl = res.url || '';
        const loggedOut = finalUrl.includes('/hq/signin') || /passwordless login/i.test(bodyText) || /no organization\./i.test(bodyText);
        entry = { stage, ok: !loggedOut, status: res.status, finalUrl };
      } catch (e) {
        entry = { stage, ok: true, error: (e && e.name === 'AbortError') ? 'timed out after 5s' : e.message }; // couldn't check — not proof either way
      } finally {
        clearTimeout(timer);
      }
      sessionChecks.push(entry);
      return entry;
    }

    // 2026-08-21: the docs page's Vue app can still be rendering when this
    // runs (same class of issue as the org-switch timing bug fixed earlier —
    // a fixed delay assumes the page is ready, but doesn't confirm it). Poll
    // for either token-related button, or the token element itself, to
    // actually exist before touching anything, instead of hoping 1s was
    // enough. Bounded so a truly broken page still fails instead of hanging.
    async function waitForTokenUiReady(timeoutMs) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (findButtonByText('Reset token') || findButtonByText('Generate a new access token') ||
            findButtonByText('Create a new access token') || document.getElementById('collapsed-token-value')) {
          return true;
        }
        await new Promise(r => setTimeout(r, 300));
      }
      return false;
    }
    await waitForTokenUiReady(8000);
    await new Promise(r => setTimeout(r, 1000)); // let the docs app finish its own auto-token attempt

    // 2026-09-09 diagnostic (Marc: giantvapes.com scanned fine, then got
    // logged out switching to mmschainportal.com — video confirmed org #1
    // reached this exact docs page successfully). These checkpoints pin down
    // which action the session loss actually follows instead of only
    // discovering it later, on the NEXT org's choose-app visit (see
    // hqStageSelectOrg's own checks). Session loss hasn't been confirmed to
    // always redirect to /hq/signin on THIS page, so this may still come
    // back clean here even when the loss is real — that's still useful,
    // narrowing it to "sometime after this page, before the next choose-app."
    function checkLoggedOut(stage) {
      if (location.pathname.includes('/hq/signin')) return { ok: false, reason: 'logged-out', detectedAfter: stage };
      return null;
    }
    let lo = checkLoggedOut('arrived-at-docs-page (before touching Reset token/Generate)');
    await checkServerSessionAlive('arrived-at-docs-page');
    if (lo) return { ...lo, sessionChecks };

    // 2026-09-09: switched from a hard chrome.tabs.update reload to clicking
    // through HQ's own "Back to HQ"/"Change Org" nav (v3.17.20) — Marc's own
    // side-by-side test confirmed that in-app nav path works by hand, but a
    // live run with it still lost the session on the 2nd org, so the nav
    // method wasn't actually the cause. The one thing that manual test never
    // did — that this automation always has — is Reset token + Generate a
    // new access token. That's still the leading suspect; it just doesn't
    // show up as an immediate redirect on THIS page (the calc-detail/order
    // API calls that follow use the Authorization: Bearer header, not the
    // browser's session cookie, so they'd keep working even if that click
    // already killed the cookie-based login underneath). Rather than force
    // Reset+Generate every time, check whether the docs page's own auto-token
    // (shown in the top bar before either button is ever touched — see
    // README's "auto-token" note) is already correctly scoped to this domain,
    // and only fall back to clicking Reset/Generate if it isn't. If this
    // resolves the bug, that confirms Reset/Generate itself was the trigger;
    // if it doesn't, the checkpoints below will still say so.
    function readCurrentToken() {
      const el = document.getElementById('collapsed-token-value');
      const full = el && el.getAttribute('data-full-token');
      if (!full || full === 'No token') return null;
      try {
        const decoded = JSON.parse(atob(full));
        return { full, decoded };
      } catch (e) { return null; }
    }
    const existing = readCurrentToken();
    const existingIsValidForThisDomain = existing && existing.decoded && existing.decoded.referrerOrigin === domain;

    if (!existingIsValidForThisDomain) {
      const resetBtn = findButtonByText('Reset token');
      if (resetBtn) { resetBtn.click(); await new Promise(r => setTimeout(r, 500)); }
      lo = checkLoggedOut('after-Reset-token-click');
      await checkServerSessionAlive('after-Reset-token-click');
      if (lo) return { ...lo, sessionChecks };

      const createBtn = findButtonByText('Generate a new access token') || findButtonByText('Create a new access token');
      if (createBtn) { createBtn.click(); await new Promise(r => setTimeout(r, 1800)); }
      lo = checkLoggedOut('after-Generate-a-new-access-token-click');
      await checkServerSessionAlive('after-Generate-a-new-access-token-click');
      if (lo) return { ...lo, sessionChecks };
    }

    const codeEl = document.getElementById('collapsed-token-value');
    let full = codeEl && codeEl.getAttribute('data-full-token');
    if (!full || full === 'No token') {
      // Minting itself can lag behind the click — give it a bit more room
      // before declaring no-token, rather than failing on the first check.
      const start2 = Date.now();
      while ((!full || full === 'No token') && Date.now() - start2 < 4000) {
        await new Promise(r => setTimeout(r, 400));
        const el2 = document.getElementById('collapsed-token-value');
        full = el2 && el2.getAttribute('data-full-token');
      }
    }
    if (!full || full === 'No token') return { ok: false, reason: 'no-token', sessionChecks };

    let decoded;
    try { decoded = JSON.parse(atob(full)); } catch (e) { return { ok: false, reason: 'decode-failed: ' + e.message, sessionChecks }; }
    if (decoded.referrerOrigin !== domain) return { ok: false, reason: `wrong-scope (token was for ${decoded.referrerOrigin})`, sessionChecks };

    return { ok: true, token: full, decoded, sessionChecks };
  })();
}


// 2026-09-09 (v3.17.28): extracted verbatim from hqStageScan, which used to
// run this ENTIRE section — every order/calc-detail fetch and all the
// tax-rate classification below — inside the injected page-context
// function, meaning the tab sat on the API docs subsite for as long as the
// whole scan took (potentially many orders' worth of fetches). Marc's own
// successful manual "Back to HQ"/"Change Org" test only ever dwelled on the
// docs page for a few seconds before switching org; the automation's latest
// live run proved (via real server-checked fetches, not just guesses)
// mmschainportal.com's session was still ALIVE through Reset token, Generate
// a new access token, AND right up through this section finishing — yet the
// very next real navigation still landed broken, even navigating fresh and
// directly rather than through "Back to HQ." That's consistent with dwell
// time on the docs subsite itself being what matters, not any one click —
// so this section no longer runs on the docs page at all, testing that
// directly. None of this code ever touched the DOM (confirmed by grepping
// the original for document./location./window. — nothing matched outside
// the token-minting part that stayed behind) — it only ever needed the
// bearer token — so it now runs here, in the side panel, calling the same
// Excise Tax Order API by absolute URL. The ONLY change from the original
// text below: its three fetch() calls were relative, resolving against the
// docs page's own origin when injected there; now explicit
// https://app.tokenoftrust.com URLs, since there's no page origin to
// resolve against from the side panel. Everything else — every rate table,
// every classification, every comment — is unchanged from hqStageScan.
async function hqScanOrdersWithToken(token, domain, idStart, idEnd, sinceHoursAgo, taxOpsRules) {
  // Side-panel counterpart of hqMintToken's checkServerSessionAlive — same
  // idea (a real server round-trip via fetch('/hq/home', {credentials:
  // 'include'}), bounded with an AbortController so a stall can never hang
  // this), but called from here (an absolute cross-origin URL, no page to
  // inject into) rather than from inside the tab. This is the one checkpoint
  // that moved with the scan itself: hqMintToken still separately checks
  // arrived-at-docs-page/after-Reset-token-click/after-Generate-a-new-
  // access-token-click on its own (those all happen before this function
  // ever runs); scanOneOrg combines both sets into one sessionChecks list
  // for reporting.
  async function checkServerSessionAliveFromPanel(stage) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch('https://app.tokenoftrust.com/hq/home', { credentials: 'include', cache: 'no-store', redirect: 'follow', signal: controller.signal });
      let bodyText = '';
      try { bodyText = await res.text(); } catch (e) {}
      const finalUrl = res.url || '';
      const loggedOut = finalUrl.includes('/hq/signin') || /passwordless login/i.test(bodyText) || /no organization\./i.test(bodyText);
      return { stage, ok: !loggedOut, status: res.status, finalUrl };
    } catch (e) {
      return { stage, ok: true, error: (e && e.name === 'AbortError') ? 'timed out after 5s' : e.message };
    } finally {
      clearTimeout(timer);
    }
  }

    // Learned tax-rate directory (2026-08-20): whenever calc-detail happens to
    // be populated for an order, it shows the actual per-unit tax charged
    // AND the catalog price it was computed against — dividing the two gives
    // an effective rate for that jurisdiction+SKU-type combo (e.g.
    // "US.regionCode.PA::vape"). We persist this across scans/orgs so it
    // keeps improving over time, and use it to convert a price-gap flag
    // (see overchargeLines below) into an estimated tax dollar amount even
    // on orders where calc-detail itself is empty — the order lookup alone
    // still gives us the jurisdiction (shippingLocation.regionCode) and the
    // SKU type (products[sku].type, confirmed to match calc-detail's
    // ruleSet, e.g. "vape"/"nicotinePouch") needed to look a rate up.
    // Loaded once per hqStageScan call, updated in memory as orders are
    // scanned, and written back once at the end (not per-order, to keep
    // storage writes cheap).
    const rateDirStored = await chrome.storage.local.get(['totHqRateDirectory']);
    const rateDirectory = rateDirStored.totHqRateDirectory || {};

    // 2026-08-24: replaced the old denylist approach (CONFIRMED_NON_PRICE_BASED,
    // populated one state at a time as false positives got manually found —
    // VA, OH, CO in one afternoon, three-for-three) with an allowlist
    // sourced from TaxOps Portal's "State Tax Rules" page (Vapor Products /
    // Nicotine Pouches tabs, kept current via that page's "Refresh from
    // sheet"). That page shows the actual tax basis for every state, and
    // the picture it gives is stark: the overwhelming majority of states
    // tax vapor/nicotine products by wholesale cost, wholesale price, a
    // flat per-mL/per-unit/per-container amount, or not at all — NOT as a
    // percentage of retail price. The retailPrice-vs-actual-price
    // comparison this heuristic relies on is only meaningful for the
    // handful of states where retail price genuinely is the basis, with no
    // wholesale/per-volume component mixed in by sub-type. Rather than
    // continue discovering non-retail-based states one false positive at a
    // time, default to skipping every state and only check the ones
    // confirmed retail-based. See the README changelog for the full
    // state-by-state transcription and every caveat (compound rules this
    // can't yet split by SKU sub-type, "local rules only" states, and a
    // gap in the nicotine-pouch data for AL–HI that wasn't available in
    // the screenshots reviewed).
    const RETAIL_PRICE_BASED = new Set([
      'US.regionCode.NY::vape',          // 20% of retail price of all vapor products — clean, no wholesale/per-unit component mixed in
      'US.regionCode.WA::vape',          // 95% of "selling price" — empirically confirmed via the original vaperanger.com WA investigation (catalog retailPrice matched the reported overcharge exactly)
      'US.regionCode.WA::nicotinePouch'  // same 95%/"selling price" rule shown on the pouches tab — carried over cautiously, not independently confirmed the way vape was
    ]);
    // A few states have a rate that's simply KNOWN from the compliance
    // sheet rather than needing to be learned from calc-detail samples —
    // use it directly when present, in preference to whatever's in
    // rateDirectory, so these show a sourced rate instead of "estimated
    // from other orders." (WA's "selling price" wording is a bit different
    // from "retail price" — if that turns out to mean something other than
    // the catalog retailPrice field this tool already reads, this rate
    // would need revisiting, but it's the best documented rate available.)
    const AUTHORITATIVE_RATES = {
      'US.regionCode.NY::vape': 0.20,
      'US.regionCode.WA::vape': 0.95,
      'US.regionCode.WA::nicotinePouch': 0.95
    };

    // Wholesale-cost-basis verification (2026-08-24). Most of the states the
    // two allowlists above skip entirely tax as a percentage of wholesale
    // cost, per the same TaxOps Portal State Tax Rules page — see the README
    // changelog for the full transcription. Unlike retailPrice/wholesalePrice/
    // msrp, which are all confirmed (via direct source read of BigCommerce's
    // totProductBuilder.node.js) to trace back to the exact same underlying
    // field, wholesaleCost is sourced from a genuinely distinct one
    // (variant.cost_price / product.cost_price) — so a wholesale-cost-basis
    // state doesn't carry the "which price field" ambiguity the overcharge
    // heuristic above is limited by. Where the correct rate is known, the
    // correct per-unit tax is fully knowable, so a mismatch here can be
    // flagged outright — in EITHER direction, not just "possible overcharge."
    //
    // Rates below are transcribed straight from the sheet; only CO is
    // confirmed against a real order (2447918). The rest are unverified
    // against a live order the way CO, NY, and WA are — treat hits as leads
    // to confirm via HQ's "How was this tax calculated" tool, same caution
    // as the possiblyMissedTaxLines check elsewhere in this function.
    //
    // Deliberately excluded from this list:
    // - CA: compound (51.08% wholesale + a separate 12.5% retail component on
    //   the same sale) — a single rate can't represent two stacked taxes.
    // - MN: sheet shows 95%, which looks like it's missing a "%" sign per the
    //   README's note on it — rate itself isn't trusted.
    // - PA: sheet says wholesale-basis, but the original vaperanger.com
    //   investigation found TOT's real PA tax tracking catalog retailPrice
    //   almost exactly — a confirmed contradiction between the sheet and
    //   TOT's actual behavior for this state specifically. Left off both
    //   allowlists until that discrepancy is resolved with whoever owns the
    //   rule engine.
    //
    // Also unconfirmed: whether calc-detail's per-product entries (cd.products
    // below) actually expose a wholesaleCost field the same way they expose
    // retailPrice — this hasn't been checked against a live order this
    // session. If they don't, this check simply never finds anything to flag
    // (guarded below), rather than erroring — but it means an empty result
    // here isn't yet proof that everything's fine, only that either nothing
    // reached this rate table or the field itself isn't present. Worth
    // confirming on a real CO/DC/HI/etc. order before trusting a clean run.
    const WHOLESALE_COST_BASED = {
      'US.regionCode.CO::vape': 0.56, // confirmed via order 2447918
      'US.regionCode.DC::vape': 0.64,
      'US.regionCode.HI::vape': 0.70,
      'US.regionCode.ME::vape': 0.75,
      'US.regionCode.MA::vape': 0.75,
      'US.regionCode.NV::vape': 0.30,
      'US.regionCode.OR::vape': 0.65,
      'US.regionCode.TN::vape': 0.10,
      'US.regionCode.UT::vape': 0.71,
      'US.regionCode.VT::vape': 0.92,
      'US.regionCode.WY::vape': 0.15
    };

    // Flat per-mL-basis verification (2026-08-24) — same idea as
    // WHOLESALE_COST_BASED just above, for states where price/cost isn't an
    // input to the tax at all: a flat dollar amount per mL of e-liquid. VA
    // and OH are confirmed via real orders (2447866, 2447910); the rest are
    // transcribed from the same TaxOps sheet and unverified. volumeInMl is
    // confirmed present on the ORDER endpoint's per-SKU catalog snapshot (see
    // possiblyMissedTaxLines below) — whether calc-detail's per-product
    // entries carry the same field the way they carry retailPrice hasn't
    // been directly confirmed, same open question as wholesaleCost above.
    //
    const FLAT_RATE_PER_ML = {
      'US.regionCode.VA::vape': 0.11, // confirmed via order 2447866
      'US.regionCode.OH::vape': 0.10, // confirmed via order 2447910
      'US.regionCode.DE::vape': 0.05,
      'US.regionCode.IA::vape': 0.05,
      'US.regionCode.KS::vape': 0.05,
      'US.regionCode.LA::vape': 0.15,
      'US.regionCode.NC::vape': 0.05,
      'US.regionCode.WV::vape': 0.075,
      'US.regionCode.WI::vape': 0.05
    };

    // Fixed 2026-09-03, corrected same day: alternativepods.com order 304939
    // (Stevens Point, WI) got flagged "undercharged" on all 28 vape lines
    // against WI::vape's $0.05/mL above. HQ's own live "How was this tax
    // calculated" page for that order says "Vape: Wisconsin is exempt from
    // excise taxes on vapes" — but Marc confirmed that reference is scoped
    // to alternativepods.com specifically (an org-level override), not a
    // change to Wisconsin's general rate. An earlier version of this fix
    // removed WI::vape from the table above entirely, which would have
    // wrongly suppressed a real mismatch on any OTHER org's WI vape order —
    // reverted that; the table above keeps the $0.05/mL default. This map is
    // the correct, narrowly-scoped fix: per-org exceptions to the tables
    // above, checked before any of them, so one client's confirmed override
    // doesn't get applied to every org this tool scans. Add a domain here
    // only once you have the same kind of direct, live confirmation this
    // entry has — not from a sheet, and not inferred from one order alone
    // without checking HQ's own rule reference for that client.
    const PER_ORG_RATE_EXCEPTIONS = {
      'alternativepods.com': new Set(['US.regionCode.WI::vape']) // confirmed via order 304939 + HQ's own per-client rule reference, 2026-09-03
    };

    // One-time cleanup: purge any previously-learned rate for a key that
    // isn't on the new allowlist — almost everything learned before this
    // fix (e.g. the old OH::vape 27.3%/n=145 entry) was learned under the
    // wrong assumption that the combo was retail-price-based at all.
    // Without this, those stale/spurious rates would just sit unused in
    // storage forever; with it, storage stays a true reflection of what
    // this tool currently trusts to estimate from.
    for (const key of Object.keys(rateDirectory)) {
      if (!RETAIL_PRICE_BASED.has(key)) delete rateDirectory[key];
    }

    async function scanOneOrder(id, token) {
      const orderRes = await fetch(`https://app.tokenoftrust.com/api/exciseTax/order/${id}`, { headers: { Accept: 'application/json', Authorization: 'Bearer ' + token } });
      if (orderRes.status !== 200) return null;
      const orderBody = await orderRes.json();
      const calcRes = await fetch(`https://app.tokenoftrust.com/api/exciseTax/orders/${id}/calc-detail`, { headers: { Accept: 'application/json', Authorization: 'Bearer ' + token } });
      const calcBody = calcRes.status === 200 ? await calcRes.json() : null;
      const order = orderBody?.content?.order;
      const events = calcBody?.content?.events || [];
      const calcEvent = events.find(e => e.eventType === 'calculation') || events[0] || {};
      const cd = calcEvent.calcDetail || {};
      const taxSum = (cd.products || []).reduce((s, p) => s + ((p.appliedRules || []).reduce((s2, r) => s2 + (r.taxForQty || 0), 0)), 0);

      // Taxlines CSV rows (2026-08-27): built for the "Export Taxlines CSV"
      // feature — reconstructs a per-SKU report in the same shape as the
      // manually-run "Taxlines Full"/"Taxlines Filtered" S3 export, but
      // sourced from this API instead of the order-sync method that came up
      // empty for vapesocietysupplies.com (see README). No extra fetches:
      // this reuses the same `order` and `cd` objects already pulled above
      // for the mismatch/overcharge checks.
      //
      // Three sources joined by SKU, per the Excise Tax Order API's own
      // schema docs (confirmed live 2026-08-27, not guessed):
      //   - order.transactionLines[]  — quantity + submitted price (the only
      //     source with quantity at all; calc-detail's per-product entries
      //     deliberately have none — confirmed from the CalcDetailProduct
      //     schema doc, which says to get it from here or derive it from
      //     taxForQty/unitTax).
      //   - cd.products[]             — the calc-time snapshot + the actual
      //     appliedRules/taxForQty this line was assessed. Absent for a line
      //     that wasn't found by the calculation (see skippedProducts) or
      //     when the whole event is a partial/skeleton record.
      //   - order.products{sku:...}   — current catalog snapshot, used only
      //     as a fallback when calc-detail's own copy of a metadata field is
      //     missing (calc-detail's copy reflects what the calculation saw at
      //     calc time, which is preferred when present).
      //
      // Known, deliberate gaps vs. the original file — not bugs, just what
      // this API does not expose: customer.fullName and the street portion
      // of shippingAddress are both left blank because the API's
      // shippingLocation schema explicitly excludes givenName/familyName/
      // line1/line2 as PII (confirmed from the API docs' own PII note).
      // county is left blank because SafeShippingLocation has no county
      // field at all. numErrors/error1-3 are left blank — nothing in this
      // API corresponds to them and nothing in a real sample pull ever had
      // them populated either. totalPrice is *computed* (quantity ×
      // unit price), not a value the API hands back directly, since
      // TransactionLineSummary has no line-total field of its own.
      const skeletonEvent = cd.partial === true || cd.source === 'skeleton';
      const calcProductsBySku = {};
      (cd.products || []).forEach(p => { if (p.sku) calcProductsBySku[p.sku] = p; });
      const skippedBySku = {};
      (cd.skippedProducts || []).forEach(p => { if (p.sku) skippedBySku[p.sku] = p; });
      const catalogBySku = order?.products || {};

      const taxlineRows = (order?.transactionLines || []).map(line => {
        const sku = line.sku;
        const calcP = sku ? calcProductsBySku[sku] : null;
        const catalogP = sku ? catalogBySku[sku] : null;
        const meta = calcP || catalogP || {};
        const qty = parseFloat(line.quantity) || 0;
        const unitPrice = parseFloat(line.unitDiscountedPrice ?? line.unitSalesPrice) || 0;
        const tags = meta.tags || [];
        const hasTag = t => tags.includes(t);
        const appliedRules = (calcP && calcP.appliedRules) || [];
        const lineTax = appliedRules.reduce((s, r) => s + (r.taxForQty || 0), 0);

        // Status reflects what this pull actually observed, not a guess —
        // deliberately more specific than the order-sync export's
        // "not_fulfilled:pending", which turned out to mean "the sync method
        // never learned fulfillment state" rather than anything about tax.
        let taxCollectionStatus;
        if (skeletonEvent || !events.length) taxCollectionStatus = 'no_calculation_data';
        else if (!calcP) taxCollectionStatus = skippedBySku[sku] ? ('skipped:' + (skippedBySku[sku].reason || 'unknown')) : 'not_in_calc_detail';
        else if (appliedRules.length === 0) taxCollectionStatus = meta.isExempt ? 'exempt' : 'no_rules_for_jurisdiction';
        else taxCollectionStatus = 'calculated';

        return {
          order: id,
          date: order?.timestamp || '',
          sku: sku || '',
          productName: meta.productName || '',
          productBrand: meta.productBrand || '',
          productId: line.productId || meta.productId || '',
          quantity: line.quantity ?? '',
          totalPrice: qty && unitPrice ? Math.round(qty * unitPrice * 100) / 100 : '',
          volumeInMl: meta.volumeInMl ?? '',
          wholesaleCost: meta.wholesaleCost ?? '',
          wholesalePrice: meta.wholesalePrice ?? '',
          retailPrice: meta.retailPrice ?? '',
          msrp: meta.msrp ?? '',
          productTags: tags.join(','),
          totalTax: calcP ? Math.round(lineTax * 100) / 100 : '',
          country: order?.shippingLocation?.countryCode || '',
          state: order?.shippingLocation?.regionCode || '',
          city: order?.shippingLocation?.locality || '',
          postalCode: order?.shippingLocation?.postalCode || '',
          isVape: hasTag('isVape') ? '1' : '0',
          isExempt: (meta.isExempt || hasTag('isExempt')) ? '1' : '0',
          hasNicotine: hasTag('hasNicotine') ? '1' : '0',
          isOpen: hasTag('isOpen') ? '1' : '0',
          isClosed: hasTag('isClosed') ? '1' : '0',
          closedRefillable: hasTag('closedRefillable') ? '1' : '0',
          closedCartridge: hasTag('closedCartridge') ? '1' : '0',
          closedSingleUse: hasTag('closedSingleUse') ? '1' : '0',
          batteryOnly: hasTag('batteryOnly') ? '1' : '0',
          taxCollectionStatus
        };
      });

      // Order-level rollups (closedVolumeMl, openVolumeMl, totalSalesOf...,
      // wholesalePriceOf...) — computed here as a second pass over this
      // order's own taxlineRows, grouped by the isOpen/isClosed/
      // closedSingleUse flags already derived above. Definitions are this
      // tool's own reconstruction (sum of totalPrice / volumeInMl×quantity /
      // wholesaleCost×quantity per system-type bucket) — not independently
      // confirmed to match whatever formula originally produced these
      // columns in the S3 taxlines export, so treat these five as a
      // documented approximation, not a verified match.
      let closedVolumeMl = 0, openVolumeMl = 0;
      let totalSalesOfOpenSystems = 0, totalSalesOfClosedSystems = 0, totalSalesOfSingleUseSystems = 0;
      let wholesalePriceOfOpenSystems = 0, wholesalePriceOfClosedSystems = 0, wholesaleValueOfSingleUseSystems = 0;
      taxlineRows.forEach(r => {
        const qty = parseFloat(r.quantity) || 0;
        const vol = (parseFloat(r.volumeInMl) || 0) * qty;
        const wsVal = (parseFloat(r.wholesaleCost) || 0) * qty;
        const price = parseFloat(r.totalPrice) || 0;
        if (r.isOpen === '1') { openVolumeMl += vol; totalSalesOfOpenSystems += price; wholesalePriceOfOpenSystems += wsVal; }
        if (r.isClosed === '1' && r.closedSingleUse !== '1') { closedVolumeMl += vol; totalSalesOfClosedSystems += price; wholesalePriceOfClosedSystems += wsVal; }
        if (r.closedSingleUse === '1') { totalSalesOfSingleUseSystems += price; wholesaleValueOfSingleUseSystems += wsVal; }
      });
      const round2 = n => Math.round(n * 100) / 100;
      taxlineRows.forEach(r => {
        r.closedVolumeMl = round2(closedVolumeMl) || '';
        r.openVolumeMl = round2(openVolumeMl) || '';
        r.totalSalesOfOpenSystems = round2(totalSalesOfOpenSystems) || '';
        r.totalSalesOfClosedSystems = round2(totalSalesOfClosedSystems) || '';
        r.totalSalesOfSingleUseSystems = round2(totalSalesOfSingleUseSystems) || '';
        r.wholesalePriceOfOpenSystems = round2(wholesalePriceOfOpenSystems) || '';
        r.wholesalePriceOfClosedSystems = round2(wholesalePriceOfClosedSystems) || '';
        r.wholesaleValueOfSingleUseSystems = round2(wholesaleValueOfSingleUseSystems) || '';
      });

      // Learn effective tax rates from calc-detail whenever it's populated
      // (regardless of whether this particular order is overcharged) — key
      // on ruleId+ruleSet (e.g. "US.regionCode.PA::vape") so it can be looked
      // up later using only regionCode + product type, no calc-detail
      // needed at lookup time. Running average across samples; skips
      // zero-tax rules (exempt items) since a 0 rate would pollute the
      // average rather than reflect a real jurisdiction rate.
      (cd.products || []).forEach(p => {
        if (p.retailPrice == null || !(p.retailPrice > 0)) return;
        (p.appliedRules || []).forEach(rule => {
          if (!rule.ruleId || !rule.ruleSet || !(rule.unitTax > 0)) return;
          const key = rule.ruleId + '::' + rule.ruleSet;
          // 2026-08-24: only learn a rate for a combo the State Tax Rules
          // page confirms is actually retail-price-based (see
          // RETAIL_PRICE_BASED above). Learning indiscriminately is what
          // produced the old OH::vape 27.3%/n=145 entry — a confident-
          // looking rate from 145 samples that turned out to be a spurious
          // price/volume correlation, not a real tax rate, once checked
          // against HQ's own rule text. Most states already have a known
          // AUTHORITATIVE_RATES value anyway; this mainly guards against
          // silently re-accumulating junk for anything not yet allowlisted.
          if (!RETAIL_PRICE_BASED.has(key)) return;
          const observedRate = rule.unitTax / p.retailPrice;
          const existing = rateDirectory[key];
          if (existing) {
            const newSamples = existing.samples + 1;
            existing.rate = Math.round((((existing.rate * existing.samples) + observedRate) / newSamples) * 100000) / 100000;
            existing.samples = newSamples;
            existing.taxLabel = rule.taxLabel || existing.taxLabel || null;
            existing.lastOrderId = id;
          } else {
            rateDirectory[key] = { rate: Math.round(observedRate * 100000) / 100000, samples: 1, taxLabel: rule.taxLabel || null, lastOrderId: id };
          }
        });
      });

      // Wholesale-cost-basis mismatch check (2026-08-24) — see
      // WHOLESALE_COST_BASED above for the rate table and its caveats. Kept
      // as its own pass over cd.products rather than folded into the
      // retailPrice-rate-learning loop above, since it must not be gated on
      // p.retailPrice being present (a product taxed on wholesaleCost has no
      // reason to also carry a populated retailPrice). Flags a real
      // over/under mismatch directly wherever the rate is known, rather than
      // an estimate — see the caveats above on which of these rates are
      // actually confirmed vs. just transcribed from the sheet.
      const wholesaleCostMismatches = [];
      (cd.products || []).forEach(p => {
        if (p.wholesaleCost == null || !(p.wholesaleCost > 0)) return;
        (p.appliedRules || []).forEach(rule => {
          if (!rule.ruleId || !rule.ruleSet || rule.unitTax == null) return;
          const wKey = rule.ruleId + '::' + rule.ruleSet;
          const wRate = WHOLESALE_COST_BASED[wKey];
          if (wRate == null) return;
          const expectedUnitTax = Math.round(p.wholesaleCost * wRate * 100) / 100;
          const actualUnitTax = Math.round(rule.unitTax * 100) / 100;
          if (Math.abs(expectedUnitTax - actualUnitTax) <= 0.02) return; // within rounding tolerance
          wholesaleCostMismatches.push({
            sku: p.sku || null,
            productName: p.productName || null,
            ruleKey: wKey,
            wholesaleCost: p.wholesaleCost,
            rate: wRate,
            expectedUnitTax,
            actualUnitTax,
            direction: actualUnitTax > expectedUnitTax ? 'overcharged' : 'undercharged'
          });
        });
      });

      // Flat per-mL-basis mismatch check (2026-08-24) — see FLAT_RATE_PER_ML
      // above. Same structure as the wholesaleCost pass just above, gated on
      // volumeInMl instead so it doesn't depend on retailPrice or
      // wholesaleCost being present either.
      const flatRateMismatches = [];
      (cd.products || []).forEach(p => {
        if (p.volumeInMl == null || !(p.volumeInMl > 0)) return;
        (p.appliedRules || []).forEach(rule => {
          if (!rule.ruleId || !rule.ruleSet || rule.unitTax == null) return;
          const fKey = rule.ruleId + '::' + rule.ruleSet;
          if (PER_ORG_RATE_EXCEPTIONS[domain] && PER_ORG_RATE_EXCEPTIONS[domain].has(fKey)) return; // confirmed org-specific override — see PER_ORG_RATE_EXCEPTIONS above
          const fRate = FLAT_RATE_PER_ML[fKey];
          if (fRate == null) return;
          const expectedUnitTax = Math.round(p.volumeInMl * fRate * 100) / 100;
          const actualUnitTax = Math.round(rule.unitTax * 100) / 100;
          if (Math.abs(expectedUnitTax - actualUnitTax) <= 0.02) return; // within rounding tolerance
          flatRateMismatches.push({
            sku: p.sku || null,
            productName: p.productName || null,
            ruleKey: fKey,
            volumeInMl: p.volumeInMl,
            rate: fRate,
            expectedUnitTax,
            actualUnitTax,
            direction: actualUnitTax > expectedUnitTax ? 'overcharged' : 'undercharged'
          });
        });
      });

      // Tax Ops Hq effective-rules cross-check (proposed, 2026-09-01) — see
      // the TAXOPS_* constants and fetchTaxOpsEffectiveRules near HQ_ORIGIN
      // for the full writeup and caveats. taxOpsRules is fetched once per
      // org in the outer (side panel) scope, before this injected function
      // runs, and passed in as a plain object — same reason the actual
      // excise-tax API calls above stay same-origin relative fetches rather
      // than reaching out cross-origin from inside this injected context.
      //
      // Deliberately does NOT recompute "the correct tax" from taxOpsRules'
      // rate+basis (unconfirmed whether basis maps to retailPrice vs.
      // wholesaleCost vs. volume the same way this tool's own tables
      // assume — see the caveat where taxOpsRules is fetched). Only checks
      // two things per rule actually applied to this order:
      //   1. Does Tax Ops Hq say this state+type has a per-ORG OVERRIDE
      //      active? This tool has no visibility into overrides at all
      //      otherwise (the WA/kangerwholesaleusa.com blind spot from the
      //      README changelog) — always worth surfacing regardless of rate.
      //   2. Does Tax Ops Hq's rate NUMBER for this state+type disagree with
      //      whatever this tool's own hand-maintained tables assume (or
      //      "assumes nothing" if the state isn't on any of them)? A
      //      disagreement here is a strong signal this tool's transcribed
      //      tables are stale or wrong for this state — exactly the class of
      //      bug that produced the MN/OH/PA issues in the README changelog.
      const taxOpsCrossCheck = [];
      if (taxOpsRules && taxOpsRules.ok) {
        (cd.products || []).forEach(p => {
          (p.appliedRules || []).forEach(rule => {
            if (!rule.ruleId || !rule.ruleSet) return;
            const key = rule.ruleId + '::' + rule.ruleSet;
            const live = taxOpsRules.states[key];
            if (!live) return; // Tax Ops Hq had nothing for this exact key — not evidence of anything either way
            const assumedRate = AUTHORITATIVE_RATES[key] ?? WHOLESALE_COST_BASED[key] ?? FLAT_RATE_PER_ML[key] ?? null;
            const assumedTable = AUTHORITATIVE_RATES[key] != null ? 'RETAIL_PRICE_BASED'
              : WHOLESALE_COST_BASED[key] != null ? 'WHOLESALE_COST_BASED'
              : FLAT_RATE_PER_ML[key] != null ? 'FLAT_RATE_PER_ML' : null;
            const hasOverride = live.source === 'override';
            const rateDisagrees = assumedRate != null && live.rate != null && Math.abs(assumedRate - live.rate) > 0.001;
            const uncoveredButRated = assumedTable == null && live.rate != null && live.rate > 0 && live.source !== 'excluded';
            if (!hasOverride && !rateDisagrees && !uncoveredButRated) return;
            taxOpsCrossCheck.push({
              sku: p.sku || null,
              productName: p.productName || null,
              ruleKey: key,
              assumedTable,
              assumedRate,
              liveRate: live.rate,
              liveBasis: live.basis,
              liveSource: live.source,
              hasOverride,
              rateDisagrees,
              uncoveredButRated
            });
          });
        });
      }

      // Overcharge detection (2026-08-20): the order endpoint embeds a per-SKU
      // "products" catalog snapshot (retailPrice/wholesalePrice/msrp) right
      // alongside the real transaction line price (unitSalesPrice /
      // unitDiscountedPrice) — no calc-detail call needed for this part, and
      // it still works even when calc-detail comes back empty (seen on a real
      // vaperanger.com order). If TOT's saved catalog price for a SKU is
      // higher than what was actually charged, tax on that line was very
      // likely computed off the inflated catalog price — see the
      // vaperanger.com investigation in the README changelog below for the
      // case that surfaced this. This only flags the price gap; it does NOT
      // assert a specific tax dollar amount overcharged, since that depends
      // on the tax rule/rate in effect for that SKU+jurisdiction, which isn't
      // always derivable (calc-detail, which does show the rate, isn't
      // reliably available — see the same changelog entry).
      const catalog = order?.products || {};
      const regionCode = order?.shippingLocation?.regionCode;
      // 2026-08-21: a second false-positive class, distinct from the
      // per-line isExempt one above — found on a real PA order
      // (vapesocietysupplies.com #2447753) where NO rule matched any line
      // at all (confirmed via HQ's own "How was this tax calculated" tool:
      // jurisdictionResolution showed `rules: {}` for every product, and
      // both collected and recalculated tax were $0.00). A stale catalog
      // price can't cause an overcharge on an order where $0 tax was ever
      // collected in the first place — there's no charged amount to have
      // been inflated. We can't reliably tell "no rule applies to this
      // order" apart from "calc-detail came back empty due to the known
      // bug" from calc-detail alone (both look like an empty rules object),
      // so this checks the order's own `exciseTaxCollected` instead, which
      // is always present regardless of calc-detail availability and is
      // the same field the under-collection mismatch check below already
      // relies on. Orders with genuine nonzero collected tax (like the
      // vaperanger.com WA case, where calc-detail was empty but real
      // overcharge was later confirmed) are unaffected by this guard.
      const orderHasAnyCollectedTax = order?.exciseTaxCollected != null && order.exciseTaxCollected !== '0';
      const overchargeLines = !orderHasAnyCollectedTax ? [] : (order?.transactionLines || []).map(l => {
        const p = catalog[l.sku];
        if (!p || p.retailPrice == null) return null;
        // 2026-08-21: an exempt SKU (p.isExempt true — e.g. a kit "part"
        // that's excluded from tax rather than a standalone taxable
        // product) contributes zero tax regardless of which price is used,
        // so a stale catalog price on an exempt line can never actually
        // cause an overcharge. Confirmed via a real HQ order where the
        // manual "How was this tax calculated" tool showed appliedRules:[]
        // and tax:0 for exactly this kind of line despite a genuine
        // retailPrice-vs-actual gap — this flag was a false positive until
        // this check was added. Skip exempt lines before even computing a
        // delta.
        if (p.isExempt) return null;
        // "US.regionCode.<state>" matches the ruleId format calc-detail uses
        // for state-level rules; product.type (confirmed to equal calc-
        // detail's ruleSet, e.g. "vape"/"nicotinePouch") supplies the rest of
        // the key.
        const rateKey = (regionCode && p.type) ? `US.regionCode.${regionCode}::${p.type}` : null;
        // 2026-08-24: only proceed for a jurisdiction+type combo the State
        // Tax Rules page confirms is retail-price-based (see
        // RETAIL_PRICE_BASED above) — everything else defaults to skipped,
        // rather than flagged-until-manually-disproven. This replaces the
        // three one-off exclusions (VA, OH, CO) found the hard way on
        // 2026-08-22/24; those states just aren't on the allowlist at all
        // now, same as the ~45 others that were never individually checked
        // but are almost certainly not retail-based either per that page.
        if (!rateKey || !RETAIL_PRICE_BASED.has(rateKey)) return null;
        const actualPrice = parseFloat(l.unitSalesPrice);
        const delta = Math.round((p.retailPrice - actualPrice) * 100) / 100;
        if (!(delta > 0.01)) return null;
        // Prefer a known rate straight from the compliance sheet
        // (AUTHORITATIVE_RATES) over one inferred from calc-detail samples
        // — it's sourced rather than estimated. Falls back to the learned
        // rate if a combo is on the allowlist but doesn't have a
        // documented rate yet (shouldn't currently happen, since every
        // allowlisted key has one, but kept as a safety net).
        const learned = rateDirectory[rateKey];
        const authoritativeRate = AUTHORITATIVE_RATES[rateKey];
        const rate = authoritativeRate != null ? authoritativeRate : (learned ? learned.rate : null);
        const rateSource = authoritativeRate != null ? 'confirmed' : (learned ? 'learned' : null);
        const qty = parseFloat(l.quantity) || 0;
        return {
          sku: l.sku,
          productName: p.productName || null,
          qty: l.quantity,
          actualPrice,
          catalogPrice: p.retailPrice,
          delta,
          estimatedOvertaxPerUnit: rate != null ? Math.round(delta * rate * 100) / 100 : null,
          estimatedOvertaxTotal: rate != null ? Math.round(delta * rate * qty * 100) / 100 : null,
          rateUsed: rate,
          rateSamples: learned ? learned.samples : null,
          rateSource
        };
      }).filter(Boolean);

      // Possible missed tax (2026-08-24) — the opposite failure mode from the
      // overcharge check above. Per BigCommerce's totProductBuilder.node.js
      // (confirmed by directly reading the source on Bitbucket once Darrin
      // granted access), a vape-type product's isExempt gets set to true
      // automatically whenever it's missing volumeInMl or a classifiable
      // vapeSystemType — that's a fallback for incomplete product data, not
      // a real tax exemption. A line whose SKU is marked isExempt but also
      // has hasNicotine:true, no volumeInMl on file, and a real (non-trivial)
      // catalog price looks exactly like that fallback rather than a
      // genuinely exempt line (e.g. a $0.01 kit accessory that's correctly
      // exempt). Unlike the overcharge checks above, this hasn't been
      // confirmed against a real order yet — it's a lead derived from
      // BigCommerce's source, not independently verified for Shopify/HQ's
      // own product-sync path — so every hit here needs manual confirmation
      // via HQ's "How was this tax calculated" tool before treating it as a
      // real miss. Scoped to type:'vape' only for now: nicotine pouches use
      // a different pair of required fields (weightInOz/pouchesPerContainer)
      // that haven't been confirmed present in this order endpoint's per-SKU
      // catalog snapshot the way hasNicotine/volumeInMl have been.
      const possiblyMissedTaxLines = (order?.transactionLines || []).map(l => {
        const p = catalog[l.sku];
        if (!p || !p.isExempt) return null;
        if (p.type !== 'vape' || !p.hasNicotine) return null;
        if (p.volumeInMl != null) return null; // has the field a fully-classified vape product would have
        const price = p.retailPrice ?? p.wholesalePrice ?? p.msrp;
        if (price == null || price <= 1) return null; // skip trivial/kit-filler-priced lines
        return {
          sku: l.sku,
          productName: p.productName || null,
          qty: l.quantity,
          catalogPrice: price
        };
      }).filter(Boolean);

      // Fixed 2026-08-24, found via a real incident: kangerwholesaleusa.com order 771030 got
      // Slack-alerted as "incorrect excise tax collected," but this scan's own most recent run
      // had bucketed it as "collected" (clean) rather than "incorrect." HQ's own "How was this
      // tax calculated" tool showed why: $0.01 was actually collected on the order against a
      // recalculated-current tax of $242.40 — a real, large under-collection. The old check below
      // only ever fired on `exciseTaxCollected === '0'`, a strict string-equality test against the
      // literal zero — "0.01" fails that comparison entirely, so this exact order (and presumably
      // any other order that collected some trivial nonzero amount instead of genuinely nothing)
      // was invisible to this check regardless of how wrong the amount was. HQ's own backend had
      // separately logged this internally as `diagnosticHistory` metric "error.incorrectCollection"
      // a full day before the Slack alert — this scan's bucketing just never caught up to that.
      //
      // Fixed again, same day, found via a second real incident: vaperanger.com order 567098495
      // (IL) had HQ's own diagnosticHistory logging that exact same "error.incorrectCollection"
      // metric — but this time for OVER-collection ($183.86 collected vs $91.93 recalculated).
      // This scan still bucketed it as clean, because the fix above was deliberately written
      // one-directional (`(taxSum - collectedNum) > 0.02`, under-collection only) on the reasoning
      // that over-collection was already covered by the stale-catalog-price overcharge check.
      // That reasoning doesn't hold: the overcharge check is gated to a narrow allowlist
      // (RETAIL_PRICE_BASED — NY::vape, WA::vape, WA::nicotinePouch) and Illinois isn't on it, so
      // this order was invisible to both checks at once. Since HQ's own diagnosticHistory metric
      // name doesn't distinguish direction either (fires for both), there's no reason this scan's
      // primary correctness check should. Fix: compare the absolute difference against the same
      // 2-cent tolerance, so both directions land in `mismatch` — and carry `mismatchDirection`
      // alongside it so anyone triaging the results table can see which way it went without doing
      // the subtraction themselves.
      const collectedNum = parseFloat(order?.exciseTaxCollected ?? '0') || 0;
      const collectionDiff = taxSum - collectedNum;
      const ruleKeys = Object.keys(cd.rules || {});
      // 2026-08-26: found via a real false positive, vapesocietysupplies.com
      // #2448091 — flagged here as "over-collected $22, should've collected
      // $0," but HQ's own "How was this tax calculated" tool (both Historical
      // and Current) showed $22 collected against $22 recalculated: no
      // mismatch at all. Root cause: calc-detail came back completely empty
      // for this order (cd.rules: {}, cd.products: []) even though a real VA
      // flat-per-mL rule genuinely applied and $22 was the correct, correctly
      // collected amount. ruleKeys.length === 0 already means exactly this
      // ("calc-detail found no rule") and is already treated as "not
      // required" in the notRequired/incorrect/collected breakdown below —
      // but the mismatch flag above wasn't applying that same guard, so an
      // order calc-detail says nothing about was being compared against a
      // recalculated total of 0 and flagged as a full-amount overcharge.
      // An empty calc-detail response isn't evidence the correct tax is $0 —
      // it's evidence calc-detail didn't return anything for this order
      // (same class of gap as the already-documented "empty 200 instead of a
      // 404" API bug, whatever its cause here specifically). Only compute a
      // mismatch when calc-detail actually returned at least one rule.
      const hasRuleData = ruleKeys.length > 0;
      // 2026-09-02: found via vapesocietysupplies.com #2448826 (OH) — this
      // scan's own notRequired/collected/incorrect breakdown bucketed it as
      // "not required" (ruleKeys.length === 0, same signal `hasRuleData`
      // above already treats as "calc-detail returned nothing," not as
      // proof nothing was owed) even though $20.00 was actually collected —
      // confirmed both by this extension's own Order Investigation tool
      // (live recalculation: $20.00) and HQ's "How was this tax calculated"
      // tool (Collected $20.00, Recalculated (current) $20.00, both
      // matching exactly). Order Investigation's own dossier for this same
      // order flagged it `needs_review`/"0 rules fired for the resolved
      // jurisdiction" rather than trusting the empty rule list either — this
      // scan's notRequired bucket should apply the same skepticism instead
      // of silently reading "no rules" as "nothing was owed." This is the
      // same underlying gap as the 2026-08-26 fix just above (empty
      // calc-detail isn't evidence the correct tax is $0) — that fix only
      // guarded the mismatch/overcharge computation, not this bucket.
      const unverifiedCollected = !hasRuleData && collectedNum > 0.005;
      return {
        id,
        exciseTaxCollected: order?.exciseTaxCollected,
        shippingRegion: order?.shippingLocation?.regionCode,
        transactionType: cd.transactionType,
        ruleKeys,
        recalculatedTaxSum: Math.round(taxSum * 100) / 100,
        mismatch: hasRuleData && Math.abs(collectionDiff) > 0.02,
        mismatchDirection: !hasRuleData ? null : (collectionDiff > 0.02 ? 'under' : (collectionDiff < -0.02 ? 'over' : null)),
        unverifiedCollected,
        overchargeLineCount: overchargeLines.length,
        overchargeLines,
        possiblyMissedTaxLineCount: possiblyMissedTaxLines.length,
        possiblyMissedTaxLines,
        wholesaleCostMismatchCount: wholesaleCostMismatches.length,
        wholesaleCostMismatches,
        flatRateMismatchCount: flatRateMismatches.length,
        flatRateMismatches,
        taxOpsCrossCheckCount: taxOpsCrossCheck.length,
        taxOpsCrossCheck,
        taxlineRows
      };
    }

    let results = [];
    let notFound = 0;
    let lastIdChecked = null;

    if (idStart != null && idEnd != null) {
      for (let id = idStart; id <= idEnd; id++) {
        const r = await scanOneOrder(id, token);
        if (r === null) notFound++; else results.push(r);
        lastIdChecked = id;
      }
    } else if (idStart != null && idEnd == null) {
      // Open-ended: no known ending order ID, so walk forward from idStart
      // until a run of consecutive misses suggests we've passed the newest
      // order, or a safety cap is hit. A single miss isn't treated as "the
      // end" since order IDs can have small legitimate gaps (e.g. a
      // cancelled/test order never landing in this API) — MISS_STREAK_LIMIT
      // consecutive misses in a row is the actual stop condition.
      //
      // Deliberately NOT raised past 15, per the 2026-08-21 README entry on
      // this same failure mode ("gaps can exceed the miss-streak limit") —
      // raising it just moves the failure to a bigger gap on some other
      // store instead of removing it. A weekend-sized gap (as hit again on
      // 2026-09-21) is exactly the case that entry says to use the
      // time-window mode for instead, which lists whatever TOT actually
      // recorded rather than walking a guessed ID space. That mode's
      // 24-hour cap is what made it unusable for a multi-day gap — fixed
      // below by making the hours value editable instead of fixed.
      const MISS_STREAK_LIMIT = 15;
      const MAX_CHECKED = 3000; // runaway-loop backstop, not expected to be hit in normal use
      let missStreak = 0;
      let id = idStart;
      while (missStreak < MISS_STREAK_LIMIT && (results.length + notFound) < MAX_CHECKED) {
        const r = await scanOneOrder(id, token);
        if (r === null) { notFound++; missStreak++; } else { results.push(r); missStreak = 0; }
        lastIdChecked = id;
        id++;
      }
    } else if (sinceHoursAgo != null) {
      const until = new Date().toISOString();
      const since = new Date(Date.now() - sinceHoursAgo * 3600 * 1000).toISOString();
      // GET /exciseTax/orders caps at limit=1000 with no offset/cursor, only
      // since/until — a 24h window rarely hits that, but now that this mode
      // can be widened well past 24h (weekend/multi-day catch-up scans), a
      // busy org could come back with exactly 1000 and silently drop
      // whatever didn't fit. Same date-bisection fix already used for this
      // same endpoint's pagination in the Product Backfill / taxlines export
      // path (see fetchIdsInRange above): split the window in half and
      // recurse whenever a call comes back right at the cap. depth is a
      // safety backstop against a truly degenerate range, not expected to
      // matter in normal use.
      async function fetchOrderIdsInRange(sinceIso, untilIso, depth) {
        const res = await fetch(`https://app.tokenoftrust.com/api/exciseTax/orders?since=${encodeURIComponent(sinceIso)}&until=${encodeURIComponent(untilIso)}&limit=1000`, {
          headers: { Accept: 'application/json', Authorization: 'Bearer ' + token }
        });
        if (res.status !== 200) return { error: `list-orders failed (status ${res.status}) for ${sinceIso}..${untilIso}` };
        const body = await res.json();
        const orders = body?.content?.orders || body?.content || [];
        if (orders.length < 1000 || depth > 12) return orders.map(o => o.orderId || o.id);
        const sinceMs = new Date(sinceIso).getTime(), untilMs = new Date(untilIso).getTime();
        const midMs = sinceMs + Math.floor((untilMs - sinceMs) / 2);
        if (!(midMs > sinceMs) || !(midMs < untilMs)) return orders.map(o => o.orderId || o.id);
        const mid = new Date(midMs).toISOString();
        const [left, right] = await Promise.all([fetchOrderIdsInRange(sinceIso, mid, depth + 1), fetchOrderIdsInRange(mid, untilIso, depth + 1)]);
        if (left && left.error) return left;
        if (right && right.error) return right;
        return Array.from(new Set([...left, ...right]));
      }
      const idResult = await fetchOrderIdsInRange(since, until, 0);
      if (idResult && idResult.error) return { ok: false, reason: idResult.error };
      for (const id of idResult) {
        const r = await scanOneOrder(id, token);
        if (r === null) notFound++; else results.push(r);
      }
    } else {
      return { ok: false, reason: 'no range configured for this row' };
    }

    const mismatches = results.filter(r => r.mismatch);
    const highestFoundId = results.length ? Math.max(...results.map(r => r.id)) : null;
    // Derived status breakdown (see README changelog "2026-08-19, tag breakdown"):
    // no literal API field for this exists (confirmed via CalcDetailEvent.status
    // inspection), so these three are inferred from data already pulled per order.
    // notRequired: no excise tax rule applied to this order at all, AND
    // nothing was actually collected on it either — the only combination
    // that's real evidence "not required" is correct. (Fixed 2026-09-02: an
    // empty ruleKeys list used to be read as "not required" on its own —
    // see the unverifiedCollected comment above for the false-positive case
    // that caught, vapesocietysupplies.com #2448826.)
    // incorrect: a rule applied AND collected vs recalculated differ by more than
    // 2 cents, in EITHER direction (fixed 2026-08-24 to catch over-collection too —
    // see the comment above collectionDiff/mismatchDirection).
    // collected: a rule applied and that mismatch check was NOT hit (does not
    // guarantee the exact amount collected was correct — only that this one
    // failure mode wasn't detected; state-specific rate checks below cover some,
    // not all, states more precisely).
    // unverifiedCollected (added 2026-09-02): calc-detail returned no rules
    // (same "hasRuleData" gap as everywhere else in this file) BUT a nonzero
    // amount was actually collected on the order. This is neither a clean
    // "collected" (this scan has no rule data to check the amount against)
    // nor a real "not required" (money was, in fact, collected) — it's a
    // separate "can't verify from calc-detail, go check manually" bucket,
    // same posture Order Investigation's own needs_review verdict already
    // takes on exactly this pattern. Always check via HQ's "How was this tax
    // calculated" tool or the Order Investigation tab before treating one of
    // these as either a miss or a false alarm.
    const notRequired = results.filter(r => (r.ruleKeys || []).length === 0 && !r.unverifiedCollected).length;
    const incorrect = results.filter(r => (r.ruleKeys || []).length > 0 && r.mismatch).length;
    const collected = results.filter(r => (r.ruleKeys || []).length > 0 && !r.mismatch).length;
    const unverifiedCollectedResults = results.filter(r => r.unverifiedCollected);

    // Orders with at least one line where TOT's saved catalog price is above
    // what was actually charged — see overchargeLines above for how this is
    // derived per line. overchargeLines is carried per order so the results
    // panel can show exactly which SKUs/orders to hand off.
    const overcharged = results.filter(r => r.overchargeLineCount > 0);
    const estimatedOverchargeTotal = Math.round(
      overcharged.reduce((s, r) => s + (r.overchargeLines || []).reduce((s2, l) => s2 + (l.estimatedOvertaxTotal || 0), 0), 0) * 100
    ) / 100;
    const overchargeLinesWithEstimate = overcharged.reduce((s, r) => s + (r.overchargeLines || []).filter(l => l.estimatedOvertaxTotal != null).length, 0);
    const overchargeLinesTotal = overcharged.reduce((s, r) => s + (r.overchargeLines || []).length, 0);

    // Orders with at least one line flagged as a possible missed tax (isExempt
    // fallback due to incomplete product data) — see possiblyMissedTaxLines
    // above. Unconfirmed/heuristic, same caveats as noted there.
    const possiblyMissedTax = results.filter(r => r.possiblyMissedTaxLineCount > 0);

    // Orders with at least one wholesale-cost-basis rate mismatch — see
    // WHOLESALE_COST_BASED and the wholesaleCostMismatches pass above. Unlike
    // the overcharge/possiblyMissedTax checks, a hit here is a direct
    // over/under mismatch against a known rate, not a price-gap estimate —
    // though the rate itself, and whether wholesaleCost is even present on
    // calc-detail's per-product entries, are less battle-tested than the
    // CO/NY/WA checks (see the caveats on WHOLESALE_COST_BASED above).
    const wholesaleCostFlagged = results.filter(r => r.wholesaleCostMismatchCount > 0);

    // Orders with at least one flat per-mL-basis rate mismatch — see
    // FLAT_RATE_PER_ML and the flatRateMismatches pass above. Same
    // confidence profile as the wholesale-cost check: VA/OH are confirmed,
    // the rest are transcribed and unverified.
    const flatRateFlagged = results.filter(r => r.flatRateMismatchCount > 0);

    // Orders with at least one Tax Ops Hq cross-check hit (per-org override
    // detected, or a rate disagreement/coverage gap vs. this tool's own
    // tables) — see the taxOpsCrossCheck pass above and its caveats. Empty
    // whenever taxOpsRules wasn't available (not signed into Tax Ops Hq, or
    // the fetch failed) — taxOpsStatus below carries that reason so the
    // results panel can distinguish "checked, found nothing" from "couldn't
    // check at all."
    const taxOpsFlagged = results.filter(r => r.taxOpsCrossCheckCount > 0);

    // Persist the (possibly updated) rate directory once, at the end of this
    // call, rather than per-order — keeps storage writes cheap while still
    // letting later orders/orgs in the same run (and future runs) benefit
    // from whatever got learned here.
    await chrome.storage.local.set({ totHqRateDirectory: rateDirectory });
    const scanCompleteCheck = await checkServerSessionAliveFromPanel('scan-complete');

    return {
      ok: true, sessionChecks: [scanCompleteCheck], checked: results.length, notFound, mismatchCount: mismatches.length, mismatches, allResults: results,
      lastIdChecked, highestFoundId, notRequired, collected, incorrect,
      unverifiedCollectedCount: unverifiedCollectedResults.length,
      unverifiedCollected: unverifiedCollectedResults.map(r => ({ id: r.id, shippingRegion: r.shippingRegion, exciseTaxCollected: r.exciseTaxCollected })),
      overchargedCount: overcharged.length,
      overcharged: overcharged.map(r => ({ id: r.id, shippingRegion: r.shippingRegion, overchargeLines: r.overchargeLines })),
      estimatedOverchargeTotal, overchargeLinesWithEstimate, overchargeLinesTotal,
      possiblyMissedTaxCount: possiblyMissedTax.length,
      possiblyMissedTax: possiblyMissedTax.map(r => ({ id: r.id, shippingRegion: r.shippingRegion, possiblyMissedTaxLines: r.possiblyMissedTaxLines })),
      wholesaleCostFlaggedCount: wholesaleCostFlagged.length,
      wholesaleCostFlagged: wholesaleCostFlagged.map(r => ({ id: r.id, shippingRegion: r.shippingRegion, wholesaleCostMismatches: r.wholesaleCostMismatches })),
      flatRateFlaggedCount: flatRateFlagged.length,
      flatRateFlagged: flatRateFlagged.map(r => ({ id: r.id, shippingRegion: r.shippingRegion, flatRateMismatches: r.flatRateMismatches })),
      taxOpsStatus: taxOpsRules ? (taxOpsRules.ok ? 'ok' : taxOpsRules.reason) : 'not-fetched',
      taxOpsFlaggedCount: taxOpsFlagged.length,
      taxOpsFlagged: taxOpsFlagged.map(r => ({ id: r.id, shippingRegion: r.shippingRegion, taxOpsCrossCheck: r.taxOpsCrossCheck })),
      taxlineRows: results.flatMap(r => r.taxlineRows || [])
    };
}
function waitForTabLoad(tabId, matchUrlSubstr) {
  return new Promise((resolve) => {
    function listener(id, info, tab) {
      if (id === tabId && info.status === 'complete' && (!matchUrlSubstr || (tab.url || '').includes(matchUrlSubstr))) {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function ensureHqTab() {
  if (HQ_TAB_ID) {
    try { await chrome.tabs.get(HQ_TAB_ID); return HQ_TAB_ID; } catch (e) { HQ_TAB_ID = null; }
  }
  const tab = await chrome.tabs.create({ url: HQ_ORIGIN + '/hq/choose-app', active: true });
  HQ_TAB_ID = tab.id;
  await waitForTabLoad(HQ_TAB_ID, '/hq/choose-app');
  return HQ_TAB_ID;
}

async function navigateHqTab(tabId, url, matchUrlSubstr) {
  await chrome.tabs.update(tabId, { url });
  await waitForTabLoad(tabId, matchUrlSubstr);
  await new Promise(r => setTimeout(r, 300));
}

// Polls the tab's ACTUAL url (via chrome.tabs.get, not injected script — this
// needs to see real navigations, including client-side route changes the app
// makes on its own) until it moves away from `fromUrlSubstr`, or times out.
async function pollUntilUrlChangesAway(tabId, fromUrlSubstr, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url && !tab.url.includes(fromUrlSubstr)) return tab.url;
    await new Promise(r => setTimeout(r, 300));
  }
  return null;
}

// Selecting an org in "Choose App Domain" doesn't commit immediately — HQ
// auto-redirects to a "Checking your configuration" gate page first, which
// needs its own Continue click, and only THEN lands on the org's home with
// the backend's "current org" pointer actually updated. Skipping this gate
// (which the first version of this tool did) mints a token still scoped to
// whatever org was previously committed, not the one just selected — this
// was confirmed directly: the docs page's "(domain)" label updates instantly
// and looks correct, but the minted token's referrerOrigin doesn't match
// until this gate is actually cleared. This function drives that whole
// hand-off before it's safe to navigate to the API docs page.
async function settleOrgSwitch(tabId) {
  let url = await pollUntilUrlChangesAway(tabId, '/hq/choose-app', 6000);
  if (url && url.includes('/hq/configuration-check')) {
    // 2026-08-26: confirmed live that the URL flips to /hq/configuration-check
    // via client-side routing BEFORE the page's Vue app has actually rendered
    // the "Continue" button — measured a ~1-1.5s gap between the URL changing
    // and the button mounting (vapesocietysupplies.com, reproduced against a
    // real HQ session). The original single-shot query-and-click here fired
    // right as pollUntilUrlChangesAway first detected the URL change, i.e.
    // squarely inside that gap — `if (btn) btn.click();` found no button and
    // silently did nothing. Nothing here ever errors in that case: the outer
    // poll below just times out waiting for a URL change that was never
    // going to happen, settleOrgSwitch returns null, and scanOneOrg carries
    // on to navigate to the docs page anyway — landing on it with the org
    // switch never actually confirmed server-side. That leaves the docs
    // page's Vue app unable to establish a valid token-minting context,
    // which is what actually produces the 'no-token' result reported for
    // this org, not a wrong-org token as the original comment above assumed.
    // Fixed the same way waitForTokenUiReady (in hqStageScan) handles an
    // analogous render-timing gap: poll for the button to exist instead of
    // assuming it already does.
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return (async () => {
          const start = Date.now();
          while (Date.now() - start < 6000) {
            const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Continue');
            if (btn) { btn.click(); return true; }
            await new Promise(r => setTimeout(r, 300));
          }
          return false;
        })();
      }
    });
    url = await pollUntilUrlChangesAway(tabId, '/hq/configuration-check', 6000);
  }
  // Small buffer even after the UI has moved on, in case the org-switch call
  // that page redirect depends on is still finishing server-side.
  await new Promise(r => setTimeout(r, 600));
  return url;
}

// Runs the full "select org -> clear the configuration-check gate -> mint +
// verify a token -> scan" sequence for one queue entry. Returns the scan
// result object (either {ok:true, ...} or {ok:false, reason}) or a
// {ok:false, reason:'logged-out'|'not-found', ...} if it couldn't even get
// the org selected.
async function exportTaxlinesForDateRange(tabId, domain, sinceIso, untilIso) {
  await navigateHqTab(tabId, HQ_ORIGIN + '/hq/choose-app', '/hq/choose-app');

  const [selectInjection] = await chrome.scripting.executeScript({ target: { tabId }, func: hqStageSelectOrg, args: [domain] });
  const sel = selectInjection.result;
  if (!sel.ok) return sel;

  await settleOrgSwitch(tabId);

  await navigateHqTab(tabId, HQ_ORIGIN + '/hq/api-docs/excise-tax-order#/operations/createAccessToken', '/hq/api-docs/excise-tax-order');

  const [exportInjection] = await chrome.scripting.executeScript({
    target: { tabId }, func: hqStageTaxlinesExport,
    args: [domain, sinceIso, untilIso]
  });
  return exportInjection.result;
}

// 2026-09-09: Marc ran a direct side-by-side test. Clicking through HQ's own
// in-app nav by hand — "Back to HQ" off the API docs subsite, then "Change
// Org" from the main app shell, then picking mmschainportal.com — switched
// orgs perfectly: full MMSDISTRO branding, no "NO ORGANIZATION.", no lost
// session. The scan queue automation, hitting the exact same destination
// (mmschainportal.com's dashboard) via a hard chrome.tabs.update reload
// straight to /hq/choose-app, reliably lost the session on that same second
// org instead. That's the one mechanical difference between a path that's
// confirmed to work and one that's confirmed to fail — a real page load vs.
// an in-app client-side route change — so this clicks through the same links
// a person would instead of reloading the URL directly. Falls back to the
// old hard-navigation approach when neither link is found, which is exactly
// what happens on a brand-new tab for the very first org in the queue —
// ensureHqTab already lands a fresh tab on /hq/choose-app with no org shell
// rendered yet, so there's no "Back to HQ"/"Change Org" to click there and
// behavior for that first org is unchanged.
// 2026-09-09 (later same day): v3.17.20/21 both still lost the session on
// the 2nd org, even with Reset/Generate skipped and a real reload avoided at
// the choose-app step specifically. One click here has never actually been
// checked for what it really does: "Back to HQ" leaves the API docs subsite,
// which is a visibly separate mini-app (its own dark theme, its own nav, no
// shared sidebar with the rest of HQ) — Marc's successful manual test never
// went near it at all, so it's never been confirmed whether that link is a
// same-document client-side route or a real page load back into the main
// app. performance.timeOrigin is fixed for the life of one document and
// only changes when the browser actually loads a new one — reading it right
// before a click and right after tells us, per click, whether that specific
// step was a real navigation, without needing a marker to survive anything.
// 2026-09-09 (v3.17.27): the single long-running injected function this used
// to be (hqClickBackToHqThenChangeOrg) read performance.timeOrigin, clicked,
// then AWAITED A 1200ms SLEEP before reading it again — all inside one
// continuous chrome.scripting.executeScript call. Marc's next live run threw
// "Frame with ID 0 was removed" — Chrome's own signal that the "Back to HQ"
// click (confirmed a real page navigation twice now, Video 5 and this) tore
// down the document the injected script was still running in, mid-sleep,
// before it ever got to the second read. That killed the whole
// chrome.scripting.executeScript call outright (an uncaught rejection in
// scanOneOrg, previously reported as a generic "Lost the HQ tab" and
// stopping the run entirely) instead of reporting a result. Split into two
// tiny, separate injected functions — a probe (read-only) and a click — so
// the risky waiting period happens in scanOneOrg itself (the extension's own
// persistent context, immune to a page's frame being torn down) rather than
// inside a single injected function whose own continuation can get killed by
// the very navigation it's trying to observe.
function hqReadNavProbe() {
  return { timeOrigin: performance.timeOrigin, pathname: location.pathname, bodyText: (document.body.innerText || '').slice(0, 2000) };
}
function hqClickNavItemIfPresent(txt) {
  const el = Array.from(document.querySelectorAll('a, button, div, span')).find(e => e.textContent.trim() === txt && e.offsetParent !== null);
  if (el) { el.click(); return { found: true }; }
  return { found: false };
}

// Matches the handful of chrome.scripting error shapes seen so far for "the
// frame this call targeted stopped existing partway through" — the expected
// consequence of a click that turns out to be a real navigation, not a sign
// of anything actually wrong. Anything else re-throws, same as before.
const FRAME_TORN_DOWN_RE = /frame.*(removed|no longer exists)|no (tab|frame) with id/i;

async function clickNavLinkAndProbe(tabId, label) {
  let before = null;
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: hqReadNavProbe });
    before = r && r.result;
  } catch (e) { /* tab already in a weird state — before stays null, handled below */ }

  let found = false;
  let frameTornDown = false;
  try {
    const [r2] = await chrome.scripting.executeScript({ target: { tabId }, func: hqClickNavItemIfPresent, args: [label] });
    found = !!(r2 && r2.result && r2.result.found);
  } catch (e) {
    if (FRAME_TORN_DOWN_RE.test((e && e.message) || '')) { found = true; frameTornDown = true; }
    else throw e;
  }
  if (!found) return { found: false, navigated: null, landedBroken: false };

  // The wait lives here, not inside a page script — this survives the frame
  // teardown a real navigation causes, which is exactly what broke the old
  // single-function version.
  await new Promise(r => setTimeout(r, 1200));

  let after = null;
  try {
    const [r3] = await chrome.scripting.executeScript({ target: { tabId }, func: hqReadNavProbe });
    after = r3 && r3.result;
  } catch (e) {
    if (FRAME_TORN_DOWN_RE.test((e && e.message) || '')) return { found: true, navigated: true, landedBroken: false, probeFailed: true };
    throw e;
  }

  const navigated = frameTornDown || !before || !after || before.timeOrigin !== after.timeOrigin;
  const landedBroken = !!(after && (after.pathname.includes('/hq/signin') || /no organization\./i.test(after.bodyText || '')));
  return { found: true, navigated, landedBroken };
}

async function scanOneOrg(tabId, current) {
  const backResult = await clickNavLinkAndProbe(tabId, 'Back to HQ');
  const changeOrgResult = await clickNavLinkAndProbe(tabId, 'Change Org');
  const navDiag = {
    usedUiNav: backResult.found || changeOrgResult.found,
    navigatedAfterBackToHq: backResult.found ? backResult.navigated : null,
    navigatedAfterChangeOrg: changeOrgResult.found ? changeOrgResult.navigated : null,
    changeOrgFound: changeOrgResult.found,
    landedBroken: backResult.landedBroken || changeOrgResult.landedBroken,
  };
  // Same reasoning as v3.17.23: only skip the explicit /hq/choose-app
  // navigation when "Change Org" was actually there to click AND neither
  // click's landing looked broken; otherwise fall back to navigating to
  // /hq/choose-app directly, same as a brand-new tab gets on the very first
  // org.
  const canSkipExplicitNav = navDiag.changeOrgFound && !navDiag.landedBroken;
  if (!canSkipExplicitNav) {
    await navigateHqTab(tabId, HQ_ORIGIN + '/hq/choose-app', '/hq/choose-app');
  } else {
    // Give the client-side route change a beat to actually land on
    // /hq/choose-app before hqStageSelectOrg goes looking for the search box —
    // this isn't a real page load, so waitForTabLoad's onUpdated listener
    // (built for the hard-navigation path above) wouldn't fire for it anyway.
    await new Promise(r => setTimeout(r, 500));
  }

  const [selectInjection] = await chrome.scripting.executeScript({ target: { tabId }, func: hqStageSelectOrg, args: [current.domain] });
  const sel = selectInjection.result;
  if (!sel.ok) return { ...sel, navDiag };

  await settleOrgSwitch(tabId);

  await navigateHqTab(tabId, HQ_ORIGIN + '/hq/api-docs/excise-tax-order#/operations/createAccessToken', '/hq/api-docs/excise-tax-order');

  // 2026-09-09 (v3.17.28): this used to inject hqStageScan here — mint AND
  // scan every order, all inside one call running on the docs page — so the
  // tab sat on that subsite for as long as the whole scan took. Marc's live
  // runs have now proven (via real server-checked fetches at each step, not
  // guesses) that a full org's session survives Reset token, Generate a new
  // access token, and scanning itself — arrived-at-docs-page through
  // scan-complete all reported alive — yet the very next navigation, even a
  // fresh direct one straight to /hq/choose-app (bypassing "Back to HQ"
  // entirely), still landed broken. That's consistent with dwell time on the
  // docs subsite itself being what matters, not any one click or action on
  // it. So: mint ONLY here (fast — a few seconds), then leave the docs page
  // immediately, and do the actual order-by-order scan afterward via direct
  // fetch from the side panel (see hqScanOrdersWithToken) using the token
  // just minted — instead of staying on the docs page for however long that
  // scan takes.
  const [mintInjection] = await chrome.scripting.executeScript({ target: { tabId }, func: hqMintToken, args: [current.domain] });
  const mint = mintInjection.result;
  if (!mint.ok) return { ...mint, navDiag };

  // Leave the docs subsite right away, before the scan below — this is the
  // actual test of the dwell-time theory: if it's right, staying off the
  // docs page during a long scan should stop breaking the next org's switch.
  await navigateHqTab(tabId, HQ_ORIGIN + '/hq/choose-app', '/hq/choose-app');

  // Fetched here (side panel context) since taxes.tokenoftrust.com is a
  // different origin than app.tokenoftrust.com. Cached per domain by
  // fetchTaxOpsEffectiveRules, so this is one extra request per org per
  // panel session, not per order. A failure here (not signed in, network
  // error) is non-fatal — hqScanOrdersWithToken treats a null/not-ok
  // taxOpsRules as "cross-check unavailable" and the scan proceeds exactly
  // as it did before this was added.
  const taxOpsRules = await fetchTaxOpsEffectiveRules(current.domain);

  const scanResult = await hqScanOrdersWithToken(mint.token, current.domain, current.idStart ?? null, current.idEnd ?? null, current.sinceHoursAgo ?? null, taxOpsRules);
  // Combine both halves' diagnostic checkpoints into one list — hqMintToken's
  // own (arrived-at-docs-page / after-Reset-token-click /
  // after-Generate-a-new-access-token-click) plus hqScanOrdersWithToken's
  // (scan-complete, now checked from the side panel instead of in-page) — so
  // formatSessionChecks still shows the full trail for this org in one place.
  const combinedSessionChecks = (mint.sessionChecks || []).concat(scanResult.sessionChecks || []);
  return { ...scanResult, sessionChecks: combinedSessionChecks, navDiag };
}

// Auto-verification for the unverifiedCollected bucket (added 2026-09-02, at
// Marc's request after #2448826: "is there something we can do to confirm
// and verify it so that it won't be unverifiable?"). The Excise Tax Order
// API's calc-detail endpoint returned nothing for these orders — that's WHY
// they're in this bucket — but this extension already wraps a second,
// independent recalculation source with its own auth and its own live
// recalculation path: the Order Investigation API (see that section below).
// That's literally the tool that resolved #2448826 by hand (verdict
// needs_review, recalculatedNow $20.00 matching collected exactly) — so
// running it automatically for every order that lands here closes the loop
// without a manual trip to the Order Investigation tab for each one.
//
// Deliberately fails open and per-order, not per-run: if Order Investigation
// credentials were never saved (a separate ops.tokenoftrust.com API key —
// see that section's own banner for why it's a different credential from
// everything else in this extension), every entry just gets
// investigation:{ok:false, reason:'no-creds'} and the scan run itself is
// completely unaffected — same posture as the Tax Ops Hq cross-check when
// nobody's signed into taxes.tokenoftrust.com. A single order's investigation
// failing (network error, this order also 403s, whatever) doesn't stop the
// rest from being checked.
//
// Sequential, not parallel — this bucket is expected to be rare (a handful
// of orders across an entire org's history so far), so there's no meaningful
// throughput reason to parallelize, and it avoids hammering an endpoint
// this extension has already found to be more access-guarded than the rest
// (diagnostic:investigate vs. diagnostic:read — see the section banner).
//
// 2026-09-09: also reused as-is (name kept for minimal diff, but nothing
// here is specific to the unverifiedCollected bucket — it only ever reads
// entry.id) for the mismatch cross-check in runHqScan, to clear
// calc-detail-only false positives like kangerwholesaleusa.com #773121
// (customer-level isExemptCustomer exemption) — see that call site's own
// comment for the full writeup.
async function investigateUnverifiedCollected(targetAppDomain, entries) {
  if (!entries || !entries.length) return entries || [];
  const creds = await invLoadCreds();
  if (!creds || !creds.apiKey || !creds.secretKey || !creds.appDomain) {
    return entries.map(e => ({ ...e, investigation: { ok: false, reason: 'no-creds' } }));
  }
  const out = [];
  for (const entry of entries) {
    try {
      const token = await invGetToken(false);
      const content = await invFetchInvestigation(token, entry.id, { includeProductHistory: false, targetAppDomain });
      const v = content.verdict || {};
      const recalc = (content.values || {}).recalculatedNow;
      out.push({
        ...entry,
        investigation: {
          ok: true,
          verdictCode: v.code || null,
          confidence: v.confidence || null,
          recalculatedNow: recalc && recalc.state === 'present' ? recalc.amount : null,
          recalculatedNowState: recalc ? recalc.state : 'absent'
        }
      });
    } catch (e) {
      out.push({ ...entry, investigation: { ok: false, reason: e.message || String(e) } });
    }
  }
  return out;
}

// 2026-09-09: renders scanOneOrg's navDiag (set by hqClickBackToHqThenChangeOrg)
// into one readable phrase so it shows up next to whatever else the status
// line/Results panel already says about this org, whether it succeeded,
// failed logged-out, or failed some other way. "not clicked" means that link
// wasn't on the page at all when this org's turn came up (e.g. the very
// first org in a fresh tab, which never visits the docs subsite this
// diagnostic cares about).
function formatNavDiag(navDiag) {
  if (!navDiag) return '(nav diagnostic not captured)';
  const describe = (v) => v === null ? 'not clicked' : (v ? 'REAL page load' : 'client-side only');
  const brokenNote = navDiag.landedBroken ? ' (landed broken — fell back to explicit /hq/choose-app nav)' : '';
  return `nav check — "Back to HQ": ${describe(navDiag.navigatedAfterBackToHq)}${brokenNote}; "Change Org": ${describe(navDiag.navigatedAfterChangeOrg)}.`;
}

// 2026-09-09 (v3.17.23): renders hqStageScan's sessionChecks — the real,
// server-verified (not just location.pathname) alive/dead check taken at
// each checkpoint inside that one org's docs-page visit (arriving, after
// Reset token, after Generate a new access token, and once more at the very
// end of the scan). Where this first flips from "alive" to "DEAD" pins down
// which specific step killed the session server-side, for THIS org — as
// opposed to formatNavDiag, which only covers the *next* org's Back to
// HQ/Change Org clicks.
function formatSessionChecks(sessionChecks) {
  if (!sessionChecks || !sessionChecks.length) return '(server session checks not captured)';
  return 'server session checks — ' + sessionChecks.map(c => `${c.stage}: ${c.ok ? 'alive' : 'DEAD'}${c.error ? ' (check failed: ' + c.error + ')' : ''}`).join('; ') + '.';
}

async function runHqScan() {
  if (HQ_RUN_STATE === 'running') return;
  HQ_RUN_STATE = 'running';
  HQ_TAXLINE_ROWS = [];
  setHqRunButtonBusy(true);
  renderHqProgress();

  // Wrapped in try/finally rather than repeating setHqRunButtonBusy(false) at
  // every one of the several early-return points below (lost tab, logged out,
  // no tab available) — easy to miss one of those by hand, and a missed spot
  // would leave the button stuck showing "Running…" after a run has actually
  // stopped, which is exactly the confusing state this button exists to avoid.
  try {
    let tabId;
    try {
      tabId = await ensureHqTab();
    } catch (e) {
      setHqStatus('Could not open an HQ tab: ' + e.message, 'err');
      HQ_RUN_STATE = 'idle';
      return;
    }

    while (HQ_QUEUE.length && HQ_RUN_STATE === 'running') {
      const current = HQ_QUEUE[0];
      if (!current.domain || (current.idStart == null && current.sinceHoursAgo == null)) {
        setHqStatus(`Skipping incomplete row (needs a domain and either an ID range or hours-ago).`, 'err');
        HQ_QUEUE.shift(); await saveHqQueue(); renderHqProgress();
        continue;
      }

      setHqStatus(`<span class="spinner">⟳</span> Switching to ${escapeAttr(current.domain)}...`, null, true);

      let scanResult;
      let loggedOut = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          scanResult = await scanOneOrg(tabId, current);
        } catch (e) {
          // 2026-09-09 (v3.17.26): this branch fired for the first time in
          // this whole investigation (Marc's screenshot) — previously every
          // failure came back as a normal {ok:false} result from inside the
          // injected scripts, this is scanOneOrg's own chrome.scripting call
          // throwing instead (plausible cause: the tab navigates away — e.g.
          // "Back to HQ" firing a real page load — WHILE an injected script
          // is still mid-await, tearing down the execution context out from
          // under it). The old message threw away e.message entirely, so
          // there was no way to tell a genuinely closed tab apart from a
          // script-injection error mid-navigation. Also now recorded in
          // HQ_RESULTS (previously this branch returned without ever writing
          // one), so it survives to the next screenshot instead of vanishing
          // once Marc resumes past it.
          const errMsg = (e && e.message) || String(e);
          setHqStatus(`Lost the HQ tab (or a script injection failed mid-switch) — click Start / Resume to reopen it. (${escapeAttr(errMsg)})`, 'err');
          HQ_RESULTS.push({ domain: current.domain, error: `tab/script error mid-switch — ${errMsg}` });
          await saveHqResults();
          HQ_TAB_ID = null; HQ_RUN_STATE = 'idle'; renderHqProgress(); renderHqResults();
          return;
        }

        if (scanResult.ok) break;

        if (scanResult.reason === 'logged-out') { loggedOut = true; break; }
        if (scanResult.reason === 'not-found') break; // retrying won't fix a real "not in HQ" result

        // Any other failure (including a wrong-scope token) gets one full retry
        // of the ENTIRE select-org sequence, not just re-minting on the same
        // page — a wrong-scope token usually means the org switch itself didn't
        // fully commit yet, which re-minting alone can't fix.
        if (attempt === 0) setHqStatus(`<span class="spinner">⟳</span> ${escapeAttr(current.domain)}: ${escapeAttr(scanResult.reason)} — retrying the full org-switch once...`, 'err', true);
      }

      if (loggedOut) {
        HQ_RUN_STATE = 'paused-login';
        const where = scanResult && scanResult.detectedAfter ? ` Lost session right after: ${scanResult.detectedAfter}.` : '';
        const navInfo = formatNavDiag(scanResult && scanResult.navDiag);
        const sessionInfo = formatSessionChecks(scanResult && scanResult.sessionChecks);
        setHqStatus(`Not signed into HQ.${where} ${navInfo} ${sessionInfo} Sign in on the scan tab, then click "Start / Resume" again — ${current.domain} is still first in the queue.`, 'err');
        HQ_RESULTS.push({ domain: current.domain, error: `logged out — ${scanResult && scanResult.detectedAfter ? scanResult.detectedAfter : 'point not captured'} — ${navInfo} — ${sessionInfo}` });
        await saveHqResults();
        renderHqProgress();
        renderHqResults();
        return;
      }
      if (!scanResult.ok && scanResult.reason === 'not-found') {
        const navInfo = formatNavDiag(scanResult.navDiag);
        setHqStatus(`"${current.domain}" wasn't found in the org list — skipping it. (dropdown said: ${(scanResult.opts || []).join(', ') || 'nothing'}) ${navInfo}`, 'err');
        HQ_RESULTS.push({ domain: current.domain, error: `domain not found in HQ org search — ${navInfo}` });
        await saveHqResults();
        HQ_QUEUE.shift(); await saveHqQueue(); renderHqProgress(); renderHqResults();
        continue;
      }

      if (scanResult.ok) {
        if (scanResult.unverifiedCollectedCount > 0) {
          setHqStatus(`<span class="spinner">⟳</span> ${escapeAttr(current.domain)}: checking ${scanResult.unverifiedCollectedCount} unverifiable order(s) via Order Investigation...`, null, true);
          scanResult.unverifiedCollected = await investigateUnverifiedCollected(current.domain, scanResult.unverifiedCollected);
        }
        // 2026-09-09: false positive reported by Marc — kangerwholesaleusa.com
        // order 773121 (CO, wholesale-cost basis) was tagged
        // tot-excise-tax-incorrect / "Under-collected" ($0 collected vs
        // $1458.18 recalculated) purely from this scan's own calc-detail read,
        // but this extension's own Order Investigation tool independently
        // verdicts the SAME order "healthy" — its dossier shows every line item
        // skipped from the calculation with reason "isExemptCustomer" (a
        // customer-level exemption that calc-detail's own products/rules
        // response never surfaces anywhere this scan reads, unlike the
        // product-level skippedProducts/isExempt cases already handled
        // elsewhere in this file). $0 collected is therefore the CORRECT
        // amount here, not a miss. Nothing observed in calc-detail itself
        // distinguishes "customer is exempt" from a real under-collection, so
        // rather than guess at a calc-detail-only heuristic, this reuses the
        // exact same cross-check this scan already trusts for the
        // unverifiedCollected bucket above: auto-run Order Investigation on
        // every flagged mismatch and let its live, independently-recalculated
        // "healthy" verdict override a mismatch that calc-detail's static
        // snapshot alone got wrong. Same fail-open posture as
        // investigateUnverifiedCollected: no Order Investigation credentials
        // saved, or a per-order investigation failure, leaves that order
        // flagged exactly as before — nothing is suppressed without a real
        // independent verdict saying so.
        if (scanResult.mismatchCount > 0) {
          setHqStatus(`<span class="spinner">⟳</span> ${escapeAttr(current.domain)}: cross-checking ${scanResult.mismatchCount} mismatch(es) via Order Investigation...`, null, true);
          const investigatedMismatches = await investigateUnverifiedCollected(current.domain, scanResult.mismatches);
          const clearedByInvestigation = investigatedMismatches.filter(m => m.investigation && m.investigation.ok && m.investigation.verdictCode === 'healthy');
          const stillMismatched = investigatedMismatches.filter(m => !(m.investigation && m.investigation.ok && m.investigation.verdictCode === 'healthy'));
          scanResult.investigationClearedMismatchesCount = clearedByInvestigation.length;
          scanResult.investigationClearedMismatches = clearedByInvestigation;
          scanResult.mismatches = stillMismatched;
          scanResult.mismatchCount = stillMismatched.length;
          // A mismatch cleared by Order Investigation is real tax-collection
          // behavior this scan now agrees is correct — move it from
          // "incorrect" to "collected" rather than letting it just vanish from
          // the notRequired/collected/incorrect breakdown's total.
          if (clearedByInvestigation.length) {
            scanResult.incorrect = Math.max(0, (scanResult.incorrect || 0) - clearedByInvestigation.length);
            scanResult.collected = (scanResult.collected || 0) + clearedByInvestigation.length;
          }
        }
        // 2026-09-09 (v3.17.26): navDiag/sessionChecks were only ever shown in
        // the transient status line (below) — gone the moment the next org's
        // status overwrote it, so a multi-org run's Results panel (what
        // actually gets screenshotted afterward) never carried this org's own
        // diagnostic trail. That's exactly the gap that left "server session
        // checks not captured" on giantvapes.com's error entry: its failure
        // happened in hqStageSelectOrg (before hqStageScan/sessionChecks ever
        // ran), so the only place that data COULD have shown up — whether the
        // PRECEDING org (mmschainportal.com) was already dead by its own
        // scan-complete checkpoint — was a status line nobody could screenshot
        // in time. Persisting both here so every org's diagnostic trail
        // survives in the Results panel, success or failure alike.
        HQ_RESULTS.push({ domain: current.domain, checked: scanResult.checked, notFound: scanResult.notFound, mismatchCount: scanResult.mismatchCount, mismatches: scanResult.mismatches, investigationClearedMismatchesCount: scanResult.investigationClearedMismatchesCount || 0, investigationClearedMismatches: scanResult.investigationClearedMismatches || [], highestFoundId: scanResult.highestFoundId, openEnded: current.idStart != null && current.idEnd == null, notRequired: scanResult.notRequired, collected: scanResult.collected, incorrect: scanResult.incorrect, unverifiedCollectedCount: scanResult.unverifiedCollectedCount, unverifiedCollected: scanResult.unverifiedCollected, overchargedCount: scanResult.overchargedCount, overcharged: scanResult.overcharged, estimatedOverchargeTotal: scanResult.estimatedOverchargeTotal, overchargeLinesWithEstimate: scanResult.overchargeLinesWithEstimate, overchargeLinesTotal: scanResult.overchargeLinesTotal, possiblyMissedTaxCount: scanResult.possiblyMissedTaxCount, possiblyMissedTax: scanResult.possiblyMissedTax, wholesaleCostFlaggedCount: scanResult.wholesaleCostFlaggedCount, wholesaleCostFlagged: scanResult.wholesaleCostFlagged, flatRateFlaggedCount: scanResult.flatRateFlaggedCount, flatRateFlagged: scanResult.flatRateFlagged, taxOpsStatus: scanResult.taxOpsStatus, taxOpsFlaggedCount: scanResult.taxOpsFlaggedCount, taxOpsFlagged: scanResult.taxOpsFlagged, navDiag: scanResult.navDiag, sessionChecks: scanResult.sessionChecks });
        // Taxline rows are kept in memory only (HQ_TAXLINE_ROWS), NOT folded into
        // HQ_RESULTS/saveHqResults — HQ_RESULTS is written to chrome.storage.local
        // after every single org in the queue, and this extension only has the
        // plain "storage" permission (no unlimitedStorage, ~5-10MB quota). A scan
        // of vapesocietysupplies.com's August alone is ~1,700 orders' worth of
        // per-SKU rows; embedding that in a value re-saved after every queue item
        // risked slow saves at best and a silently-failing quota error at worst.
        // Keeping it out of storage means it doesn't survive a popup close before
        // export, same tradeoff as the rest of a run's in-progress state.
        HQ_TAXLINE_ROWS = HQ_TAXLINE_ROWS.concat(scanResult.taxlineRows || []);
        setHqStatus(`${current.domain}: checked ${scanResult.checked}, ${scanResult.mismatchCount} mismatch(es).`, scanResult.mismatchCount > 0 ? 'err' : 'ok');
      } else {
        const navInfo = formatNavDiag(scanResult.navDiag);
        const sessionInfo = formatSessionChecks(scanResult.sessionChecks);
        HQ_RESULTS.push({ domain: current.domain, error: `${scanResult.reason} — ${navInfo} — ${sessionInfo}` });
        setHqStatus(`${current.domain} failed after retry: ${scanResult.reason} — skipping. ${navInfo} ${sessionInfo}`, 'err');
      }
      await saveHqResults();
      HQ_QUEUE.shift();
      await saveHqQueue();
      renderHqProgress();
      renderHqResults();
    }

    if (HQ_RUN_STATE === 'running') {
      HQ_RUN_STATE = 'idle';
      const flaggedCount = HQ_RESULTS.filter(r => r.mismatchCount > 0).length;
      setHqStatus(`Scan complete. ${flaggedCount} org(s) flagged out of ${HQ_RESULTS.length} scanned.`, 'ok');
    }
    renderHqProgress();
  } finally {
    setHqRunButtonBusy(false);
  }
}

document.getElementById('hqStartBtn').addEventListener('click', () => { runHqScan(); });
document.getElementById('hqStopBtn').addEventListener('click', () => {
  if (HQ_RUN_STATE === 'running') { HQ_RUN_STATE = 'stopped'; setHqStatus('<span class="spinner">⟳</span> Stopping after the current org finishes...', 'ok', true); }
});

// Export Taxlines CSV (2026-08-27) — same 44-column header as the manually-run
// "Taxlines Full"/"Taxlines Filtered" S3 export, rebuilt from HQ_TAXLINE_ROWS
// (populated by the scan just run — see the taxlineRows comment in
// scanOneOrder for exactly which columns are real vs. left blank vs.
// computed). Two files, matching Haroon's original pair: Full is every line
// this run saw; Filtered narrows to lines with a real, non-zero assessed tax
// (taxCollectionStatus 'calculated' and totalTax > 0) — i.e. Haroon's own
// definition, "all taxable product with the tax collected on them" — rather
// than the order-sync method's fulfillment-based filter, which is what came
// up empty in the first place.
const TAXLINES_CSV_HEADERS = [
  'order','date','customer.fullName','shippingAddress','country','state','city','county','postalCode',
  'sku','productName','productBrand','productId','quantity','DO NOT USE','totalPrice','volumeInMl',
  'wholesaleCost','wholesalePrice','retailPrice','msrp','productTags','totalTax','numErrors','error1',
  'error2','error3','closedVolumeMl','openVolumeMl','totalSalesOfOpenSystems','totalSalesOfClosedSystems',
  'totalSalesOfSingleUseSystems','wholesalePriceOfOpenSystems','wholesalePriceOfClosedSystems',
  'wholesaleValueOfSingleUseSystems','isVape','isExempt','hasNicotine','isOpen','isClosed',
  'closedRefillable','closedCartridge','closedSingleUse','batteryOnly','taxCollectionStatus'
];

// Only reachable from the date-range export flow below now — the Run panel's
// own "Export Taxlines CSV" button was removed (2026-08-27) since the
// date-range fetch is the only supported way to pull this report going
// forward, and always reports through this panel's own status line.
function hqExportTaxlinesCsvs() {
  if (!HQ_TAXLINE_ROWS.length) {
    setHqTaxlinesStatus('No taxline rows to export yet — run the date-range fetch above first.', 'err');
    return;
  }
  // Stamp filenames with the actual order-date range these rows cover, not
  // today's export date — the first version used today's date, which made a
  // downloaded file's actual coverage impossible to tell without opening it.
  const dates = HQ_TAXLINE_ROWS.map(r => (r.date || '').slice(0, 10)).filter(Boolean).sort();
  const rangeStamp = dates.length ? `${dates[0]}_to_${dates[dates.length - 1]}` : new Date().toISOString().slice(0, 10);

  const fullCsv = pbToCsv(TAXLINES_CSV_HEADERS, HQ_TAXLINE_ROWS);
  pbDownloadCsv(`taxlines-full-${rangeStamp}.csv`, fullCsv);

  const filteredRows = HQ_TAXLINE_ROWS.filter(r => r.taxCollectionStatus === 'calculated' && (parseFloat(r.totalTax) || 0) > 0);
  const filteredCsv = pbToCsv(TAXLINES_CSV_HEADERS, filteredRows);
  pbDownloadCsv(`taxlines-filtered-${rangeStamp}.csv`, filteredCsv);

  const statusCounts = {};
  HQ_TAXLINE_ROWS.forEach(r => { statusCounts[r.taxCollectionStatus] = (statusCounts[r.taxCollectionStatus] || 0) + 1; });
  const breakdown = Object.entries(statusCounts).map(([k, v]) => `${k}: ${v}`).join(', ');
  setHqTaxlinesStatus(`Exported ${HQ_TAXLINE_ROWS.length} full / ${filteredRows.length} filtered taxline rows (${rangeStamp}). Status breakdown — ${breakdown}.`, 'ok');
}

function renderHqTaxlinesDomainSelect() {
  const sel = document.getElementById('hqTaxlinesDomain');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="" disabled>Select a domain...</option>' + domainOptionsHtml(prev);
}

async function runTaxlinesRangeExport() {
  const domain = document.getElementById('hqTaxlinesDomain').value;
  const sinceRaw = document.getElementById('hqTaxlinesSince').value; // yyyy-mm-dd from <input type="date">
  const untilRaw = document.getElementById('hqTaxlinesUntil').value;
  if (!domain) { setHqTaxlinesStatus('Pick a domain for the date-range export first.', 'err'); return; }
  if (!sinceRaw) { setHqTaxlinesStatus('Pick a Since date for the date-range export.', 'err'); return; }
  const sinceIso = new Date(sinceRaw + 'T00:00:00.000Z').toISOString();
  const untilIso = untilRaw ? new Date(untilRaw + 'T23:59:59.999Z').toISOString() : new Date().toISOString();

  // The date-bisection pagination and the per-order fetch loop both happen
  // inside one injected function call (hqStageTaxlinesExport) that only
  // returns at the very end — but that function pings progress back via
  // chrome.runtime.sendMessage as it works (see reportProgress() there and
  // the onMessage listener near setHqTaxlinesStatus above), so the percentage
  // and ETA below update live rather than only appearing once it's all done.
  // All status here goes through setHqTaxlinesStatus (this panel's own status
  // line, not the Run panel's shared #hqStatus) so it shows up right under
  // the button being watched.
  const btn = document.getElementById('hqTaxlinesRangeBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner">⟳</span> Fetching…';
  HQ_TAXLINES_FETCH_START_MS = null;
  setHqTaxlinesProgressBar(null);
  setHqTaxlinesStatus(`<span class="spinner">⟳</span> Fetching ${escapeAttr(domain)} orders ${sinceRaw} → ${untilRaw || 'now'}... (listing orders in range)`, null, true);
  try {
    const tabId = await ensureHqTab();
    const result = await exportTaxlinesForDateRange(tabId, domain, sinceIso, untilIso);
    if (!result || !result.ok) {
      setHqTaxlinesStatus(`Date-range export failed: ${(result && result.reason) || 'unknown error'}`, 'err');
      return;
    }
    // Replaces whatever taxline rows were last gathered (by either this path
    // or a scan-queue run) — see the hint text next to this button.
    HQ_TAXLINE_ROWS = result.taxlineRows || [];
    setHqTaxlinesStatus(`<span class="spinner">⟳</span> Fetched ${result.orderCount} order(s) for ${escapeAttr(domain)} (${result.checked} checked, ${result.failed} failed) — building CSV...`, 'ok', true);
    hqExportTaxlinesCsvs();
  } catch (e) {
    setHqTaxlinesStatus('Date-range export failed: ' + e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Fetch &amp; Export CSV';
    setHqTaxlinesProgressBar(null);
  }
}
document.getElementById('hqTaxlinesRangeBtn').addEventListener('click', runTaxlinesRangeExport);

async function initHq() {
  await loadHqDomains();
  await loadHqQueue();
  await loadHqResults();
  renderHqDomainsTable();
  renderHqQueueTable();
  renderHqTaxlinesDomainSelect();
  renderHqProgress();
  renderHqResults();
}
initHq();

// ---- Product Backfill (beta) ----
// Built for zuluvape.com's 3-week-stale-metadata situation: HQ's excise-tax "missing data" list
// (System B — encrypted accessToken blob, pasted fresh from DevTools each run, see the panel's
// own intro copy for why this can't be automated the way the Product Sync API's Bearer token
// flow is elsewhere) cross-referenced against the store's real BigCommerce catalog (via the same
// internal-API pattern bcFetchProductBySku/bcResolveProductViaSearch/bcFetchProductById already
// use elsewhere in this file). Exports a CSV in HQ's exact "Load Excise Tax Products" vape format
// for manual review + manual upload — this tool never uploads anything itself. Per explicit
// instruction, nothing here is ever guessed from a product title/tag: a field either comes from
// real TOT/BigCommerce data or it's left blank with a plain-language note in a trailing NOTES
// column (confirmed safe — HQ's own CSV-upload FAQ says trailing extra columns are ignored during
// parsing). VAPE_SYSTEM_TYPE in particular will get a note on essentially every row: confirmed
// live (2026-08-25) that TOT has no "vape system category map" configured at all for
// zuluvape.com — that's a missing org-level backend config, not a per-product gap, so no amount
// of BigCommerce cross-referencing can ever fill it in. Items whose name plainly suggests a
// different HQ product type (e.g. "Zimo 6mg Nicotine Pouches" filed under Vape — a confirmed real
// miscategorization, 16+ instances) are pulled into a separate re-type review list instead of
// being "completed" under the wrong type.

function setPbStatus(msg, type, isHtml){
  const statusEl = document.getElementById('pbStatus');
  if(isHtml) statusEl.innerHTML = msg; else statusEl.textContent = msg;
  statusEl.className = 'status-line show' + (type ? ' '+type : '');
}

let PB_RESULTS = null; // {vapeRows, reviewRows} — set after a successful run, used by the download buttons

const PB_VAPE_CSV_HEADERS = ['PRODUCT_ID','SKU','PRODUCT_NAME','PRODUCT_BRAND','VOLUME_ML','WHOLESALE_COST','WHOLESALE_PRICE','MSRP','RETAIL_PRICE','VAPE_SYSTEM_TYPE','HAS_NICOTINE','IS_EXEMPT','PACK_CONFIG','PACK_QUANTITY','TYPE','NICOTINE_ANALOGUE','NOTES'];
const PB_REVIEW_CSV_HEADERS = ['SKU','PRODUCT_NAME','CURRENT_TOT_TYPE','SUGGESTED_TYPE','REASON'];

// Name-pattern heuristic for catching items HQ has filed under "vape" that are plainly something
// else by name — this only decides which review bucket an item goes in, it never fills in a CSV
// field, so it doesn't need to be conservative the way field-derivation below does.
// Confirmed live (2026-08-25) this org's TOT type field isn't fully reliable even on named,
// already-complete records — found "Off-Stamp Tee Shirt XXXL" filed with type "vape". None of
// today's actual missing-data vape items matched this pattern, but a future item could, so this
// catches it the same way the pouch/hemp patterns above do — pulled into review, never silently
// completed as a vape row.
function pbGuessRetype(productName){
  const n = (productName || '').toLowerCase();
  if(/\bpouch(es)?\b/.test(n)) return 'nicotinePouch';
  if(/\b(cbd|delta[\s-]?8|delta[\s-]?9|thc|hemp)\b/.test(n)) return 'hemp';
  if(/\b(t-?shirt|hoodie|sweatshirt|hat|cap|beanie|jacket|lanyard|sticker|gift card|tote|bag|mug|keychain|pin|patch)\b/i.test(n)) return 'not a compliance product (merchandise)';
  return null;
}

function pbCsvEscape(v){
  const s = (v === null || v === undefined) ? '' : String(v);
  if(/[",\n]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
  return s;
}

function pbToCsv(headers, rows){
  const lines = [headers.join(',')];
  rows.forEach(r => lines.push(headers.map(h => pbCsvEscape(r[h])).join(',')));
  return lines.join('\r\n');
}

function pbDownloadCsv(filename, csvString){
  const blob = new Blob([csvString], {type: 'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(()=> URL.revokeObjectURL(url), 5000);
}

function pbParseMissingDataUrl(raw){
  const trimmed = (raw || '').trim();
  if(!trimmed) return null;
  try{
    const u = new URL(trimmed);
    if(!/(^|\.)tokenoftrust\.com$/.test(u.hostname)) return null;
    return u.toString();
  }catch(e){
    return null;
  }
}

// Looks for a BigCommerce variant option whose name suggests it's the size/volume axis (e.g.
// "Size", "Volume", "mL") and tries to pull a number of mL out of its label (e.g. "30ml",
// "60 mL"). Confirmed via real data that many disposables have no such option at all — only a
// flavor axis — in which case this returns null and VOLUME_ML is left blank with a note rather
// than guessed from anything else.
function pbExtractVolumeMl(variant){
  const optionValues = (variant && variant.option_values) || [];
  for(const ov of optionValues){
    const optName = (ov.option_display_name || '').toLowerCase();
    if(/size|volume|\bml\b|capacity/.test(optName)){
      const m = (ov.label || '').match(/(\d+(?:\.\d+)?)\s*ml/i);
      if(m) return parseFloat(m[1]);
    }
  }
  return null;
}

// Fetches TOT's FULL excise-tax product catalog for this org, not just the missing-data slice the
// pasted URL was copied from. Confirmed live (2026-08-25): the accessToken isn't scoped to a
// specific quickView value — the same token that was minted for quickView=missingData also works
// with quickView removed entirely (HQ's own "All" quick-view), which returns every record
// including the ~3,000+ already-complete ones. That's needed for sibling-derivation below: there's
// nothing to derive missing fields FROM if we only ever see the broken records.
async function pbFetchCatalog(url){
  const u = new URL(url);
  u.searchParams.delete('quickView');
  const res = await fetch(u.toString(), {credentials:'include'});
  if(!res.ok) throw new Error('HTTP ' + res.status + ' — the pasted URL may have expired; grab a fresh one from DevTools.');
  const data = await res.json();
  const list = data && data.content && data.content.exciseTaxProducts;
  if(!Array.isArray(list)) throw new Error('Unexpected response shape — no content.exciseTaxProducts array found.');
  return list;
}

// Strips a trailing bundle/pack-count suffix (e.g. "Pick 10", "Box of 5") off a product name to
// find its underlying product family — confirmed live that pack-size variants of the same device
// (e.g. every "Lost Mary MT35000" SKU) reliably agree on structural attributes like
// VAPE_SYSTEM_TYPE even though their own volume/pricing/pack fields differ.
function pbBaseName(name){
  return (name || '').replace(/\s+(Pick\s*\d+|Box of \d+)\s*$/i, '').trim().toLowerCase();
}

// Filters out template/placeholder rows (e.g. "-TEMPLATE- Pick 3", "Excise Taxes Excise Taxes")
// that exist in TOT's catalog but aren't real products — confirmed these should never be trusted
// as a derivation source or matched against as a sibling.
function pbLooksRealProduct(p){
  const n = (p.productName || '').toLowerCase().trim();
  if(!n) return false;
  if(n.includes('template')) return false;
  if(n === 'excise taxes excise taxes') return false;
  return true;
}

function pbBuildSiblingIndex(fullCatalog){
  const index = {};
  fullCatalog.filter(pbLooksRealProduct).forEach(p=>{
    const key = pbBaseName(p.productName);
    (index[key] = index[key] || []).push(p);
  });
  return index;
}

// Looks for other SKUs in the same product family (same base name) that already have a confirmed
// value for `field`. Only returns a value when every sibling found agrees — a split vote means
// the family doesn't actually share this attribute reliably, so it's safer to leave it for a human
// than guess which sibling is right.
function pbDeriveFromSiblings(item, field, siblingIndex){
  const key = pbBaseName(item.productName);
  const sibs = (siblingIndex[key] || []).filter(s => s.sku !== item.sku && s[field]);
  if(!sibs.length) return {value: null};
  const values = [...new Set(sibs.map(s=>s[field]))];
  if(values.length !== 1) return {value: null, conflict: true, siblingSkus: sibs.map(s=>s.sku)};
  return {value: values[0], siblingSkus: sibs.map(s=>s.sku)};
}

async function pbFetchBcVariant(sub, sku){
  let bcProduct = null;
  try{
    bcProduct = await bcFetchProductBySku(sub, sku);
  }catch(e){
    console.log(`[product backfill] BC lookup failed for SKU "${sku}":`, e.message);
    return null;
  }
  if(!bcProduct || !bcProduct.id) return null;
  // bcFetchProductBySku resolves variant SKUs down to their parent product — fetch the dedicated
  // variants endpoint to get this exact SKU's own cost/option data rather than the parent's
  // (parent-level cost_price/option fields are frequently blank or zero even when the specific
  // variant has real data — confirmed on a real zuluvape product).
  try{
    const vRes = await fetch(`https://${sub}.mybigcommerce.com/internalapi/v1/catalog/products/${bcProduct.id}/variants/`, {credentials:'include', headers:{'X-Requested-With':'XMLHttpRequest'}});
    if(!vRes.ok) return null;
    const vData = await vRes.json();
    const variants = (vData && vData.data) || [];
    return variants.find(v => v.sku === sku) || null;
  }catch(e){
    console.log(`[product backfill] variants fetch failed for product ${bcProduct.id}:`, e.message);
    return null;
  }
}

function pbRenderResults(vapeRows, reviewRows, unclassifiedCount){
  const panel = document.getElementById('pbResultsPanel');
  panel.style.display = 'block';
  const notesCount = vapeRows.filter(r => r.NOTES).length;
  const derivedCount = vapeRows.filter(r => /derived from \d+ sibling/.test(r.NOTES || '')).length;
  document.getElementById('pbResultsSummary').innerHTML = `
    <div>${vapeRows.length} vape row(s) built for CSV export (${notesCount} with at least one field noted, ${derivedCount} of those with a sibling-derived value to verify).</div>
    <div>${reviewRows.length} item(s) pulled out for re-type review (name suggests a different product type than HQ has stored).</div>
    <div>${unclassifiedCount} completely unclassified item(s) in the source list were skipped — no name/SKU on file, and (confirmed on this org's full bucket) a live BigCommerce check recovers none of them, so it's not run by default.</div>
  `;

  const list = document.getElementById('pbResultsList');
  list.innerHTML = '';
  const combined = [
    ...reviewRows.map(r => ({...r, _kind: 'retype'})),
    ...vapeRows.filter(r => r.NOTES).map(r => ({...r, _kind: 'note'}))
  ];
  combined.slice(0, 200).forEach(r=>{
    const item = document.createElement('div');
    item.className = 'diag-item';
    const badgeClass = r._kind === 'retype' ? 'flag' : 'info';
    const badgeText = r._kind === 'retype' ? 'Re-type' : 'Note';
    const summary = r._kind === 'retype'
      ? `Currently filed as "${r.CURRENT_TOT_TYPE}" — name suggests "${r.SUGGESTED_TYPE}". ${r.REASON}`
      : r.NOTES;
    item.innerHTML = `
      <div class="diag-head">
        <div class="diag-title">${escapeAttr(r.PRODUCT_NAME || r.SKU || '')}</div>
        <span class="badge ${badgeClass}">${badgeText}</span>
      </div>
      <div class="diag-summary">${escapeAttr(summary || '')}</div>
    `;
    list.appendChild(item);
  });
  if(combined.length > 200){
    const more = document.createElement('div');
    more.className = 'hint';
    more.textContent = `...and ${combined.length - 200} more not shown here — all are included in the downloaded CSV(s).`;
    list.appendChild(more);
  }
}

document.getElementById('pbClearBtn').addEventListener('click', ()=>{
  PB_RESULTS = null;
  document.getElementById('pbResultsPanel').style.display = 'none';
  document.getElementById('pbResultsList').innerHTML = '';
  document.getElementById('pbResultsSummary').innerHTML = '';
  setPbStatus('Cleared.', 'ok');
});

document.getElementById('pbRunBtn').addEventListener('click', async ()=>{
  const url = pbParseMissingDataUrl(document.getElementById('pbUrlInput').value);
  const sub = document.getElementById('pbSubdomain').value.trim();
  if(!url){ setPbStatus('Paste a valid app.tokenoftrust.com missing-data URL first (see the hint above the box).', 'err'); return; }
  if(!sub){ setPbStatus('Enter the BigCommerce subdomain.', 'err'); return; }

  const btn = document.getElementById('pbRunBtn');
  const progressWrap = document.getElementById('pbProgressWrap');
  const progressBar = document.getElementById('pbProgressBar');
  btn.disabled = true;
  progressWrap.style.display = 'block';
  progressBar.style.width = '0%';
  document.getElementById('pbResultsPanel').style.display = 'none';

  try{
    setPbStatus('Fetching full excise-tax product catalog from HQ (not just the missing-data slice — needed to find already-completed sibling products)…');
    const fullCatalog = await pbFetchCatalog(url);
    const siblingIndex = pbBuildSiblingIndex(fullCatalog);
    const missing = fullCatalog.filter(p => p.missingData);

    const unclassified = missing.filter(p => !p.type);
    const vapeTyped = missing.filter(p => p.type === 'vape');

    // Split off anything that looks mistyped by name before doing any BigCommerce work on it —
    // these never get "completed" as vape rows, they need a human to re-type them in HQ first.
    const reviewRows = [];
    const genuineVape = [];
    vapeTyped.forEach(p=>{
      const suggestion = pbGuessRetype(p.productName);
      if(suggestion){
        const reason = suggestion === 'not a compliance product (merchandise)'
          ? 'Product name matches apparel/merchandise wording (e.g. shirt, hat, sticker) — likely not an excise-taxable item at all, not a vape product.'
          : `Product name matches a "${suggestion}" naming pattern, not vape.`;
        reviewRows.push({
          SKU: p.sku || '',
          PRODUCT_NAME: p.productName || '',
          CURRENT_TOT_TYPE: p.type || '',
          SUGGESTED_TYPE: suggestion,
          REASON: reason
        });
      } else {
        genuineVape.push(p);
      }
    });

    setPbStatus(`${genuineVape.length} vape item(s) to cross-reference against BigCommerce (${reviewRows.length} pulled out for re-type review, ${unclassified.length} unclassified record(s) skipped — see status below)…`);

    const totalWork = genuineVape.length;
    let doneCount = 0;

    const vapeRows = [];
    for(let i=0;i<genuineVape.length;i++){
      const p = genuineVape[i];
      setPbStatus(`<span class="spinner">⟳</span> Cross-referencing vape item ${i+1} of ${genuineVape.length} (${p.sku || 'no SKU'})…`, null, true);

      const variant = p.sku ? await pbFetchBcVariant(sub, p.sku) : null;
      const notes = [];

      let volumeMl = (p.volumeInMl !== undefined && p.volumeInMl !== null) ? p.volumeInMl : null;
      if(volumeMl === null && variant) volumeMl = pbExtractVolumeMl(variant);
      if(volumeMl === null) notes.push('VOLUME_ML: not in TOT and no size/volume BigCommerce option found for this SKU — left blank.');

      let wholesaleCost = (p.wholesaleCost !== undefined && p.wholesaleCost !== null) ? p.wholesaleCost : null;
      if(wholesaleCost === null && variant && variant.cost_price > 0) wholesaleCost = variant.cost_price;
      if(wholesaleCost === null) notes.push('WHOLESALE_COST: not in TOT and BigCommerce has no usable cost_price (0 or missing) for this SKU — left blank.');

      const wholesalePrice = (p.wholesalePrice !== undefined && p.wholesalePrice !== null) ? p.wholesalePrice : null;
      if(wholesalePrice === null) notes.push('WHOLESALE_PRICE: not in TOT — left blank (no reliable BigCommerce equivalent).');

      const msrp = (p.msrp !== undefined && p.msrp !== null) ? p.msrp : null;
      if(msrp === null) notes.push('MSRP: not in TOT — left blank.');

      let retailPrice = (p.retailPrice !== undefined && p.retailPrice !== null) ? p.retailPrice : null;
      if(retailPrice === null && variant && (variant.calculated_price || variant.price)){
        retailPrice = variant.calculated_price || variant.price;
      }
      if(retailPrice === null) notes.push('RETAIL_PRICE: not in TOT and no BigCommerce price found for this SKU — left blank.');

      // VAPE_SYSTEM_TYPE is a required CSV field. Confirmed (2026-08-25) this org has no "vape
      // system category map" configured on TOT's side for zuluvape.com, so it's never present
      // directly on the record — but confirmed live that pack-size siblings of the same device
      // (e.g. every "Lost Mary MT35000" SKU) reliably agree on this value elsewhere in TOT's own
      // catalog. Only used when every sibling found agrees — a split vote leaves it blank rather
      // than guessing which one is right, and either way it's flagged in NOTES for a human check
      // rather than treated as equivalent to the SKU's own confirmed data.
      let vapeSystemType = (p.vapeSystemType !== undefined && p.vapeSystemType !== null && p.vapeSystemType !== '') ? p.vapeSystemType : null;
      if(vapeSystemType === null){
        const derived = pbDeriveFromSiblings(p, 'vapeSystemType', siblingIndex);
        if(derived.value){
          vapeSystemType = derived.value;
          notes.push(`VAPE_SYSTEM_TYPE: TOT has no vape system category map configured for this domain — derived from ${derived.siblingSkus.length} sibling SKU(s) in the same product family (e.g. SKU ${derived.siblingSkus[0]}) that all agree on this value. Verify before uploading.`);
        } else if(derived.conflict){
          notes.push('VAPE_SYSTEM_TYPE: TOT has no vape system category map configured for this domain, and sibling SKUs in this product family disagree on system type — left blank, needs a manual check.');
        } else {
          notes.push('VAPE_SYSTEM_TYPE: TOT has no vape system category map configured for this domain, and no sibling SKUs in this product family have a confirmed value either — set this manually from HQ\'s dropdown before uploading.');
        }
      }

      const hasNicotine = (p.hasNicotine === true) ? 'Nicotine' : (p.hasNicotine === false ? 'No Nicotine' : null);
      if(hasNicotine === null) notes.push('HAS_NICOTINE: not set in TOT — left blank (not derived from siblings, since nicotine strength can genuinely differ within the same product family).');

      let brand = p.productBrand || null;
      if(!brand){
        const derivedBrand = pbDeriveFromSiblings(p, 'productBrand', siblingIndex);
        if(derivedBrand.value){
          brand = derivedBrand.value;
          notes.push(`PRODUCT_BRAND: not set in TOT — derived from ${derivedBrand.siblingSkus.length} sibling SKU(s) in the same product family. Verify before uploading.`);
        } else {
          notes.push('PRODUCT_BRAND: not set in TOT and no sibling SKUs in this product family have a confirmed value either — left blank.');
        }
      }

      vapeRows.push({
        PRODUCT_ID: '',
        SKU: p.sku || '',
        PRODUCT_NAME: p.productName || '',
        PRODUCT_BRAND: brand || '',
        VOLUME_ML: volumeMl !== null ? volumeMl : '',
        WHOLESALE_COST: wholesaleCost !== null ? wholesaleCost : '',
        WHOLESALE_PRICE: wholesalePrice !== null ? wholesalePrice : '',
        MSRP: msrp !== null ? msrp : '',
        RETAIL_PRICE: retailPrice !== null ? retailPrice : '',
        VAPE_SYSTEM_TYPE: vapeSystemType || '',
        HAS_NICOTINE: hasNicotine || '',
        IS_EXEMPT: '',
        PACK_CONFIG: '',
        PACK_QUANTITY: (p.packQuantity !== undefined && p.packQuantity !== null) ? p.packQuantity : '',
        TYPE: 'vape',
        NICOTINE_ANALOGUE: (p.nicotineAnalogue !== undefined && p.nicotineAnalogue !== null) ? p.nicotineAnalogue : '',
        NOTES: notes.join(' | ')
      });

      doneCount++;
      progressBar.style.width = `${Math.round((doneCount/totalWork)*100)}%`;
      if(i < genuineVape.length - 1) await new Promise(r=>setTimeout(r, 200));
    }

    // Completely unclassified records (no name, no SKU, no type in TOT) were tried as a live
    // BigCommerce lookup by productId in an earlier version of this tool — the idea being that a
    // resolving ID recovers a real name/SKU for someone to type manually, while a non-resolving
    // one gets reported as a likely stale reference for TOT/ExciseOps to clean up. Removed
    // (2026-08-25) after a real run against zuluvape's full 984-record unclassified bucket came
    // back with zero resolved — every single one 404s on BigCommerce. Confirmed this wasn't a
    // sampling fluke (an earlier 50-record spot-check found the same thing), so the live check
    // was pure runtime cost — it's easily the slowest part of a full run — for zero recovered
    // records. Left as a flat skip rather than deleted outright in case a different org's
    // unclassified bucket looks different; re-enable per-org if a run there might actually recover
    // something.
    setPbStatus(`${unclassified.length} completely unclassified record(s) skipped — no name/SKU on file in TOT, and a live BigCommerce check against this org's full unclassified bucket recovered zero of them, so it's no longer run by default.`);

    PB_RESULTS = {vapeRows, reviewRows, sub};
    pbRenderResults(vapeRows, reviewRows, unclassified.length);
    setPbStatus(`Done. ${vapeRows.length} vape row(s) ready to review, ${reviewRows.length} flagged for re-type, ${unclassified.length} unclassified record(s) skipped (no live BigCommerce match to be found — see status above).`, 'ok');
  }catch(err){
    setPbStatus('Failed — ' + (err.message || 'unknown error'), 'err');
  } finally {
    btn.disabled = false;
    progressWrap.style.display = 'none';
  }
});

document.getElementById('pbDownloadVapeBtn').addEventListener('click', ()=>{
  if(!PB_RESULTS || !PB_RESULTS.vapeRows.length){ setPbStatus('Run a cross-reference first.', 'err'); return; }
  const csv = pbToCsv(PB_VAPE_CSV_HEADERS, PB_RESULTS.vapeRows);
  const storeTag = PB_RESULTS.sub || 'store';
  pbDownloadCsv(`${storeTag}-vape-backfill-${new Date().toISOString().slice(0,10)}.csv`, csv);
  setPbStatus(`Downloaded ${PB_RESULTS.vapeRows.length} vape row(s). Review the NOTES column before uploading via HQ.`, 'ok');
});

document.getElementById('pbDownloadReviewBtn').addEventListener('click', ()=>{
  if(!PB_RESULTS || !PB_RESULTS.reviewRows.length){ setPbStatus('No re-type items to download — run a cross-reference first, or none were found.', 'err'); return; }
  const csv = pbToCsv(PB_REVIEW_CSV_HEADERS, PB_RESULTS.reviewRows);
  const storeTag = PB_RESULTS.sub || 'store';
  pbDownloadCsv(`${storeTag}-retype-review-${new Date().toISOString().slice(0,10)}.csv`, csv);
  setPbStatus(`Downloaded ${PB_RESULTS.reviewRows.length} re-type review item(s).`, 'ok');
});

// =====================================================================
// Order Investigation (BETA — wraps HQ's new, internal-only Excise Order
// Investigation API, GET /api/exciseTax/orders/{appTransactionId}/investigation).
// See README "Order Investigation" section for the full writeup.
//
// Unlike everything else in this extension, this doesn't ride a signed-in
// HQ browser session — it needs a standalone ops.tokenoftrust.com API key
// pair (totApiKey/totSecretKey) with api:opsAdmin, exchanged for a bearer
// token via POST /api/accessToken. Confirmed live (2026-08-26) that this
// extension's usual session-minted token gets a 403 insufficientPermissions
// against this endpoint — diagnostic:investigate is a separate, more
// guarded grant than diagnostic:read, which every ordinary key gets.
//
// 2026-08-26 correction: the first version of this section guessed at the
// POST /api/accessToken request/response shape (the HQ session investigating
// it lost its org context mid-session before the AccessTokenRequest/
// AccessTokenResponse schema pages could be read). Marc then pulled up the
// actual "Create an access token" docs page directly — the real request body
// is THREE required fields, not two: totApiKey, totSecretKey, AND appDomain
// ("Domain associated with API keys") — the original code only sent the
// first two, which would have failed every call with a 422 for a missing
// required field. Confirmed from the same page: the response token lives at
// content.accessToken (one of the guessed candidates was right, kept as the
// primary lookup now), used as `Authorization: Bearer <accessToken>`, and
// the token is valid 24 hours — replacing the earlier defensive 10-minute
// assumption.
//
// Confirmed working end-to-end (2026-08-26): the real credentials come from
// HQ's own self-service flow, not a special provisioning request — sign
// into HQ, select "ops" as the vendor (same choose-app flow as everywhere
// else in this extension), then open its Integration tab. That page's
// totApiKey/totSecretKey pair, with appDomain "ops.tokenoftrust.com" (NOT
// the bare "tokenoftrust.com" the API docs' own generic example showed),
// authenticates AND carries diagnostic:investigate — tested live against
// order 2448120 (vapesocietysupplies.com), returned a clean "healthy"
// verdict. See README "Order Investigation" for the full writeup, including
// why Target app domain almost always needs to be filled in explicitly
// (it defaults to the key's own ops.tokenoftrust.com domain, which has no
// real client orders on it).
// =====================================================================

const INV_CREDS_KEY = 'totExciseInvestigationCreds';
let INV_TOKEN = null;       // in-memory only, deliberately not persisted — cheap to re-mint from the stored key pair
let INV_TOKEN_EXPIRES = 0;  // ms epoch; 0 forces a re-mint

function invSetCredsStatus(msg, type, isHtml){
  const el = document.getElementById('invCredsStatus');
  if(isHtml) el.innerHTML = msg; else el.textContent = msg;
  el.className = 'status-line show' + (type ? ' '+type : '');
}
function invSetStatus(msg, type, isHtml){
  const el = document.getElementById('invStatus');
  if(isHtml) el.innerHTML = msg; else el.textContent = msg;
  el.className = 'status-line show' + (type ? ' '+type : '');
}

async function invLoadCreds(){
  const stored = await chrome.storage.local.get([INV_CREDS_KEY]);
  return stored[INV_CREDS_KEY] || null;
}
async function invSaveCreds(apiKey, secretKey, appDomain){
  await chrome.storage.local.set({ [INV_CREDS_KEY]: { apiKey, secretKey, appDomain } });
}
async function invClearCreds(){
  await chrome.storage.local.remove([INV_CREDS_KEY]);
  INV_TOKEN = null;
  INV_TOKEN_EXPIRES = 0;
}

// Exchanges totApiKey/totSecretKey/appDomain for a bearer token. Confirmed
// against the actual "Create an access token" docs page (2026-08-26) — see
// the section banner above.
async function invExchangeToken(apiKey, secretKey, appDomain){
  const res = await fetch('https://app.tokenoftrust.com/api/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ totApiKey: apiKey, totSecretKey: secretKey, appDomain })
  });
  let body;
  try{ body = await res.json(); }catch(e){ throw new Error(`HTTP ${res.status} — response wasn't valid JSON.`); }
  if(!res.ok){
    const msg = body?.content?.message || body?.message || body?.content?.code || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  const c = body?.content || body;
  // content.accessToken is the confirmed field; the other candidates stay as a fallback
  // only in case a future API version renames it, not because the shape is still unknown.
  const token = c?.accessToken || c?.token || c?.bearerToken || c?.access_token || (typeof c === 'string' ? c : null);
  if(!token){
    throw new Error(`Got a 200 back but couldn't find content.accessToken — response had top-level keys: ${Object.keys(c || {}).join(', ') || '(none)'}.`);
  }
  // Docs confirm 24-hour validity. Still checks for an explicit expiresAt/expires field
  // first in case the response carries one, but no longer guesses a conservative fallback —
  // 24h is the documented value, not an assumption.
  const expiresAt = c?.expiresAt || c?.expires || null;
  const expiresMs = expiresAt ? (typeof expiresAt === 'number' ? expiresAt : new Date(expiresAt).getTime()) : (Date.now() + 24*60*60*1000);
  return { token, expiresMs };
}

async function invGetToken(forceRefresh){
  if(!forceRefresh && INV_TOKEN && Date.now() < INV_TOKEN_EXPIRES - 15000) return INV_TOKEN;
  const creds = await invLoadCreds();
  if(!creds || !creds.apiKey || !creds.secretKey || !creds.appDomain) throw new Error('No saved credentials — enter your totApiKey/totSecretKey/appDomain above first.');
  const { token, expiresMs } = await invExchangeToken(creds.apiKey, creds.secretKey, creds.appDomain);
  INV_TOKEN = token;
  INV_TOKEN_EXPIRES = expiresMs;
  return token;
}

async function invFetchInvestigation(token, appTransactionId, opts){
  const params = new URLSearchParams();
  params.set('includeProductHistory', opts.includeProductHistory ? 'true' : 'false');
  if(opts.regionCode) params.set('regionCode', opts.regionCode);
  if(opts.targetAppDomain) params.set('targetAppDomain', opts.targetAppDomain);
  const url = `https://app.tokenoftrust.com/api/exciseTax/orders/${encodeURIComponent(appTransactionId)}/investigation?${params.toString()}`;
  const res = await fetch(url, { headers: { Accept: 'application/json', Authorization: 'Bearer ' + token } });
  let body;
  try{ body = await res.json(); }catch(e){ throw new Error(`HTTP ${res.status} — response wasn't valid JSON.`); }
  if(!res.ok){
    const msg = body?.content?.message || body?.content?.causedBy?.message || body?.message || `HTTP ${res.status}`;
    throw new Error(`${res.status}: ${msg}`);
  }
  return body?.content || body;
}

// Per-product excise breakdown (added 2026-09-15, for the frepouch.com
// Trello card asking whether TOT can supply line-item excise amounts for
// their ERP). Charlie confirmed this ships already, no new work needed on
// TOT's side — this endpoint IS the feature, per the "Excise Tax Per-Product
// Breakdown API" doc he sent the client. That doc is written for an external
// client's OWN single-tenant key (POST /internal/auth/token there, vs. this
// extension's already-proven /api/accessToken flow — both mint a Bearer
// token, just different mint endpoints; not mixing them here since ours
// already works) and says nothing about cross-tenant scoping, because a
// normal client key never needs it. Whether OUR ops key's cross-tenant
// access (confirmed for Investigate via targetAppDomain) extends to this
// endpoint too is genuinely unverified — passed through defensively, same
// as invFetchInvestigation, rather than assumed either way. This is the
// actual live test Charlie asked Marc to run (pull a giantvapes order),
// not a check that's already been confirmed.
async function invFetchCalcDetail(token, appTransactionId, opts){
  const params = new URLSearchParams();
  if(opts && opts.targetAppDomain) params.set('targetAppDomain', opts.targetAppDomain);
  const qs = params.toString();
  const url = `https://app.tokenoftrust.com/api/exciseTax/orders/${encodeURIComponent(appTransactionId)}/calc-detail${qs ? '?'+qs : ''}`;
  const res = await fetch(url, { headers: { Accept: 'application/json', Authorization: 'Bearer ' + token } });
  let body;
  try{ body = await res.json(); }catch(e){ throw new Error(`HTTP ${res.status} — response wasn't valid JSON.`); }
  if(!res.ok){
    const msg = body?.content?.message || body?.content?.causedBy?.message || body?.message || `HTTP ${res.status}`;
    throw new Error(`${res.status}: ${msg}`);
  }
  return body?.content || body;
}

// Renders per the doc's own reading guide: events[0] is current state (newest first),
// sum appliedRules[].taxForQty per product for the line total, list skippedProducts with
// their reason (not a silent $0 — the doc is explicit that count:0/empty products is a
// "no breakdown stored" success response, not proof no tax was charged).
function invRenderCalcDetail(content){
  const events = content.events || [];
  if(!events.length){
    return `<div class="diag-summary" style="color:var(--muted);">count: ${invEsc(content.count ?? 0)}, no events — per the doc, this is a success response meaning no calc-detail is stored for this order, NOT proof no tax was charged. Check GET /exciseTax/order/{id}'s exciseTaxCollected for the order-level total instead.</div>`;
  }
  const event = events[0];
  const cd = event.calcDetail || {};
  const products = cd.products || [];
  const skipped = cd.skippedProducts || [];

  let html = `<div class="diag-summary" style="margin-bottom:10px;font-size:11px;color:var(--muted);">
    event ${invEsc(event.eventType||'?')} at ${invEsc(event.eventTs||'?')} · status: ${invEsc(event.status||'—')} · ${events.length} event(s) total (showing events[0], the current state)
  </div>`;

  if(!products.length && !skipped.length){
    html += `<div class="diag-summary" style="color:var(--muted);">This event's calcDetail has no products and no skippedProducts — empty breakdown.</div>`;
  }

  if(products.length){
    let orderTotal = 0;
    html += `<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:10px;">
      <thead><tr style="text-align:left;border-bottom:1px solid var(--border);"><th>SKU</th><th>Product</th><th>Applied rules</th><th>Line total</th></tr></thead>
      <tbody>`;
    products.forEach(p=>{
      const rules = p.appliedRules || [];
      const lineTax = rules.reduce((s,r)=> s + (r.taxForQty || 0), 0);
      orderTotal += lineTax;
      const rulesHtml = rules.length
        ? rules.map(r=>`${invEsc(r.taxLabel||'?')}: $${Number(r.taxForQty||0).toFixed(2)} (unit $${Number(r.unitTax||0).toFixed(2)})`).join('<br>')
        : '<span style="color:var(--muted);">none</span>';
      html += `<tr style="border-bottom:1px solid var(--border);">
        <td style="font-family:var(--mono);font-size:11px;">${invEsc(p.sku||'—')}</td>
        <td>${invEsc(p.productName||'—')}</td>
        <td>${rulesHtml}</td>
        <td style="font-family:var(--mono);">$${lineTax.toFixed(2)}</td>
      </tr>`;
    });
    html += `</tbody></table>
    <div class="diag-summary" style="font-weight:600;margin-bottom:10px;">Order total (sum of line totals): $${orderTotal.toFixed(2)}</div>`;
  }

  if(skipped.length){
    html += `<div class="diag-summary" style="margin-bottom:10px;"><div style="font-weight:600;margin-bottom:4px;">Skipped products (${skipped.length}) — not taxed, with reason</div>${skipped.map(s=>{
      const note = invSkipReasonNote(s.reason);
      const base = `${invEsc(s.sku||'—')}: ${invEsc(s.reason||'no reason given')}`;
      if(!note) return base;
      const color = note.normal ? 'var(--muted)' : 'var(--warn)';
      return `${base}<br><span style="color:${color};font-size:11px;">↳ ${note.normal ? '(expected) ' : '(check this) '}${invEsc(note.note)}</span>`;
    }).join('<br>')}</div>`;
  }

  html += `<details style="margin-top:6px;"><summary style="cursor:pointer;color:var(--muted);font-size:11px;">Raw response</summary>
    <pre style="white-space:pre-wrap;font-size:11px;background:var(--panel2);padding:8px;border-radius:6px;margin-top:6px;">${invEsc(JSON.stringify(content, null, 2))}</pre>
  </details>`;

  return html;
}

function invEsc(s){ return escapeAttr(String(s ?? '')); }

// present/absent/degraded — never coerce absent to a dollar amount, per the API's own
// "Unknown is never zero" warning. Rendered as a plain dash + reasonCode instead of $0.
// label is a small pre-built HTML cell (plain-English name + the raw API field name as a
// muted subline) — see INV_VALUE_LABELS below. Not user data, so not run through invEsc.
function invTaxValueHtml(tv, label){
  if(!tv) return `<tr><td>${label}</td><td colspan="3" style="color:var(--muted);">not returned</td></tr>`;
  if(tv.state === 'present'){
    return `<tr><td>${label}</td><td style="font-family:var(--mono);">$${Number(tv.amount).toFixed(2)}</td><td>${invEsc(tv.source||'')}</td><td style="color:var(--muted);font-size:11px;">${invEsc(tv.observedAt||'')}</td></tr>`;
  }
  const color = tv.state === 'degraded' ? 'var(--warn)' : 'var(--muted)';
  return `<tr><td>${label}</td><td style="font-style:italic;color:${color};">— (${invEsc(tv.reasonCode||tv.state)})</td><td>${invEsc(tv.source||'')}</td><td style="color:var(--muted);font-size:11px;">${invEsc(tv.observedAt||'')}</td></tr>`;
}

// Plain-English names for the five TaxValue fields, with the raw API field name kept as a
// small muted subline so the row is still traceable back to the docs. Order matches the
// API's own collected/reconcileReported/checkoutCalculated/recordCalculated/recalculatedNow.
function invValueLabel(friendly, rawField){
  return `<div>${friendly}</div><div style="font-size:10px;color:var(--muted);font-family:var(--mono);">${rawField}</div>`;
}

// Returns inline banner styling (border/background/text color) rather than a CSS class —
// this extension's .ok/.warn/.err styling only exists combined with .status-line/.badge,
// there's no bare .warn class defined at all, so a class-only approach here would silently
// render unstyled. Mirrors the .status-line.ok/.err color+border+background combo directly.
function invVerdictStyle(code){
  if(code === 'healthy') return { color: 'var(--accent)', border: '#1c5a3d', bg: 'var(--accent-dim)' };
  if(code === 'amount_drift' || code === 'needs_review') return { color: 'var(--warn)', border: 'var(--warn-dim)', bg: 'var(--warn-dim)' };
  return { color: 'var(--danger)', border: '#5a2626', bg: 'var(--danger-dim)' }; // jurisdiction_mismatch, collected_but_engine_says_zero, should_have_collected, computed_but_not_collected
}

// Platform-specific collection-mechanism notes and Sentry project lists, copied
// verbatim (not paraphrased) from Engineering's investigate-order.node.js
// PLATFORM_GUIDANCE constant, per the excise-diagnostics handoff snapshot dated
// 2026-08-31 (Trello 9369 review bundle). That script's own Stage 4 verdict
// engine computes the exact same verdict codes our Investigation API already
// returns (healthy/amount_drift/jurisdiction_mismatch/collected_but_engine_
// says_zero/should_have_collected/computed_but_not_collected/needs_review) —
// this extension already gets that engine's OUTPUT from the live API, but was
// missing the static "how this platform's collection mechanism actually works,
// and what to check" knowledge that script prints alongside its verdict. Added
// here as reference text only — it never changes what gets fetched or how the
// verdict itself is computed, only what guidance is shown alongside it.
const INV_PLATFORM_GUIDANCE = {
  shopify: {
    repo: 'TOT/shopify-app',
    sentry: ['shopify-app', 'shopify-checkout'],
    basics: 'Excise tax is applied via the Checkout UI Extension (a TOT_TAXLINE line). It is $0 when a checkout path never renders the extension (e.g. some B2B / draft-order / portal flows). Recall the totCheckoutId vs cart_token reconciliation gap. shopify-checkout logs errors from the tax extension itself.'
  },
  bigcommerce: {
    repo: 'TOT/bigcommerce-app',
    sentry: ['bigcommerce-app', 'bigcommerce-ui'],
    basics: 'Excise tax is a cart line item (catalog product SKU TOT_EXCISE_TAX) added by /tax/calculate from TOT\'s totalTaxes; a $0 calc removes the line. But exciseTaxCollected is RE-SUMMED at order-record time from order lines matched by isExciseTaxLine (product_id / sku==TOT_EXCISE_TAX / name ~ /excise tax/i) — NOT from the live calc. A stale line left after the cart turned exempt / changed jurisdiction is still summed. Check the order for a leftover excise line and the "Incorrect Taxes Collected" order metafield.'
  },
  woocommerce: {
    repo: 'TOT/tokenoftrust (WooCommerce plugin hits /api/exciseTax/calculate + /api/ecommerce/orderCreated)',
    sentry: ['wordpress'],
    basics: 'WordPress/WooCommerce plugin calls the same TOT calculate/record endpoints. Explore the plugin for how the tax line is applied client-side.'
  },
  foxycart: {
    repo: 'TOT/tot-foxycart',
    sentry: ['foxycart-app'],
    basics: 'FoxyCart collection mechanism — explore the repo (webhook/transaction handling) for how the excise amount is applied and reported.'
  }
};
const INV_SENTRY_CORE_PROJECT = 'tot-server'; // always check this one regardless of platform — it's where the core calc runs

// Skipped-product reason-code translations, from sentry-order-lookup.js's diagnose()
// function in the same handoff snapshot. isTaxSku/noRulesForJurisdiction are treated
// as expected/normal there (not flagged) — everything else gets a specific suggested
// action. Falls back to showing the raw reason with no guess for anything not on this
// list, since the MD-doc examples (isExempt/taxExpired) don't even use the same exact
// spelling as this script's checks (productIsExempt) — API reason strings clearly
// aren't fully stable/enumerated, so this is deliberately additive, never assumed complete.
const INV_SKIP_REASON_NOTES = {
  isTaxSku: { normal: true, note: 'Expected — this line IS the tax line itself, not a taxable product.' },
  noRulesForJurisdiction: { normal: true, note: 'Expected — no excise rule exists for this jurisdiction/product combination.' },
  MissingVapeSystemType: { normal: false, note: 'Fix this product\'s tags — needs one of isClosed/isOpen/isLiquid/batteryOnly.' },
  MissingProductData: { normal: false, note: 'Product has no metadata on file — upload/refresh the product CSV for this domain.' },
  productIsExempt: { normal: false, note: 'Product is marked isExempt=true — verify that\'s actually intentional for this SKU.' },
  isExempt: { normal: false, note: 'Product is marked exempt — verify that\'s actually intentional for this SKU.' },
  taxExpired: { normal: false, note: 'This product\'s tax rule had an expiration date that has passed — check if that\'s expected or a stale rule.' }
};
function invSkipReasonNote(reason){
  return INV_SKIP_REASON_NOTES[reason] || null;
}

function invRenderPlatformNotes(platform, verdictCode){
  const g = INV_PLATFORM_GUIDANCE[platform] || null;
  const didntCollect = verdictCode === 'should_have_collected' || verdictCode === 'computed_but_not_collected';
  let html = '';

  if(g){
    html += `<div class="diag-summary" style="margin-bottom:8px;">
      <div style="font-weight:600;margin-bottom:4px;">How ${invEsc(platform)} collection works</div>
      <div>${invEsc(g.basics)}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:4px;">Repo to explore: ${invEsc(g.repo)} — apps change often, don't trust cached file paths/line numbers.</div>
    </div>`;
  } else {
    html += `<div class="diag-summary" style="margin-bottom:8px;color:var(--muted);">Set "Platform" above for platform-specific collection-mechanism notes.</div>`;
  }

  if(verdictCode === 'amount_drift'){
    html += `<div class="diag-summary" style="margin-bottom:8px;">
      <div style="font-weight:600;margin-bottom:4px;">Amount drift — two candidate causes (check in this order)</div>
      <div>(a) A stale/wrong-jurisdiction line on the platform order — e.g. a mid-checkout address change left an earlier jurisdiction's excise line (BigCommerce re-sums this at record time). Ask which jurisdiction the platform order page shows; if it differs from the resolved region above, this is likely it — TOT resolved correctly, the wrong tax is a stale platform-side line, not a resolution bug.</div>
      <div>(b) Rules or product metadata changed between the order and now — compare order-time vs current (see product metadata drift above, if any).</div>
      <div style="font-size:11px;color:var(--muted);margin-top:4px;">This dossier only sees TOT's resolved jurisdiction, not what the platform order page itself shows — a correct-looking resolution here does NOT rule out a wrong-state amount on the order.</div>
    </div>`;
  }

  if(platform === 'shopify' && didntCollect){
    html += `<div class="diag-summary" style="margin-bottom:8px;">
      <div style="font-weight:600;margin-bottom:4px;">Possible cause — Shopify express/accelerated payments</div>
      <div>Apple Pay / Google Pay / Shop Pay express checkout bypasses the tax Checkout UI Extension entirely, so excise tax is silently missed. This is a known issue with no code fix — check whether this order was placed via an express/accelerated wallet; if so, the remedy is asking the vendor to disable express payment methods.</div>
    </div>`;
  }

  const suspectServer = didntCollect || verdictCode === 'needs_review';
  const projects = [INV_SENTRY_CORE_PROJECT].concat((g && g.sentry) || []);
  html += `<div class="diag-summary" style="margin-bottom:0;">
    <div style="font-weight:600;margin-bottom:4px;">Check Sentry${suspectServer ? ' — collection may have failed due to a TOT server issue' : ' (if a server outage/timeout is suspected)'}</div>
    <div>org: token-of-trust · projects: ${invEsc(projects.join(', '))} (tot-server = core calc; always check it)</div>
    <div style="font-size:11px;color:var(--muted);margin-top:4px;">Filter by tags excise.appDomain / excise.appTransactionId, bounded to the order timestamp. Look for ApplicationTimeout, 5xx/calc failures, connection errors (core) and tax-extension errors (platform UI project). The Sentry credentials panel below only searches one saved project at a time — check the others listed here manually if the first comes up empty.</div>
  </div>`;

  return html;
}

function invRenderDossier(content, platform){
  const v = content.verdict || {};
  const vals = content.values || {};
  const j = content.jurisdiction || {};
  const rec = j.record || {};
  const products = content.products || [];
  const skipped = content.skippedProducts || [];
  const degradations = content.degradations || [];
  const operational = content.operational || {};
  const handoff = content.handoff || {};

  const vs = invVerdictStyle(v.code);
  const numbers = v.numbers || {};

  let html = '';

  html += `<div style="padding:10px;border-radius:6px;margin-bottom:12px;border:1px solid ${vs.border};background:${vs.bg};">
    <div style="font-weight:700;font-size:14px;margin-bottom:2px;color:${vs.color};">${invEsc(v.code||'unknown')}</div>
    <div style="margin-bottom:6px;">${invEsc(v.headline||'')}</div>
    <div style="font-size:11px;color:var(--muted);">confidence: ${invEsc(v.confidence||'?')} · A (charged to customer): ${numbers.collected ?? '—'} · B (calculated when saved): ${numbers.recordCalculated ?? '—'} · C (recalculated now): ${numbers.recalcNow ?? '—'}</div>
    ${(v.reasons||[]).length ? `<ul style="margin:8px 0 0 18px;padding:0;">${v.reasons.map(r=>`<li>${invEsc(r)}</li>`).join('')}</ul>` : ''}
  </div>`;

  html += `<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:12px;">
    <thead><tr style="text-align:left;border-bottom:1px solid var(--border);"><th>Value</th><th>Amount</th><th>Source</th><th>Observed</th></tr></thead>
    <tbody>
      ${invTaxValueHtml(vals.collected, invValueLabel('Charged to customer', 'collected · platform'))}
      ${invTaxValueHtml(vals.reconcileReported, invValueLabel('Reported in reconciliation', 'reconcileReported · platform'))}
      ${invTaxValueHtml(vals.checkoutCalculated, invValueLabel('Calculated at checkout', 'checkoutCalculated · engine'))}
      ${invTaxValueHtml(vals.recordCalculated, invValueLabel('Calculated when order was saved', 'recordCalculated · engine'))}
      ${invTaxValueHtml(vals.recalculatedNow, invValueLabel('Recalculated just now', 'recalculatedNow · engine'))}
    </tbody>
  </table>`;

  if(rec.input || rec.resolved){
    const mismatch = j.crossResolutionMismatch;
    html += `<div class="diag-summary" style="margin-bottom:12px;">
      <div style="font-weight:600;margin-bottom:4px;">Jurisdiction${mismatch ? ' <span style="color:var(--danger);">— input/resolved mismatch</span>' : ''}</div>
      <div>Input: ${invEsc([rec.input?.locality, rec.input?.regionCode, rec.input?.postalCode].filter(Boolean).join(', '))}</div>
      <div>Resolved: ${invEsc([rec.resolved?.locality, rec.resolved?.regionCode, rec.resolved?.postalCode].filter(Boolean).join(', '))}</div>
    </div>`;
  }

  if((content.rules?.firedForJurisdiction||[]).length){
    html += `<div class="diag-summary" style="margin-bottom:12px;"><div style="font-weight:600;margin-bottom:4px;">Rules fired</div>${content.rules.firedForJurisdiction.map(r=>invEsc(r)).join(', ')}</div>`;
  }

  const drifted = products.filter(p => (p.changedSinceOrder||[]).length);
  if(drifted.length){
    html += `<div class="diag-summary" style="margin-bottom:12px;"><div style="font-weight:600;margin-bottom:4px;">Product metadata drift since order (${drifted.length})</div>`;
    drifted.forEach(p=>{
      html += `<div style="margin-bottom:4px;">${invEsc(p.sku)}: ${(p.changedSinceOrder||[]).map(c=>`${invEsc(c.field)} was ${invEsc(c.orderTime)} → now ${invEsc(c.current)}`).join('; ')}</div>`;
    });
    html += `</div>`;
  }

  if(skipped.length){
    html += `<div class="diag-summary" style="margin-bottom:12px;"><div style="font-weight:600;margin-bottom:4px;">Skipped products (${skipped.length})</div>${skipped.map(s=>{
      const note = invSkipReasonNote(s.reason);
      const base = `${invEsc(s.sku||s.productId)}: ${invEsc(s.reason)}`;
      if(!note) return base;
      const color = note.normal ? 'var(--muted)' : 'var(--warn)';
      return `${base}<br><span style="color:${color};font-size:11px;">↳ ${note.normal ? '(expected) ' : '(check this) '}${invEsc(note.note)}</span>`;
    }).join('<br>')}</div>`;
  }

  if(degradations.length){
    html += `<div class="diag-summary" style="margin-bottom:12px;color:var(--warn);"><div style="font-weight:600;margin-bottom:4px;">Degradations — evidence that couldn't be gathered</div>${degradations.map(d=>`${invEsc(d.stage)}: ${invEsc(d.reasonCode)}${d.detail ? ' — '+invEsc(d.detail) : ''}`).join('<br>')}</div>`;
  }

  // 2026-09-14: operational.checkoutTraceId + a checkout-scoped Sentry link
  // (labeled with "tot_checkout_id") were added to the investigation API by
  // PR 1604 (Trello 9859 follow-up) — surfaces the Shopify checkout id a
  // "tax calculated but never collected" order carries, plus a Sentry link
  // scoped to that one checkout instead of the whole shop's free-text search.
  // sentryLinks was already rendered generically below (just .map() over
  // whatever the array contains), so the new 4th entry shows up there with
  // no changes needed — this block only adds the id itself, which wasn't
  // rendered anywhere before, and bolds/labels the checkout-scoped link so
  // it stands out from the three pre-existing free-text ones.
  if(operational.checkoutTraceId){
    html += `<div class="diag-summary" style="margin-bottom:12px;">
      <div style="font-weight:600;margin-bottom:4px;">Checkout trace ID</div>
      <div style="font-family:var(--mono);font-size:11px;">${invEsc(operational.checkoutTraceId)}</div>
    </div>`;
  }

  if((operational.sentryLinks||[]).length){
    html += `<div class="diag-summary" style="margin-bottom:12px;" id="invSentryBlock">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;flex-wrap:wrap;gap:6px;">
        <div style="font-weight:600;">Sentry links</div>
        <button class="btn ghost small" id="invSentrySearchBtn">Search Sentry now</button>
      </div>
      ${operational.sentryLinks.map(s=>{
        const isCheckoutScoped = /tot_checkout_id/i.test(s.label||'');
        return `<a href="${invEsc(s.url)}" target="_blank" rel="noopener" style="color:var(--accent);${isCheckoutScoped ? 'font-weight:700;' : ''}">${invEsc(s.label||s.project)}${isCheckoutScoped ? ' ←' : ''}</a>`;
      }).join('<br>')}
      <div id="invSentryResults" style="margin-top:8px;"></div>
    </div>`;
  }

  if(content.whatIf){
    const w = content.whatIf;
    html += `<div class="diag-summary" style="margin-bottom:12px;"><div style="font-weight:600;margin-bottom:4px;">What-if: ${invEsc(w.requestedRegionCode)}</div>${w.state === 'present' ? `$${Number(w.amount).toFixed(2)}` : `— (${invEsc(w.reasonCode||w.state)})`} — structurally separate from the verdict above, per the API's own note that a regionCode what-if never affects it.</div>`;
  }

  html += `<div class="panel" style="margin-top:4px;margin-bottom:12px;padding:10px;border:1px solid var(--border);border-radius:6px;">
    <div style="font-weight:600;margin-bottom:6px;">Platform & troubleshooting notes <span style="font-weight:400;color:var(--muted);font-size:11px;">(from Engineering's investigate-order.node.js playbook)</span></div>
    ${invRenderPlatformNotes(platform, v.code)}
  </div>`;

  if(handoff.markdown){
    html += `<div class="panel" style="margin-top:4px;padding:10px;border:1px solid var(--border);border-radius:6px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <div style="font-weight:600;">Agent / ticket handoff</div>
        <button class="btn ghost small" id="invCopyHandoffBtn">Copy</button>
      </div>
      <textarea readonly style="width:100%;height:120px;font-family:var(--mono);font-size:11px;" id="invHandoffText">${invEsc(handoff.markdown)}</textarea>
    </div>`;
  }

  return html;
}

// Target app domain dropdown reuses the same HQ_DOMAINS list/storage as the
// HQ Excise Tax Scan tab's "Known domains" table (see loadHqDomains/saveHqDomains/
// domainOptionsHtml above) rather than maintaining a second copy — add or fix
// domains in that tab and this dropdown picks them up too. A hidden text input
// (#invTargetDomain) stays the actual source of truth that invRunBtn reads, so
// its handler didn't need to change; the visible <select> (#invTargetDomainSelect)
// just writes into it, with an "Other…" option falling back to free text for a
// domain not yet in the list.
function invRenderTargetDomainSelect(selected){
  const sel = document.getElementById('invTargetDomainSelect');
  if(!sel) return;
  const opts = ['<option value="">(use my key\'s own domain — ops.tokenoftrust.com)</option>'];
  opts.push(domainOptionsHtml(selected && selected !== '__custom__' ? selected : ''));
  opts.push('<option value="__custom__"' + (selected === '__custom__' ? ' selected' : '') + '>Other… (type manually)</option>');
  sel.innerHTML = opts.join('');
  if(selected && selected !== '__custom__') sel.value = selected;
}

document.getElementById('invTargetDomainSelect').addEventListener('change', (e)=>{
  const textInput = document.getElementById('invTargetDomain');
  if(e.target.value === '__custom__'){
    textInput.style.display = '';
    textInput.value = '';
    textInput.focus();
  } else {
    textInput.style.display = 'none';
    textInput.value = e.target.value;
  }
});

async function initInvestigation(){
  const creds = await invLoadCreds();
  if(creds){
    document.getElementById('invApiKey').value = creds.apiKey || '';
    document.getElementById('invSecretKey').value = creds.secretKey || '';
    document.getElementById('invAppDomain').value = creds.appDomain || '';
  }
  await loadHqDomains();
  invRenderTargetDomainSelect('');
}

document.getElementById('invSaveCredsBtn').addEventListener('click', async ()=>{
  const apiKey = document.getElementById('invApiKey').value.trim();
  const secretKey = document.getElementById('invSecretKey').value.trim();
  const appDomain = document.getElementById('invAppDomain').value.trim();
  if(!apiKey || !secretKey || !appDomain){ invSetCredsStatus('Enter totApiKey, totSecretKey, and appDomain — all three are required by POST /api/accessToken.', 'err'); return; }
  invSetCredsStatus('Saving and testing…');
  try{
    await invSaveCreds(apiKey, secretKey, appDomain);
    await invGetToken(true); // force a fresh exchange to actually validate the pair
    invSetCredsStatus('Saved — credentials exchanged for a token successfully.', 'ok');
  }catch(err){
    invSetCredsStatus('Saved, but the test call failed — ' + (err.message || 'unknown error') + '. Double-check the key pair and appDomain.', 'err');
  }
});

document.getElementById('invClearCredsBtn').addEventListener('click', async ()=>{
  await invClearCreds();
  document.getElementById('invApiKey').value = '';
  document.getElementById('invAppDomain').value = '';
  document.getElementById('invSecretKey').value = '';
  invSetCredsStatus('Cleared saved credentials.', 'ok');
});

document.getElementById('invRunBtn').addEventListener('click', async ()=>{
  const appTransactionId = document.getElementById('invOrderId').value.trim();
  if(!appTransactionId){ invSetStatus('Enter an order ID first.', 'err'); return; }
  const includeProductHistory = document.getElementById('invIncludeHistory').checked;
  const regionCode = document.getElementById('invRegionCode').value.trim() || null;
  const targetAppDomain = document.getElementById('invTargetDomain').value.trim() || null;
  const platform = document.getElementById('invPlatform').value || null;

  const btn = document.getElementById('invRunBtn');
  btn.disabled = true;
  document.getElementById('invResultsPanel').style.display = 'none';
  invSetStatus('Getting a token…');
  try{
    const token = await invGetToken(false);
    invSetStatus(`<span class="spinner">⟳</span> Investigating order ${invEsc(appTransactionId)}…`, null, true);
    const content = await invFetchInvestigation(token, appTransactionId, { includeProductHistory, regionCode, targetAppDomain });
    document.getElementById('invResultsBody').innerHTML = invRenderDossier(content, platform);
    document.getElementById('invResultsPanel').style.display = 'block';
    const copyBtn = document.getElementById('invCopyHandoffBtn');
    if(copyBtn){
      copyBtn.addEventListener('click', async (evt)=>{
        const btn = evt.currentTarget;
        try{
          await navigator.clipboard.writeText(document.getElementById('invHandoffText').value);
          flashCopied(btn);
          invSetStatus('Copied handoff markdown to clipboard.', 'ok');
        }catch(e){
          invSetStatus('Could not copy automatically — select the text in the box above and copy manually.', 'err');
        }
      });
    }
    const sentrySearchBtn = document.getElementById('invSentrySearchBtn');
    if(sentrySearchBtn){
      sentrySearchBtn.addEventListener('click', async ()=>{
        const resultsEl = document.getElementById('invSentryResults');
        sentrySearchBtn.disabled = true;
        resultsEl.innerHTML = '<span class="spinner">⟳</span> Searching Sentry…';
        try{
          const creds = await sentryLoadCreds();
          const events = await sentrySearchEvents(creds, targetAppDomain, appTransactionId);
          resultsEl.innerHTML = sentryRenderEvents(events);
        }catch(err){
          resultsEl.innerHTML = `<div style="color:var(--danger);">Sentry search failed — ${invEsc(err.message || 'unknown error')}</div>`;
        } finally {
          sentrySearchBtn.disabled = false;
        }
      });
    }
    invSetStatus(`Done. Verdict: ${invEsc(content.verdict?.code || 'unknown')}.`, 'ok');
  }catch(err){
    invSetStatus('Failed — ' + (err.message || 'unknown error'), 'err');
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('invCalcDetailBtn').addEventListener('click', async ()=>{
  const appTransactionId = document.getElementById('invOrderId').value.trim();
  if(!appTransactionId){ invSetStatus('Enter an order ID first.', 'err'); return; }
  const targetAppDomain = document.getElementById('invTargetDomain').value.trim() || null;

  const btn = document.getElementById('invCalcDetailBtn');
  btn.disabled = true;
  document.getElementById('invCalcDetailPanel').style.display = 'none';
  invSetStatus('Getting a token…');
  try{
    const token = await invGetToken(false);
    invSetStatus(`<span class="spinner">⟳</span> Fetching calc-detail for order ${invEsc(appTransactionId)}…`, null, true);
    const content = await invFetchCalcDetail(token, appTransactionId, { targetAppDomain });
    document.getElementById('invCalcDetailBody').innerHTML = invRenderCalcDetail(content);
    document.getElementById('invCalcDetailPanel').style.display = 'block';
    invSetStatus(`Done. ${content.count ?? 0} event(s) found.`, 'ok');
  }catch(err){
    invSetStatus('Failed — ' + (err.message || 'unknown error'), 'err');
  } finally {
    btn.disabled = false;
  }
});

initInvestigation();

// =====================================================================
// Verification Diagnostics (beta) — added 3.17.39. Ports lookupVerificationAttempt
// and verificationHealthCheck from HQ's POST /api/diagnostic/evaluate, per the
// [VerifOps] "Adopt portable verification diagnostics into Ops daily tooling"
// Trello epic (https://trello.com/c/j3fzLvwd) and its companion [VerifOpsAPI]
// card (https://trello.com/c/OsqiYsvY). Both functions are confirmed present
// in the real AVAILABLE_FUNCTIONS registry (modules/diagnostic/api/
// diagnostic-api-routes.node.js, tokenoftrust/tokenoftrust@a93162bb7, packaged
// 2026-09-11 for the VerifOpsAPI card) — not just described in the card — so
// this is purely UI wiring on an endpoint that already exists, same as the
// calc-detail button above. verificationHealthCheck's response shape
// ({anomalies, scanned, healthy, summary:{errors,warnings,info}}) and its five
// anomaly types (stalled/skippedCorrection/brokenRedirect/multipleAttempts/
// error, each error|warning|info) are read directly out of that file's
// evaluateVerificationHealthCheck function, lines 909-1082 of the snapshot —
// not guessed. lookupVerificationAttempt's exact response fields are NOT
// independently confirmed the same way (the route just forwards whatever
// VerificationAttemptService.lookup() returns, and that service's source
// wasn't in this snapshot) — the field list below is the card's own stated
// DoD ("resolves to appDomain + appUserid + sessionUuid, incl.
// sourceVerificationAttemptId"), rendered defensively with a raw-JSON fallback
// so nothing is hidden if the real shape differs.
//
// Reuses the same ops.tokenoftrust.com key/token as Order Investigation
// (invGetToken) — whether that key actually carries diagnostic:read /
// diagnostic:crossTenant is unconfirmed; see the panel's hint text and the
// epic's own Uncertainty #1.
// =====================================================================

async function verifDiagEvaluate(token, functionName, params){
  const res = await fetch('https://app.tokenoftrust.com/api/diagnostic/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ functionName, params })
  });
  let body;
  try{ body = await res.json(); }catch(e){ throw new Error(`HTTP ${res.status} — response wasn't valid JSON.`); }
  if(!res.ok){
    const msg = body?.error || body?.content?.error || body?.content?.message || body?.message || `HTTP ${res.status}`;
    throw new Error(`${res.status}: ${msg}`);
  }
  return body?.content !== undefined ? body.content : body;
}

function vSetStatus(id, msg, type, isHtml){
  const el = document.getElementById(id);
  if(isHtml) el.innerHTML = msg; else el.textContent = msg;
  el.className = 'status-line show' + (type ? ' '+type : '');
}

// Mirrors invRenderTargetDomainSelect / sentryRenderAppDomainSelect exactly —
// same shared HQ_DOMAINS list (fed by the HQ Excise Tax Scan tab's Known
// domains), same "Other… (type manually)" fallback pattern.
function vRenderDomainSelect(selectId, textId, selected){
  const sel = document.getElementById(selectId);
  if(!sel) return;
  const opts = ['<option value="">(use my key\'s own domain — ops.tokenoftrust.com)</option>'];
  opts.push(domainOptionsHtml(selected && selected !== '__custom__' ? selected : ''));
  opts.push('<option value="__custom__"' + (selected === '__custom__' ? ' selected' : '') + '>Other… (type manually)</option>');
  sel.innerHTML = opts.join('');
  if(selected && selected !== '__custom__') sel.value = selected;
  sel.addEventListener('change', (e)=>{
    const textInput = document.getElementById(textId);
    if(e.target.value === '__custom__'){
      textInput.style.display = '';
      textInput.value = '';
      textInput.focus();
    } else {
      textInput.style.display = 'none';
      textInput.value = e.target.value;
    }
  });
}

async function initVerification(){
  await loadHqDomains(); // idempotent if the Investigate/Sentry tab's init already ran this
  vRenderDomainSelect('vLookupDomainSelect', 'vLookupDomain', '');
  vRenderDomainSelect('vHealthDomainSelect', 'vHealthDomain', '');
}

function vRenderLookupResult(content){
  let html = '<div class="diag-summary" style="margin-bottom:10px;">';
  const fields = [
    ['appDomain', content.appDomain],
    ['appUserid', content.appUserid],
    ['appTransactionId', content.appTransactionId],
    ['sessionUuid', content.sessionUuid],
    ['verificationAttemptId', content.verificationAttemptId],
    ['sourceVerificationAttemptId', content.sourceVerificationAttemptId],
    ['createdAt', content.createdAt || content.ts]
  ];
  const rows = fields.filter(([, v]) => v !== undefined && v !== null && v !== '');
  if(rows.length){
    html += '<table style="width:100%;border-collapse:collapse;">' + rows.map(([k,v]) =>
      `<tr><td style="padding:3px 8px 3px 0;color:var(--muted);white-space:nowrap;">${invEsc(k)}</td><td style="padding:3px 0;font-family:var(--mono);word-break:break-all;">${invEsc(v)}</td></tr>`
    ).join('') + '</table>';
  } else {
    html += 'None of the expected fields (appDomain/appUserid/sessionUuid/…) were on this response — the real shape may differ from the card\'s stated DoD. Check the raw response below.';
  }
  if(content.sourceVerificationAttemptId){
    html += `<div style="margin-top:8px;color:var(--warn);">This attempt reused a prior verification (sourceVerificationAttemptId set) — you're looking at the reuse chain, not a fresh verification.</div>`;
  }
  html += '</div>';
  html += `<details style="margin-top:6px;"><summary style="cursor:pointer;color:var(--muted);font-size:11px;">Raw response</summary>
    <pre style="white-space:pre-wrap;font-size:11px;background:var(--panel2);padding:8px;border-radius:6px;margin-top:6px;">${invEsc(JSON.stringify(content, null, 2))}</pre>
  </details>`;
  return html;
}

const V_SEVERITY_STYLE = {
  error: { color: 'var(--danger)', border: '#5a2626', bg: 'var(--danger-dim)' },
  warning: { color: 'var(--warn)', border: 'var(--warn-dim)', bg: 'var(--warn-dim)' },
  info: { color: 'var(--muted)', border: 'var(--border)', bg: 'var(--panel2)' }
};

function vRenderHealthResult(content){
  const anomalies = content.anomalies || [];
  const summary = content.summary || { errors: 0, warnings: 0, info: 0 };
  let html = `<div class="diag-summary" style="margin-bottom:10px;">Scanned ${content.scanned ?? '?'} associated_id(s), ${content.healthy ?? '?'} with no anomalies. ${anomalies.length} total: ${summary.errors ?? 0} error, ${summary.warnings ?? 0} warning, ${summary.info ?? 0} info.</div>`;
  if(!anomalies.length){
    html += '<div class="diag-summary">Nothing to show for this window.</div>';
    return html;
  }
  const bySeverity = { error: [], warning: [], info: [] };
  anomalies.forEach(a => {
    const sev = bySeverity[a.severity] ? a.severity : 'info';
    bySeverity[sev].push(a);
  });
  ['error','warning','info'].forEach(sev => {
    if(!bySeverity[sev].length) return;
    const s = V_SEVERITY_STYLE[sev];
    bySeverity[sev].forEach(a => {
      html += `<div style="border:1px solid ${s.border};background:${s.bg};border-radius:6px;padding:8px 10px;margin-bottom:8px;">
        <div style="font-weight:600;color:${s.color};">${invEsc(a.type)} <span style="font-weight:400;color:var(--muted);font-size:11px;">(${invEsc(sev)})</span></div>
        <div style="margin-top:2px;">associated_id: <span style="font-family:var(--mono);">${invEsc(a.associated_id)}</span></div>
        <div style="margin-top:2px;">${invEsc(a.description)}</div>
        ${a.evidence ? `<details style="margin-top:4px;"><summary style="cursor:pointer;color:var(--muted);font-size:11px;">Evidence</summary>
          <pre style="white-space:pre-wrap;font-size:11px;background:var(--panel2);padding:6px;border-radius:6px;margin-top:4px;">${invEsc(JSON.stringify(a.evidence, null, 2))}</pre>
        </details>` : ''}
      </div>`;
    });
  });
  return html;
}

document.getElementById('vLookupBtn').addEventListener('click', async ()=>{
  const codeRaw = document.getElementById('vCode').value.trim();
  if(!codeRaw || codeRaw.length !== 6){ vSetStatus('vLookupStatus', 'Enter the 6-character code from the modal footer.', 'err'); return; }
  const targetAppDomain = document.getElementById('vLookupDomain').value.trim() || null;

  const btn = document.getElementById('vLookupBtn');
  btn.disabled = true;
  document.getElementById('vLookupResultsPanel').style.display = 'none';
  vSetStatus('vLookupStatus', 'Getting a token…');
  try{
    const token = await invGetToken(false);
    vSetStatus('vLookupStatus', `<span class="spinner">⟳</span> Looking up code ${invEsc(codeRaw)}…`, null, true);
    const params = { code: codeRaw };
    if(targetAppDomain) params.appDomain = targetAppDomain;
    const content = await verifDiagEvaluate(token, 'lookupVerificationAttempt', params);
    document.getElementById('vLookupResultsBody').innerHTML = vRenderLookupResult(content);
    document.getElementById('vLookupResultsPanel').style.display = 'block';
    vSetStatus('vLookupStatus', 'Done.', 'ok');
  }catch(err){
    vSetStatus('vLookupStatus', 'Failed — ' + (err.message || 'unknown error') + '. A 404 here can mean either "not found" or a permission gap on this key — see the hint above.', 'err');
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('vHealthBtn').addEventListener('click', async ()=>{
  const sinceLocal = document.getElementById('vHealthSince').value;
  if(!sinceLocal){ vSetStatus('vHealthStatus', 'Enter a "since" time first.', 'err'); return; }
  const untilLocal = document.getElementById('vHealthUntil').value;
  const targetAppDomain = document.getElementById('vHealthDomain').value.trim() || null;

  const btn = document.getElementById('vHealthBtn');
  btn.disabled = true;
  document.getElementById('vHealthResultsPanel').style.display = 'none';
  vSetStatus('vHealthStatus', 'Getting a token…');
  try{
    const token = await invGetToken(false);
    vSetStatus('vHealthStatus', '<span class="spinner">⟳</span> Scanning…', null, true);
    const params = { since: new Date(sinceLocal).toISOString() };
    if(untilLocal) params.until = new Date(untilLocal).toISOString();
    if(targetAppDomain) params.appDomain = targetAppDomain;
    const content = await verifDiagEvaluate(token, 'verificationHealthCheck', params);
    document.getElementById('vHealthResultsBody').innerHTML = vRenderHealthResult(content);
    document.getElementById('vHealthResultsPanel').style.display = 'block';
    const n = (content.anomalies || []).length;
    vSetStatus('vHealthStatus', `Done. ${n} anomal${n===1?'y':'ies'} found.`, 'ok');
  }catch(err){
    vSetStatus('vHealthStatus', 'Failed — ' + (err.message || 'unknown error'), 'err');
  } finally {
    btn.disabled = false;
  }
});

initVerification();

// =====================================================================
// Sentry event search (beta) — added 3.17.9. Ported from Engineering's
// scripts/excise-diagnostics/sentry-order-lookup.js (Trello 9369, the 8/31
// handoff snapshot for the "[Epic][TaxOpsTools] Adopt portable excise
// diagnostics" epic). Only the Sentry-querying half of that script is
// portable — confirmed by direct source inspection: fetchSentryIssue/
// searchSentryEvents call https://sentry.io/api/0/organizations/{org}/...
// directly over plain HTTPS with a Bearer token, and the script's own
// SystemServices/commonUtils requires only appear later, in the separate
// order-fetch/recalculate step (getAccessToken/fetchOrder/
// calculateWithDiagnostics) — a step the script's own --sentry-only flag
// skips entirely, proving the Sentry half has no monolith dependency.
//
// This ports searchSentryEvents() specifically (not fetchSentryIssue-by-ID —
// out of scope for now, nothing in this extension currently takes a raw
// Sentry issue ID as input). Query shape, field list, sort, and the 25-result
// cap all mirror the original function exactly. Reuses the same
// excise.appDomain / excise.appTransactionId tags the "Sentry links" section
// in the Investigation dossier already generates clickable search links for —
// this adds an inline result list as an alternative to clicking out.
// =====================================================================

const SENTRY_CREDS_KEY = 'totExciseSentryCreds';

function sentrySetCredsStatus(msg, type, isHtml){
  const el = document.getElementById('sentryCredsStatus');
  if(isHtml) el.innerHTML = msg; else el.textContent = msg;
  el.className = 'status-line show' + (type ? ' '+type : '');
}
function sentrySetStandaloneStatus(msg, type, isHtml){
  const el = document.getElementById('sentryStandaloneStatus');
  if(isHtml) el.innerHTML = msg; else el.textContent = msg;
  el.className = 'status-line show' + (type ? ' '+type : '');
}

async function sentryLoadCreds(){
  const stored = await chrome.storage.local.get([SENTRY_CREDS_KEY]);
  return stored[SENTRY_CREDS_KEY] || null;
}
async function sentrySaveCreds(authToken, org, project){
  await chrome.storage.local.set({ [SENTRY_CREDS_KEY]: { authToken, org, project } });
}
async function sentryClearCreds(){
  await chrome.storage.local.remove([SENTRY_CREDS_KEY]);
}

function sentryEsc(s){ return escapeAttr(String(s ?? '')); }

// Mirrors sentry-order-lookup.js's searchSentryEvents() — same query shape
// (tags[excise.appDomain]:<domain> [tags[excise.appTransactionId]:<id>]),
// same field list, same -timestamp sort, same 25-result cap.
async function sentrySearchEvents(creds, appDomain, appTransactionId){
  if(!creds || !creds.authToken || !creds.org) throw new Error('No saved Sentry credentials — enter an auth token and org slug above first.');
  if(!appDomain) throw new Error('App domain is required.');
  let query = `tags[excise.appDomain]:${appDomain}`;
  if(appTransactionId) query += ` tags[excise.appTransactionId]:${appTransactionId}`;
  const params = new URLSearchParams();
  params.set('query', query);
  ['id','message','timestamp','tags[errorType]','tags[excise.appDomain]','tags[excise.appTransactionId]','tags[excise.sku]','tags[excise.productId]','tags[excise.integrationSource]'].forEach(f=>params.append('field', f));
  params.set('sort', '-timestamp');
  params.set('per_page', '25');
  if(creds.project) params.set('project', creds.project);
  const url = `https://sentry.io/api/0/organizations/${encodeURIComponent(creds.org)}/events/?${params.toString()}`;
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + creds.authToken, Accept: 'application/json' } });
  let body;
  try{ body = await res.json(); }catch(e){ throw new Error(`HTTP ${res.status} — response wasn't valid JSON.`); }
  if(!res.ok){
    const msg = body?.detail || body?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return (body.data || []).map(e => ({
    id: e.id,
    message: e.message,
    timestamp: e.timestamp,
    errorType: e['tags[errorType]'] || 'unknown',
    appDomain: e['tags[excise.appDomain]'] || null,
    appTransactionId: e['tags[excise.appTransactionId]'] || null,
    sku: e['tags[excise.sku]'] || null,
    productId: e['tags[excise.productId]'] || null,
    integrationSource: e['tags[excise.integrationSource]'] || null
  }));
}

// Sentry has no dedicated ping/token-exchange endpoint the way the
// Investigation API's /accessToken does, so "test" here hits the org detail
// endpoint (GET .../organizations/{org}/), which needs only org:read and
// confirms the token + org slug actually work together.
async function sentryTestCreds(authToken, org){
  const res = await fetch(`https://sentry.io/api/0/organizations/${encodeURIComponent(org)}/`, {
    headers: { Authorization: 'Bearer ' + authToken, Accept: 'application/json' }
  });
  if(!res.ok){
    let body; try{ body = await res.json(); }catch(e){}
    const msg = body?.detail || `HTTP ${res.status}`;
    throw new Error(msg);
  }
}

function sentryRenderEvents(events){
  if(!events || !events.length) return '<div style="color:var(--muted);">(no Sentry events found)</div>';
  return `<div class="table-scroll"><table class="cfg" style="width:100%;">
    <thead><tr><th>Time</th><th>Error type</th><th>SKU</th><th>Order</th><th>Source</th><th>Message</th></tr></thead>
    <tbody>
      ${events.map(e => `<tr>
        <td style="white-space:nowrap;font-size:11px;color:var(--muted);">${sentryEsc(e.timestamp||'')}</td>
        <td>${sentryEsc(e.errorType||'')}</td>
        <td>${sentryEsc(e.sku||'—')}</td>
        <td>${sentryEsc(e.appTransactionId||'—')}</td>
        <td>${sentryEsc(e.integrationSource||'—')}</td>
        <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${sentryEsc(e.message||'')}">${sentryEsc(e.message||'')}</td>
      </tr>`).join('')}
    </tbody>
  </table></div>`;
}

// App domain dropdown reuses the same HQ_DOMAINS list/storage as the
// Investigate tab's Target app domain select and the HQ Excise Tax Scan
// tab's Known domains table (see loadHqDomains/domainOptionsHtml above) —
// add or fix domains in either of those and this dropdown picks them up
// too. Mirrors invRenderTargetDomainSelect exactly, minus the "use my key's
// own domain" default option, which has no Sentry equivalent — a domain
// must be explicitly chosen (or typed via "Other...") here.
function sentryRenderAppDomainSelect(selected){
  const sel = document.getElementById('sentryAppDomainSelect');
  if(!sel) return;
  const opts = ['<option value="">(select a domain)</option>'];
  opts.push(domainOptionsHtml(selected && selected !== '__custom__' ? selected : ''));
  opts.push('<option value="__custom__"' + (selected === '__custom__' ? ' selected' : '') + '>Other… (type manually)</option>');
  sel.innerHTML = opts.join('');
  if(selected && selected !== '__custom__') sel.value = selected;
}

document.getElementById('sentryAppDomainSelect').addEventListener('change', (e)=>{
  const textInput = document.getElementById('sentryAppDomain');
  if(e.target.value === '__custom__'){
    textInput.style.display = '';
    textInput.value = '';
    textInput.focus();
  } else {
    textInput.style.display = 'none';
    textInput.value = e.target.value;
  }
});

async function initSentry(){
  const creds = await sentryLoadCreds();
  if(creds){
    document.getElementById('sentryAuthToken').value = creds.authToken || '';
    document.getElementById('sentryOrg').value = creds.org || '';
    document.getElementById('sentryProject').value = creds.project || '';
  }
  await loadHqDomains(); // idempotent if the Investigate tab's init already ran this
  sentryRenderAppDomainSelect('');
}

document.getElementById('sentrySaveCredsBtn').addEventListener('click', async ()=>{
  const authToken = document.getElementById('sentryAuthToken').value.trim();
  const org = document.getElementById('sentryOrg').value.trim();
  const project = document.getElementById('sentryProject').value.trim();
  if(!authToken || !org){ sentrySetCredsStatus('Enter at least an auth token and org slug.', 'err'); return; }
  sentrySetCredsStatus('Saving and testing…');
  try{
    await sentrySaveCreds(authToken, org, project);
    await sentryTestCreds(authToken, org);
    sentrySetCredsStatus('Saved — org lookup succeeded.', 'ok');
  }catch(err){
    sentrySetCredsStatus('Saved, but the test call failed — ' + (err.message || 'unknown error') + '. Double-check the token and org slug.', 'err');
  }
});

document.getElementById('sentryClearCredsBtn').addEventListener('click', async ()=>{
  await sentryClearCreds();
  document.getElementById('sentryAuthToken').value = '';
  document.getElementById('sentryOrg').value = '';
  document.getElementById('sentryProject').value = '';
  sentrySetCredsStatus('Cleared saved credentials.', 'ok');
});

document.getElementById('sentrySearchStandaloneBtn').addEventListener('click', async ()=>{
  const appDomain = document.getElementById('sentryAppDomain').value.trim();
  const orderId = document.getElementById('sentryOrderId').value.trim() || null;
  if(!appDomain){ sentrySetStandaloneStatus('Enter an app domain first.', 'err'); return; }
  const btn = document.getElementById('sentrySearchStandaloneBtn');
  btn.disabled = true;
  document.getElementById('sentryStandaloneResults').innerHTML = '';
  sentrySetStandaloneStatus('<span class="spinner">⟳</span> Searching Sentry…', null, true);
  try{
    const creds = await sentryLoadCreds();
    const events = await sentrySearchEvents(creds, appDomain, orderId);
    document.getElementById('sentryStandaloneResults').innerHTML = sentryRenderEvents(events);
    sentrySetStandaloneStatus(`Done — ${events.length} event(s) found.`, 'ok');
  }catch(err){
    sentrySetStandaloneStatus('Failed — ' + (err.message || 'unknown error'), 'err');
  } finally {
    btn.disabled = false;
  }
});

initSentry();
