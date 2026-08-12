#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { captureGitBaseline } from "./git-delivery-state.mjs";

if (process.argv.length !== 5) {
  process.stderr.write("Usage: capture-git-baseline.mjs <worktree> <owner/repo#issue> <output.json>\n");
  process.exit(2);
}
try {
  const baseline = await captureGitBaseline(process.argv[2], process.argv[3]);
  await writeFile(process.argv[4], `${JSON.stringify(baseline, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  process.stdout.write(`${process.argv[4]}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}
