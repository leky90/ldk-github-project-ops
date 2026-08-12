#!/usr/bin/env node
import { readJson } from "./lib.mjs";
import { validateGitDelivery } from "./git-delivery-state.mjs";

if (process.argv.length !== 4) {
  process.stderr.write("Usage: validate-git-delivery.mjs <baseline.json> <scope-paths.json>\n");
  process.exit(2);
}
try {
  const errors = await validateGitDelivery(await readJson(process.argv[2]), await readJson(process.argv[3]));
  if (errors.length) throw new Error(errors.join("\n"));
  process.stdout.write("Git delivery is valid.\n");
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}
