/* ╔══════════════════════════════════════════════════════════════════╗
   ║  DSA Dojo — Gist Sync                                              ║
   ║                                                                    ║
   ║  Cross-device persistence for userData/todayPlan via a private     ║
   ║  GitHub Gist (file: dojo-progress.json). One-time setup: paste a   ║
   ║  GitHub Personal Access Token with 'gist' scope. Token lives only  ║
   ║  in localStorage on this device — never in the public repo, never  ║
   ║  sent anywhere except api.github.com.                              ║
   ║                                                                    ║
   ║  Conflict policy: last-write-wins per problem record. Each entry   ║
   ║  in userData carries a 'lastModified' timestamp; on merge, the     ║
   ║  side with the newer stamp wins for that one key. Records present  ║
   ║  on only one side are preserved.                                   ║
   ║                                                                    ║
   ║  Sync trigger: 2-second debounced push after any saveState() call. ║
   ║  Pull on app boot; merge against in-memory + localStorage state    ║
   ║  before first render.                                              ║
   ╚══════════════════════════════════════════════════════════════════╝ */

// ─── Storage keys (localStorage) ─────────────────────────────────────
const GIST_TOKEN_KEY    = 'dojo_gist_token';     // PAT with 'gist' scope
const GIST_ID_KEY       = 'dojo_gist_id';        // gist ID once created
const GIST_LAST_PULL    = 'dojo_gist_last_pull'; // ISO timestamp of last successful pull
const GIST_LAST_PUSH    = 'dojo_gist_last_push'; // ISO timestamp of last successful push
const GIST_LAST_ERROR   = 'dojo_gist_last_error';// last sync error (for debug)

const GIST_FILENAME     = 'dojo-progress.json';
const GIST_DESCRIPTION  = 'DSA Dojo — progress (auto-managed)';
const GIST_PUSH_DEBOUNCE_MS = 2000;
const API_BASE = 'https://api.github.com';

// ─── In-memory state ─────────────────────────────────────────────────
let _gistPushTimer = null;
let _gistPushInflight = null;
let _gistPullInflight = null;
let _gistConfigInvalid = false; // true after a 401/404 — stop hammering API

// ────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────

function gistGetToken() {
  try { return localStorage.getItem(GIST_TOKEN_KEY) || ''; } catch(e) { return ''; }
}
function gistSetToken(token) {
  try {
    if (token) localStorage.setItem(GIST_TOKEN_KEY, token);
    else localStorage.removeItem(GIST_TOKEN_KEY);
    _gistConfigInvalid = false;
  } catch(e) {}
}
function gistGetId() {
  try { return localStorage.getItem(GIST_ID_KEY) || ''; } catch(e) { return ''; }
}
function gistSetId(id) {
  try {
    if (id) localStorage.setItem(GIST_ID_KEY, id);
    else localStorage.removeItem(GIST_ID_KEY);
  } catch(e) {}
}
function gistIsConfigured() {
  return !!gistGetToken();
}
function gistStatus() {
  if (!gistIsConfigured()) return { state: 'disconnected', label: 'Not connected' };
  if (_gistConfigInvalid)  return { state: 'error',        label: 'Token invalid — re-paste' };
  let lastPush = '';
  try { lastPush = localStorage.getItem(GIST_LAST_PUSH) || ''; } catch(e) {}
  let lastErr = '';
  try { lastErr = localStorage.getItem(GIST_LAST_ERROR) || ''; } catch(e) {}
  if (lastErr) return { state: 'error', label: 'Last sync failed', detail: lastErr, lastPush };
  if (!lastPush) return { state: 'connected', label: 'Connected (not synced yet)' };
  const ago = Math.max(0, Date.now() - new Date(lastPush).getTime());
  return { state: 'synced', label: 'Synced ' + _humanAgo(ago) + ' ago', lastPush };
}
function _humanAgo(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60)   return s + 's';
  const m = Math.round(s / 60);
  if (m < 60)   return m + 'm';
  const h = Math.round(m / 60);
  if (h < 24)   return h + 'h';
  return Math.round(h / 24) + 'd';
}

function gistDisconnect() {
  // Local-only disconnect: drop the token and remembered gist ID.
  // The gist itself still exists on GitHub — user can delete from gist.github.com.
  gistSetToken('');
  gistSetId('');
  try {
    localStorage.removeItem(GIST_LAST_PULL);
    localStorage.removeItem(GIST_LAST_PUSH);
    localStorage.removeItem(GIST_LAST_ERROR);
  } catch(e) {}
}

// ────────────────────────────────────────────────────────────────────
// Push: debounced
// ────────────────────────────────────────────────────────────────────

function scheduleGistPush() {
  if (!gistIsConfigured() || _gistConfigInvalid) return;
  if (_gistPushTimer) clearTimeout(_gistPushTimer);
  _gistPushTimer = setTimeout(() => { _gistPushTimer = null; gistPushNow(); }, GIST_PUSH_DEBOUNCE_MS);
}

async function gistPushNow() {
  if (!gistIsConfigured() || _gistConfigInvalid) return;
  if (_gistPushInflight) return _gistPushInflight; // dedupe overlapping pushes
  _gistPushInflight = (async () => {
    const payload = _buildPayload();
    const body = JSON.stringify(payload, null, 2);
    try {
      const id = gistGetId();
      const res = id ? await _gistUpdate(id, body) : await _gistCreate(body);
      if (!res || !res.id) throw new Error('Gist write returned no id');
      if (!id) gistSetId(res.id);
      try { localStorage.setItem(GIST_LAST_PUSH, new Date().toISOString()); } catch(e){}
      try { localStorage.removeItem(GIST_LAST_ERROR); } catch(e){}
      _refreshSyncStatusUI();
    } catch (err) {
      _recordError(err);
    } finally {
      _gistPushInflight = null;
    }
  })();
  return _gistPushInflight;
}

function _buildPayload() {
  // Snapshot the live state. We copy by reference for speed; JSON.stringify
  // happens once during the fetch body serialization above.
  return {
    version: 2,
    schema: 'dojo-progress/v2',
    exportedAt: new Date().toISOString(),
    userData: typeof userData === 'object' && userData ? userData : {},
    todayPlan: typeof todayPlan === 'object' && todayPlan ? todayPlan : []
  };
}

// ────────────────────────────────────────────────────────────────────
// Pull + merge (last-write-wins per record)
// ────────────────────────────────────────────────────────────────────

async function gistPullAndMerge({ skipRender = false } = {}) {
  if (!gistIsConfigured() || _gistConfigInvalid) return false;
  if (_gistPullInflight) return _gistPullInflight;
  _gistPullInflight = (async () => {
    try {
      const id = gistGetId();
      const remote = id ? await _gistRead(id) : await _findOurGist();
      if (!remote) {
        // No remote yet — push current state to seed it.
        await gistPushNow();
        return false;
      }
      if (!gistGetId() && remote.id) gistSetId(remote.id);
      const merged = _mergeUserData(
        typeof userData === 'object' && userData ? userData : {},
        remote.userData || {}
      );
      const remoteChangedLocal = _objectsDiffer(merged, userData);
      // Always replace in-memory userData with merged (idempotent if unchanged)
      // eslint-disable-next-line no-global-assign
      userData = merged;
      // Plan: take whichever was saved most recently. Plans regen daily anyway.
      if (remote.todayPlan && remote.exportedAt) {
        const localPlanTs = _latestUdTs(merged);
        const remotePlanTs = new Date(remote.exportedAt).getTime();
        if (!todayPlan || !todayPlan.length || remotePlanTs > localPlanTs) {
          // eslint-disable-next-line no-global-assign
          todayPlan = remote.todayPlan;
        }
      }
      // Persist merged state locally, then re-render if anything changed.
      try { localStorage.setItem('dsa_dojo_data', JSON.stringify(userData)); } catch(e){}
      try { localStorage.setItem('dsa_dojo_plan', JSON.stringify(todayPlan)); } catch(e){}
      try { localStorage.setItem(GIST_LAST_PULL, new Date().toISOString()); } catch(e){}
      try { localStorage.removeItem(GIST_LAST_ERROR); } catch(e){}
      // If local had data the remote didn't, push the merge back so the gist
      // becomes the canonical superset.
      const localHasNewer = Object.keys(userData).some(k => {
        const l = userData[k] && userData[k].lastModified;
        const r = (remote.userData && remote.userData[k] && remote.userData[k].lastModified);
        return l && (!r || l > r);
      });
      if (localHasNewer) scheduleGistPush();
      // Trigger UI refresh (caller may opt out during boot to avoid double-render)
      if (!skipRender && remoteChangedLocal) _safeRerender();
      _refreshSyncStatusUI();
      return remoteChangedLocal;
    } catch (err) {
      _recordError(err);
      return false;
    } finally {
      _gistPullInflight = null;
    }
  })();
  return _gistPullInflight;
}

// Merge two userData objects. For every key present in either side, choose
// the value with the newer lastModified timestamp. Records without a
// timestamp are treated as 'epoch' (always lose to a stamped version).
function _mergeUserData(local, remote) {
  const out = {};
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);
  for (const k of keys) {
    const l = local[k], r = remote[k];
    if (!l) { out[k] = r; continue; }
    if (!r) { out[k] = l; continue; }
    const lt = +new Date(l.lastModified || 0) || 0;
    const rt = +new Date(r.lastModified || 0) || 0;
    out[k] = (rt > lt) ? r : l;
  }
  return out;
}

function _latestUdTs(ud) {
  let max = 0;
  for (const k in ud) {
    const t = +new Date((ud[k] || {}).lastModified || 0) || 0;
    if (t > max) max = t;
  }
  return max;
}

function _objectsDiffer(a, b) {
  // Cheap structural compare — JSON serialize at top level only.
  // Fine here because userData is bounded (~hundreds of keys).
  try { return JSON.stringify(a) !== JSON.stringify(b); }
  catch(e) { return true; }
}

function _safeRerender() {
  try {
    if (typeof applyFilters === 'function') applyFilters();
    if (typeof renderDashboard === 'function') renderDashboard();
    if (typeof renderToday === 'function') renderToday();
    if (typeof updateHeroStats === 'function') updateHeroStats();
    if (typeof updateBadges === 'function') updateBadges();
  } catch(e) { console.warn('Re-render after sync pull failed:', e); }
}

function _refreshSyncStatusUI() {
  // Lightweight hook — Settings modal listens for updates via this.
  try { window.dispatchEvent(new CustomEvent('dojo:sync-status-changed')); } catch(e) {}
}

// ────────────────────────────────────────────────────────────────────
// GitHub Gist REST plumbing
// ────────────────────────────────────────────────────────────────────

async function _ghFetch(path, init = {}) {
  const token = gistGetToken();
  if (!token) throw new Error('No GitHub token configured');
  const headers = Object.assign({
    'Accept': 'application/vnd.github+json',
    'Authorization': 'Bearer ' + token,
    'X-GitHub-Api-Version': '2022-11-28'
  }, init.headers || {});
  const res = await fetch(API_BASE + path, Object.assign({}, init, { headers }));
  if (res.status === 401) {
    _gistConfigInvalid = true;
    throw new Error('GitHub token rejected (401). Re-paste it in Settings.');
  }
  if (res.status === 404 && path.startsWith('/gists/')) {
    // Remembered gist ID is gone (deleted from GitHub) — clear it so the
    // next push creates a new one.
    gistSetId('');
    throw new Error('Gist not found (404). A new one will be created on next save.');
  }
  if (!res.ok) {
    const txt = await res.text().catch(()=>res.statusText);
    throw new Error('GitHub API ' + res.status + ': ' + txt.slice(0, 200));
  }
  return res.json();
}

async function _gistCreate(body) {
  const data = await _ghFetch('/gists', {
    method: 'POST',
    body: JSON.stringify({
      description: GIST_DESCRIPTION,
      public: false,
      files: { [GIST_FILENAME]: { content: body } }
    })
  });
  return data;
}
async function _gistUpdate(id, body) {
  const data = await _ghFetch('/gists/' + encodeURIComponent(id), {
    method: 'PATCH',
    body: JSON.stringify({
      description: GIST_DESCRIPTION,
      files: { [GIST_FILENAME]: { content: body } }
    })
  });
  return data;
}
async function _gistRead(id) {
  const meta = await _ghFetch('/gists/' + encodeURIComponent(id));
  const file = meta.files && meta.files[GIST_FILENAME];
  if (!file) throw new Error('Gist exists but missing ' + GIST_FILENAME);
  let raw = file.content;
  // GitHub returns truncated=true for files >1MB and exposes raw_url. Our
  // payload should be far below that, but handle it correctly anyway.
  if (file.truncated && file.raw_url) {
    raw = await fetch(file.raw_url).then(r => r.text());
  }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch(e) { throw new Error('Gist content not valid JSON'); }
  return Object.assign({ id: meta.id, exportedAt: parsed.exportedAt || meta.updated_at }, parsed);
}

async function _findOurGist() {
  // No remembered ID — search this user's gists for our filename. List up
  // to 100 most recently updated; that should easily cover anyone's
  // first-time setup. If a hit is found, remember its ID.
  const list = await _ghFetch('/gists?per_page=100');
  if (!Array.isArray(list)) return null;
  const hit = list.find(g => g.files && g.files[GIST_FILENAME]);
  if (!hit) return null;
  return await _gistRead(hit.id);
}

function _recordError(err) {
  console.warn('[gist-sync]', err);
  try { localStorage.setItem(GIST_LAST_ERROR, String(err && err.message || err)); } catch(e){}
  _refreshSyncStatusUI();
}

// ────────────────────────────────────────────────────────────────────
// Boot
// ────────────────────────────────────────────────────────────────────

async function initGistSync() {
  if (!gistIsConfigured()) return;
  // Pull silently on boot. _safeRerender inside will trigger UI refresh
  // only if remote actually changed local state.
  await gistPullAndMerge();
}

// Keep status text fresh in the modal even when nothing else is happening.
setInterval(_refreshSyncStatusUI, 30 * 1000);
