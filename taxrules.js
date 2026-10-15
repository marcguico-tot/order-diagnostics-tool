// =====================================================================
// Tax Rules tab — read, dry-run and forced-save global excise tax rules
// through the Tax Rules API on PRODUCTION (app.tokenoftrust.com).
//
// v3.21.0: moved from test.tokenoftrust.com to production. Writes here
// change LIVE rules for real vendors.
//
// Design decisions (see README "Tax Rules tab"):
//  * PRODUCTION ONLY. The API origin is a hard-coded constant; there is no
//    host field. Connect refuses anything that isn't a public_live_/
//    secret_live_ key pair, so a test key can't be pointed at production by
//    mistake and the wrong environment's secret is never sent anywhere.
//  * Credentials are NOT stored unless you tick "Remember on this computer"
//    (chrome.storage.local, UNENCRYPTED, this browser profile only; live-key
//    prefixes are still enforced, and "Forget" removes them). This is a
//    deliberate choice for a personal ops tool (v3.21.1): a live secret sits
//    in plain text on this machine. Either way the key/secret are exchanged
//    for a 24h bearer token via POST /api/accessToken and the fields are
//    cleared immediately. The token itself is kept only in
//    chrome.storage.session (memory, cleared when the browser closes). With
//    remembered credentials the tab reconnects by itself in a fresh session.
//    Any test-era saved credentials are deleted on load.
//  * POST /api/taxRules/{type} REPLACES THE WHOLE RULE SET. This tab always
//    posts the complete rule set it just loaded with exactly one
//    jurisdiction node changed, never a partial payload.
//  * Dry-run first, always. force=true is only enabled after a dry-run of
//    the exact same edit against the exact same revision, with two
//    different audit emails and an explicit confirmation.
//  * Revert points. Before any forced save the CURRENT server rule set is
//    re-fetched and snapshotted (storage.local + downloadable), and the
//    previous value of every changed jurisdiction is logged. Server-side
//    history entries carry oldValue too, so reverts also work from history.
// =====================================================================
(function(){
'use strict';

const API = 'https://app.tokenoftrust.com/api';
const TOKEN_KEY = 'trProdToken';       // chrome.storage.session  { token, exp, appDomain }
const LOG_KEY   = 'trProdChangeLog';   // chrome.storage.local    [ entry... ]
const SNAP_KEY  = 'trProdSnapshots';   // chrome.storage.local    [ snapshot... ]
const PREFS_KEY = 'trProdPrefs';       // chrome.storage.local    { requestedBy, approvedBy }
const CREDS_KEY = 'trProdCreds';       // chrome.storage.local    { apiKey, secretKey, appDomain }  — only when "Remember" is ticked (live keys)
const LEGACY_KEYS = [['local','trTestCreds'], ['session','trTestToken']]; // test-era secrets/tokens: deleted on load
const MAX_LOG = 50;
const MAX_SNAPS = 5;
const MAX_ROWS = 60;

const $ = (id) => document.getElementById(id);
if(!$('platformTaxRules')) return; // markup not present — nothing to do

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// ---------------------------------------------------------------- state
const S = {
  token: null, tokenExp: 0, appDomain: '',
  loaded: null,            // { productType, revision, rules }
  preview: null,           // { sig, productType, revision, path, changes, extra, previous }
  revertOf: null,          // log/history entry being reverted (for the banner + log link)
  busy: false,
  histCache: null,
  saved: null,             // remembered credentials (or null)
  manualOff: false,        // user pressed Disconnect: don't auto-reconnect until they press Connect
  autoP: null, autoFailAt: 0
};

// ---------------------------------------------------------------- storage helpers
async function sget(area, key){
  try{ const o = await chrome.storage[area].get([key]); return o[key]; }catch(e){ return undefined; }
}
async function sset(area, key, val){
  try{ await chrome.storage[area].set({[key]: val}); return true; }catch(e){ return false; }
}
async function sremove(area, key){
  try{ await chrome.storage[area].remove([key]); }catch(e){ /* ignore */ }
}

// ---------------------------------------------------------------- tiny utils
function setStatus(id, msg, type, html){
  const el = $(id); if(!el) return;
  if(html) el.innerHTML = msg; else el.textContent = msg;
  el.className = 'status-line show' + (type ? ' ' + type : '');
}
function clearStatus(id){ const el = $(id); if(el){ el.textContent = ''; el.className = 'status-line'; } }

function canon(v){ // canonical JSON (sorted keys) for comparisons / signatures
  if(Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if(v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
const pretty = (v) => v === undefined ? '(not present)' : JSON.stringify(v, null, 2);
const clone = (v) => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
const fmtTime = (t) => { try{ return new Date(t).toLocaleString(); }catch(e){ return String(t); } };
const validEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());

async function copyText(text){
  try{ await navigator.clipboard.writeText(text); return true; }catch(e){ return false; }
}
function downloadText(filename, text){
  const blob = new Blob([text], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// ---------------------------------------------------------------- rule-shape helpers
// Global rule file shape: country -> regionCode|postalCode -> location -> rule | [rules] | {all, county, locality}
// A "jurisdiction" here is the node at country.kind.location (e.g. US.regionCode.AK), which is the same
// granularity the API reports changes at.
function flatten(rules){
  const out = [];
  if(!rules || typeof rules !== 'object') return out;
  for(const country of Object.keys(rules)){
    const c = rules[country];
    if(!c || typeof c !== 'object') continue;
    for(const kind of Object.keys(c)){
      const loc = c[kind];
      if(!loc || typeof loc !== 'object' || Array.isArray(loc)) continue;
      for(const key of Object.keys(loc)){
        out.push({ path: country + '.' + kind + '.' + key, value: loc[key] });
      }
    }
  }
  return out;
}
function describe(node, limit){
  const out = [];
  (function walk(n){
    if(out.length >= limit || n == null) return;
    if(Array.isArray(n)){ n.forEach(walk); return; }
    if(typeof n === 'object'){
      if(typeof n.description === 'string') out.push(n.description);
      Object.keys(n).forEach((k) => { if(k !== 'description' && n[k] && typeof n[k] === 'object') walk(n[k]); });
    }
  })(node);
  return out;
}
function splitPath(path){
  const parts = String(path || '').trim().split('.');
  if(parts.length !== 3 || parts.some((p) => !p)) return null;
  return parts;
}
function getNode(rules, path){
  const p = splitPath(path); if(!p) return undefined;
  const a = rules && rules[p[0]]; const b = a && a[p[1]];
  return b ? b[p[2]] : undefined;
}
// returns a NEW rules object with the node set (value) or removed (value === undefined)
function withNode(rules, path, value){
  const p = splitPath(path); if(!p) throw new Error('Jurisdiction path must look like US.regionCode.AK');
  const out = clone(rules) || {};
  if(value === undefined){
    if(out[p[0]] && out[p[0]][p[1]]){
      delete out[p[0]][p[1]][p[2]];
      if(!Object.keys(out[p[0]][p[1]]).length) delete out[p[0]][p[1]];
      if(!Object.keys(out[p[0]]).length) delete out[p[0]];
    }
    return out;
  }
  out[p[0]] = out[p[0]] || {};
  out[p[0]][p[1]] = out[p[0]][p[1]] || {};
  out[p[0]][p[1]][p[2]] = value;
  return out;
}

// ---------------------------------------------------------------- line diff (small LCS)
function lineDiff(aText, bText){
  const a = aText === '' ? [] : aText.split('\n'), b = bText === '' ? [] : bText.split('\n');
  if(a.length * b.length > 4000000) return null;
  const n = a.length, m = b.length;
  const dp = Array.from({length: n + 1}, () => new Uint16Array(m + 1));
  for(let i = n - 1; i >= 0; i--) for(let j = m - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = []; let i = 0, j = 0;
  while(i < n && j < m){
    if(a[i] === b[j]){ ops.push([' ', a[i]]); i++; j++; }
    else if(dp[i + 1][j] >= dp[i][j + 1]){ ops.push(['-', a[i]]); i++; }
    else { ops.push(['+', b[j]]); j++; }
  }
  while(i < n) ops.push(['-', a[i++]]);
  while(j < m) ops.push(['+', b[j++]]);
  return ops;
}
function renderDiff(oldV, newV){
  const aText = oldV === undefined ? '' : pretty(oldV);
  const bText = newV === undefined ? '' : pretty(newV);
  const ops = lineDiff(aText, bText);
  const sideBySide = () =>
    '<div class="hint">Previous</div><pre class="json-view" style="max-height:200px;">' + esc(pretty(oldV)) + '</pre>' +
    '<div class="hint" style="margin-top:6px;">New</div><pre class="json-view" style="max-height:200px;">' + esc(pretty(newV)) + '</pre>';
  if(!ops) return sideBySide();
  // collapse long unchanged runs
  const lines = []; let run = [];
  const flush = () => {
    if(run.length > 8){
      run.slice(0, 3).forEach((l) => lines.push([' ', l]));
      lines.push(['…', '… ' + (run.length - 6) + ' unchanged lines …']);
      run.slice(-3).forEach((l) => lines.push([' ', l]));
    } else run.forEach((l) => lines.push([' ', l]));
    run = [];
  };
  ops.forEach(([t, l]) => { if(t === ' ') run.push(l); else { flush(); lines.push([t, l]); } });
  flush();
  const html = lines.map(([t, l]) => {
    if(t === '+') return '<span style="background:#12301f;color:#7ee2a8;display:block;">+ ' + esc(l) + '</span>';
    if(t === '-') return '<span style="background:#3a1c1c;color:#ff9d9d;display:block;">- ' + esc(l) + '</span>';
    if(t === '…') return '<span style="color:var(--muted);display:block;">  ' + esc(l) + '</span>';
    return '<span style="display:block;">  ' + esc(l) + '</span>';
  }).join('');
  return '<pre class="json-view" style="max-height:260px;">' + html + '</pre>';
}

// ---------------------------------------------------------------- API layer
function apiErrorMessage(status, body){
  const c = body && (body.content || body);
  const parts = ['HTTP ' + status];
  if(c && typeof c === 'object'){
    if(c.code) parts.push(c.code);
    if(c.message) parts.push(c.message);
    const cb = c.causedBy && c.causedBy.message;
    if(cb && cb !== c.message) parts.push(cb);
    const d = c.details;
    if((Array.isArray(d) && d.length) || (d && typeof d === 'object' && Object.keys(d).length)) parts.push(JSON.stringify(d).slice(0, 600));
  }
  return parts.join(' — '); // never includes stack traces
}
function tokenOk(){ return !!S.token && Date.now() < S.tokenExp; }

async function api(method, path, body, extraHeaders){
  if(!tokenOk()) await autoConnect();
  if(!tokenOk()){ const e = new Error('Not connected (or the 24-hour token expired) — use Connect above.'); e.status = 401; throw e; }
  const res = await fetch(API + path, {
    method,
    headers: Object.assign({ Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.token }, extraHeaders || {}),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json = null;
  try{ json = await res.json(); }catch(e){ /* non-JSON */ }
  if(!res.ok){
    const err = new Error(apiErrorMessage(res.status, json));
    err.status = res.status; err.body = json;
    throw err;
  }
  return json && json.content !== undefined ? json.content : json;
}

async function exchangeToken(apiKey, secretKey, appDomain){
  const res = await fetch(API + '/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ totApiKey: apiKey, totSecretKey: secretKey, appDomain })
  });
  let json = null;
  try{ json = await res.json(); }catch(e){ /* ignore */ }
  if(!res.ok) throw new Error(apiErrorMessage(res.status, json));
  const c = json && (json.content || json);
  const token = c && (c.accessToken || c.token);
  if(!token) throw new Error('Got a 200 back but no content.accessToken in the response.');
  return { token, exp: Date.now() + 24 * 3600 * 1000 - 60 * 1000 };
}

// ---------------------------------------------------------------- connect UI
const maskKey = (k) => String(k || '').length > 18 ? String(k).slice(0, 14) + '…' + String(k).slice(-3) : '(saved)'; // e.g. public_live_RE…234
const looksLive = (key, secret) => /^public_live_/.test(key || '') && /^secret_live_/.test(secret || '');
function renderConn(){
  const saved = S.saved ? ' Saved credentials: ' + maskKey(S.saved.apiKey) + ' (' + (S.saved.appDomain || '') + ').' : '';
  $('trForgetBtn').style.display = S.saved ? 'inline-block' : 'none';
  if(tokenOk()){
    setStatus('trConnStatus', 'Connected to PRODUCTION (app.tokenoftrust.com) as ' + (S.appDomain || 'unknown app domain') +
      ' — token valid until ' + fmtTime(S.tokenExp) + '.' + saved, 'ok');
  } else {
    setStatus('trConnStatus', 'Not connected.' + (S.saved && !S.manualOff ? ' (Saved credentials will be used automatically.)' : saved), null);
  }
}
// Use remembered credentials to get a fresh token (new browser session, or the 24h token expired).
async function autoConnect(){
  if(tokenOk() || !S.saved || S.manualOff) return false;
  if(Date.now() - S.autoFailAt < 30000) return false; // don't hammer the server if the saved credentials were rejected
  if(S.autoP) return S.autoP;
  S.autoP = (async () => {
    try{
      const c = S.saved;
      if(!looksLive(c.apiKey, c.secretKey)) throw new Error('the saved credentials don\'t look like live keys');
      const { token, exp } = await exchangeToken(c.apiKey, c.secretKey, c.appDomain);
      S.token = token; S.tokenExp = exp; S.appDomain = c.appDomain;
      await sset('session', TOKEN_KEY, { token, exp, appDomain: c.appDomain });
      renderConn();
      return true;
    }catch(err){
      S.autoFailAt = Date.now(); S.token = null; S.tokenExp = 0;
      setStatus('trConnStatus', 'Saved credentials were not accepted — ' + (err.message || 'unknown error') + '. Re-enter them (or Forget them) below.', 'err');
      return false;
    }finally{ S.autoP = null; }
  })();
  return S.autoP;
}
async function onConnect(){
  let apiKey = $('trApiKey').value.trim();
  let secret = $('trSecret').value.trim();
  let appDomain = $('trAppDomain').value.trim();
  const typed = !!(apiKey || secret);
  if(!typed && S.saved){ apiKey = S.saved.apiKey; secret = S.saved.secretKey; appDomain = S.saved.appDomain || appDomain; }
  if(!apiKey || !secret || !appDomain){ setStatus('trConnStatus', 'Enter the API key, secret key and app domain — all three are required.', 'err'); return; }
  if(!looksLive(apiKey, secret)){
    setStatus('trConnStatus', 'Refusing: these don\'t look like LIVE keys (public_live_… / secret_live_…). This tab only talks to production (app.tokenoftrust.com); test keys won\'t work here.', 'err');
    return;
  }
  const btn = $('trConnectBtn'); btn.disabled = true;
  setStatus('trConnStatus', '<span class="spinner">⟳</span> Exchanging credentials…', null, true);
  try{
    const { token, exp } = await exchangeToken(apiKey, secret, appDomain);
    S.token = token; S.tokenExp = exp; S.appDomain = appDomain; S.manualOff = false; S.autoFailAt = 0;
    await sset('session', TOKEN_KEY, { token, exp, appDomain });
    if(typed && $('trRemember').checked){
      S.saved = { apiKey, secretKey: secret, appDomain };
      await sset('local', CREDS_KEY, S.saved);
    }
    $('trApiKey').value = ''; $('trSecret').value = ''; $('trRemember').checked = false; // fields never keep credentials around
    renderConn();
  }catch(err){
    S.token = null; S.tokenExp = 0;
    setStatus('trConnStatus', 'Connect failed — ' + (err.message || 'unknown error'), 'err');
  }finally{
    btn.disabled = false;
  }
}
async function onDisconnect(){
  S.token = null; S.tokenExp = 0; S.appDomain = ''; S.manualOff = true;
  await sremove('session', TOKEN_KEY);
  $('trApiKey').value = ''; $('trSecret').value = '';
  renderConn();
}
async function onForget(){
  S.saved = null; S.token = null; S.tokenExp = 0; S.appDomain = ''; S.manualOff = false;
  await sremove('local', CREDS_KEY); await sremove('session', TOKEN_KEY);
  $('trApiKey').value = ''; $('trSecret').value = ''; $('trRemember').checked = false;
  renderConn();
}

// ---------------------------------------------------------------- load + find
async function onLoad(){
  const productType = $('trProductType').value;
  const btn = $('trLoadBtn'); btn.disabled = true;
  setStatus('trLoadStatus', '<span class="spinner">⟳</span> Loading ' + esc(productType) + ' rules…', null, true);
  try{
    await loadRules(productType);
    setStatus('trLoadStatus', 'Loaded ' + productType + ' rules — revision ' + S.loaded.revision + ' — ' + flatten(S.loaded.rules).length + ' jurisdictions.', 'ok');
  }catch(err){
    setStatus('trLoadStatus', 'Failed — ' + (err.message || 'unknown error'), 'err');
  }finally{ btn.disabled = false; }
}
async function loadRules(productType){
  const c = await api('GET', '/taxRules/' + encodeURIComponent(productType));
  if(!c || typeof c.rules !== 'object' || c.rules === null) throw new Error('Response had no rules object.');
  S.loaded = { productType, revision: c.revision, rules: c.rules };
  invalidatePreview();
  $('trFindWrap').style.display = 'block';
  $('trConfirmType').textContent = productType;
  renderFind();
  if($('trEditPanel').style.display === 'block') refreshRevertPoint();
  return S.loaded;
}
function renderFind(){
  if(!S.loaded) return;
  const q = $('trSearch').value.trim().toLowerCase();
  const all = flatten(S.loaded.rules);
  const hits = q ? all.filter((j) => (j.path + ' ' + JSON.stringify(j.value)).toLowerCase().includes(q)) : all;
  $('trSearchCount').textContent = hits.length + ' of ' + all.length + ' jurisdictions' + (hits.length > MAX_ROWS ? ' — showing the first ' + MAX_ROWS + ', refine the search to narrow.' : '.');
  const rows = hits.slice(0, MAX_ROWS).map((j, i) => {
    const d = describe(j.value, 3);
    const more = describe(j.value, 99).length - d.length;
    return '<tr><td style="font-family:var(--mono);">' + esc(j.path) + '</td><td style="white-space:normal;min-width:180px;">' +
      esc(d.join(' · ') || '(no description)') + (more > 0 ? ' <span style="color:var(--muted);">+' + more + ' more</span>' : '') +
      '</td><td><button class="btn small" data-tr-edit="' + esc(j.path) + '">Edit</button></td></tr>';
  }).join('');
  $('trJurBody').innerHTML = rows || '<tr><td colspan="3" style="color:var(--muted);">No match.</td></tr>';
}

// ---------------------------------------------------------------- editor
function showEditor(){ $('trEditPanel').style.display = 'block'; }
function openEditor(path, opts){
  if(!S.loaded) return;
  opts = opts || {};
  const node = getNode(S.loaded.rules, path);
  $('trPath').value = path;
  $('trPath').dataset.orig = path;
  $('trRemove').checked = !!opts.remove;
  $('trEditor').value = opts.text !== undefined ? opts.text : (node === undefined ? '{\n  "description": "",\n  "attr": "product.wholesalePrice",\n  "pct": 0\n}' : pretty(node));
  $('trEditor').dataset.orig = node === undefined ? '' : pretty(node);
  S.revertOf = opts.revertOf || null;
  const banner = $('trRevertBanner');
  if(S.revertOf){
    banner.style.display = 'block'; banner.className = 'status-line show';
    banner.textContent = 'Reverting ' + path + ' to its value from before the change on ' + fmtTime(S.revertOf.ts) + '. Preview it, then save with audit details.';
  } else { banner.style.display = 'none'; }
  showEditor();
  invalidatePreview();
  refreshRevertPoint();
  $('trEditPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function refreshRevertPoint(){
  const path = $('trPath').value.trim();
  const box = $('trRevertPoint');
  if(!S.loaded || !splitPath(path)){ box.style.display = 'none'; return; }
  const cur = getNode(S.loaded.rules, path);
  $('trRevertPointJson').textContent = cur === undefined
    ? '(this jurisdiction does not exist yet — the revert for a new jurisdiction is to remove it)'
    : pretty(cur);
  box.style.display = 'block';
}
// Reads the editor into { path, remove, value } or throws a friendly error.
function readEditor(){
  const path = $('trPath').value.trim();
  if(!splitPath(path)) throw new Error('Jurisdiction path must have three parts, like US.regionCode.AK.');
  if($('trRemove').checked) return { path, remove: true, value: undefined };
  let value;
  try{ value = JSON.parse($('trEditor').value); }
  catch(e){ throw new Error('The rule JSON is not valid: ' + e.message); }
  if(value === null || typeof value !== 'object') throw new Error('The rule must be a JSON object or array of rules.');
  return { path, remove: false, value };
}
function editSig(e){ return canon({ p: e.path, r: e.remove, v: e.value === undefined ? null : e.value, rev: S.loaded && S.loaded.revision, t: S.loaded && S.loaded.productType }); }

function invalidatePreview(){
  S.preview = null;
  $('trPreviewOut').innerHTML = '';
  clearStatus('trPreviewStatus');
  $('trSavePanel').style.display = 'none';
  $('trAckExtra').checked = false; $('trAckRow').style.display = 'none';
  $('trConfirm').checked = false;
  clearStatus('trSaveStatus'); $('trSaveOut').innerHTML = '';
  updateSaveState();
}

// ---------------------------------------------------------------- preview (dry-run)
async function onPreview(){
  if(!S.loaded){ setStatus('trPreviewStatus', 'Load the rules first.', 'err'); return; }
  let e;
  try{ e = readEditor(); }catch(err){ setStatus('trPreviewStatus', err.message, 'err'); return; }
  const btn = $('trPreviewBtn'); btn.disabled = true;
  setStatus('trPreviewStatus', '<span class="spinner">⟳</span> Running dry-run (nothing is saved)…', null, true);
  try{
    const rules = withNode(S.loaded.rules, e.path, e.remove ? undefined : e.value);
    const productType = S.loaded.productType;
    const c = await api('POST', '/taxRules/' + encodeURIComponent(productType) + '?force=false', { rules });
    if(!c || c.dryRun !== true){
      throw new Error('Unexpected response: the server did not report dryRun=true for a force=false call. Do NOT assume nothing was saved — reload the rules and check the revision/history.');
    }
    const changes = Array.isArray(c.changes) ? c.changes : [];
    const extra = changes.filter((ch) => ch.jurisdiction !== e.path);
    const previous = getNode(S.loaded.rules, e.path);
    S.preview = { sig: editSig(e), productType, revision: S.loaded.revision, path: e.path, changes, extra, previous, serverRevision: c.revision };
    renderPreview(e);
    if(!changes.length){
      setStatus('trPreviewStatus', 'Dry-run OK — the server sees no difference from the current rules. Nothing to save.', 'ok');
      $('trSavePanel').style.display = 'none';
    } else {
      setStatus('trPreviewStatus', 'Dry-run OK — ' + changes.length + ' change(s). Nothing was saved.', 'ok');
      $('trSavePanel').style.display = 'block';
      $('trAckRow').style.display = extra.length ? 'flex' : 'none';
      updateSaveState();
    }
  }catch(err){
    S.preview = null;
    $('trPreviewOut').innerHTML = '';
    $('trSavePanel').style.display = 'none';
    setStatus('trPreviewStatus', 'Dry-run failed — ' + (err.message || 'unknown error'), 'err');
  }finally{ btn.disabled = false; }
}
function renderPreview(e){
  const p = S.preview; if(!p) return;
  const warn = p.extra.length
    ? '<div class="status-line show err" style="margin-bottom:8px;">The preview changes ' + p.extra.length + ' jurisdiction(s) besides ' + esc(p.path) + ': ' +
      esc(p.extra.map((x) => x.jurisdiction).join(', ')) + '. That usually means the rules loaded here are out of date or the server normalizes values — review below before saving.</div>'
    : '';
  const blocks = p.changes.map((ch) => {
    const kind = ch.oldValue === undefined || ch.oldValue === null ? 'added' : (ch.newValue === undefined || ch.newValue === null ? 'removed' : 'changed');
    const oldV = ch.oldValue === null ? undefined : ch.oldValue;
    const newV = ch.newValue === null ? undefined : ch.newValue;
    return '<div class="diag-item" style="cursor:default;"><div class="diag-head" style="cursor:default;"><div class="diag-title"><span style="font-family:var(--mono);">' +
      esc(ch.jurisdiction) + '</span></div><div class="diag-badges"><span class="badge ' + (kind === 'removed' ? 'err' : (kind === 'added' ? 'ok' : 'flag')) + '">' + kind + '</span></div></div>' +
      '<div style="margin-top:8px;">' + renderDiff(oldV, newV) + '</div></div>';
  }).join('');
  $('trPreviewOut').innerHTML = warn + (blocks || '<div class="empty-state">No differences.</div>');
}

// ---------------------------------------------------------------- save (force=true)
function saveBlockers(){
  const why = [];
  if(!tokenOk()) why.push('connect first');
  if(!S.preview) return ['run a dry-run preview first'];
  let e = null;
  try{ e = readEditor(); }catch(err){ why.push('fix the editor: ' + err.message); }
  if(e && editSig(e) !== S.preview.sig) why.push('the edit changed since the preview — preview again');
  const rb = $('trRequestedBy').value.trim(), ab = $('trApprovedBy').value.trim(), reason = $('trReason').value.trim();
  if(!validEmail(rb)) why.push('requester email');
  if(!validEmail(ab)) why.push('approver email');
  if(validEmail(rb) && validEmail(ab) && rb.toLowerCase() === ab.toLowerCase()) why.push('approver must be a different person');
  if(!reason) why.push('reason');
  if(S.preview.extra.length && !$('trAckExtra').checked) why.push('acknowledge the extra changes');
  if(!$('trConfirm').checked) why.push('tick the confirmation');
  return why;
}
function updateSaveState(){
  const btn = $('trSaveBtn'); if(!btn) return;
  const why = saveBlockers();
  btn.disabled = S.busy || why.length > 0;
  $('trSaveWhy').textContent = why.length && S.preview ? 'To enable: ' + why.join(' · ') + '.' : '';
}

async function snapshotNow(productType, revision, rules){
  const snap = { id: 's' + Date.now().toString(36), ts: Date.now(), productType, revision, rules };
  const list = (await sget('local', SNAP_KEY)) || [];
  list.unshift(snap);
  const kept = list.slice(0, MAX_SNAPS);
  let ok = await sset('local', SNAP_KEY, kept);
  if(!ok){ ok = await sset('local', SNAP_KEY, kept.slice(0, 1)); } // quota: keep at least the newest
  return { snap, stored: ok };
}

async function onSave(){
  const why = saveBlockers();
  if(why.length){ updateSaveState(); return; }
  const e = readEditor();
  const p = S.preview;
  const audit = { requestedBy: $('trRequestedBy').value.trim(), approvedBy: $('trApprovedBy').value.trim(), reason: $('trReason').value.trim() };
  S.busy = true; updateSaveState();
  $('trSaveOut').innerHTML = '';
  setStatus('trSaveStatus', '<span class="spinner">⟳</span> Checking the server is still at revision ' + esc(p.revision) + '…', null, true);
  try{
    // 1) re-read the live rules: must still be the revision we previewed against; this is also the revert snapshot.
    const live = await api('GET', '/taxRules/' + encodeURIComponent(p.productType));
    if(live.revision !== p.revision){
      throw new Error('The rules changed on the server since you loaded them (revision ' + p.revision + ' → ' + live.revision + '). Nothing was saved. Reload, re-apply your edit and preview again.');
    }
    const { snap, stored } = await snapshotNow(p.productType, live.revision, live.rules);
    const prevNode = getNode(live.rules, e.path);
    // 2) the actual forced save: whole rule set, exactly one node changed
    setStatus('trSaveStatus', '<span class="spinner">⟳</span> Saving to PRODUCTION (force=true)…', null, true);
    const rules = withNode(live.rules, e.path, e.remove ? undefined : e.value);
    const c = await api('POST', '/taxRules/' + encodeURIComponent(p.productType) + '?force=true', { rules, expectedRevision: live.revision, audit });
    if(!c || c.dryRun === true) throw new Error('Unexpected response: the server reported a dry run for a force=true call, so the change was probably not saved. Reload and check the revision.');
    // 3) log with revert points
    const ts = Date.now();
    const log = (await sget('local', LOG_KEY)) || [];
    const changes = (Array.isArray(c.changes) && c.changes.length ? c.changes : [{ jurisdiction: e.path, oldValue: prevNode, newValue: e.remove ? undefined : e.value }]);
    changes.forEach((ch) => log.unshift({
      id: 'c' + ts.toString(36) + Math.random().toString(36).slice(2, 6), ts, productType: p.productType,
      jurisdiction: ch.jurisdiction, oldValue: ch.oldValue === null ? undefined : ch.oldValue, newValue: ch.newValue === null ? undefined : ch.newValue,
      revisionBefore: live.revision, revisionAfter: c.revision, snapshotId: snap.id, audit,
      revertOf: S.revertOf ? S.revertOf.id || true : undefined
    }));
    await sset('local', LOG_KEY, log.slice(0, MAX_LOG));
    await sset('local', PREFS_KEY, { requestedBy: audit.requestedBy, approvedBy: audit.approvedBy });
    // 4) verify by re-reading
    let verifyHtml = '';
    try{
      await loadRules(p.productType);
      const after = getNode(S.loaded.rules, e.path);
      const want = e.remove ? undefined : e.value;
      const match = canon(after === undefined ? null : after) === canon(want === undefined ? null : want);
      verifyHtml = match
        ? '<div class="status-line show ok">Verified: re-reading the server shows exactly the saved value for ' + esc(e.path) + '.</div>'
        : '<div class="status-line show err">Saved, but the value read back for ' + esc(e.path) + ' differs from what was sent (the server may normalize it). Compare in the rules list / history.</div>';
    }catch(vErr){ verifyHtml = '<div class="status-line show err">Saved, but re-reading to verify failed: ' + esc(vErr.message) + '</div>'; }
    setStatus('trSaveStatus', 'Saved. New revision ' + c.revision + '.', 'ok');
    $('trSaveOut').innerHTML = verifyHtml +
      '<div class="hint" style="margin-top:8px;">Revert point stored' + (stored ? '' : ' (browser storage was full — download it now)') + '. Previous value of <span style="font-family:var(--mono);">' + esc(e.path) + '</span>:</div>' +
      '<pre class="json-view" style="max-height:150px;">' + esc(pretty(prevNode)) + '</pre>' +
      '<div class="btn-row"><button class="btn small" data-tr-dlsnap="' + esc(snap.id) + '">Download full backup (rev ' + esc(live.revision) + ')</button>' +
      '<button class="btn small" data-tr-revert="' + esc(log[0].id) + '">Revert this change…</button></div>';
    S.preview = null; S.revertOf = null; $('trRevertBanner').style.display = 'none';
    $('trSavePanel').style.display = 'block'; // keep panel visible to show the result
    $('trPreviewOut').innerHTML = ''; clearStatus('trPreviewStatus');
    $('trConfirm').checked = false;
    renderLog();
  }catch(err){
    const hint = err.status === 409 ? ' (409: stale revision — reload and preview again.)'
      : err.status === 503 ? ' (503: the server refused — global writes may be disabled on production, or the audit trail could not be recorded; nothing was saved.)'
      : err.status === 403 ? ' (403: this API client lacks the permission for this call.)' : '';
    setStatus('trSaveStatus', 'Save failed — ' + (err.message || 'unknown error') + hint, 'err');
  }finally{
    S.busy = false; updateSaveState();
  }
}

// ---------------------------------------------------------------- reverts
async function startRevert(entry){
  if(!tokenOk()){ setStatus('trPreviewStatus', 'Connect first.', 'err'); showEditor(); return; }
  try{
    if(!S.loaded || S.loaded.productType !== entry.productType){
      $('trProductType').value = entry.productType;
    }
    setStatus('trLoadStatus', '<span class="spinner">⟳</span> Re-reading current ' + esc(entry.productType) + ' rules before reverting…', null, true);
    await loadRules(entry.productType);
    setStatus('trLoadStatus', 'Loaded ' + entry.productType + ' rules — revision ' + S.loaded.revision + '.', 'ok');
    const remove = entry.oldValue === undefined || entry.oldValue === null;
    openEditor(entry.jurisdiction, { text: remove ? '{}' : pretty(entry.oldValue), remove, revertOf: entry });
    await onPreview();
  }catch(err){
    showEditor();
    setStatus('trPreviewStatus', 'Could not start the revert — ' + (err.message || 'unknown error'), 'err');
  }
}

// ---------------------------------------------------------------- history (server)
async function onHistory(){
  const productType = $('trProductType').value;
  const btn = $('trHistBtn'); btn.disabled = true;
  setStatus('trHistStatus', '<span class="spinner">⟳</span> Loading history…', null, true);
  try{
    const c = await api('GET', '/taxRules/' + encodeURIComponent(productType) + '/history');
    const changes = Array.isArray(c && c.changes) ? c.changes : [];
    S.histCache = { productType, changes };
    const versions = Array.isArray(c && c.versions) ? c.versions.length : 0;
    setStatus('trHistStatus', changes.length + ' audited change(s)' + (versions ? ', ' + versions + ' stored version(s)' : '') + ' for ' + productType + '.', 'ok');
    renderHistory();
  }catch(err){
    setStatus('trHistStatus', 'Failed — ' + (err.message || 'unknown error'), 'err');
  }finally{ btn.disabled = false; }
}
function renderHistory(){
  const h = S.histCache; if(!h) return;
  if(!h.changes.length){ $('trHistOut').innerHTML = '<div class="empty-state">No audited changes yet.</div>'; return; }
  $('trHistOut').innerHTML = h.changes.slice(0, 40).map((entry, i) => {
    const who = [entry.requestedBy && ('req: ' + entry.requestedBy), entry.approvedBy && ('appr: ' + entry.approvedBy)].filter(Boolean).join(' · ');
    const juris = Array.isArray(entry.changes) ? entry.changes : [];
    const rows = juris.map((ch, k) => {
      const canRevert = ch && ch.jurisdiction;
      return '<div style="margin-top:6px;"><span style="font-family:var(--mono);">' + esc(ch.jurisdiction) + '</span> ' +
        (canRevert ? '<button class="btn small" data-tr-hrevert="' + i + ':' + k + '">Revert to previous value…</button>' : '') +
        '<details class="config"><summary>show before / after</summary>' + renderDiff(ch.oldValue === null ? undefined : ch.oldValue, ch.newValue === null ? undefined : ch.newValue) + '</details></div>';
    }).join('');
    return '<div class="diag-item" style="cursor:default;"><div class="diag-head" style="cursor:default;"><div class="diag-title">' +
      '<span style="font-family:var(--mono);font-size:11px;">' + esc(fmtTime(entry.timestamp)) + '</span></div><div class="diag-badges"><span class="badge info">rev ' + esc(entry.revision || '?') + '</span></div></div>' +
      '<div class="diag-summary">' + esc(who || 'actor: ' + JSON.stringify(entry.actor || {})) + '</div>' +
      '<div class="diag-summary">Reason: ' + esc(entry.reason || '(none)') + '</div>' + rows + '</div>';
  }).join('');
}

// ---------------------------------------------------------------- local change log
async function renderLog(){
  const log = (await sget('local', LOG_KEY)) || [];
  const snaps = (await sget('local', SNAP_KEY)) || [];
  if(!log.length){ $('trLogOut').innerHTML = '<div class="empty-state">Nothing saved from this extension yet.</div>'; return; }
  $('trLogOut').innerHTML = log.map((e) => {
    const hasSnap = snaps.some((s) => s.id === e.snapshotId);
    return '<div class="diag-item" style="cursor:default;"><div class="diag-head" style="cursor:default;"><div class="diag-title"><span style="font-family:var(--mono);">' +
      esc(e.jurisdiction) + '</span> <span class="hint" style="margin:0;">' + esc(e.productType) + '</span></div><div class="diag-badges"><span class="badge info">' +
      esc(e.revisionBefore) + ' → ' + esc(e.revisionAfter) + '</span></div></div>' +
      '<div class="diag-summary">' + esc(fmtTime(e.ts)) + ' · ' + esc((e.audit && e.audit.requestedBy) || '') + ' / ' + esc((e.audit && e.audit.approvedBy) || '') + '</div>' +
      '<div class="diag-summary">Reason: ' + esc((e.audit && e.audit.reason) || '') + '</div>' +
      '<div class="btn-row" style="margin-top:6px;"><button class="btn small" data-tr-revert="' + esc(e.id) + '">Revert this change…</button>' +
      (hasSnap ? '<button class="btn small" data-tr-dlsnap="' + esc(e.snapshotId) + '">Download full backup</button>' : '<span class="hint">backup snapshot no longer stored</span>') + '</div>' +
      '<details class="config"><summary>show before / after</summary>' + renderDiff(e.oldValue, e.newValue) + '</details></div>';
  }).join('');
}

// ---------------------------------------------------------------- wiring
function onListClick(ev){
  const t = ev.target.closest('button'); if(!t) return;
  if(t.dataset.trEdit){ openEditor(t.dataset.trEdit); return; }
  if(t.dataset.trDlsnap){
    sget('local', SNAP_KEY).then((list) => {
      const s = (list || []).find((x) => x.id === t.dataset.trDlsnap);
      if(!s){ setStatus('trSaveStatus', 'That backup snapshot is no longer stored.', 'err'); return; }
      downloadText('tax-rules-' + s.productType + '-rev-' + s.revision + '.json', JSON.stringify({ productType: s.productType, revision: s.revision, capturedAt: new Date(s.ts).toISOString(), rules: s.rules }, null, 2));
    });
    return;
  }
  if(t.dataset.trRevert){
    sget('local', LOG_KEY).then((log) => {
      const e = (log || []).find((x) => x.id === t.dataset.trRevert);
      if(e) startRevert(e);
    });
    return;
  }
  if(t.dataset.trHrevert && S.histCache){
    const [i, k] = t.dataset.trHrevert.split(':').map(Number);
    const entry = S.histCache.changes[i]; const ch = entry && entry.changes && entry.changes[k];
    if(ch) startRevert({ id: 'h' + i + '-' + k, ts: entry.timestamp, productType: S.histCache.productType, jurisdiction: ch.jurisdiction, oldValue: ch.oldValue === null ? undefined : ch.oldValue });
  }
}

async function init(){
  // token (session memory) + remembered emails (no secrets)
  const t = await sget('session', TOKEN_KEY);
  if(t && t.token && t.exp > Date.now()){ S.token = t.token; S.tokenExp = t.exp; S.appDomain = t.appDomain || ''; }
  const prefs = (await sget('local', PREFS_KEY)) || {};
  if(prefs.requestedBy) $('trRequestedBy').value = prefs.requestedBy;
  if(prefs.approvedBy) $('trApprovedBy').value = prefs.approvedBy;
  // Delete anything the test-era build stored (an unencrypted test secret and a test bearer token).
  for(const [area, key] of LEGACY_KEYS) await sremove(area, key);
  const sc = await sget('local', CREDS_KEY);
  if(sc && sc.apiKey && sc.secretKey && sc.appDomain){ S.saved = sc; $('trAppDomain').value = sc.appDomain; }
  renderConn();
  renderLog();
  if(!tokenOk() && S.saved) autoConnect(); // fresh browser session: reconnect with the remembered credentials

  $('trConnectBtn').addEventListener('click', onConnect);
  $('trDisconnectBtn').addEventListener('click', onDisconnect);
  $('trForgetBtn').addEventListener('click', onForget);
  $('trLoadBtn').addEventListener('click', onLoad);
  $('trSearch').addEventListener('input', renderFind);
  $('trNewJurBtn').addEventListener('click', () => {
    if(!S.loaded) return;
    openEditor('US.regionCode.XX');
    $('trPath').focus();
  });
  $('trProductType').addEventListener('change', () => { S.loaded = null; $('trFindWrap').style.display = 'none'; $('trEditPanel').style.display = 'none'; invalidatePreview(); clearStatus('trLoadStatus'); });
  ['trEditor', 'trPath'].forEach((id) => $(id).addEventListener('input', () => { if(S.preview) invalidatePreview(); refreshRevertPoint(); }));
  $('trRemove').addEventListener('change', () => { if(S.preview) invalidatePreview(); });
  $('trPreviewBtn').addEventListener('click', onPreview);
  $('trResetEditorBtn').addEventListener('click', () => { const p = $('trPath').dataset.orig || $('trPath').value.trim(); if(S.loaded && splitPath(p)) openEditor(p); });
  ['trRequestedBy', 'trApprovedBy', 'trReason'].forEach((id) => $(id).addEventListener('input', updateSaveState));
  ['trConfirm', 'trAckExtra'].forEach((id) => $(id).addEventListener('change', updateSaveState));
  $('trSaveBtn').addEventListener('click', onSave);
  $('trHistBtn').addEventListener('click', onHistory);
  $('trCopyPrevBtn').addEventListener('click', async () => {
    const ok = await copyText($('trRevertPointJson').textContent);
    const b = $('trCopyPrevBtn'); const old = b.textContent; b.textContent = ok ? 'Copied' : 'Copy failed'; setTimeout(() => { b.textContent = old; }, 1200);
  });
  $('trDlBackupBtn').addEventListener('click', () => {
    if(!S.loaded) return;
    downloadText('tax-rules-' + S.loaded.productType + '-rev-' + S.loaded.revision + '.json', JSON.stringify({ productType: S.loaded.productType, revision: S.loaded.revision, capturedAt: new Date().toISOString(), rules: S.loaded.rules }, null, 2));
  });
  $('trClearLogBtn').addEventListener('click', async () => { await sremove('local', LOG_KEY); await sremove('local', SNAP_KEY); renderLog(); });
  ['trJurBody', 'trSaveOut', 'trHistOut', 'trLogOut'].forEach((id) => $(id).addEventListener('click', onListClick));
}

// minimal surface for tests / console debugging
window.TaxRulesTab = { flatten, describe, withNode, getNode, canon, lineDiff, apiErrorMessage, splitPath,
  // shared with overrides.js (Client Config section) — same token, same helpers, same production-only host
  api, tokenOk, esc, setStatus, clearStatus, pretty, clone, fmtTime, validEmail, copyText, downloadText, renderDiff, sget, sset, sremove, PREFS_KEY };

init();
})();
