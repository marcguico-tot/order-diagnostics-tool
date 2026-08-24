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

function analyzeOrder(order, compliance, walletType){
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
  const unusual = gateways.some(g => ['manual','cash on delivery (cod)','bogus','free'].includes((g||'').toLowerCase()));
  const expressWalletNames = {google_pay:'Google Pay', apple_pay:'Apple Pay', shopify_pay:'Shop Pay'};
  const expressWallet = walletType && expressWalletNames[walletType];
  const paymentTerms = order.payment_terms || null; // Shopify B2B/Companies deferred-payment orders (e.g. Net 30) carry this instead of/alongside a gateway
  checks.push({
    label:'Payment method',
    status: gateways.length===0 ? 'info' : (expressWallet ? 'flag' : (unusual ? 'flag' : 'ok')),
    summary: gateways.length===0
      ? (paymentTerms ? `No payment gateway recorded — expected for a deferred-payment (${paymentTerms.payment_terms_name || paymentTerms.payment_terms_type || 'net terms'}) order, see Payment terms check below` : 'No payment gateway recorded on the order')
      : expressWallet ? `Express payment detected: ${expressWallet} (via ${gatewayText})`
      : unusual ? `Non-standard gateway: ${gatewayText}`
      : `Gateway: ${gatewayText}`,
    detail: expressWallet
      ? 'Confirmed root cause (2026-08-03, BV147374): express payment methods (Google Pay, Apple Pay) bypass the standard Shopify checkout process, which is what the excise tax app hooks into. Orders paid this way calculate tax correctly but the tax app never gets the chance to add it to the collected total. Recommend the merchant disable express payment methods, or flag to dev for a fix on the tax app side. (Wallet type read from the order\'s Transactions API — payment_details.credit_card_wallet — not from payment_gateway_names, which only shows the processor, e.g. "authorize.net", regardless of wallet used.)'
      : unusual ? 'Manual / COD / bogus gateways sometimes bypass the checkout flow that triggers the tax app.' : null
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

async function fetchWalletType(handle, orderId){
  try{
    const url = `https://admin.shopify.com/store/${handle}/orders/${orderId}/transactions.json`;
    const res = await fetch(url, {credentials:'include'});
    if(!res.ok) return null;
    const data = await res.json();
    const txs = data.transactions || [];
    // Prefer a successful sale transaction with wallet info; wallet type lives in
    // payment_details.credit_card_wallet (e.g. "google_pay", "apple_pay", "shopify_pay").
    // Confirmed against a real transactions.json response for BV147374 (2026-08-04).
    const withWallet = txs.find(t => t.payment_details && t.payment_details.credit_card_wallet);
    return withWallet ? withWallet.payment_details.credit_card_wallet : null;
  }catch(e){
    return null; // Non-fatal — payment method check just falls back to gateway-only info.
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
  const walletType = (handle && order.id) ? await fetchWalletType(handle, order.id) : null;
  renderTotStatus(order);
  renderDiagnostics(analyzeOrder(order, compliance, walletType));
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
  document.getElementById('platformHQ').classList.toggle('active', platform === 'hq');
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
const HQ_SCAN_HOURS = 24; // fixed — "last N hours" mode always means the last 24h, not a typed number
const HQ_ORIGIN = 'https://app.tokenoftrust.com';

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

function setHqStatus(msg, type) {
  const el = document.getElementById('hqStatus');
  el.textContent = msg;
  el.className = 'status-line show' + (type ? ' ' + type : '');
}

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
    const last24 = row.sinceHoursAgo != null;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><select data-i="${i}" data-f="domain" style="width:150px;">
        <option value="" ${row.domain ? '' : 'selected'} disabled>Select a domain...</option>
        ${domainOptionsHtml(row.domain)}
      </select></td>
      <td><input type="text" data-i="${i}" data-f="idStart" value="${row.idStart ?? ''}" placeholder="idStart" style="width:70px;" ${last24 ? 'disabled' : ''}></td>
      <td><input type="text" data-i="${i}" data-f="idEnd" value="${row.idEnd ?? ''}" placeholder="blank = auto" title="Leave blank to auto-detect the end — the scan walks forward from ID start until it stops finding real orders." style="width:80px;" ${last24 ? 'disabled' : ''}></td>
      <td style="text-align:center;"><input type="checkbox" data-i="${i}" data-f="last24" ${last24 ? 'checked' : ''} title="Scan the last ${HQ_SCAN_HOURS} hours instead of a fixed ID range"></td>
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
  body.querySelectorAll('input[data-f="last24"]').forEach(cb => {
    cb.addEventListener('change', async e => {
      const i = +e.target.dataset.i;
      if (e.target.checked) {
        HQ_QUEUE[i].sinceHoursAgo = HQ_SCAN_HOURS;
        HQ_QUEUE[i].idStart = null;
        HQ_QUEUE[i].idEnd = null;
      } else {
        HQ_QUEUE[i].sinceHoursAgo = null;
      }
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
    return `<div class="hint">${isCurrent ? '▶' : '⏳'} ${escapeAttr(row.domain || '(no domain)')} — ${label}${isCurrent ? ' (in progress...)' : ''}</div>`;
  }).join('');
}

function renderMismatchTable(mismatches) {
  const rows = mismatches.map(m => `
    <tr>
      <td>${escapeAttr(String(m.id))}</td>
      <td>${escapeAttr(m.shippingRegion || '—')}</td>
      <td>${escapeAttr(m.transactionType || '—')}</td>
      <td>$${escapeAttr(String(m.exciseTaxCollected ?? '0'))}</td>
      <td>$${escapeAttr(String(m.recalculatedTaxSum ?? 0))}</td>
      <td>${escapeAttr((m.ruleKeys || []).join(', ') || '—')}</td>
    </tr>`).join('');
  return `
    <table class="cfg" style="margin-top:0;">
      <thead><tr><th>Order ID</th><th>Region</th><th>Type</th><th>Collected</th><th>Should've collected</th><th>Rule(s) applied</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
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
    <table class="cfg" style="margin-top:0;">
      <thead><tr><th>Order ID</th><th>Region</th><th>SKU</th><th>Product</th><th>Qty</th><th>Actual price</th><th>Catalog price</th><th>Delta/unit</th><th>Est. tax overcharged</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>`;
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
    <table class="cfg" style="margin-top:0;">
      <thead><tr><th>Order ID</th><th>Region</th><th>SKU</th><th>Product</th><th>Qty</th><th>Catalog price</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>`;
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
    <table class="cfg" style="margin-top:0;">
      <thead><tr><th>Order ID</th><th>Region</th><th>SKU</th><th>Product</th><th>Rule</th><th>Wholesale cost</th><th>Rate</th><th>Expected unit tax</th><th>Actual unit tax</th><th>Direction</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>`;
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
    <table class="cfg" style="margin-top:0;">
      <thead><tr><th>Order ID</th><th>Region</th><th>SKU</th><th>Product</th><th>Rule</th><th>Volume</th><th>Rate</th><th>Expected unit tax</th><th>Actual unit tax</th><th>Direction</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>`;
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
  const errored = HQ_RESULTS.filter(r => r.error);
  summary.textContent = `Scanned ${HQ_RESULTS.length} org(s) — ${flagged.length} with mismatches, ${overchargedOrgs.length} with a stale catalog price (possible overcharge), ${possiblyMissedTaxOrgs.length} with a possible missed tax (isExempt fallback), ${wholesaleCostOrgs.length} with a wholesale-cost-basis rate mismatch, ${flatRateOrgs.length} with a flat per-mL rate mismatch, ${errored.length} couldn't be scanned.`;

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
      const overchargeBadge = r.overchargedCount > 0 ? `<span class="badge flag" style="margin-left:6px;">${r.overchargedCount} order(s) w/ stale price</span>` : '';
      const possiblyMissedTaxBadge = r.possiblyMissedTaxCount > 0 ? `<span class="badge flag" style="margin-left:6px;">${r.possiblyMissedTaxCount} order(s) w/ possible missed tax</span>` : '';
      const wholesaleCostBadge = r.wholesaleCostFlaggedCount > 0 ? `<span class="badge flag" style="margin-left:6px;">${r.wholesaleCostFlaggedCount} order(s) w/ wholesale-cost mismatch</span>` : '';
      const flatRateBadge = r.flatRateFlaggedCount > 0 ? `<span class="badge flag" style="margin-left:6px;">${r.flatRateFlaggedCount} order(s) w/ flat-rate mismatch</span>` : '';
      item.innerHTML = `
        <div class="diag-head">
          <div class="diag-title">${escapeAttr(r.domain)}</div>
          <span class="badge ${badge}">${badgeText}</span>${overchargeBadge}${possiblyMissedTaxBadge}${wholesaleCostBadge}${flatRateBadge}
        </div>
        <div class="diag-summary">${r.checked} order(s) found and checked (${r.notFound} in the range didn't exist / 404'd) — ${r.mismatchCount} of those ${r.checked} show the mismatch pattern.${r.highestFoundId != null ? ` Newest order found: <strong>${r.highestFoundId}</strong> — use this as next cycle's start ID.` : ''}</div>
        ${r.notRequired != null ? `<div class="diag-summary" style="margin-top:4px;">${r.checked} checked:<div style="margin-top:2px;padding-left:14px;font-family:monospace;line-height:1.6;">${r.notRequired} tot-excise-tax-not-required<br>${r.collected} tot-excise-tax-collected<br>${r.incorrect} tot-excise-tax-incorrect</div></div>` : ''}
        ${r.mismatchCount > 0 ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);"><div style="font-weight:600;margin-bottom:4px;">Order IDs tagged tot-excise-tax-incorrect:</div>${renderMismatchTable(r.mismatches)}</div>` : ''}
        ${r.overchargedCount > 0 ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);"><div style="font-weight:600;margin-bottom:4px;">${r.overchargedCount} order(s) with a line where TOT's saved catalog price is above what was actually charged:</div><div class="diag-summary" style="margin-bottom:6px;">Estimated tax overcharged so far: <strong>~$${r.estimatedOverchargeTotal}</strong>. Only jurisdiction+SKU-type combos confirmed retail-price-based on TaxOps Portal's State Tax Rules page are checked at all (currently NY::vape and WA::vape/nicotinePouch) — everything else is skipped by default, since most states tax by wholesale cost/price, a flat per-mL/per-unit amount, or not at all, where a stale catalog retail price is irrelevant to the tax owed. This is still an estimate, not a confirmed dollar amount — always double-check against HQ's "How was this tax calculated" tool before acting on it.</div>${renderOverchargeTable(r.overcharged)}</div>` : ''}
        ${r.possiblyMissedTaxCount > 0 ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);"><div style="font-weight:600;margin-bottom:4px;">${r.possiblyMissedTaxCount} order(s) with a nicotine vape line marked exempt but missing its volume classification:</div><div class="diag-summary" style="margin-bottom:6px;">Speculative, unconfirmed lead — not a proven miss. Per BigCommerce's own totProductBuilder.node.js source, a vape product's isExempt gets set to true automatically whenever it's missing volumeInMl or a classifiable vapeSystemType, which is a fallback for incomplete product data rather than a genuine exemption. These lines match that pattern (isExempt, hasNicotine, no volumeInMl on file, non-trivial catalog price) but haven't been checked against a real order the way the overcharge findings above were. Verify each one manually via HQ's "How was this tax calculated" tool before treating it as a real missed tax.</div>${renderPossiblyMissedTaxTable(r.possiblyMissedTax)}</div>` : ''}
        ${r.wholesaleCostFlaggedCount > 0 ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);"><div style="font-weight:600;margin-bottom:4px;">${r.wholesaleCostFlaggedCount} order(s) with a wholesale-cost-basis tax mismatch:</div><div class="diag-summary" style="margin-bottom:6px;">These states (CO, DC, HI, ME, MA, NV, OR, TN, UT, VT, WY) tax as a percentage of wholesaleCost — a field distinct from retailPrice/wholesalePrice/msrp, so this is a direct expected-vs-actual comparison, not a price-gap estimate. Only CO is confirmed against a real order; the rest are transcribed from the TaxOps sheet and unverified — and it's unconfirmed whether calc-detail always exposes wholesaleCost the way it exposes retailPrice, so a quiet run isn't proof of a clean one either. "Direction" shows whether the actual unit tax charged was above or below the expected amount. Verify each hit via HQ's "How was this tax calculated" tool before acting on it.</div>${renderWholesaleCostMismatchTable(r.wholesaleCostFlagged)}</div>` : ''}
        ${r.flatRateFlaggedCount > 0 ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);"><div style="font-weight:600;margin-bottom:4px;">${r.flatRateFlaggedCount} order(s) with a flat per-mL rate mismatch:</div><div class="diag-summary" style="margin-bottom:6px;">These states (VA, OH, DE, IA, KS, LA, NC, WV, WI) tax a flat dollar amount per mL, with no price/cost field involved at all — the most reliable check in this tool, since there's no price-field ambiguity to get wrong. VA and OH are confirmed against real orders (2447866, 2447910); the rest are transcribed from the TaxOps sheet and unverified. "Direction" shows whether the actual unit tax charged was above or below the expected amount. Verify each hit via HQ's "How was this tax calculated" tool before acting on it.</div>${renderFlatRateMismatchTable(r.flatRateFlagged)}</div>` : ''}`;
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
    const input = document.querySelector('input.vs__search');
    if (!input) return { ok: false, reason: 'logged-out' };
    input.click();
    input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    setNativeValue(input, domain);
    await new Promise(r => setTimeout(r, 900));
    const opts = Array.from(document.querySelectorAll('li'));
    const match = opts.find(l => l.textContent.trim() === domain);
    if (!match) return { ok: false, reason: 'not-found', opts: opts.map(o => o.textContent.trim()) };
    match.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    match.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    match.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 1000));
    return { ok: true };
  })();
}

function hqStageScan(domain, idStart, idEnd, sinceHoursAgo) {
  return (async () => {
    function findButtonByText(txt) {
      return Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === txt);
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

    const resetBtn = findButtonByText('Reset token');
    if (resetBtn) { resetBtn.click(); await new Promise(r => setTimeout(r, 500)); }
    const createBtn = findButtonByText('Generate a new access token') || findButtonByText('Create a new access token');
    if (createBtn) { createBtn.click(); await new Promise(r => setTimeout(r, 1800)); }

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
    if (!full || full === 'No token') return { ok: false, reason: 'no-token' };

    let decoded;
    try { decoded = JSON.parse(atob(full)); } catch (e) { return { ok: false, reason: 'decode-failed: ' + e.message }; }
    if (decoded.referrerOrigin !== domain) return { ok: false, reason: `wrong-scope (token was for ${decoded.referrerOrigin})` };

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
      const orderRes = await fetch(`/api/exciseTax/order/${id}`, { headers: { Accept: 'application/json', Authorization: 'Bearer ' + token } });
      if (orderRes.status !== 200) return null;
      const orderBody = await orderRes.json();
      const calcRes = await fetch(`/api/exciseTax/orders/${id}/calc-detail`, { headers: { Accept: 'application/json', Authorization: 'Bearer ' + token } });
      const calcBody = calcRes.status === 200 ? await calcRes.json() : null;
      const order = orderBody?.content?.order;
      const events = calcBody?.content?.events || [];
      const calcEvent = events.find(e => e.eventType === 'calculation') || events[0] || {};
      const cd = calcEvent.calcDetail || {};
      const taxSum = (cd.products || []).reduce((s, p) => s + ((p.appliedRules || []).reduce((s2, r) => s2 + (r.taxForQty || 0), 0)), 0);

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

      return {
        id,
        exciseTaxCollected: order?.exciseTaxCollected,
        shippingRegion: order?.shippingLocation?.regionCode,
        transactionType: cd.transactionType,
        ruleKeys: Object.keys(cd.rules || {}),
        recalculatedTaxSum: Math.round(taxSum * 100) / 100,
        mismatch: (order?.exciseTaxCollected === '0' && taxSum > 0),
        overchargeLineCount: overchargeLines.length,
        overchargeLines,
        possiblyMissedTaxLineCount: possiblyMissedTaxLines.length,
        possiblyMissedTaxLines,
        wholesaleCostMismatchCount: wholesaleCostMismatches.length,
        wholesaleCostMismatches,
        flatRateMismatchCount: flatRateMismatches.length,
        flatRateMismatches
      };
    }

    const token = full;
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
      const listRes = await fetch(`/api/exciseTax/orders?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&limit=1000`, {
        headers: { Accept: 'application/json', Authorization: 'Bearer ' + token }
      });
      if (listRes.status !== 200) return { ok: false, reason: `list-orders failed (status ${listRes.status})` };
      const body = await listRes.json();
      const orders = body?.content?.orders || body?.content || [];
      for (const o of orders) {
        const id = o.orderId || o.id;
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
    // notRequired: no excise tax rule applied to this order at all.
    // incorrect: a rule applied AND the known under-collection pattern was hit.
    // collected: a rule applied and that specific pattern was NOT hit (does not
    // guarantee the exact amount collected was correct — only that this one
    // failure mode wasn't detected).
    const notRequired = results.filter(r => (r.ruleKeys || []).length === 0).length;
    const incorrect = results.filter(r => (r.ruleKeys || []).length > 0 && r.mismatch).length;
    const collected = results.filter(r => (r.ruleKeys || []).length > 0 && !r.mismatch).length;

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

    // Persist the (possibly updated) rate directory once, at the end of this
    // call, rather than per-order — keeps storage writes cheap while still
    // letting later orders/orgs in the same run (and future runs) benefit
    // from whatever got learned here.
    await chrome.storage.local.set({ totHqRateDirectory: rateDirectory });

    return {
      ok: true, checked: results.length, notFound, mismatchCount: mismatches.length, mismatches, allResults: results,
      lastIdChecked, highestFoundId, notRequired, collected, incorrect,
      overchargedCount: overcharged.length,
      overcharged: overcharged.map(r => ({ id: r.id, shippingRegion: r.shippingRegion, overchargeLines: r.overchargeLines })),
      estimatedOverchargeTotal, overchargeLinesWithEstimate, overchargeLinesTotal,
      possiblyMissedTaxCount: possiblyMissedTax.length,
      possiblyMissedTax: possiblyMissedTax.map(r => ({ id: r.id, shippingRegion: r.shippingRegion, possiblyMissedTaxLines: r.possiblyMissedTaxLines })),
      wholesaleCostFlaggedCount: wholesaleCostFlagged.length,
      wholesaleCostFlagged: wholesaleCostFlagged.map(r => ({ id: r.id, shippingRegion: r.shippingRegion, wholesaleCostMismatches: r.wholesaleCostMismatches })),
      flatRateFlaggedCount: flatRateFlagged.length,
      flatRateFlagged: flatRateFlagged.map(r => ({ id: r.id, shippingRegion: r.shippingRegion, flatRateMismatches: r.flatRateMismatches }))
    };
  })();
}

// ---- orchestration, running in the side panel's own context ----

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
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Continue');
        if (btn) btn.click();
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
async function scanOneOrg(tabId, current) {
  await navigateHqTab(tabId, HQ_ORIGIN + '/hq/choose-app', '/hq/choose-app');

  const [selectInjection] = await chrome.scripting.executeScript({ target: { tabId }, func: hqStageSelectOrg, args: [current.domain] });
  const sel = selectInjection.result;
  if (!sel.ok) return sel;

  await settleOrgSwitch(tabId);

  await navigateHqTab(tabId, HQ_ORIGIN + '/hq/api-docs/excise-tax-order#/operations/createAccessToken', '/hq/api-docs/excise-tax-order');

  const [scanInjection] = await chrome.scripting.executeScript({
    target: { tabId }, func: hqStageScan,
    args: [current.domain, current.idStart ?? null, current.idEnd ?? null, current.sinceHoursAgo ?? null]
  });
  return scanInjection.result;
}

async function runHqScan() {
  if (HQ_RUN_STATE === 'running') return;
  HQ_RUN_STATE = 'running';
  renderHqProgress();

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

    setHqStatus(`Switching to ${current.domain}...`);

    let scanResult;
    let loggedOut = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        scanResult = await scanOneOrg(tabId, current);
      } catch (e) {
        setHqStatus('Lost the HQ tab (closed?) — click Start / Resume to reopen it.', 'err');
        HQ_TAB_ID = null; HQ_RUN_STATE = 'idle'; renderHqProgress();
        return;
      }

      if (scanResult.ok) break;

      if (scanResult.reason === 'logged-out') { loggedOut = true; break; }
      if (scanResult.reason === 'not-found') break; // retrying won't fix a real "not in HQ" result

      // Any other failure (including a wrong-scope token) gets one full retry
      // of the ENTIRE select-org sequence, not just re-minting on the same
      // page — a wrong-scope token usually means the org switch itself didn't
      // fully commit yet, which re-minting alone can't fix.
      if (attempt === 0) setHqStatus(`${current.domain}: ${scanResult.reason} — retrying the full org-switch once...`, 'err');
    }

    if (loggedOut) {
      HQ_RUN_STATE = 'paused-login';
      setHqStatus(`Not signed into HQ. Sign in on the scan tab, then click "Start / Resume" again — ${current.domain} is still first in the queue.`, 'err');
      renderHqProgress();
      return;
    }
    if (!scanResult.ok && scanResult.reason === 'not-found') {
      setHqStatus(`"${current.domain}" wasn't found in the org list — skipping it. (dropdown said: ${(scanResult.opts || []).join(', ') || 'nothing'})`, 'err');
      HQ_RESULTS.push({ domain: current.domain, error: 'domain not found in HQ org search' });
      await saveHqResults();
      HQ_QUEUE.shift(); await saveHqQueue(); renderHqProgress(); renderHqResults();
      continue;
    }

    if (scanResult.ok) {
      HQ_RESULTS.push({ domain: current.domain, checked: scanResult.checked, notFound: scanResult.notFound, mismatchCount: scanResult.mismatchCount, mismatches: scanResult.mismatches, highestFoundId: scanResult.highestFoundId, openEnded: current.idStart != null && current.idEnd == null, notRequired: scanResult.notRequired, collected: scanResult.collected, incorrect: scanResult.incorrect, overchargedCount: scanResult.overchargedCount, overcharged: scanResult.overcharged, estimatedOverchargeTotal: scanResult.estimatedOverchargeTotal, overchargeLinesWithEstimate: scanResult.overchargeLinesWithEstimate, overchargeLinesTotal: scanResult.overchargeLinesTotal, possiblyMissedTaxCount: scanResult.possiblyMissedTaxCount, possiblyMissedTax: scanResult.possiblyMissedTax, wholesaleCostFlaggedCount: scanResult.wholesaleCostFlaggedCount, wholesaleCostFlagged: scanResult.wholesaleCostFlagged, flatRateFlaggedCount: scanResult.flatRateFlaggedCount, flatRateFlagged: scanResult.flatRateFlagged });
      setHqStatus(`${current.domain}: checked ${scanResult.checked}, ${scanResult.mismatchCount} mismatch(es).`, scanResult.mismatchCount > 0 ? 'err' : 'ok');
    } else {
      HQ_RESULTS.push({ domain: current.domain, error: scanResult.reason });
      setHqStatus(`${current.domain} failed after retry: ${scanResult.reason} — skipping.`, 'err');
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
}

document.getElementById('hqStartBtn').addEventListener('click', () => { runHqScan(); });
document.getElementById('hqStopBtn').addEventListener('click', () => {
  if (HQ_RUN_STATE === 'running') { HQ_RUN_STATE = 'stopped'; setHqStatus('Stopping after the current org finishes...', 'ok'); }
});

async function initHq() {
  await loadHqDomains();
  await loadHqQueue();
  await loadHqResults();
  renderHqDomainsTable();
  renderHqQueueTable();
  renderHqProgress();
  renderHqResults();
}
initHq();