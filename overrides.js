// =====================================================================
// Vendor overrides (Client Config API) — part of the Tax Rules tab (PRODUCTION since v3.21.0).
//
// Reads, dry-runs and force-saves ONE client's excise rule overrides
// (options.exciseTax.ruleOverrides) on PRODUCTION (app.tokenoftrust.com).
//
// Same safety model as taxrules.js (which it borrows its helpers, token and
// production-only host from):
//  * The API replaces the client's WHOLE override set on every write (omitted
//    jurisdictions and omitted product types are deleted). This section always
//    posts the complete set it just loaded with exactly one jurisdiction node
//    changed.
//  * Dry-run first (force=false). force=true only after a dry-run of the exact
//    same edit, two different audit emails, a reason and a confirmation.
//  * Before saving: re-read the client; abort if its overrides changed since
//    they were loaded (the Client Config API has no revision to compare, so the
//    comparison is by content). Snapshot the full set (storage.local +
//    downloadable). After saving: re-read and verify.
//  * Revert points: the previous value of the changed jurisdiction is logged.
// =====================================================================
(function(){
'use strict';

const T = window.TaxRulesTab;
const $ = (id) => document.getElementById(id);
if(!T || !$('ovPanel')) return;
const { api, tokenOk, esc, setStatus, clearStatus, canon, pretty, clone, fmtTime, validEmail, copyText, downloadText,
        renderDiff, flatten, describe, getNode, withNode, splitPath, sget, sset, sremove, PREFS_KEY } = T;

const LOG_KEY = 'trProdOvLog';
const SNAP_KEY = 'trProdOvSnaps';
const MAX_LOG = 50, MAX_SNAPS = 5, MAX_ROWS = 60;
const TYPES = ['vape', 'nicotinePouch', 'hemp'];
const OV_FIELD = 'options.exciseTax.ruleOverrides';

const S = {
  loaded: null,   // { ref, appDomain, appId, title, overrides, legacy, modifiableMissing }
  preview: null,  // { sig, ref, pt, path, changes, extra, previous }
  revertOf: null,
  busy: false
};

// ---------------------------------------------------------------- helpers
const enc = encodeURIComponent;

// Calendar date "Oct 6, 2026" (the format the API docs use). The server's "today" might be UTC while ours is
// local, so use whichever is LATER — a start date a few hours ahead is accepted, one behind is rejected as retroactive.
function todayStr(){
  const now = new Date();
  const local = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const utc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const d = new Date(Math.max(local, utc));
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return M[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
}
const RULE_KEYS = ['attr', 'pct', 'tax', 'number', 'forEvery', 'perUnit', 'perVolume', 'exclude'];
const isRule = (o) => o && typeof o === 'object' && !Array.isArray(o) && RULE_KEYS.some((k) => k in o);
// returns { value, added } — adds startDate to rule objects that have neither startDate nor firstDate
function addStartDates(node, date){
  let added = 0;
  const walk = (n) => {
    if(Array.isArray(n)) return n.map(walk);
    if(isRule(n)){
      if(n.exclude === true || n.startDate || n.firstDate) return n;
      added++; return Object.assign({}, n, { startDate: date });
    }
    if(n && typeof n === 'object'){ const o = {}; Object.keys(n).forEach((k) => { o[k] = walk(n[k]); }); return o; }
    return n;
  };
  return { value: walk(node), added };
}

// ruleOverrides as the API hands them back -> { vape:{…}, nicotinePouch:{…}, hemp:{…} }.
// "An object rooted at US is the legacy vape-only form."
function normalize(raw){
  if(!raw || typeof raw !== 'object' || Array.isArray(raw)) return { overrides: {}, legacy: false };
  const hasType = TYPES.some((t) => t in raw);
  if(!hasType && 'US' in raw) return { overrides: { vape: clone(raw) }, legacy: true };
  return { overrides: clone(raw), legacy: false };
}
function overridesOf(cfg){
  const o = cfg && cfg.options && cfg.options.exciseTax && cfg.options.exciseTax.ruleOverrides;
  return normalize(o);
}
function valueAtField(root, field){
  let cur = root;
  for(const k of String(field).split('.')){
    if(cur === null || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}
function summarize(node){
  const d = describe(node, 3);
  const more = describe(node, 99).length - d.length;
  let txt = d.join(' · ');
  if(!txt) txt = (node && node.exclude === true) ? 'EXCLUDED (exclude: true)' : '(no description)';
  return esc(txt) + (more > 0 ? ' <span style="color:var(--muted);">+' + more + ' more</span>' : '');
}
function needClient(){
  if(!S.loaded){ throw new Error('Load a client first.'); }
  return S.loaded;
}
function selectedType(){ return $('ovProductType').value; }
// ---- targets. One state node (US.regionCode.AK) can hold several independent overrides:
//   { all: rule|[rules], county: { "<County>": rule }, locality: { "<City>": rule } }
// A target is the state node plus WHICH part of it is being edited, so adding Fairbanks never touches Anchorage.
const SUBS = ['all', 'county', 'locality'];
const kindLabel = (k) => k === 'locality' ? 'city' : k;
const isContainer = (n) => n && typeof n === 'object' && !Array.isArray(n) && !isRule(n);
function subKeys(n){
  const out = [];
  if(isContainer(n)){
    if('all' in n) out.push('all');
    ['county', 'locality'].forEach((k) => Object.keys(n[k] || {}).forEach((nm) => out.push(kindLabel(k) + ' ' + nm)));
    Object.keys(n).filter((k) => SUBS.indexOf(k) < 0).forEach((k) => out.push(k));
  } else if(n !== undefined) out.push('all');
  return out;
}
const targetKey = (e) => e.level === 'node' ? null : (e.level === 'all' ? 'all' : kindLabel(e.level) + ' ' + e.name);
// the part of a state node a target points at (undefined = not there)
function getSub(node, e){
  if(node === undefined || e.level === 'node') return node;
  if(e.level === 'all') return isContainer(node) ? node.all : node;
  return isContainer(node) && node[e.level] ? node[e.level][e.name] : undefined;
}
// the state node as it will be after the edit (undefined = gone)
function applyTarget(oldNode, e){
  const val = e.remove ? undefined : e.value;
  if(e.level === 'node') return val;
  if(e.level === 'all' && !isContainer(oldNode)) return val;
  let base;
  if(oldNode === undefined) base = {};
  else if(isContainer(oldNode)) base = clone(oldNode);
  else base = { all: clone(oldNode) }; // a state-wide rule stays state-wide, as `all`, when a county/locality is added next to it
  if(e.level === 'all'){ if(val === undefined) delete base.all; else base.all = val; }
  else {
    base[e.level] = base[e.level] || {};
    if(val === undefined) delete base[e.level][e.name]; else base[e.level][e.name] = val;
    if(!Object.keys(base[e.level]).length) delete base[e.level];
  }
  return Object.keys(base).length ? base : undefined;
}
// existing parts of the node that this edit deletes, other than the one being edited on purpose
function removedBy(oldNode, newNode, e){
  const after = subKeys(newNode), mine = targetKey(e);
  return subKeys(oldNode).filter((k) => after.indexOf(k) < 0 && k !== mine);
}
// the complete override set with exactly one state node changed (node undefined = remove)
function buildFull(path, node){
  const L = needClient(); const pt = selectedType();
  const ov = clone(L.overrides) || {};
  const next = withNode(ov[pt] || {}, path, node);
  if(Object.keys(next).length) ov[pt] = next; else delete ov[pt];
  return ov;
}
const targetLabel = (path, level, name) => path + (level && level !== 'node' ? ' › ' + (level === 'all' ? 'state-wide (all)' : kindLabel(level) + ' ' + name) : '');
const bodyFor = (ov, audit) => {
  const b = { options: { exciseTax: { ruleOverrides: ov } } };
  if(audit) b.audit = audit;
  return b;
};
const clientPath = (ref) => '/clients/' + enc(ref);

// ---------------------------------------------------------------- list + load
async function onList(){
  const btn = $('ovListBtn'); btn.disabled = true;
  setStatus('ovLoadStatus', '<span class="spinner">⟳</span> Listing clients…', null, true);
  try{
    const list = await api('GET', '/clients');
    const arr = Array.isArray(list) ? list : [];
    const sel = $('ovClientSel');
    sel.innerHTML = '<option value="">— pick a client (' + arr.length + ') —</option>' + arr.map((c) =>
      '<option value="' + esc(c.appDomain || c.appId) + '">' + esc((c.appTitle || '') + ' — ' + (c.appDomain || c.appId)) + '</option>').join('');
    sel.style.display = arr.length ? 'block' : 'none';
    setStatus('ovLoadStatus', arr.length + ' client(s) on production. Pick one, or type an app domain below.', 'ok');
  }catch(err){
    setStatus('ovLoadStatus', 'Could not list clients — ' + (err.message || 'unknown error') + (err.status === 403 ? ' (403: this API client needs the api:clientConfig role.)' : ''), 'err');
  }finally{ btn.disabled = false; }
}
async function onLoad(){
  const ref = $('ovClient').value.trim();
  if(!ref){ setStatus('ovLoadStatus', 'Enter or pick a client first.', 'err'); return; }
  const btn = $('ovLoadBtn'); btn.disabled = true;
  setStatus('ovLoadStatus', '<span class="spinner">⟳</span> Loading ' + esc(ref) + '…', null, true);
  try{
    await loadClient(ref);
    const L = S.loaded;
    const n = TYPES.reduce((a, t) => a + flatten(L.overrides[t]).length, 0);
    let msg = 'Loaded ' + (L.appDomain || ref) + ' — ' + (n ? n + ' override jurisdiction(s).' : 'no overrides set (it uses the global rules).');
    if(L.legacy) msg += ' NOTE: stored in the legacy vape-only form; saving converts it to {vape: …}.';
    setStatus('ovLoadStatus', msg, L.legacy ? 'err' : 'ok');
  }catch(err){
    S.loaded = null; $('ovWrap').style.display = 'none'; $('ovEditPanel').style.display = 'none';
    setStatus('ovLoadStatus', 'Failed — ' + (err.message || 'unknown error') + (err.status === 403 ? ' (403: this API client needs the api:clientConfig role.)' : err.status === 404 ? ' (404: no such client.)' : ''), 'err');
  }finally{ btn.disabled = false; }
}
async function loadClient(ref){
  const c = await api('GET', clientPath(ref));
  if(!c || typeof c !== 'object') throw new Error('Unexpected response (no client configuration).');
  const { overrides, legacy } = overridesOf(c);
  const mf = c._metadata && Array.isArray(c._metadata.modifiableFields) ? c._metadata.modifiableFields : null;
  S.loaded = { ref, appDomain: c.appDomain || ref, appId: c.appId, title: c.appTitle, overrides, legacy,
    modifiableMissing: !!(mf && !mf.some((f) => String(f).indexOf('options.exciseTax') === 0)) };
  Object.keys(gCache).forEach((k) => delete gCache[k]);
  invalidatePreview();
  $('ovWrap').style.display = 'block';
  $('ovConfirmClient').textContent = S.loaded.appDomain;
  renderOverrides();
  if($('ovEditPanel').style.display === 'block') refreshRevertPoint();
  return S.loaded;
}
function renderOverrides(){
  const L = S.loaded; if(!L) return;
  const per = TYPES.map((t) => t + ': ' + flatten(L.overrides[t]).length).join(' · ');
  const extraKeys = Object.keys(L.overrides).filter((k) => TYPES.indexOf(k) < 0);
  $('ovSummary').innerHTML = '<strong>' + esc(L.title || L.appDomain) + '</strong> <span style="font-family:var(--mono);">(' + esc(L.appDomain) + ')</span><br>Overrides — ' + esc(per) +
    (extraKeys.length ? '<br><span style="color:var(--warn);">Unrecognised top-level keys are kept as-is: ' + esc(extraKeys.join(', ')) + '</span>' : '') +
    (L.modifiableMissing ? '<br><span style="color:var(--warn);">The server&rsquo;s modifiableFields list doesn&rsquo;t mention options.exciseTax — a save may be rejected.</span>' : '');
  const pt = selectedType();
  const all = flatten(L.overrides[pt]);
  $('ovCount').textContent = all.length ? all.length + ' override(s) for ' + pt + '.' : 'No ' + pt + ' overrides — this client uses the global ' + pt + ' rules.';
  const rows = [];
  all.forEach((j) => {
    if(isContainer(j.value) && SUBS.some((k) => k in j.value) && Object.keys(j.value).every((k) => SUBS.indexOf(k) >= 0)){
      if('all' in j.value) rows.push({ path: j.path, level: 'all', name: '', value: j.value.all });
      ['county', 'locality'].forEach((k) => Object.keys(j.value[k] || {}).forEach((nm) => rows.push({ path: j.path, level: k, name: nm, value: j.value[k][nm] })));
    } else rows.push({ path: j.path, level: 'node', name: '', value: j.value });
  });
  if(rows.length) $('ovCount').textContent = rows.length + ' override(s) for ' + pt + ' (under ' + all.length + ' state node(s)).';
  $('ovJurBody').innerHTML = rows.slice(0, MAX_ROWS).map((r) =>
    '<tr><td style="font-family:var(--mono);word-break:break-all;">' + esc(r.path) + (r.level === 'node' ? '' : '<br><span style="color:var(--accent);">' + esc(r.level === 'all' ? 'state-wide (all)' : kindLabel(r.level) + ': ' + r.name) + '</span>') +
    '</td><td style="white-space:normal;min-width:160px;">' + summarize(r.value) +
    '</td><td><button class="btn small" data-ov-edit="' + esc(JSON.stringify({ path: r.path, level: r.level, name: r.name })) + '">Edit</button></td></tr>').join('') ||
    '<tr><td colspan="3" style="color:var(--muted);">None.</td></tr>';
}

// ---------------------------------------------------------------- editor
// ---- the single "Where" dropdown. Values: "all|", "node|", "county|<name>", "locality|<name>", "new-county|", "new-locality|"
const gCache = {};          // product type -> global rules (so the dropdown can list the cities and counties that exist)
let locSeq = 0, locTimer = null;
async function globalRules(pt){
  if(gCache[pt]) return gCache[pt];
  try{ const g = await api('GET', '/taxRules/' + enc(pt)); if(g && g.rules && typeof g.rules === 'object') gCache[pt] = g.rules; }catch(e){ /* not connected / no permission: list what the client already overrides */ }
  return gCache[pt] || null;
}
function locationItems(pt, path, gRules){
  const items = new Map();
  const add = (node, src) => {
    if(!isContainer(node)) return;
    ['county', 'locality'].forEach((k) => Object.keys(node[k] || {}).forEach((nm) => {
      const it = items.get(k + '|' + nm) || { kind: k, name: nm }; it[src] = true; items.set(k + '|' + nm, it);
    }));
  };
  if(gRules && splitPath(path)) add(getNode(gRules, path), 'inGlobal');
  if(S.loaded && splitPath(path)) add(getNode(S.loaded.overrides[pt], path), 'overridden');
  return Array.from(items.values()).sort((a, b) => a.name.localeCompare(b.name));
}
function stateWideOverridden(pt, path){
  if(!S.loaded || !splitPath(path)) return false;
  const n = getNode(S.loaded.overrides[pt], path);
  return n !== undefined && (!isContainer(n) || 'all' in n);
}
// (re)build the dropdown, keeping `keep` selected (added as an extra option if it isn't in the list)
function renderLocOptions(keep, gRules){
  const sel = $('ovLevel'); const pt = selectedType(); const path = $('ovPath').value.trim();
  const items = locationItems(pt, path, gRules);
  const opt = (v, label) => '<option value="' + esc(v) + '">' + esc(label) + '</option>';
  let html = opt('all|', 'State-wide rule (all)' + (stateWideOverridden(pt, path) ? ' · already overridden' : ''));
  if(items.length) html += '<optgroup label="Cities and counties' + (splitPath(path) ? ' in ' + esc(path.split('.')[2]) : '') + '">' +
    items.map((it) => opt(it.kind + '|' + it.name, it.name + ' — ' + kindLabel(it.kind) + (it.inGlobal ? '' : ' (not in the global rules)') + (it.overridden ? ' · already overridden' : ''))).join('') + '</optgroup>';
  html += '<optgroup label="Not listed?">' + opt('new-locality|', '＋ A city that isn\'t listed…') + opt('new-county|', '＋ A county that isn\'t listed…') + '</optgroup>';
  html += '<optgroup label="Advanced">' + opt('node|', 'Whole state node — replaces everything under it') + '</optgroup>';
  sel.innerHTML = html;
  const want = keep || 'all|';
  if(!Array.from(sel.options).some((o) => o.value === want)){
    const m = want.match(/^(county|locality)\|(.+)$/);
    if(m){ const o = document.createElement('option'); o.value = want; o.textContent = m[2] + ' — ' + kindLabel(m[1]) + ' (not in the global rules)'; sel.insertBefore(o, sel.options[1]); }
  }
  sel.value = Array.from(sel.options).some((o) => o.value === want) ? want : 'all|';
}
async function refreshLocations(keep){
  const seq = ++locSeq;
  const startVal = $('ovLevel').value;
  const cur = keep !== undefined ? keep : startVal;
  const path = $('ovPath').value.trim();
  const g = (splitPath(path) && tokenOk()) ? await globalRules(selectedType()) : null;
  if(seq !== locSeq) return; // a newer refresh superseded this one
  // the user picked something else while the global rules were loading: keep THEIR choice
  renderLocOptions($('ovLevel').value !== startVal ? $('ovLevel').value : cur, g);
  refreshRevertPoint();
}
function scheduleLocations(){ clearTimeout(locTimer); locTimer = setTimeout(() => { refreshLocations(); }, 300); }

function targetValue(t){
  return (t.level === 'all' || t.level === 'node') ? (t.level + '|') : (t.level + '|' + (t.name || ''));
}
function setTarget(t){
  const key = targetValue(t);
  $('ovPath').value = t.path;
  renderLocOptions(key, gCache[selectedType()] || null);
  $('ovName').value = '';
  $('ovPath').dataset.orig = JSON.stringify({ path: t.path, level: t.level || 'node', name: t.name || '' });
  refreshLocations(key); // fill in the cities/counties from the global rules once they arrive
}
function currentTarget(){
  const raw = $('ovLevel').value || 'all|';
  const k = raw.indexOf('|'); const kind = raw.slice(0, k), nm = raw.slice(k + 1);
  const isNew = kind.indexOf('new-') === 0;
  return { path: $('ovPath').value.trim(), level: isNew ? kind.slice(4) : kind, name: isNew ? $('ovName').value.trim() : nm, isNew };
}
const TEMPLATE = () => '{\n  "description": "",\n  "attr": "product.wholesalePrice",\n  "pct": 0,\n  "startDate": "' + todayStr() + '"\n}';
function openEditor(t, opts){
  if(!S.loaded) return;
  opts = opts || {};
  t = Object.assign({ path: '', level: 'all', name: '' }, typeof t === 'string' ? { path: t } : t);
  setTarget(t);
  const cur = getSub(getNode(S.loaded.overrides[selectedType()], t.path), t);
  $('ovRemove').checked = !!opts.remove;
  $('ovEditor').value = opts.text !== undefined ? opts.text : (cur === undefined ? TEMPLATE() : pretty(cur));
  S.revertOf = opts.revertOf || null;
  const banner = $('ovRevertBanner');
  if(S.revertOf){
    banner.style.display = 'block'; banner.className = 'status-line show';
    banner.textContent = 'Reverting ' + targetLabel(t.path, t.level, t.name) + ' for ' + S.loaded.appDomain + ' to its value from before the change on ' + fmtTime(S.revertOf.ts) +
      '. If that old rule has a start date in the past the server may call it retroactive — see the "Advanced" box in section 7. Preview it, then save.';
  } else banner.style.display = 'none';
  $('ovDateHint').textContent = 'Today (as the server will count it): ' + todayStr() + '. A new or changed rule needs a startDate on or after this; it takes effect from that date.';
  $('ovEditPanel').style.display = 'block';
  invalidatePreview();
  refreshRevertPoint();
  $('ovEditPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function refreshRevertPoint(){
  const box = $('ovRevertPoint'); const t = currentTarget();
  const needsName = t.isNew;
  $('ovNameRow').style.display = needsName ? 'block' : 'none';
  $('ovNameLabel').firstChild.nodeValue = 'Name of the ' + kindLabel(t.level) + ' ';
  $('ovLevelHint').textContent = t.level === 'node'
    ? 'Replaces EVERYTHING this client overrides under the state node — every other city and county in it is deleted.'
    : 'Only this one is changed; other overrides under ' + (t.path || 'the state') + ' stay as they are.';
  if(!S.loaded || !splitPath(t.path) || (needsName && !t.name)){ box.style.display = 'none'; return; }
  const cur = getSub(getNode(S.loaded.overrides[selectedType()], t.path), t);
  $('ovRevertPointJson').textContent = cur === undefined
    ? '(this client has no override here yet — the revert for a new override is to remove it)' : pretty(cur);
  box.style.display = 'block';
}
function readEditor(){
  const t = currentTarget();
  if(!splitPath(t.path)) throw new Error('Jurisdiction path must have three parts, like US.regionCode.AK.');
  if((t.level === 'county' || t.level === 'locality') && !t.name) throw new Error('Enter the name of the ' + kindLabel(t.level) + ', exactly as it appears in the rules (e.g. Fairbanks North Star Borough).');
  if($('ovRemove').checked) return Object.assign({}, t, { remove: true, value: undefined });
  let value;
  try{ value = JSON.parse($('ovEditor').value); }catch(e){ throw new Error('The rule JSON is not valid: ' + e.message); }
  if(value === null || typeof value !== 'object') throw new Error('The override must be a JSON object or an array of rules.');
  return Object.assign({}, t, { remove: false, value });
}
const nodeNow = (e) => getNode(S.loaded.overrides[selectedType()], e.path);
const editSig = (e) => canon({ p: e.path, l: e.level, n: e.name, r: e.remove, v: e.value === undefined ? null : e.value, c: S.loaded && S.loaded.ref, t: selectedType(), base: S.loaded && S.loaded.overrides });

function invalidatePreview(){
  S.preview = null;
  $('ovPreviewOut').innerHTML = ''; clearStatus('ovPreviewStatus');
  $('ovSavePanel').style.display = 'none';
  $('ovAckExtra').checked = false; $('ovAckRow').style.display = 'none';
  $('ovConfirm').checked = false; $('ovRetro').checked = false;
  clearStatus('ovSaveStatus'); $('ovSaveOut').innerHTML = '';
  updateSaveState();
}

async function onFromGlobal(){
  const t = currentTarget(); const path = t.path; const pt = selectedType();
  if(!splitPath(path)){ setStatus('ovPreviewStatus', 'Enter the jurisdiction path first (e.g. US.regionCode.AK).', 'err'); return; }
  if((t.level === 'county' || t.level === 'locality') && !t.name){ setStatus('ovPreviewStatus', 'Enter the name of the ' + kindLabel(t.level) + ' first.', 'err'); return; }
  setStatus('ovPreviewStatus', '<span class="spinner">⟳</span> Reading the global ' + esc(pt) + ' rule…', null, true);
  try{
    const g = await api('GET', '/taxRules/' + enc(pt));
    const node = getSub(getNode(g && g.rules, path), t);
    if(node === undefined){ setStatus('ovPreviewStatus', 'There is no global ' + pt + ' rule at ' + targetLabel(path, t.level, t.name) + ' to start from.', 'err'); return; }
    const { value, added } = addStartDates(node, todayStr());
    $('ovRemove').checked = false;
    $('ovEditor').value = pretty(value);
    if(S.preview) invalidatePreview();
    setStatus('ovPreviewStatus', 'Copied the global rule (rev ' + g.revision + ')' + (added ? ' and added startDate ' + todayStr() + ' to ' + added + ' rule(s)' : '') + '. Edit it, then preview.', 'ok');
  }catch(err){
    setStatus('ovPreviewStatus', 'Could not read the global rule — ' + (err.message || 'unknown error'), 'err');
  }
}
function onStartToday(){
  let v;
  try{ v = JSON.parse($('ovEditor').value); }catch(e){ setStatus('ovPreviewStatus', 'The rule JSON is not valid: ' + e.message, 'err'); return; }
  const { value, added } = addStartDates(v, todayStr());
  $('ovEditor').value = pretty(value);
  if(S.preview) invalidatePreview();
  setStatus('ovPreviewStatus', added ? 'Added startDate ' + todayStr() + ' to ' + added + ' rule(s).' : 'Every rule already has a startDate (or is an exclude rule). Past dates are not changed.', added ? 'ok' : null);
}

// ---------------------------------------------------------------- preview (dry-run)
// a server change is "expected" when it is the edited node, inside it, or a parent that contains it
function isExpected(field, pt, path){
  const exp = OV_FIELD + '.' + pt + '.' + path;
  return field === exp || field.indexOf(exp + '.') === 0 || exp.indexOf(field + '.') === 0;
}
async function onPreview(){
  if(!S.loaded){ setStatus('ovPreviewStatus', 'Load a client first.', 'err'); return; }
  let e; try{ e = readEditor(); }catch(err){ setStatus('ovPreviewStatus', err.message, 'err'); return; }
  const btn = $('ovPreviewBtn'); btn.disabled = true;
  setStatus('ovPreviewStatus', '<span class="spinner">⟳</span> Running dry-run (nothing is saved)…', null, true);
  try{
    const pt = selectedType();
    const oldNode = nodeNow(e), newNode = applyTarget(oldNode, e);
    const removed = removedBy(oldNode, newNode, e);
    const full = buildFull(e.path, newNode);
    const c = await api('POST', clientPath(S.loaded.ref) + '?force=false', bodyFor(full));
    if(!c || c.dryRun !== true) throw new Error('Unexpected response: the server did not report dryRun=true for a force=false call. Do NOT assume nothing was saved — reload the client and check.');
    const changes = Array.isArray(c.changes) ? c.changes : [];
    const mine = { options: { exciseTax: { ruleOverrides: S.loaded.overrides } } };
    // anything outside the edited node, or whose "old value" isn't what we loaded (we are stale, or GET hides part of the set)
    const extra = changes.filter((ch) => !isExpected(String(ch.field), pt, e.path)
      || canon(ch.oldValue === null ? undefined : ch.oldValue) !== canon(valueAtField(mine, String(ch.field))));
    S.preview = { sig: editSig(e), ref: S.loaded.ref, pt, path: e.path, changes, extra, removed, previous: getSub(oldNode, e) };
    renderPreview();
    if(!changes.length){
      setStatus('ovPreviewStatus', 'Dry-run OK — the server sees no difference from this client\'s current overrides. Nothing to save.', 'ok');
      $('ovSavePanel').style.display = 'none';
    } else {
      setStatus('ovPreviewStatus', 'Dry-run OK — ' + changes.length + ' change(s). Nothing was saved.', 'ok');
      $('ovSavePanel').style.display = 'block';
      $('ovAckRow').style.display = (extra.length || removed.length) ? 'flex' : 'none';
      $('ovAckText').textContent = ackText(extra, removed);
      updateSaveState();
    }
  }catch(err){
    S.preview = null; $('ovPreviewOut').innerHTML = ''; $('ovSavePanel').style.display = 'none';
    let hint = '';
    if(err.status === 400) hint = ' (400: the server rejected the rule — read the message above; common causes: missing startDate/description, a startDate in the past, pct outside 0–100, a duplicate key, an `if` clause the calculator can\'t load.)';
    if(err.status === 403) hint = ' (403: this API client needs the api:clientConfig role.)';
    setStatus('ovPreviewStatus', 'Dry-run failed — ' + (err.message || 'unknown error') + hint, 'err');
  }finally{ btn.disabled = false; }
}
function ackText(extra, removed){
  const bits = [];
  if(removed.length) bits.push('This edit DELETES existing overrides under the state node: ' + removed.join(', ') + '. I meant to delete them.');
  if(extra.length) bits.push('The preview shows changes beyond the override I edited, or the server\'s current value differs from what I loaded.');
  return bits.join(' ') + ' I have reviewed the preview.';
}
function renderPreview(){
  const p = S.preview; if(!p) return;
  const warn = p.extra.length
    ? '<div class="status-line show err" style="margin-bottom:8px;">' + p.extra.length + ' change(s) are outside the override you edited, or the server&rsquo;s current value differs from what was loaded: ' +
      esc(p.extra.map((x) => x.field).join(', ')) + '. The overrides loaded here may be out of date (reload) — or the server normalises values. Review before saving.</div>' : '';
  const del = p.removed.length ? '<div class="status-line show err" style="margin-bottom:8px;">This edit deletes existing override(s) under the same state node: ' + esc(p.removed.join(', ')) + '. Not intended? Use the county / locality level instead of the whole state node.</div>' : '';
  const blocks = p.changes.map((ch) => {
    const oldV = ch.oldValue === null ? undefined : ch.oldValue, newV = ch.newValue === null ? undefined : ch.newValue;
    const kind = oldV === undefined ? 'added' : (newV === undefined ? 'removed' : 'changed');
    return '<div class="diag-item" style="cursor:default;"><div class="diag-head" style="cursor:default;"><div class="diag-title"><span style="font-family:var(--mono);word-break:break-all;">' +
      esc(ch.field) + '</span></div><div class="diag-badges"><span class="badge ' + (kind === 'removed' ? 'err' : (kind === 'added' ? 'ok' : 'flag')) + '">' + kind + '</span></div></div>' +
      '<div style="margin-top:8px;">' + renderDiff(oldV, newV) + '</div></div>';
  }).join('');
  $('ovPreviewOut').innerHTML = del + warn + (blocks || '<div class="empty-state">No differences.</div>');
}

// ---------------------------------------------------------------- save (force=true)
function saveBlockers(){
  const why = [];
  if(!tokenOk()) why.push('connect first (section 1)');
  if(!S.preview) return ['run a dry-run preview first'];
  let e = null;
  try{ e = readEditor(); }catch(err){ why.push('fix the editor: ' + err.message); }
  if(e && editSig(e) !== S.preview.sig) why.push('the edit changed since the preview — preview again');
  const rb = $('ovRequestedBy').value.trim(), ab = $('ovApprovedBy').value.trim(), reason = $('ovReason').value.trim();
  if(!validEmail(rb)) why.push('requester email');
  if(!validEmail(ab)) why.push('approver email');
  if(validEmail(rb) && validEmail(ab) && rb.toLowerCase() === ab.toLowerCase()) why.push('approver must be a different person');
  if(!reason) why.push('reason');
  if((S.preview.extra.length || S.preview.removed.length) && !$('ovAckExtra').checked) why.push('acknowledge the extra changes');
  if(!$('ovConfirm').checked) why.push('tick the confirmation');
  return why;
}
function updateSaveState(){
  const btn = $('ovSaveBtn'); if(!btn) return;
  const why = saveBlockers();
  btn.disabled = S.busy || why.length > 0;
  $('ovSaveWhy').textContent = why.length && S.preview ? 'To enable: ' + why.join(' · ') + '.' : '';
}
async function snapshotNow(ref, appDomain, overrides){
  const snap = { id: 'o' + Date.now().toString(36), ts: Date.now(), client: ref, appDomain, overrides };
  const list = (await sget('local', SNAP_KEY)) || [];
  list.unshift(snap);
  let kept = list.slice(0, MAX_SNAPS);
  let ok = await sset('local', SNAP_KEY, kept);
  if(!ok){ kept = kept.slice(0, 1); ok = await sset('local', SNAP_KEY, kept); }
  return { snap, stored: ok };
}
const newKey = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'ov-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);

async function onSave(){
  const why = saveBlockers();
  if(why.length){ updateSaveState(); return; }
  const e = readEditor(); const p = S.preview; const L = S.loaded;
  const audit = { requestedBy: $('ovRequestedBy').value.trim(), approvedBy: $('ovApprovedBy').value.trim(), reason: $('ovReason').value.trim() };
  if($('ovRetro').checked) audit.allowRetroactive = true;
  S.busy = true; updateSaveState();
  $('ovSaveOut').innerHTML = '';
  setStatus('ovSaveStatus', '<span class="spinner">⟳</span> Checking ' + esc(L.appDomain) + ' hasn\'t changed since you loaded it…', null, true);
  try{
    // 1) re-read: the client's overrides must still be exactly what we loaded (no revision exists, so compare content); this is the revert snapshot
    const liveCfg = await api('GET', clientPath(p.ref));
    const live = overridesOf(liveCfg).overrides;
    if(canon(live) !== canon(L.overrides)){
      throw new Error('This client\'s overrides changed on the server since you loaded them. Nothing was saved. Reload the client, re-apply your edit and preview again.');
    }
    const { snap, stored } = await snapshotNow(p.ref, L.appDomain, live);
    const prevState = getNode(live[p.pt], e.path);
    const prevNode = getSub(prevState, e);
    // 2) the forced save: the whole override set, exactly one node changed
    setStatus('ovSaveStatus', '<span class="spinner">⟳</span> Saving to PRODUCTION (force=true)…', null, true);
    const full = buildFull(e.path, applyTarget(prevState, e));
    const c = await api('POST', clientPath(p.ref) + '?force=true', bodyFor(full, audit), { 'Idempotency-Key': newKey() });
    if(!c || c.dryRun === true) throw new Error('Unexpected response: the server reported a dry run for a force=true call, so the change was probably not saved. Reload the client and check.');
    // 3) log with a revert point
    const ts = Date.now();
    const log = (await sget('local', LOG_KEY)) || [];
    const entry = { id: 'v' + ts.toString(36) + Math.random().toString(36).slice(2, 6), ts, client: p.ref, appDomain: L.appDomain, productType: p.pt,
      jurisdiction: e.path, level: e.level, name: e.name, oldValue: prevNode, newValue: e.remove ? undefined : e.value, snapshotId: snap.id, audit,
      revertOf: S.revertOf ? S.revertOf.id || true : undefined };
    log.unshift(entry);
    await sset('local', LOG_KEY, log.slice(0, MAX_LOG));
    await sset('local', PREFS_KEY, { requestedBy: audit.requestedBy, approvedBy: audit.approvedBy });
    // 4) verify by re-reading
    let verifyHtml = '';
    try{
      await loadClient(p.ref);
      const after = getSub(getNode(S.loaded.overrides[p.pt], e.path), e);
      const want = e.remove ? undefined : e.value;
      const match = canon(after === undefined ? null : after) === canon(want === undefined ? null : want);
      verifyHtml = match
        ? '<div class="status-line show ok">Verified: re-reading the client shows exactly the saved override for ' + esc(targetLabel(e.path, e.level, e.name)) + '.</div>'
        : '<div class="status-line show err">Saved, but the value read back for ' + esc(targetLabel(e.path, e.level, e.name)) + ' differs from what was sent (the server may normalise it). Compare below.</div>';
    }catch(vErr){ verifyHtml = '<div class="status-line show err">Saved, but re-reading to verify failed: ' + esc(vErr.message) + '</div>'; }
    setStatus('ovSaveStatus', 'Saved.' + (c.changes && c.changes.length ? ' ' + c.changes.length + ' change(s) recorded.' : ''), 'ok');
    $('ovSaveOut').innerHTML = verifyHtml +
      '<div class="hint" style="margin-top:8px;">Revert point stored' + (stored ? '' : ' (browser storage was full — download it now)') + '. Previous override at <span style="font-family:var(--mono);">' + esc(p.pt + ' · ' + targetLabel(e.path, e.level, e.name)) + '</span>:</div>' +
      '<pre class="json-view" style="max-height:150px;">' + esc(pretty(prevNode)) + '</pre>' +
      '<div class="btn-row"><button class="btn small" data-ov-dlsnap="' + esc(snap.id) + '">Download this client\'s previous overrides (backup)</button>' +
      '<button class="btn small" data-ov-revert="' + esc(entry.id) + '">Revert this change…</button></div>';
    S.preview = null; S.revertOf = null; $('ovRevertBanner').style.display = 'none';
    $('ovSavePanel').style.display = 'block';
    $('ovPreviewOut').innerHTML = ''; clearStatus('ovPreviewStatus');
    $('ovConfirm').checked = false; $('ovRetro').checked = false;
    renderLog();
  }catch(err){
    const hint = err.status === 409 ? ' (409: idempotency conflict — reload and try again.)'
      : err.status === 503 ? ' (503: the audit trail could not be recorded, so nothing was saved.)'
      : err.status === 400 ? ' (400: the server rejected the change — nothing was saved.)'
      : err.status === 403 ? ' (403: this API client needs the api:clientConfig role.)' : '';
    setStatus('ovSaveStatus', 'Save failed — ' + (err.message || 'unknown error') + hint, 'err');
  }finally{ S.busy = false; updateSaveState(); }
}

// ---------------------------------------------------------------- reverts + log
async function startRevert(entry){
  if(!tokenOk()){ setStatus('ovLoadStatus', 'Connect first (section 1).', 'err'); return; }
  try{
    $('ovClient').value = entry.client;
    setStatus('ovLoadStatus', '<span class="spinner">⟳</span> Re-reading ' + esc(entry.appDomain || entry.client) + ' before reverting…', null, true);
    await loadClient(entry.client);
    $('ovProductType').value = entry.productType; renderOverrides();
    setStatus('ovLoadStatus', 'Loaded ' + S.loaded.appDomain + '.', 'ok');
    const remove = entry.oldValue === undefined || entry.oldValue === null;
    openEditor({ path: entry.jurisdiction, level: entry.level || 'node', name: entry.name || '' }, { text: remove ? '{}' : pretty(entry.oldValue), remove, revertOf: entry });
    await onPreview();
  }catch(err){
    $('ovEditPanel').style.display = 'block';
    setStatus('ovPreviewStatus', 'Could not start the revert — ' + (err.message || 'unknown error'), 'err');
  }
}
async function renderLog(){
  const log = (await sget('local', LOG_KEY)) || [];
  const snaps = (await sget('local', SNAP_KEY)) || [];
  if(!log.length){ $('ovLogOut').innerHTML = '<div class="empty-state">No overrides saved from this extension yet.</div>'; return; }
  $('ovLogOut').innerHTML = log.map((e) => {
    const hasSnap = snaps.some((s) => s.id === e.snapshotId);
    return '<div class="diag-item" style="cursor:default;"><div class="diag-head" style="cursor:default;"><div class="diag-title"><span style="font-family:var(--mono);">' +
      esc(targetLabel(e.jurisdiction, e.level, e.name)) + '</span> <span class="hint" style="margin:0;">' + esc(e.productType) + ' · ' + esc(e.appDomain || e.client) + '</span></div></div>' +
      '<div class="diag-summary">' + esc(fmtTime(e.ts)) + ' · ' + esc((e.audit && e.audit.requestedBy) || '') + ' / ' + esc((e.audit && e.audit.approvedBy) || '') + '</div>' +
      '<div class="diag-summary">Reason: ' + esc((e.audit && e.audit.reason) || '') + '</div>' +
      '<div class="btn-row" style="margin-top:6px;"><button class="btn small" data-ov-revert="' + esc(e.id) + '">Revert this change…</button>' +
      (hasSnap ? '<button class="btn small" data-ov-dlsnap="' + esc(e.snapshotId) + '">Download previous overrides</button>' : '<span class="hint">backup snapshot no longer stored</span>') + '</div>' +
      '<details class="config"><summary>show before / after</summary>' + renderDiff(e.oldValue, e.newValue) + '</details></div>';
  }).join('');
}
function onListClick(ev){
  const t = ev.target.closest('button'); if(!t) return;
  if(t.dataset.ovEdit){ try{ openEditor(JSON.parse(t.dataset.ovEdit)); }catch(err){ /* ignore */ } return; }
  if(t.dataset.ovDlsnap){
    sget('local', SNAP_KEY).then((list) => {
      const s = (list || []).find((x) => x.id === t.dataset.ovDlsnap);
      if(!s){ setStatus('ovSaveStatus', 'That backup snapshot is no longer stored.', 'err'); return; }
      downloadText('client-overrides-' + String(s.appDomain || s.client).replace(/[^a-z0-9.-]/gi, '_') + '-' + new Date(s.ts).toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json',
        JSON.stringify({ client: s.client, appDomain: s.appDomain, capturedAt: new Date(s.ts).toISOString(), ruleOverrides: s.overrides }, null, 2));
    });
    return;
  }
  if(t.dataset.ovRevert){
    sget('local', LOG_KEY).then((log) => { const e = (log || []).find((x) => x.id === t.dataset.ovRevert); if(e) startRevert(e); });
  }
}

// ---------------------------------------------------------------- wiring
async function init(){
  const prefs = (await sget('local', PREFS_KEY)) || {};
  if(prefs.requestedBy) $('ovRequestedBy').value = prefs.requestedBy;
  if(prefs.approvedBy) $('ovApprovedBy').value = prefs.approvedBy;
  renderLog();

  $('ovListBtn').addEventListener('click', onList);
  $('ovClientSel').addEventListener('change', () => { const v = $('ovClientSel').value; if(v) $('ovClient').value = v; });
  $('ovLoadBtn').addEventListener('click', onLoad);
  $('ovClient').addEventListener('input', () => { S.loaded = null; $('ovWrap').style.display = 'none'; $('ovEditPanel').style.display = 'none'; invalidatePreview(); clearStatus('ovLoadStatus'); });
  $('ovProductType').addEventListener('change', () => { $('ovEditPanel').style.display = 'none'; invalidatePreview(); renderOverrides(); });
  renderLocOptions('all|', null);
  $('ovNewBtn').addEventListener('click', () => { if(!S.loaded) return; openEditor({ path: '', level: 'all', name: '' }); $('ovPath').focus(); });
  $('ovDlAllBtn').addEventListener('click', () => {
    if(!S.loaded) return;
    downloadText('client-overrides-' + String(S.loaded.appDomain).replace(/[^a-z0-9.-]/gi, '_') + '.json',
      JSON.stringify({ client: S.loaded.ref, appDomain: S.loaded.appDomain, capturedAt: new Date().toISOString(), ruleOverrides: S.loaded.overrides }, null, 2));
  });
  ['ovEditor', 'ovName'].forEach((id) => $(id).addEventListener('input', () => { if(S.preview) invalidatePreview(); refreshRevertPoint(); }));
  $('ovPath').addEventListener('input', () => { if(S.preview) invalidatePreview(); refreshRevertPoint(); scheduleLocations(); });
  $('ovLevel').addEventListener('change', () => { if(S.preview) invalidatePreview(); refreshRevertPoint(); });
  $('ovRemove').addEventListener('change', () => { if(S.preview) invalidatePreview(); });
  $('ovFromGlobalBtn').addEventListener('click', onFromGlobal);
  $('ovStartTodayBtn').addEventListener('click', onStartToday);
  $('ovPreviewBtn').addEventListener('click', onPreview);
  $('ovResetBtn').addEventListener('click', () => { let t = null; try{ t = JSON.parse($('ovPath').dataset.orig); }catch(e){ t = currentTarget(); } if(S.loaded && t && splitPath(t.path)) openEditor(t); });
  ['ovRequestedBy', 'ovApprovedBy', 'ovReason'].forEach((id) => $(id).addEventListener('input', updateSaveState));
  ['ovConfirm', 'ovAckExtra', 'ovRetro'].forEach((id) => $(id).addEventListener('change', updateSaveState));
  $('ovSaveBtn').addEventListener('click', onSave);
  $('ovCopyPrevBtn').addEventListener('click', async () => {
    const ok = await copyText($('ovRevertPointJson').textContent);
    const b = $('ovCopyPrevBtn'); const old = b.textContent; b.textContent = ok ? 'Copied' : 'Copy failed'; setTimeout(() => { b.textContent = old; }, 1200);
  });
  $('ovClearLogBtn').addEventListener('click', async () => { await sremove('local', LOG_KEY); await sremove('local', SNAP_KEY); renderLog(); });
  ['ovJurBody', 'ovSaveOut', 'ovLogOut'].forEach((id) => $(id).addEventListener('click', onListClick));
}

window.OverridesTab = { addStartDates, normalize, todayStr, isExpected, applyTarget, getSub, removedBy };
init();
})();
