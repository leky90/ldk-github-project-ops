#!/usr/bin/env node
import { stableKey } from "./lib.mjs";

if (process.argv.length < 3) {
  process.stderr.write("Usage: stable-key.mjs <part> [part...]\n");
  process.exit(2);
}
process.stdout.write(`${stableKey(process.argv.slice(2))}\n`);
