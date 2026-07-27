const CONFIG_KEY = 'totExciseConfig';
const SHEET_KEY = 'totExciseSheetUrl';

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

function currentUrl(){
  const parsedFromInput = parseOrderInput(document.getElementById('orderInput').value);
  let handle, orderId;
  if(parsedFromInput.handle){
    handle = parsedFromInput.handle;
    orderId = parsedFromInput.orderId;
  } else {
    const row = CONFIG[document.getElementById('domainSelect').value];
    handle = row ? row.handle : '';
    orderId = parsedFromInput.orderId;
  }
  if(!handle || !orderId) return null;
  return `https://admin.shopify.com/store/${handle}/orders/${orderId}.json`;
}

function setStatus(msg, type){
  const el = document.getElementById('fetchStatus');
  el.textContent = msg;
  el.className = 'status-line show' + (type ? ' '+type : '');
}

document.getElementById('openTabBtn').addEventListener('click', ()=>{
  const url = currentUrl();
  if(!url){ setStatus('Select a storefront with a saved handle, and enter an order ID.', 'err'); return; }
  chrome.tabs.create({url: url.replace(/\.json$/, '')});
});

document.getElementById('fetchBtn').addEventListener('click', async ()=>{
  const url = currentUrl();
  if(!url){ setStatus('Select a storefront with a saved handle, and enter an order ID.', 'err'); return; }
  setStatus('Fetching ' + url + ' …');
  try{
    const res = await fetch(url, {credentials:'include'});
    if(res.status === 401 || res.status === 403){
      setStatus(`Not authenticated for this store (${res.status}). Open it in Shopify first to log in, then try Fetch again.`, 'err');
      return;
    }
    if(!res.ok){
      setStatus(`Request returned ${res.status}. Check the store handle and order ID are correct.`, 'err');
      return;
    }
    const data = await res.json();
    setStatus('Loaded order ' + url, 'ok');
    handleOrderData(data.order || data);
  }catch(err){
    setStatus('Fetch failed — ' + (err.message || 'unknown error') + '. Try "Open in Shopify" and paste the JSON below instead.', 'err');
  }
});

document.getElementById('analyzePastedBtn').addEventListener('click', ()=>{
  const raw = document.getElementById('pasteArea').value.trim();
  if(!raw){ return; }
  try{
    const data = JSON.parse(raw);
    handleOrderData(data.order || data);
    setStatus('Loaded from pasted JSON.', 'ok');
  }catch(e){
    setStatus('Could not parse that as JSON — check for a stray character or truncated paste.', 'err');
  }
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

function analyzeOrder(order){
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

  const untaxed = lineItems.filter(li => li.taxable === false || !li.tax_lines || li.tax_lines.length===0);
  checks.push({
    label:'Product metadata (PMD)',
    status: untaxed.length>0 ? 'flag' : (lineItems.length ? 'ok' : 'info'),
    summary: lineItems.length===0 ? 'No line items on this order'
      : untaxed.length>0 ? `${untaxed.length} of ${lineItems.length} line item(s) missing tax config`
      : `All ${lineItems.length} line item(s) have tax_lines and taxable:true`,
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
  checks.push({
    label:'State-specific rate config',
    status: 'info',
    summary: state ? `Ship-to state: ${state} — cross-check against the compliance calendar` : 'No ship-to state to check',
    detail: state ? `Verify ${state}'s excise tax / PACT registration rules for this order date against the compliance reference.` : null
  });

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

function handleOrderData(order){
  document.getElementById('jsonPanel').style.display = 'block';
  document.getElementById('jsonView').innerHTML = syntaxHighlight(order);
  document.getElementById('orderMeta').textContent =
    `#${order.order_number || order.name || order.id || ''} · ${order.created_at ? order.created_at.slice(0,10) : ''}`;
  renderDiagnostics(analyzeOrder(order));
}

async function init(){
  CONFIG = await loadConfig();
  renderDomainSelect();
  renderCfgTable();

  const sheetInput = document.getElementById('sheetUrl');
  const stored = await chrome.storage.local.get([SHEET_KEY]);
  sheetInput.value = stored[SHEET_KEY] || '';
  sheetInput.addEventListener('input', ()=> chrome.storage.local.set({[SHEET_KEY]: sheetInput.value.trim()}));
}

init();
