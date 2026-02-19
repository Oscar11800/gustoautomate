#!/usr/bin/env bash
#
# Launches a separate Chrome instance for automation.
# Uses its own profile directory so your real Chrome data is never touched.
# Your normal Chrome can stay open while this runs.

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT=9222
PROFILE_DIR="$HOME/.gustoautomate-chrome-profile"

if ! [ -f "$CHROME" ]; then
  echo "ERROR: Chrome not found at $CHROME"
  exit 1
fi

if lsof -i ":$PORT" &>/dev/null; then
  echo "Port $PORT is already in use. A debug Chrome instance may already be running."
  echo "Connect to it at http://127.0.0.1:$PORT"
  exit 0
fi

echo "Launching Chrome with dedicated automation profile..."
echo "  Profile dir: $PROFILE_DIR"
echo "  Debug port:  $PORT"
echo ""
echo "This is a separate Chrome instance — your normal Chrome is not affected."
echo "Log into Google Sheets and Gusto in this window, then run the script."
echo ""

"$CHROME" \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE_DIR" \
  --no-first-run \
  --no-default-browser-check \
  --disable-default-apps \
  "$@"
