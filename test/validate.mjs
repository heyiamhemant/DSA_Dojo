// DSA Dojo validation harness.
//
// Boots a tiny static server over the repo root, opens the page in a
// real Chromium (downloaded by Playwright), injects a synthetic broken
// streak via dojoTestRecovery(), and asserts that every recovery
// surface renders correctly: top banner, streak-prime pill, and the
// transformed Forge CTA. Screenshots are written under ./screenshots
// so we can eyeball regressions across runs.
//
// Usage:
//   cd test && npm install && npm test
//
// Exit code 0 = all assertions passed. Anything else = failure with
// the failing assertion logged.

import http from 'node:http';
import path from 'node:path';
import url  from 'node:url';
import fs   from 'node:fs/promises';
import handler from 'serve-handler';
import { chromium } from 'playwright';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const PORT      = 4173;
const SHOTS_DIR = path.join(__dirname, 'screenshots');

function startServer() {
  const server = http.createServer((req, res) => handler(req, res, { public: ROOT }));
  return new Promise((resolve) => {
    server.listen(PORT, () => resolve(server));
  });
}

const failures = [];
function check(label, cond, detail) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
    failures.push(label + (detail ? ' — ' + detail : ''));
  }
}

async function shoot(page, name) {
  await fs.mkdir(SHOTS_DIR, { recursive: true });
  // Screenshots are nice-to-have for eyeball review; never fail the harness
  // if rendering is mid-animation. Pulse animations on the recovery banner
  // mean Playwright's "stable rendering" wait can spin forever.
  try {
    await page.screenshot({ path: path.join(SHOTS_DIR, name + '.png'), fullPage: false, animations: 'disabled', timeout: 8000 });
  } catch (e) {
    console.log('  (screenshot skipped: ' + e.message.split('\n')[0] + ')');
  }
}

async function main() {
  await fs.mkdir(SHOTS_DIR, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  page.on('console', msg => {
    const t = msg.text();
    if (t.startsWith('[recovery]')) console.log('     ' + t);
  });

  console.log('\n▶ scenario: fresh load, no recovery state');
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
  // Dismiss the cinematic intro splash so the dashboard is actually visible.
  // The intro element has id="intro" and listens for click/keydown, fading
  // out to display:none. Without this the dashboard is fully occluded —
  // assertions still pass on DOM presence but screenshots are useless.
  await page.evaluate(() => {
    const el = document.getElementById('intro');
    if (el) el.click();
  });
  // Intro fade-out animation is 1s; wait it out plus a margin.
  await page.waitForFunction(() => {
    const el = document.getElementById('intro');
    return !el || getComputedStyle(el).visibility === 'hidden' || getComputedStyle(el).display === 'none' || el.classList.contains('fade-out');
  }, { timeout: 5000 });
  await page.waitForTimeout(1100);
  await page.waitForSelector('#page-dashboard.active');
  await page.waitForFunction(() => typeof window.dojoTestRecovery === 'function');

  // Empty state expectations
  const emptyPill = await page.evaluate(() => {
    const el = document.getElementById('streak-prime-recovery');
    return { exists: !!el, html: el && el.innerHTML.trim(), display: el && getComputedStyle(el).display };
  });
  check('pill element exists in DOM', emptyPill.exists, JSON.stringify(emptyPill));
  check('pill is empty when no recovery', emptyPill.html === '', JSON.stringify(emptyPill));
  check('pill is display:none when empty', emptyPill.display === 'none', JSON.stringify(emptyPill));

  const emptyBanner = await page.evaluate(() => {
    const el = document.getElementById('streak-recovery-banner-slot');
    return { exists: !!el, html: el && el.innerHTML.trim(), display: el && getComputedStyle(el).display };
  });
  check('dashboard banner slot exists', emptyBanner.exists);
  // On first boot, the banner is either empty (no skip reason) or shows the
  // info-variant diagnostic ("Streak Recovery — Not Available" + reason).
  // What we never want is the active recovery banner without a real
  // recovery state.
  const startsActive = /streak-recovery-banner active|streak-recovery-banner success/.test(emptyBanner.html || '');
  check('dashboard banner is not stuck on active recovery on fresh load', !startsActive, JSON.stringify(emptyBanner).slice(0, 160));

  await shoot(page, '01-fresh-no-recovery');

  console.log('\n▶ scenario: inject synthetic broken streak via dojoTestRecovery()');
  await page.evaluate(() => window.dojoTestRecovery());
  await page.waitForTimeout(200);

  const filled = await page.evaluate(() => {
    const pill   = document.getElementById('streak-prime-recovery');
    const banner = document.getElementById('streak-recovery-banner-slot');
    const cta    = document.querySelector('.cta-enter');
    const main   = document.querySelector('.cta-enter .cta-line.cta-main');
    const eyebrow = document.querySelector('.cta-enter .cta-eyebrow');
    return {
      pillHtml:   pill && pill.innerHTML.trim(),
      pillDisp:   pill && getComputedStyle(pill).display,
      bannerHtml: banner && banner.innerHTML.trim(),
      bannerDisp: banner && getComputedStyle(banner).display,
      ctaClasses: cta && cta.className,
      ctaMain:    main && main.textContent.trim(),
      eyebrow:    eyebrow && eyebrow.textContent.trim(),
    };
  });

  check('pill renders content after detection', !!filled.pillHtml && filled.pillHtml.length > 0, filled.pillHtml);
  check('pill is visible (not display:none)', filled.pillDisp !== 'none', filled.pillDisp);
  check('pill mentions "Recover to"',          /Recover to/.test(filled.pillHtml), filled.pillHtml);
  check('banner renders content after detection', !!filled.bannerHtml && filled.bannerHtml.length > 0, filled.bannerHtml && filled.bannerHtml.slice(0, 80));
  check('banner is visible (not display:none)', filled.bannerDisp !== 'none', filled.bannerDisp);
  check('banner contains numbered steps',       /Open the.*Quest Board[\s\S]+Solve and rate/.test(filled.bannerHtml), 'steps not found');
  check('CTA gains recovery-mode class',        /recovery-mode/.test(filled.ctaClasses), filled.ctaClasses);
  check('CTA main reads "Recover N-Day Streak"', /Recover \d+-Day Streak/.test(filled.ctaMain), filled.ctaMain);
  check('CTA eyebrow mentions Streak Recovery', /Streak Recovery/i.test(filled.eyebrow), filled.eyebrow);

  await shoot(page, '02-recovery-detected');

  console.log('\n▶ scenario: navigate to Quest Board → banner repaints there');
  await page.evaluate(() => window.navigate('quest'));
  await page.waitForSelector('#page-quest.active');
  await page.waitForTimeout(200);

  const questBanner = await page.evaluate(() => {
    const el = document.querySelector('#page-quest .recovery-banner-slot');
    return { exists: !!el, html: el && el.innerHTML.trim(), display: el && getComputedStyle(el).display };
  });
  check('quest page has banner slot',          questBanner.exists);
  check('quest banner renders after navigate', !!questBanner.html && questBanner.html.length > 0, questBanner.html && questBanner.html.slice(0, 80));
  check('quest banner is visible',             questBanner.display !== 'none', questBanner.display);

  await shoot(page, '03-quest-banner');

  console.log('\n▶ scenario: simulate scroll → sticky banner stays in viewport');
  await page.evaluate(() => window.navigate('dashboard'));
  await page.waitForSelector('#page-dashboard.active');
  await page.waitForTimeout(200);
  await page.evaluate(() => window.scrollTo(0, 800));
  await page.waitForTimeout(150);

  const sticky = await page.evaluate(() => {
    const el = document.getElementById('streak-recovery-banner-slot');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { topInViewport: r.top, height: r.height, sticky: getComputedStyle(el).position };
  });
  check('banner uses position:sticky',         sticky && sticky.sticky === 'sticky', JSON.stringify(sticky));
  check('banner pinned near top of viewport',  sticky && sticky.topInViewport >= 0 && sticky.topInViewport < 100, JSON.stringify(sticky));

  await shoot(page, '04-scrolled-sticky');

  console.log('\n▶ scenario: rate problems → progress increments → success state');
  // Reset and inject a fresh test recovery so we can run progress flow.
  await page.evaluate(() => window.dojoResetRecovery());
  await page.evaluate(() => window.dojoTestRecovery());
  await page.waitForTimeout(150);

  // dojoTestRecovery sets required=2, progress=0. Drive noteRecoveryRate twice.
  await page.evaluate(() => window.noteRecoveryRate());
  await page.waitForTimeout(100);
  const mid = await page.evaluate(() => {
    const pill = document.getElementById('streak-prime-recovery');
    // Access the recovery state through the same accessor users / painters
    // use, since `userData` is module-scoped and not on window.
    const rec  = (typeof window.getStreakRecovery === 'function') ? window.getStreakRecovery() : null;
    return { progress: rec && rec.progress, required: rec && rec.required, pillHtml: pill && pill.innerHTML };
  });
  check('progress increments to 1 after one rate', mid.progress === 1, JSON.stringify(mid));
  check('pill reflects "rate 1 more"',             /rate <b>1<\/b> more/.test(mid.pillHtml || ''), mid.pillHtml);

  await page.evaluate(() => window.noteRecoveryRate());
  await page.waitForTimeout(150);
  const done = await page.evaluate(() => {
    const pill = document.getElementById('streak-prime-recovery');
    const rec  = (typeof window.getStreakRecovery === 'function') ? window.getStreakRecovery() : null;
    return { recovered: rec && rec.recovered, classes: pill && pill.className, html: pill && pill.innerHTML };
  });
  check('recovery flag flips to recovered',     done.recovered === true, JSON.stringify(done));
  check('pill switches to .success class',      /success/.test(done.classes || ''), done.classes);
  check('pill shows "Recovered to N days"',     /Recovered to/.test(done.html || ''), done.html);

  await shoot(page, '05-recovery-success');

  console.log('\n▶ scenario: reset clears all surfaces');
  await page.evaluate(() => window.dojoResetRecovery());
  await page.waitForTimeout(150);
  const cleared = await page.evaluate(() => {
    const pill   = document.getElementById('streak-prime-recovery');
    const banner = document.getElementById('streak-recovery-banner-slot');
    const cta    = document.querySelector('.cta-enter');
    return {
      pillHtml: pill && pill.innerHTML.trim(),
      bannerHtml: banner && banner.innerHTML.trim(),
      ctaClasses: cta && cta.className,
    };
  });
  check('pill cleared on reset',         cleared.pillHtml === '', cleared.pillHtml);
  // After reset we accept either an empty banner (no skip reason) or the
  // info-variant diagnostic banner (skip reason re-detected). What we never
  // want is the active recovery banner sticking around.
  check('banner is not stuck on active recovery',
        !/streak-recovery-banner active|streak-recovery-banner success/.test(cleared.bannerHtml || ''),
        cleared.bannerHtml && cleared.bannerHtml.slice(0, 120));
  check('CTA recovery class removed',    !/recovery-mode|recovery-success/.test(cleared.ctaClasses || ''), cleared.ctaClasses);

  await shoot(page, '06-cleared');

  console.log('\n▶ scenario: diagnostic empty-state when detection skips');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  // Use the test-only escape hatch to set a skip reason without touching
  // module-scoped userData directly. The painter then renders the info
  // variant of the banner.
  await page.evaluate(() => {
    window.dojoSetSkipReason('best recent streak was 1 day — need at least 3 consecutive days within the last 30 days to qualify');
  });
  await page.waitForTimeout(150);
  const diag = await page.evaluate(() => {
    const banner = document.getElementById('streak-recovery-banner-slot');
    const r = banner && banner.getBoundingClientRect();
    return {
      html: banner && banner.innerHTML,
      display: banner && getComputedStyle(banner).display,
      visibleTop: r && r.top,
      visibleHeight: r && r.height,
    };
  });
  check('diagnostic banner renders when no recovery + skip reason set', /Streak Recovery — Not Available/.test(diag.html || ''), diag.html && diag.html.slice(0, 120));
  check('diagnostic banner explains the reason',                       /best recent streak was/.test(diag.html || ''), diag.html);
  check('diagnostic banner is visible',                                diag.display !== 'none', diag.display);
  check('diagnostic banner has non-zero height',                       (diag.visibleHeight || 0) > 20, JSON.stringify(diag));
  check('diagnostic banner is in viewport',                            diag.visibleTop !== undefined && diag.visibleTop < 600, JSON.stringify(diag));

  await shoot(page, '07-diagnostic');

  await browser.close();
  server.close();

  console.log(`\n${'─'.repeat(60)}`);
  if (failures.length === 0) {
    console.log('ALL CHECKS PASSED');
    process.exit(0);
  } else {
    console.log(`${failures.length} FAILURE${failures.length === 1 ? '' : 'S'}:`);
    failures.forEach(f => console.log('  ✗ ' + f));
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Harness crashed:', err);
  process.exit(2);
});
