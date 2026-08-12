#!/usr/bin/env node
import { readJson, validateProjectBinding, validateWorkPlan } from "./lib.mjs";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const files = args.filter((arg) => arg !== "--apply");
if (files.length < 1 || files.length > 2) {
  process.stderr.write("Usage: validate-work-plan.mjs [--apply] <plan.json> [binding.json]\n");
  process.exit(2);
}
try {
  const plan = await readJson(files[0]);
  const binding = files[1] ? await readJson(files[1]) : undefined;
  const errors = [...(binding ? validateProjectBinding(binding) : []), ...validateWorkPlan(plan, { binding, forApply: apply })];
  if (errors.length) throw new Error(errors.join("\n"));
  process.stdout.write(`Work plan is valid for ${apply ? "apply" : "preview"}.\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}
