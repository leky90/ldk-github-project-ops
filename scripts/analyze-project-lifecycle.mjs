#!/usr/bin/env node
import { readJson } from "./lib.mjs";
import { analyzeProjectLifecycle } from "./project-lifecycle.mjs";

if (process.argv.length !== 3) {
  process.stderr.write("Usage: analyze-project-lifecycle.mjs <snapshot.json>\n");
  process.exit(2);
}
try {
  process.stdout.write(`${JSON.stringify(analyzeProjectLifecycle(await readJson(process.argv[2])), null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}
