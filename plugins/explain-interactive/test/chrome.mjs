// Shared by the browser tests: whether to skip them, said out loud so a missing browser isn't missed.
import { findChrome } from "../skills/explain-interactive/cdp.mjs";

export const skip = findChrome() ? false : "no Chrome/Chromium found (set CHROME=/path/to/chrome)";

if (skip) {
  // CI installs Chrome on purpose; skipping there would hide a broken setup.
  if (process.env.CI) throw new Error(`browser tests can't run in CI: ${skip}`);
  console.warn(`\n*** browser tests skipped: ${skip} ***\n`);
}
