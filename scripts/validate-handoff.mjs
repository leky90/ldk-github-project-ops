#!/usr/bin/env node
import { readJson, validateHandoff } from "./lib.mjs";

if (process.argv.length !== 3) {
  process.stderr.write("Usage: validate-handoff.mjs <handoff.json>\n");
  process.exit(2);
}
try {
  const errors = validateHandoff(await readJson(process.argv[2]));
  if (errors.length) throw new Error(errors.join("\n"));
  process.stdout.write("Handoff is valid.\n");
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}
