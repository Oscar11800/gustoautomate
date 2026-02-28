#!/usr/bin/env node

import { connectBrowser, findSheetsTab, findTab, bringToFront } from './browser.js';
import { readCell, writeCellFast, parseFullName } from './sheets.js';
import { checkVerification } from './gustoVerify.js';
import { getCachedRow, setCachedRow, loadCache } from './cache.js';
import { log, shortDelay } from './utils.js';
import { CONFIG } from '../config.js';

const COL = CONFIG.sheets.columns;

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { startRow: 2, endRow: null, singleRow: null, dryRun: false, noCache: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--start-row': case '-s':
        opts.startRow = parseInt(args[++i], 10); break;
      case '--end-row': case '-e':
        opts.endRow = parseInt(args[++i], 10); break;
      case '--row': case '-r':
        opts.singleRow = parseInt(args[++i], 10); break;
      case '--dry-run': case '-d':
        opts.dryRun = true; break;
      case '--no-cache':
        opts.noCache = true; break;
      case '--help': case '-h':
        printUsage(); process.exit(0);
    }
  }

  if (opts.singleRow) {
    opts.startRow = opts.singleRow;
    opts.endRow = opts.singleRow;
  }
  return opts;
}

function printUsage() {
  console.log(`
Gusto Verification Checker
===========================

Usage:
  node src/verify.js [options]

Options:
  --start-row, -s <n>   First row to process (default: 2)
  --end-row, -e <n>     Last row to process (default: auto-detect empty)
  --row, -r <n>         Process a single row only
  --dry-run, -d         Read data but don't write to sheet
  --sheet-b             Use Sheet B profile (default: Sheet A)
  --no-cache            Ignore cached row data and re-read everything from Sheets
  --help, -h            Show this help

Examples:
  node src/verify.js -s 2 -e 6          # Check rows 2-6
  node src/verify.js --row 3            # Check row 3 only
  node src/verify.js -s 2 -e 6 -d      # Dry run rows 2-6
  node src/verify.js -s 2 -e 50 --no-cache  # Force re-read all from Sheets
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs();
  if (opts.noCache) loadCache(true);

  log('info', '========================================');
  log('info', ' Gusto Verification Checker');
  log('info', '========================================');
  log('info', `Sheet profile: ${CONFIG.sheets.profileName}`);
  log('info', `Gusto Sent col: ${COL.status} | GUSTO COMPLETED col: ${COL.gustoCompleted}`);
  log('info', `Config: startRow=${opts.startRow}, endRow=${opts.endRow ?? 'auto'}, dryRun=${opts.dryRun}, cache=${!opts.noCache}`);

  const browser = await connectBrowser();
  const sheetsPage = await findSheetsTab(browser);

  log('info', 'Looking for Gusto /people/all tab...');
  const allPage = await findTab(browser, 'people/all');

  log('info', 'Looking for Gusto /people/onboarding tab...');
  const onboardingPage = await findTab(browser, 'people/onboarding');

  log('ok', 'All 3 tabs found. Starting verification checks...');
  console.log('');

  const results = { verified: 0, notVerified: 0, skipped: 0, notFound: 0, cached: 0, errors: [] };
  const maxEmptyRows = 3;
  let consecutiveEmpty = 0;

  for (let row = opts.startRow; ; row++) {
    if (opts.endRow && row > opts.endRow) break;
    if (!opts.endRow && consecutiveEmpty >= maxEmptyRows) {
      log('info', `Stopping: ${maxEmptyRows} consecutive empty rows at row ${row - maxEmptyRows}`);
      break;
    }

    // --- Fast path: check cache ---
    const cached = getCachedRow(row);
    if (cached) {
      if (cached.completed === 'yes') {
        log('info', `Row ${row}: cached as complete (${cached.name}), skipping`);
        results.cached++;
        consecutiveEmpty = 0;
        continue;
      }
      if (cached.sent === false) {
        log('info', `Row ${row}: cached as not sent, skipping`);
        results.cached++;
        if (cached.empty) consecutiveEmpty++;
        else consecutiveEmpty = 0;
        continue;
      }
    }

    log('info', `--- Row ${row} ---`);

    await bringToFront(sheetsPage);
    await shortDelay(50, 80);

    let sentVal;
    if (cached?.sent === true) {
      sentVal = CONFIG.sheets.statusValue;
    } else {
      sentVal = await readCell(sheetsPage, COL.status, row);
    }

    if (sentVal.toLowerCase() !== CONFIG.sheets.statusValue.toLowerCase()) {
      log('info', `Row ${row}: Gusto Sent = "${sentVal}" (not "${CONFIG.sheets.statusValue}"), skipping`);
      setCachedRow(row, { sent: false, empty: !sentVal });
      if (!sentVal) consecutiveEmpty++;
      else consecutiveEmpty = 0;
      results.skipped++;
      continue;
    }
    consecutiveEmpty = 0;

    let completedVal;
    if (cached?.completedRaw) {
      completedVal = cached.completedRaw;
    } else {
      completedVal = await readCell(sheetsPage, COL.gustoCompleted, row);
    }

    if (completedVal && completedVal.toLowerCase() === 'yes') {
      log('info', `Row ${row}: GUSTO COMPLETED already "YES", skipping`);
      setCachedRow(row, { sent: true, completed: 'yes', completedRaw: completedVal });
      results.skipped++;
      continue;
    }

    let fullName;
    if (cached?.name) {
      fullName = cached.name;
    } else {
      fullName = await readCell(sheetsPage, COL.fullName, row);
    }

    if (!fullName) {
      log('warn', `Row ${row}: no name found, skipping`);
      setCachedRow(row, { sent: true, empty: true });
      consecutiveEmpty++;
      results.skipped++;
      continue;
    }

    const { firstName, lastName } = parseFullName(fullName);
    log('data', `Row ${row}: "${fullName}" → first="${firstName}" last="${lastName}"`);

    setCachedRow(row, { sent: true, name: fullName });

    if (opts.dryRun) {
      log('info', `[DRY RUN] Would check verification for ${firstName} ${lastName}`);
      results.skipped++;
      continue;
    }

    try {
      const verdict = await checkVerification(allPage, onboardingPage, firstName, lastName, {
        yesValue: CONFIG.sheets.completedYes,
        noValue: CONFIG.sheets.completedNo,
      });

      if (verdict === CONFIG.sheets.completedYes) {
        results.verified++;
      } else if (verdict === CONFIG.sheets.completedNo) {
        results.notVerified++;
      } else {
        results.notFound++;
        log('warn', `Row ${row}: "${firstName} ${lastName}" not found on Gusto, leaving blank`);
        continue;
      }

      await bringToFront(sheetsPage);
      await shortDelay(50, 80);
      await writeCellFast(sheetsPage, COL.gustoCompleted, row, verdict);
      log('ok', `Row ${row}: wrote "${verdict}" to col ${COL.gustoCompleted}`);

      setCachedRow(row, {
        completedRaw: verdict,
        completed: verdict.toLowerCase() === 'yes' ? 'yes' : 'no',
      });

    } catch (err) {
      log('err', `Row ${row}: error — ${err.message}`);
      results.errors.push({ row, name: `${firstName} ${lastName}`, error: err.message });
    }

    console.log('');
  }

  console.log('');
  log('info', '========================================');
  log('info', ' Verification Complete');
  log('info', '========================================');
  log('info', `Verified (Yes): ${results.verified}`);
  log('info', `Not verified (No): ${results.notVerified}`);
  log('info', `Skipped:    ${results.skipped}`);
  log('info', `Cached:     ${results.cached}`);
  log('info', `Not found:  ${results.notFound}`);
  log('info', `Errors:     ${results.errors.length}`);

  if (results.errors.length > 0) {
    log('err', 'Failed rows:');
    for (const e of results.errors) {
      log('err', `  Row ${e.row} (${e.name}): ${e.error}`);
    }
  }

  browser.disconnect();
  log('info', 'Disconnected from Chrome (browser remains open)');
}

main().catch((err) => {
  log('err', `Fatal error: ${err.message}`);
  log('err', err.stack);
  process.exit(1);
});
