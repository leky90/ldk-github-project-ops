#!/usr/bin/env node
import { readJson, validateProjectUpdate } from "./lib.mjs";

if (process.argv.length !== 3) {
  process.stderr.write("Usage: render-project-update.mjs <update.json>\n");
  process.exit(2);
}
try {
  const update = await readJson(process.argv[2]);
  const errors = validateProjectUpdate(update);
  if (errors.length) throw new Error(errors.join("\n"));
  const lines = [
    `## ${update.status} · ${update.summary}`,
    "", "### Progress", "", ...update.progress.map((item) => `- ${item}`),
    "", "### Risks", "", ...(update.risks?.length ? update.risks.map((item) => `- ${item}`) : ["- No observed risk recorded."]),
    "", "### Evidence", "", ...update.evidence.map((item) => `- [${item.label}](${item.url})`),
    "", "### Next", "", ...update.nextActions.map((item) => `- ${item}`), "",
  ];
  process.stdout.write(lines.join("\n"));
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}
