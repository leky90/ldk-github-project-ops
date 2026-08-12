#!/usr/bin/env node
import { readJson, renderHandoff, validateHandoff } from "./lib.mjs";

if (process.argv.length !== 3) {
  process.stderr.write("Usage: render-work-comment.mjs <handoff.json>\n");
  process.exit(2);
}
try {
  const handoff = await readJson(process.argv[2]);
  const errors = validateHandoff(handoff);
  if (errors.length) throw new Error(errors.join("\n"));
  process.stdout.write(renderHandoff(handoff));
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}
