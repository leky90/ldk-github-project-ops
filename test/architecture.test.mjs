import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("package exposes the same v0.2.0 plugin for Codex and Claude Code", async () => {
  const codex = JSON.parse(await readFile(join(root, ".codex-plugin", "plugin.json"), "utf8"));
  const claude = JSON.parse(await readFile(join(root, ".claude-plugin", "plugin.json"), "utf8"));
  const marketplace = JSON.parse(await readFile(join(root, ".claude-plugin", "marketplace.json"), "utf8"));
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(packageJson.version, "0.2.0");
  assert.equal(codex.name, "ldk-github-project-ops");
  assert.equal(codex.version.split("+")[0], packageJson.version);
  assert.equal(claude.version, packageJson.version);
  assert.equal(marketplace.plugins[0].version, packageJson.version);
  assert.equal(marketplace.plugins[0].source, "./");
});

test("plugin has four GitHub role workflow skills without placeholders", async () => {
  const skillsRoot = join(root, "skills");
  const skills = (await readdir(skillsRoot)).sort();
  assert.deepEqual(skills, ["github-create-work", "github-do-issue", "github-project-status", "github-reconcile"]);
  for (const skill of skills) {
    const body = await readFile(join(skillsRoot, skill, "SKILL.md"), "utf8");
    assert.doesNotMatch(body, /TODO|\[TODO:/u);
    await stat(join(skillsRoot, skill, "agents", "openai.yaml"));
  }
});

test("source has deterministic workflow assets and no daemon or database", async () => {
  const required = [
    "schemas/project-binding.schema.json",
    "schemas/work-plan.schema.json",
    "schemas/project-result.schema.json",
    "schemas/handoff.schema.json",
    "schemas/project-update.schema.json",
    "scripts/project-lifecycle.mjs",
    "scripts/project-result.mjs",
    "scripts/validate-project-result.mjs",
    "scripts/build-project-report.mjs",
    "scripts/work-lock.mjs",
    "scripts/git-delivery-state.mjs",
    "references/github-native-model.md",
    "references/delivery-lifecycle.md",
    "references/project-setup.md",
    "references/tracker-routing.md",
    "hooks/hooks.json",
  ];
  for (const path of required) await stat(join(root, path));
  const files = await listFiles(root);
  assert.equal(files.some((path) => /sqlite|daemon|claim-db/iu.test(path)), false);
  assert.equal(files.includes(".github-project-ops.json"), false);
});

test("source contains no credential-like values", async () => {
  for (const path of await listFiles(root)) {
    if (path.startsWith(".git/") || path.startsWith(".codegraph/") || path.startsWith("node_modules/") || path.startsWith(".github-ops/")) continue;
    const data = await readFile(join(root, path));
    if (data.includes(0)) continue;
    const text = data.toString("utf8");
    assert.doesNotMatch(text, /\bgh[opsu]_[A-Za-z0-9_]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/u, path);
  }
});

async function listFiles(directory, prefix = "") {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      output.push(...await listFiles(join(directory, entry.name), path));
    }
    else if (entry.isFile()) output.push(path);
  }
  return output;
}
