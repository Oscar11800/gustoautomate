#!/usr/bin/env node

import { connectBrowser, findSheetsTab, findGustoTab, bringToFront } from './browser.js';
import { readContractorRow, isRowCompleted, markRowCompleted } from './sheets.js';
import { addContractor } from './gusto.js';
import { log, shortDelay, sleep } from './utils.js';
import { CONFIG } from '../config.js';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    startRow: 2,
    endRow: null,   // null = keep going until empty row
    dryRun: false,
    singleRow: null,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--start-row':
      case '-s':
        opts.startRow = parseInt(args[++i], 10);
        break;
      case '--end-row':
      case '-e':
        opts.endRow = parseInt(args[++i], 10);
        break;
      case '--row':
      case '-r':
        opts.singleRow = parseInt(args[++i], 10);
        break;
      case '--dry-run':
      case '-d':
        opts.dryRun = true;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
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
Gusto Contractor Automator
==========================

Usage:
  node src/index.js [options]

Options:
  --start-row, -s <n>   First row to process (default: 2)
  --end-row, -e <n>     Last row to process (default: auto-detect empty)
  --row, -r <n>         Process a single row only
  --dry-run, -d         Read data from sheet but don't submit in Gusto
  --help, -h            Show this help

Examples:
  node src/index.js --row 2              # Test with just row 2
  node src/index.js -s 2 -e 5           # Process rows 2 through 5
  node src/index.js -s 2 -e 3 --dry-run # Read rows 2-3 without submitting
  node src/index.js -s 2                 # Process rows 2+ until empty row
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs();

  log('info', '========================================');
  log('info', ' Gusto Contractor Automator');
  log('info', '========================================');
  log('info', `Config: startRow=${opts.startRow}, endRow=${opts.endRow ?? 'auto'}, dryRun=${opts.dryRun}`);

  // Connect to Chrome
  const browser = await connectBrowser();
  const sheetsPage = await findSheetsTab(browser);
  const gustoPage = await findGustoTab(browser);

  log('ok', 'Both tabs found. Starting automation...');
  console.log('');

  const results = { processed: 0, skipped: 0, failed: 0, errors: [] };
  const maxEmptyRows = 3; // stop after 3 consecutive empty rows (when endRow is auto)
  let consecutiveEmpty = 0;

  for (let row = opts.startRow; ; row++) {
    // Check bounds
    if (opts.endRow && row > opts.endRow) break;
    if (!opts.endRow && consecutiveEmpty >= maxEmptyRows) {
      log('info', `Stopping: ${maxEmptyRows} consecutive empty rows detected at row ${row - maxEmptyRows}`);
      break;
    }

    log('info', `--- Row ${row} ---`);

    // Switch to Sheets and read data
    await bringToFront(sheetsPage);
    await shortDelay(80, 100);

    // Check if already completed
    const done = await isRowCompleted(sheetsPage, row);
    if (done) {
      results.skipped++;
      consecutiveEmpty = 0;
      continue;
    }

    // Read contractor data
    const contractor = await readContractorRow(sheetsPage, row);
    if (!contractor) {
      consecutiveEmpty++;
      log('warn', `Row ${row}: empty or missing data, skipping`);
      results.skipped++;
      continue;
    }
    consecutiveEmpty = 0;

    log('data', `Contractor: ${contractor.firstName} ${contractor.lastName} <${contractor.email}>`);

    if (opts.dryRun) {
      log('info', `[DRY RUN] Would process ${contractor.firstName} ${contractor.lastName} -- skipping Gusto steps`);
      results.processed++;
      continue;
    }

    // Switch to Gusto and run workflow
    await bringToFront(gustoPage);
    await shortDelay(80, 100);

    const result = await addContractor(gustoPage, contractor);

    if (result.success) {
      // Mark row as completed in Sheets
      await bringToFront(sheetsPage);
      await shortDelay(80, 100);
      await markRowCompleted(sheetsPage, row);
      results.processed++;
      log('ok', `Row ${row}: DONE -- ${contractor.firstName} ${contractor.lastName}`);
    } else {
      results.failed++;
      results.errors.push({ row, name: result.name, errors: result.errors, stepsCompleted: result.stepsCompleted });
      log('err', `Row ${row}: FAILED -- ${result.errors.join('; ')}`);
      log('err', `  Steps completed before failure: ${result.stepsCompleted.join(', ')}`);
      // Continue to next row instead of crashing
    }

    console.log('');

    // Pause between contractors to avoid Gusto server throttling
    if (CONFIG.delays.betweenContractors > 0) {
      log('info', `Cooling down ${CONFIG.delays.betweenContractors}ms before next contractor...`);
      await sleep(CONFIG.delays.betweenContractors);
    }
  }

  // Final summary
  console.log('');
  log('info', '========================================');
  log('info', ' Run Complete');
  log('info', '========================================');
  log('info', `Processed: ${results.processed}`);
  log('info', `Skipped:   ${results.skipped}`);
  log('info', `Failed:    ${results.failed}`);

  if (results.errors.length > 0) {
    log('err', 'Failed rows:');
    for (const e of results.errors) {
      log('err', `  Row ${e.row} (${e.name}): ${e.errors.join('; ')} [completed: ${e.stepsCompleted.join(', ')}]`);
    }
  }

  // Disconnect (doesn't close Chrome)
  browser.disconnect();
  log('info', 'Disconnected from Chrome (browser remains open)');
}

main().catch((err) => {
  log('err', `Fatal error: ${err.message}`);
  log('err', err.stack);
  process.exit(1);
});
