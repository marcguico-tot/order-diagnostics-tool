const CONFIG_KEY = 'totExciseConfig';
const SHEET_KEY = 'totExciseSheetUrl';
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
function setLivePriceStatus(msg, type){
  const el = document.getElementById('livePriceStatus');
  el.textContent = msg;
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

async function checkLivePrices(order, handle){
  const lineItems = (order.line_items || []).filter(li=>!isAncillaryLineItem(li));
  const productIds = [...new Set(lineItems.map(li=>li.product_id).filter(Boolean))];
  const variantsByProduct = {};
  await Promise.all(productIds.map(async pid=>{
    try{
      variantsByProduct[pid] = await fetchProductVariants(handle, pid);
    }catch(e){
      variantsByProduct[pid] = null; // deleted/archived product, or fetch failed
    }
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
  setLivePriceStatus('Checking current prices…');
  document.getElementById('livePriceResults').innerHTML = '';
  try{
    const results = await checkLivePrices(currentOrderData, handle);
    renderLivePriceResults(results);
    const mismatches = results.filter(r=>r.mismatch).length;
    setLivePriceStatus(
      mismatches ? `${mismatches} of ${results.length} item(s) differ from the current listed price.` : `All ${results.length} item(s) match the current listed price.`,
      mismatches ? 'err' : 'ok'
    );
  }catch(err){
    setLivePriceStatus('Check failed — ' + (err.message || 'unknown error'), 'err');
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

  setBulkStatus(`Done — ${flagged.length} of ${matches.length} matched orders flagged.`, 'ok');
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

  const sheetInput = document.getElementById('sheetUrl');
  const stored = await chrome.storage.local.get([SHEET_KEY]);
  sheetInput.value = stored[SHEET_KEY] || '';
  sheetInput.addEventListener('input', ()=> chrome.storage.local.set({[SHEET_KEY]: sheetInput.value.trim()}));

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

init();
