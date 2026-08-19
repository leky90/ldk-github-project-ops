#!/usr/bin/env node
import { readJson } from "./lib.mjs";
import { validateProjectResult } from "./project-result.mjs";

const files = process.argv.slice(2);
if (files.length < 2 || files.length > 3) {
  process.stderr.write("Usage: validate-project-result.mjs <plan.json> <result.json> [binding.json]\n");
  process.exit(2);
}

try {
  const plan = await readJson(files[0]);
  const result = await readJson(files[1]);
  const binding = files[2] ? await readJson(files[2]) : undefined;
  const errors = validateProjectResult(plan, result, { binding });
  process.stdout.write(`${JSON.stringify({ valid: errors.length === 0, errors }, null, 2)}\n`);
  if (errors.length) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}
