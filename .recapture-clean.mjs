// Retry specific captures: dismiss cookie/consent overlays and floating widgets before printing.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = '/Users/craigfahner/cv';
const outDir = join(root, 'press-clippings');

const targets = [
  { id: 'music_press-2021-29-new-songs-out-today', url: 'https://www.brooklynvegan.com/29-new-songs-out-today-18/' },
  { id: 'music_press-2021-26-new-songs-out-today', url: 'https://www.brooklynvegan.com/26-new-songs-out-today-25/' },
  { id: 'music_press-2021-indie-basement-93-the-week-in-classic-indie-college-rock-and-more', url: 'https://www.brooklynvegan.com/indie-basement-93-the-week-in-classic-indie-college-rock-and-more/' },
  { id: 'music_press-2021-sloan-s-jay-ferguson-tells-us-about-his-favorite-songs-of-2021', url: 'https://www.brooklynvegan.com/sloans-jay-ferguson-tells-us-about-his-favorite-songs-of-2021/' },
  { id: 'music_press-2020-motorists-tough-age-feel-alright-to-release-from-the-wreckage-ep', url: 'https://www.punknews.org/article/72084/motorists-tough-age-feel-alright-to-release-from-the-wreckage-ep' },
  { id: 'music_press-2018-video-premiere-cool-water-by-feel-alright', url: 'https://bigtakeover.com/news/video-premiere-cool-water-by-feel-alright' },
  { id: 'music_press-2018-five-questions-with-craig-fahner-of-feel-alright', url: 'https://www.fyimusicnews.ca/articles/2018/05/09/five-questions-…-craig-fahner-feel-alright' },
  { id: 'music_press-2021-essential-releases-september-10-2021', url: 'https://daily.bandcamp.com/seven-essential-releases/essential-releases-september-10-2021' },
  { id: 'music_press-2024-essential-releases-may-24-2024', url: 'https://daily.bandcamp.com/essential-releases/essential-releases-may-24-2024' },
];

const executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 1600 },
});

// Block known ad-delivery / video-widget network noise that renders as broken fallback content.
const blockedHosts = [/revive/i, /doubleclick/i, /googlesyndication/i, /adnxs/i, /outbrain/i, /taboola/i, /criteo/i, /jwpltx/i, /jwpcdn/i];
await context.route('**/*', (route) => {
  const url = route.request().url();
  if (blockedHosts.some((re) => re.test(url))) return route.abort();
  return route.continue();
});

const results = { ok: [], failed: [] };

for (const t of targets) {
  const page = await context.newPage();
  try {
    let resp;
    try {
      resp = await page.goto(t.url, { waitUntil: 'networkidle', timeout: 40000 });
    } catch {
      resp = await page.goto(t.url, { waitUntil: 'load', timeout: 40000 }).catch(() => null);
    }
    const status = resp?.status();
    if (status && status >= 400) throw new Error(`HTTP ${status}`);
    await page.waitForTimeout(1500);

    // Pass 1: click anything that looks like a consent/dismiss control.
    await page.evaluate(() => {
      const texts = ['accept all', 'accept', 'i agree', 'agree', 'got it', 'allow all', 'ok', 'close', 'confirm', 'x'];
      const clickable = [...document.querySelectorAll('button, a, [role="button"], [class*="close"], [class*="dismiss"]')];
      for (const el of clickable) {
        const t = (el.innerText || el.getAttribute('aria-label') || '').trim().toLowerCase();
        if (texts.includes(t) && el.offsetParent !== null) {
          try { el.click(); } catch {}
        }
      }
    });
    await page.waitForTimeout(800);

    // Pass 2: strip large fixed/sticky overlays (video widgets, cookie banners, backdrops) that survived.
    await page.evaluate(() => {
      document.querySelectorAll('body *').forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed' || cs.position === 'sticky') {
          const r = el.getBoundingClientRect();
          const area = Math.max(0, r.width) * Math.max(0, r.height);
          const z = parseInt(cs.zIndex || '0', 10);
          if (area > 12000 || z > 999) el.remove();
        }
      });
      document.documentElement.style.overflow = 'auto';
      document.body.style.overflow = 'auto';
    });
    await page.waitForTimeout(300);

    const pdfPath = join(outDir, `${t.id}.pdf`);
    await page.pdf({ path: pdfPath, format: 'Letter', printBackground: true, margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' } });
    results.ok.push(t.id);
  } catch (err) {
    results.failed.push({ id: t.id, url: t.url, reason: err.message.slice(0, 300) });
  } finally {
    await page.close();
  }
}

await browser.close();
console.log(JSON.stringify(results, null, 2));
