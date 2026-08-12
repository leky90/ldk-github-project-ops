#!/usr/bin/env node
import { readJson, validateProjectBinding } from "./lib.mjs";

if (process.argv.length !== 3) {
  process.stderr.write("Usage: validate-project-binding.mjs <binding.json>\n");
  process.exit(2);
}
try {
  const errors = validateProjectBinding(await readJson(process.argv[2]));
  if (errors.length) throw new Error(errors.join("\n"));
  process.stdout.write("Project binding is valid.\n");
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}
