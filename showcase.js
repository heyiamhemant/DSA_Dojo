/* ╔══════════════════════════════════════════════════════════════════╗
   ║  DSA Dojo — Showcase Mode                                          ║
   ║                                                                    ║
   ║  Read-only portfolio view of someone else's progress, hydrated     ║
   ║  from their public dojo-progress.json gist on GitHub.              ║
   ║                                                                    ║
   ║  Activation: ?profile=<github_username> in the URL.                ║
   ║  e.g. https://heyiamhemant.github.io/DSA_Dojo/?profile=heyiamhemant║
   ║                                                                    ║
   ║  Behavior:                                                          ║
   ║    1. Detect param before app boots; lock the app in 'showcase'    ║
   ║       mode (no localStorage writes, no API mutations).             ║
   ║    2. Fetch GET /users/<u>/gists (public, no token), find the      ║
   ║       gist named dojo-progress.json, fetch its content.            ║
   ║    3. Hydrate window.userData and window.todayPlan with the data,  ║
   ║       BUT strip notes (they're private journal entries).           ║
   ║    4. Render normally; CSS [data-showcase] hides editing chrome    ║
   ║       and a branded header replaces the default.                   ║
   ║    5. Every mutator function checks isShowcaseMode() and bails.    ║
   ║                                                                    ║
   ║  Why before-boot? init() in index.html calls loadState() then      ║
   ║  navigate('dashboard') synchronously, which renders. If we waited  ║
   ║  for the gist fetch to finish, the user would see the empty app    ║
   ║  flash before showcase data loaded. So we set a 'pending' flag,    ║
   ║  let init render once with empty data, then re-render when fetch   ║
   ║  resolves (~300ms).                                                ║
   ╚══════════════════════════════════════════════════════════════════╝ */

(function () {
  // Parse URL once, synchronously, before anything else runs.
  const params = new URLSearchParams(location.search);
  const profileUser = (params.get('profile') || '').trim();

  // Bail fast if no ?profile= param: showcase mode is off, normal app.
  if (!profileUser) {
    window.SHOWCASE = { active: false };
    return;
  }

  // Validate username format. GitHub usernames: [A-Za-z0-9-], 1-39 chars,
  // can't start or end with hyphen. Don't fetch garbage URLs.
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(profileUser)) {
    window.SHOWCASE = { active: false, error: 'Invalid username format' };
    console.warn('[showcase] invalid username:', profileUser);
    return;
  }

  // Mark active before init() runs so guards see it.
  window.SHOWCASE = {
    active: true,
    user: profileUser,
    loaded: false,
    error: null
  };

  // Mark <html> for CSS hooks ASAP (no FOUC of edit chrome).
  try { document.documentElement.setAttribute('data-showcase', '1'); } catch (e) {}

  // Kick off the fetch immediately. We don't await here — init() will
  // render an empty dashboard first, and we re-render on resolution.
  loadShowcaseData(profileUser).then(data => {
    if (!data) return;
    window.SHOWCASE.loaded = true;
    // Hydrate globals AFTER the boot path runs so we don't race with
    // loadState() overwriting from localStorage. Done via a re-render
    // hook called when DOM is ready.
    applyShowcaseDataWhenReady(data);
  }).catch(err => {
    window.SHOWCASE.error = err && err.message || String(err);
    console.warn('[showcase] load failed:', err);
    applyShowcaseErrorWhenReady();
  });
})();

// ────────────────────────────────────────────────────────────────────
// Public guard — every mutating function in the app should call this.
// ────────────────────────────────────────────────────────────────────

function isShowcaseMode() {
  return !!(window.SHOWCASE && window.SHOWCASE.active);
}

function showcaseUser() {
  return (window.SHOWCASE && window.SHOWCASE.user) || '';
}

// ────────────────────────────────────────────────────────────────────
// Data fetch — public, unauthenticated GitHub API
// ────────────────────────────────────────────────────────────────────

const SHOWCASE_GIST_FILENAME = 'dojo-progress.json';
const SHOWCASE_API_BASE = 'https://api.github.com';

async function loadShowcaseData(username) {
  // GitHub returns 30 most-recent public gists by default; bump per_page
  // to 100 so we can find it even if user has many gists.
  const listRes = await fetch(
    SHOWCASE_API_BASE + '/users/' + encodeURIComponent(username) + '/gists?per_page=100',
    { headers: { 'Accept': 'application/vnd.github+json' } }
  );
  if (listRes.status === 404) {
    throw new Error('GitHub user "' + username + '" not found');
  }
  if (listRes.status === 403) {
    // Rate limited (60/hr unauth). Surface clearly.
    throw new Error('GitHub API rate limit reached. Try again in an hour.');
  }
  if (!listRes.ok) {
    throw new Error('GitHub API ' + listRes.status);
  }
  const list = await listRes.json();
  if (!Array.isArray(list)) throw new Error('Unexpected gist list response');
  const hit = list.find(g => g && g.files && g.files[SHOWCASE_GIST_FILENAME]);
  if (!hit) {
    throw new Error('No public DSA Dojo profile found for ' + username + '. They may not have synced yet, or their gist is private.');
  }

  // The list endpoint returns gists WITHOUT file content. Need a follow-
  // up GET to /gists/<id> to actually read the JSON.
  const detailRes = await fetch(SHOWCASE_API_BASE + '/gists/' + hit.id, {
    headers: { 'Accept': 'application/vnd.github+json' }
  });
  if (!detailRes.ok) throw new Error('Could not fetch gist content');
  const detail = await detailRes.json();
  const file = detail.files && detail.files[SHOWCASE_GIST_FILENAME];
  if (!file) throw new Error('Profile gist found but content missing');

  let raw = file.content;
  // Handle truncation (>1MB files) by following raw_url
  if (file.truncated && file.raw_url) {
    raw = await fetch(file.raw_url).then(r => r.text());
  }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { throw new Error('Profile data is not valid JSON'); }

  return {
    userData: parsed.userData || {},
    todayPlan: parsed.todayPlan || [],
    exportedAt: parsed.exportedAt || detail.updated_at,
    gistId: detail.id,
    gistUrl: detail.html_url
  };
}

// ────────────────────────────────────────────────────────────────────
// Hydration — runs after init() so we don't race
// ────────────────────────────────────────────────────────────────────

function applyShowcaseDataWhenReady(data) {
  // Wait for window.userData to exist (set by dojo-core.js on script load).
  // Then apply, strip notes, and re-render.
  const apply = () => {
    if (typeof userData === 'undefined') {
      setTimeout(apply, 30);
      return;
    }
    const hydrated = {};
    for (const k in data.userData) {
      const v = data.userData[k];
      if (!v) continue;
      // Strip notes — those are private journal entries even if owner
      // chose to expose everything else.
      const { notes, ...safe } = v;
      hydrated[k] = safe;
    }
    // eslint-disable-next-line no-global-assign
    userData = hydrated;
    // Showcase mode: don't show today's quest plan (it's the owner's
    // private TODO; visitors don't need to see what's in flight).
    // eslint-disable-next-line no-global-assign
    todayPlan = [];

    // Update the branded header with last-updated info.
    setShowcaseHeaderMeta(data);

    // Re-render every visible surface.
    safeShowcaseRerender();
  };
  apply();
}

function applyShowcaseErrorWhenReady() {
  const apply = () => {
    if (typeof document === 'undefined' || !document.body) {
      setTimeout(apply, 30);
      return;
    }
    setShowcaseHeaderMeta({ error: window.SHOWCASE.error });
  };
  apply();
}

function safeShowcaseRerender() {
  try {
    if (typeof applyFilters === 'function') applyFilters();
    if (typeof renderDashboard === 'function') renderDashboard();
    if (typeof renderToday === 'function') renderToday();
    if (typeof updateHeroStats === 'function') updateHeroStats();
    if (typeof updateBadges === 'function') updateBadges();
    if (typeof renderPowerLevels === 'function') renderPowerLevels();
    if (typeof renderTopicMastery === 'function') renderTopicMastery();
  } catch (e) { console.warn('[showcase] re-render error:', e); }
}

// ────────────────────────────────────────────────────────────────────
// Branded header injection
// ────────────────────────────────────────────────────────────────────

function buildShowcaseBanner() {
  if (document.getElementById('showcase-banner')) return;
  const u = showcaseUser();
  const banner = document.createElement('div');
  banner.id = 'showcase-banner';
  banner.className = 'showcase-banner';
  banner.innerHTML =
    '<div class="sb-inner">' +
      '<div class="sb-left">' +
        '<div class="sb-avatar"><img src="https://github.com/' + encodeURIComponent(u) + '.png?size=120" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.style.display=\'none\'"></div>' +
        '<div class="sb-id">' +
          '<div class="sb-eyebrow">⚜ Showcase · Read-only</div>' +
          '<h1 class="sb-name" id="sb-name">@' + escapeShowcase(u) + '</h1>' +
          '<div class="sb-meta" id="sb-meta">Loading…</div>' +
        '</div>' +
      '</div>' +
      '<div class="sb-right">' +
        '<a class="sb-cta sb-cta-primary" href="https://github.com/' + encodeURIComponent(u) + '" target="_blank" rel="noopener">' +
          '<span>🐙</span><span>GitHub</span>' +
        '</a>' +
        '<a class="sb-cta sb-cta-ghost" href="https://heyiamhemant.github.io/DSA_Dojo/" >' +
          '<span>🗡</span><span>Open my own dojo</span>' +
        '</a>' +
      '</div>' +
    '</div>';
  // Insert at the very top of <body>, above the .app shell.
  document.body.insertBefore(banner, document.body.firstChild);
}

function escapeShowcase(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function setShowcaseHeaderMeta(data) {
  buildShowcaseBanner();
  const meta = document.getElementById('sb-meta');
  if (!meta) return;
  if (data.error) {
    meta.innerHTML = '<span class="sb-error">' + escapeShowcase(data.error) + '</span>';
    return;
  }
  const count = (typeof userData === 'object' && userData) ? Object.keys(userData).length : 0;
  const ts = data.exportedAt ? new Date(data.exportedAt) : null;
  const tsStr = ts ? ts.toLocaleString() : '—';
  meta.innerHTML =
    '<span>' + count + ' problems tracked</span>' +
    '<span class="sb-dot">·</span>' +
    '<span>Last updated ' + escapeShowcase(tsStr) + '</span>';
}

// ────────────────────────────────────────────────────────────────────
// Hard-block any edit attempt — defense in depth on top of CSS
// ────────────────────────────────────────────────────────────────────

function showcaseBlock(actionLabel) {
  if (typeof showToast === 'function') {
    showToast('Read-only mode — ' + (actionLabel || 'editing disabled') + '. Open your own dojo to track progress.', 'info');
  }
}
