import { bringToFront } from './browser.js';
import { log, shortDelay, sleep, waitForStableDOM } from './utils.js';

const SEARCH_SETTLE_MS = 600;

// ---------------------------------------------------------------------------
// Search bar interaction (shared between both pages)
// ---------------------------------------------------------------------------

async function findSearchInput(page) {
  return page.evaluateHandle(() => {
    const candidates = [
      ...document.querySelectorAll('input[type="search"]'),
      ...document.querySelectorAll('input[placeholder*="Search" i]'),
      ...document.querySelectorAll('input[aria-label*="search" i]'),
    ];
    for (const el of candidates) {
      if (el.offsetParent !== null) return el;
    }
    return null;
  });
}

async function searchOnPage(page, name) {
  const input = await findSearchInput(page);
  const isValid = await page.evaluate(el => el instanceof HTMLInputElement, input);
  if (!isValid) throw new Error('Search input not found on Gusto page');

  await input.click({ clickCount: 3 });
  await page.keyboard.press('Backspace');
  await shortDelay(30, 50);
  await page.keyboard.type(name, { delay: 12 });
  await sleep(SEARCH_SETTLE_MS);
  await waitForStableDOM(page, 200, 2000);
}

// ---------------------------------------------------------------------------
// /people/all -- person appearing in results = verified
// ---------------------------------------------------------------------------

export async function isFoundOnAllPage(page, name) {
  log('step', `  Searching /people/all for "${name}"`);
  await searchOnPage(page, name);

  const found = await page.evaluate((searchName) => {
    const body = document.body?.innerText || '';
    const noResults = /no (people|team members|results)/i.test(body)
      || /couldn.t find/i.test(body)
      || /0 results/i.test(body);
    if (noResults) return false;

    const rows = [
      ...document.querySelectorAll('tr'),
      ...document.querySelectorAll('[role="row"]'),
      ...document.querySelectorAll('[data-testid*="person"], [data-testid*="employee"], [data-testid*="member"]'),
    ];

    const searchLower = searchName.toLowerCase();
    for (const row of rows) {
      const text = row.textContent?.toLowerCase() || '';
      if (text.includes(searchLower)) return true;
    }

    const links = document.querySelectorAll('a');
    for (const link of links) {
      const text = link.textContent?.toLowerCase() || '';
      if (text.includes(searchLower)) return true;
    }

    return false;
  }, name.toLowerCase());

  log('data', `  /people/all result: ${found ? 'FOUND' : 'NOT FOUND'}`);
  return found;
}

// ---------------------------------------------------------------------------
// /people/onboarding -- check progress percentage
// ---------------------------------------------------------------------------

export async function getOnboardingProgress(page, name) {
  log('step', `  Searching /people/onboarding for "${name}"`);
  await searchOnPage(page, name);

  const result = await page.evaluate((searchName) => {
    const body = document.body?.innerText || '';
    const noResults = /no (people|team members|results)/i.test(body)
      || /couldn.t find/i.test(body)
      || /0 results/i.test(body);
    if (noResults) return { found: false, progress: null };

    const searchLower = searchName.toLowerCase();

    const rows = [
      ...document.querySelectorAll('tr'),
      ...document.querySelectorAll('[role="row"]'),
      ...document.querySelectorAll('[role="listitem"]'),
      ...document.querySelectorAll('li'),
    ];

    for (const row of rows) {
      const text = row.textContent?.toLowerCase() || '';
      if (!text.includes(searchLower)) continue;

      const spans = row.querySelectorAll('span, div, p, td');
      for (const span of spans) {
        const t = span.textContent?.trim();
        if (t && /^\d{1,3}%$/.test(t)) {
          return { found: true, progress: parseInt(t, 10) };
        }
      }
    }

    const allSpans = document.querySelectorAll('span, div');
    for (const span of allSpans) {
      const t = span.textContent?.trim();
      if (t && /^\d{1,3}%$/.test(t)) {
        return { found: true, progress: parseInt(t, 10) };
      }
    }

    if (body.toLowerCase().includes(searchLower)) {
      return { found: true, progress: null };
    }

    return { found: false, progress: null };
  }, name.toLowerCase());

  if (result.found) {
    log('data', `  /people/onboarding result: FOUND, progress=${result.progress ?? 'unknown'}%`);
  } else {
    log('data', `  /people/onboarding result: NOT FOUND`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Orchestrator: check both pages and return verdict
// ---------------------------------------------------------------------------

export async function checkVerification(allPage, onboardingPage, firstName, lastName, { yesValue = 'Yes', noValue = 'No' } = {}) {
  const name = `${firstName} ${lastName}`.trim();
  log('info', `Checking verification for "${name}"`);

  await bringToFront(onboardingPage);
  await shortDelay(30, 50);

  const { found, progress } = await getOnboardingProgress(onboardingPage, name);
  if (found) {
    if (progress === 100) {
      log('ok', `  "${name}" onboarding at 100% → ${yesValue}`);
      return yesValue;
    }
    log('info', `  "${name}" onboarding at ${progress ?? '?'}% → ${noValue}`);
    return noValue;
  }

  await bringToFront(allPage);
  await shortDelay(30, 50);

  const onAll = await isFoundOnAllPage(allPage, name);
  if (onAll) {
    log('ok', `  "${name}" found on /people/all → ${yesValue}`);
    return yesValue;
  }

  log('warn', `  "${name}" not found on either page → skipping`);
  return null;
}
