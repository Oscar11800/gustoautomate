export function log(level, ...args) {
  const ts = new Date().toISOString().slice(11, 23);
  const prefix = { info: 'INFO', step: 'STEP', ok: ' OK ', warn: 'WARN', err: ' ERR', data: 'DATA' }[level] || level.toUpperCase();
  console.log(`[${ts}] [${prefix}]`, ...args);
}

export function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function shortDelay(min = 50, max = 100) {
  await sleep(randomBetween(min, max));
}

export async function typeHuman(page, selector, text, opts = {}) {
  const { charMin = 10, charMax = 30, clearFirst = true } = opts;
  if (clearFirst) {
    await page.click(selector, { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await shortDelay(20, 40);
  }
  for (const ch of text) {
    await page.keyboard.type(ch, { delay: randomBetween(charMin, charMax) });
  }
}

export async function clickText(page, text, tag = '*') {
  const xpath = `//${tag}[contains(text(), "${text}")]`;
  await page.locator(`::-p-xpath(${xpath})`).click();
  await shortDelay();
}

export async function waitAndClick(page, selector, opts = {}) {
  const { timeout = 15000, visible = true } = opts;
  await page.waitForSelector(selector, { timeout, visible });
  await shortDelay(20, 50);
  await page.click(selector);
  await shortDelay();
}

/**
 * Waits for the page to stop producing DOM mutations.
 * Useful after navigation or big React re-renders.
 */
export async function waitForStableDOM(page, idleMs = 300, timeout = 10000) {
  await page.evaluate(
    (idleMs, timeout) =>
      new Promise((resolve) => {
        let timer;
        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            observer.disconnect();
            resolve();
          }, idleMs);
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        timer = setTimeout(() => {
          observer.disconnect();
          resolve();
        }, idleMs);
        setTimeout(() => {
          observer.disconnect();
          resolve();
        }, timeout);
      }),
    idleMs,
    timeout,
  );
}
