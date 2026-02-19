import { CONFIG } from '../config.js';
import { log, shortDelay, sleep, typeHuman, waitForStableDOM } from './utils.js';

const COL = CONFIG.sheets.columns;

/**
 * Navigate to a specific cell using the Name Box (top-left cell reference input).
 * This is the most reliable way to navigate Google Sheets programmatically.
 */
async function goToCell(page, cellRef) {
  log('data', `Navigating to cell ${cellRef}`);
  // Click the Name Box (shows current cell reference like "A1")
  const nameBox = '#\\:3';
  try {
    await page.click(nameBox);
  } catch {
    // Fallback: use Ctrl+G or click the element by its aria label
    await page.keyboard.down('Control');
    await page.keyboard.press('g');
    await page.keyboard.up('Control');
    await shortDelay(50, 80);
  }
  await shortDelay(30, 60);

  // Type the cell reference
  await page.keyboard.down('Meta');
  await page.keyboard.press('a');
  await page.keyboard.up('Meta');
  await shortDelay(10, 20);
  await page.keyboard.type(cellRef, { delay: 15 });
  await page.keyboard.press('Enter');
  await shortDelay(50, 80);
}

/**
 * Read the current cell's text value. Assumes the cell is already selected.
 */
async function readSelectedCellValue(page) {
  // The formula bar input holds the current cell's value
  const value = await page.evaluate(() => {
    // Try the formula bar textarea/input
    const formulaBar = document.querySelector('.cell-input') 
      || document.querySelector('#\\:5') 
      || document.querySelector('[aria-label="Formula input"]');
    if (formulaBar) return formulaBar.textContent || formulaBar.value || '';
    
    // Fallback: try to get from contenteditable
    const cellInput = document.querySelector('.cell-input.editable');
    if (cellInput) return cellInput.textContent || '';
    
    return '';
  });
  return value.trim();
}

/**
 * Read a specific cell value by navigating to it.
 */
export async function readCell(page, col, row) {
  const cellRef = `${col}${row}`;
  await goToCell(page, cellRef);
  await shortDelay(80, 100);
  
  // Read from the formula bar -- press Escape first to ensure we're not in edit mode
  await page.keyboard.press('Escape');
  await shortDelay(30, 50);
  await goToCell(page, cellRef);
  await shortDelay(80, 100);

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

    await goToCell(page, cellRef);
    await shortDelay(100, 150);

    // Escape out of edit mode if we're in it, so the cell is in "ready" mode.
    // In ready mode, typing replaces content without destroying data validation.
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
