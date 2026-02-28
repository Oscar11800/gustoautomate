import { CONFIG } from '../config.js';
import { log, shortDelay, sleep, typeHuman, waitForStableDOM } from './utils.js';

const COL = CONFIG.sheets.columns;

/**
 * Find the Name Box input in Google Sheets using multiple selector strategies.
 * Returns an ElementHandle or null.
 */
async function findNameBox(page) {
  return page.evaluateHandle(() => {
    // aria-label is the most stable across Sheets updates
    let el = document.querySelector('input[aria-label="Name Box"]');
    if (el) return el;

    // Fallback: known auto-generated IDs (fragile, but fast)
    for (const id of [':3', ':2', ':1', ':4']) {
      el = document.getElementById(id);
      if (el && el.tagName === 'INPUT') return el;
    }

    // Last resort: find an <input> whose value looks like a cell reference (e.g. "A1", "D69")
    for (const input of document.querySelectorAll('input')) {
      if (/^[A-Z]{1,3}\d{1,7}$/.test(input.value?.trim())) return input;
    }

    return null;
  });
}

/**
 * Navigate to a specific cell using the Name Box (top-left cell reference input).
 * Retries finding the Name Box for up to ~3 seconds in case the page is still loading.
 */
async function goToCell(page, cellRef) {
  log('data', `Navigating to cell ${cellRef}`);

  let nameBox;
  let isValid = false;

  for (let attempt = 0; attempt < 6; attempt++) {
    nameBox = await findNameBox(page);
    isValid = await page.evaluate((el) => el instanceof HTMLInputElement, nameBox);
    if (isValid) break;
    await sleep(500);
  }

  if (!isValid) {
    throw new Error('Could not find the Google Sheets Name Box after retries. Is the Sheets tab in focus?');
  }

  // Click the Name Box, select-all its text, type the new cell reference
  await nameBox.click();
  await shortDelay(30, 60);
  await page.keyboard.down('Meta');
  await page.keyboard.press('a');
  await page.keyboard.up('Meta');
  await shortDelay(10, 20);
  await page.keyboard.type(cellRef, { delay: 15 });
  await page.keyboard.press('Enter');
  await shortDelay(80, 120);
}

/**
 * Read the value of the currently selected cell via the formula bar.
 * Uses multiple strategies because Google Sheets' DOM IDs are not stable.
 */
async function readSelectedCellValue(page) {
  const value = await page.evaluate(() => {
    const selectors = [
      '#formula_bar_id [contenteditable="true"]',
      '[aria-label="Formula input"]',
      '.cell-input',
      '#\\:5',
      '[role="textbox"][aria-label*="ormula"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = (el.textContent || el.value || '').trim();
        // Guard: ignore if it looks like a cell reference (Name Box leaking through)
        if (text && !/^[A-Z]{1,3}\d{1,7}$/.test(text)) return text;
        if (text) return text;  // even if it looks like a ref, return as last resort
      }
    }
    return '';
  });
  return value.trim();
}

/**
 * Read a specific cell value by navigating to it.
 */
export async function readCell(page, col, row) {
  const cellRef = `${col}${row}`;

  // Ensure we're not in edit mode before navigating
  await page.keyboard.press('Escape');
  await shortDelay(30, 50);

  await goToCell(page, cellRef);
  await shortDelay(100, 150);

  // Verify the Name Box shows the cell we navigated to
  const nameBoxValue = await page.evaluate(() => {
    const el = document.querySelector('input[aria-label="Name Box"]')
      || (() => { for (const i of document.querySelectorAll('input')) if (/^[A-Z]{1,3}\d{1,7}$/.test(i.value?.trim())) return i; return null; })();
    return el?.value?.trim() ?? '';
  });
  if (nameBoxValue.toUpperCase() !== cellRef.toUpperCase()) {
    log('warn', `Name Box shows "${nameBoxValue}" instead of "${cellRef}", retrying navigation...`);
    await goToCell(page, cellRef);
    await shortDelay(100, 150);
  }

  const value = await readSelectedCellValue(page);
  log('data', `Cell ${cellRef} = "${value}"`);
  return value;
}

/**
 * Write a value into a specific cell, then verify it was written correctly.
 * Types directly in "ready" mode so Google Sheets data validation is preserved.
 * Retries up to 3 times if verification fails.
 */
export async function writeCell(page, col, row, value, maxRetries = 3) {
  const cellRef = `${col}${row}`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    log('data', `Writing "${value}" to cell ${cellRef} (attempt ${attempt})`);

    await page.keyboard.press('Escape');
    await shortDelay(50, 80);
    await goToCell(page, cellRef);
    await shortDelay(100, 150);

    // Type the value (replaces cell content in ready mode) and commit
    await page.keyboard.type(value, { delay: 20 });
    await page.keyboard.press('Enter');
    await shortDelay(300, 400);

    // Verify: navigate back and read
    const actual = await readCell(page, col, row);
    if (actual.toLowerCase() === value.toLowerCase()) {
      log('ok', `Verified "${value}" in ${cellRef}`);
      return;
    }

    log('warn', `Write verification failed for ${cellRef}: expected "${value}", got "${actual}" (attempt ${attempt}/${maxRetries})`);
    await shortDelay(300, 500);
  }

  log('err', `Failed to write "${value}" to ${cellRef} after ${maxRetries} attempts`);
}

/**
 * Fast write: navigate to cell, type value, press Enter. No verification read-back.
 */
export async function writeCellFast(page, col, row, value) {
  const cellRef = `${col}${row}`;
  log('data', `Writing "${value}" to cell ${cellRef} (fast)`);

  await page.keyboard.press('Escape');
  await shortDelay(30, 50);
  await goToCell(page, cellRef);
  await shortDelay(50, 80);

  await page.keyboard.type(value, { delay: 20 });
  await page.keyboard.press('Enter');
  await shortDelay(50, 80);
  log('ok', `Wrote "${value}" to ${cellRef}`);
}

/**
 * Check if a row is already marked as completed (column O = "yes").
 */
export async function isRowCompleted(page, row) {
  const val = await readCell(page, COL.status, row);
  const done = val.toLowerCase() === CONFIG.sheets.statusValue.toLowerCase();
  if (done) log('info', `Row ${row} already marked "${CONFIG.sheets.statusValue}", skipping`);
  return done;
}

/**
 * Mark a row as completed by writing "yes" into column O.
 */
export async function markRowCompleted(page, row) {
  await writeCell(page, COL.status, row, CONFIG.sheets.statusValue);
}

/**
 * Read contractor data from a row: full name (col D) and email (col F).
 */
export async function readContractorRow(page, row) {
  const fullName = await readCell(page, COL.fullName, row);
  const email = await readCell(page, COL.email, row);

  if (!fullName || !email) {
    log('warn', `Row ${row}: missing data (name="${fullName}", email="${email}")`);
    return null;
  }

  const parsed = parseFullName(fullName);
  log('data', `Row ${row}: name=${JSON.stringify(parsed)}, email="${email}"`);
  return { ...parsed, email, fullName, row };
}

const SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii']);

/**
 * Parse a full legal name into first name and last name only.
 * Middle names/initials are discarded -- Gusto only needs first + last.
 *
 * Rules:
 *   "Caden Lepple"                    → Caden / Lepple
 *   "Coen Troy Collins"               → Coen / Collins       (middle dropped)
 *   "Alicia AMA-Mansah Agyemang"      → Alicia / Agyemang    (middle dropped)
 *   "Frank Clinton Elcan IV"          → Frank / Elcan IV      (suffix kept with last)
 *   "Fleming Bo Hardy III"            → Fleming / Hardy III
 *   "Ricardo Perez Jr"                → Ricardo / Perez Jr
 *   "Madison Sullivan-Westover"       → Madison / Sullivan-Westover (hyphen preserved)
 *   "Adelina de la Rosa"              → Adelina / de la Rosa  (particles kept)
 *   "Cheyanne"                        → Cheyanne / (empty)
 *   "Madison L. Bass"                 → Madison / Bass
 *   "Charles Edward Todd Witherington"→ Charles / Witherington
 */
export function parseFullName(fullName) {
  const parts = fullName.trim().split(/\s+/);

  if (parts.length === 0) {
    return { firstName: '', lastName: '' };
  }
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }

  const firstName = parts[0];

  // Check if the last token is a suffix (Jr, III, IV, etc.)
  const lastToken = parts[parts.length - 1];
  if (parts.length >= 3 && SUFFIXES.has(lastToken.toLowerCase())) {
    // Suffix detected: attach it to the word before it
    // e.g. ["Frank", "Clinton", "Elcan", "IV"] → lastName = "Elcan IV"
    const lastName = parts[parts.length - 2] + ' ' + lastToken;
    return { firstName, lastName };
  }

  // Check for name particles (de, la, del, van, von, etc.) preceding the last name
  // e.g. ["Adelina", "de", "la", "Rosa"] → lastName = "de la Rosa"
  const PARTICLES = new Set(['de', 'la', 'del', 'di', 'da', 'el', 'al', 'van', 'von', 'bin', 'ben', 'le', 'du', 'dos', 'das']);
  let lastNameStart = parts.length - 1;
  while (lastNameStart > 1 && PARTICLES.has(parts[lastNameStart - 1].toLowerCase())) {
    lastNameStart--;
  }
  const lastName = parts.slice(lastNameStart).join(' ');

  return { firstName, lastName };
}
