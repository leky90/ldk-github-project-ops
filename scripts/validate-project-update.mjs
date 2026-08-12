#!/usr/bin/env node
import { readJson, validateProjectUpdate } from "./lib.mjs";

const args = process.argv.slice(2);
const publish = args.includes("--publish");
const files = args.filter((arg) => arg !== "--publish");
if (files.length !== 1) {
  process.stderr.write("Usage: validate-project-update.mjs [--publish] <update.json>\n");
  process.exit(2);
}
try {
  const errors = validateProjectUpdate(await readJson(files[0]), { forPublish: publish });
  if (errors.length) throw new Error(errors.join("\n"));
  process.stdout.write(`Project update is valid for ${publish ? "publish" : "preview"}.\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}
