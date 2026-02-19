# Gusto Contractor Automator

Automates adding contractors to Gusto by reading data from a Google Sheet and driving your existing Chrome browser.

## Prerequisites

- **Node.js** v18+ (you have v25)
- **Google Chrome** with your Google and Gusto accounts already logged in

## Setup

```bash
npm install
```

## Step 1: Launch Chrome with Debugging Port

**Close all existing Chrome windows first**, then run:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

This starts Chrome with a debug port that the script connects to.

## Step 2: Open Both Tabs and Log In

Open these two tabs in that Chrome window and make sure you're logged in:

1. **Google Sheet**: https://docs.google.com/spreadsheets/d/1gBryReeOb7g8zQBcmXZfL57p-kbcC-gC_xkCF_qqoFY/edit?gid=1879732679#gid=1879732679
2. **Gusto**: https://app.gusto.com/

## Step 3: Run

### Test a single row first (dry run -- reads data only, no Gusto changes):
```bash
node src/index.js --row 2 --dry-run
```

### Test a single row for real:
```bash
node src/index.js --row 2
```

### Process a range of rows:
```bash
node src/index.js --start-row 2 --end-row 10
```

### Process all rows starting from row 2 (stops at 3 consecutive empty rows):
```bash
node src/index.js --start-row 2
```

## CLI Options

| Flag | Short | Description |
|------|-------|-------------|
| `--start-row <n>` | `-s` | First row to process (default: 2) |
| `--end-row <n>` | `-e` | Last row to process |
| `--row <n>` | `-r` | Process a single row only |
| `--dry-run` | `-d` | Read sheet data only, skip Gusto steps |
| `--help` | `-h` | Show help |

## What It Does

For each row in the Google Sheet (column D = full name, column F = email):

1. Checks column O -- if "yes", skips that row
2. Goes to Gusto > People > Add Person
3. Fills the Basics form (name, email, Contractor/Individual)
4. Sets contract start date to 02/17/2026
5. Selects Fixed payment type
6. Clicks through Review, Onboarding, Contact Details
7. Sends the invitation
8. Writes "yes" in column O of the completed row

## Debugging

The script outputs timestamped logs at every step:

```
[12:34:56.789] [INFO] Config: startRow=2, endRow=2, dryRun=false
[12:34:56.890] [ OK ] Connected to Chrome
[12:34:57.001] [DATA] Cell D2 = "John A. Smith"
[12:34:57.102] [DATA] Cell F2 = "john@example.com"
[12:34:57.203] [STEP] Step 2: Filling Basics form for John Smith
...
```

If a step fails, the error message and completed steps are printed so you know exactly where it stopped.

## Configuration

Edit `config.js` to change:
- Column mappings (D, F, O)
- Contract start date
- Delay timings
- Wage type (Fixed / Hourly)

## Troubleshooting

**"No tab found matching..."** -- Make sure both the Google Sheet and Gusto tabs are open in the Chrome instance launched with `--remote-debugging-port=9222`.

**"connect ECONNREFUSED"** -- Chrome isn't running with the debug port. Close Chrome fully and relaunch with the command above.

**Selectors not matching** -- Gusto may update their UI. Check the browser console or adjust selectors in `src/gusto.js`.
