import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildProjectReport } from "../scripts/build-project-report.mjs";
import { captureGitBaseline, validateGitBaseline } from "../scripts/git-delivery-state.mjs";
import { analyzeProjectLifecycle, resolveProjectLifecycle } from "../scripts/project-lifecycle.mjs";
import { validateProjectResult } from "../scripts/project-result.mjs";
import { readJson, stableKey, validateHandoff, validateProjectBinding, validateProjectUpdate, validateWorkPlan } from "../scripts/lib.mjs";
import { renderLegacyHandoff } from "../scripts/legacy-lib.mjs";

const exec = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = (name) => join(root, "tests", "fixtures", name);

test("stable key is deterministic", () => {
  assert.equal(stableKey("Example Product", "Public Launch"), "example-product.public-launch");
  assert.equal(stableKey("Lưu giữ", "Kỉ niệm"), "luu-giu.ki-niem");
});

test("binding validates exact Project and repository boundary", async () => {
  const binding = await readJson(fixture("valid-project-binding.json"));
  assert.deepEqual(validateProjectBinding(binding), []);
  binding.github.repositories.push("invalid");
  assert.match(validateProjectBinding(binding).join("\n"), /repositories\[1\] is invalid/u);
  binding.github.repositories[1] = "example-org/other";
  binding.token = ["github", "pat", "abcdefghijklmnopqrstuvwxyz123456"].join("_");
  assert.match(validateProjectBinding(binding).join("\n"), /secret-like/u);
});

test("work plan validates hierarchy, repositories, references, and dependency DAG", async () => {
  const binding = await readJson(fixture("valid-project-binding.json"));
  const plan = await readJson(fixture("valid-work-plan.json"));
  assert.deepEqual(validateWorkPlan(plan, { binding }), []);
  assert.match(validateWorkPlan(plan, { binding, forApply: true }).join("\n"), /migration.*v4.*required/u);
  plan.mode = "apply";
  plan.setup.mode = "ensure";
  plan.issues[1].blockedByKeys = ["product.analytics-decision"];
  plan.issues[2].blockedByKeys = ["product.implementation"];
  assert.match(validateWorkPlan(plan, { binding }).join("\n"), /dependency cycle/u);
  plan.issues[2].blockedByKeys = [];
  plan.issues[1].repository = "other-org/other-repo";
  assert.match(validateWorkPlan(plan, { binding }).join("\n"), /outside the binding/u);
});

test("schema-v2 planning requires standard dynamic views and complete sub-issue coverage", async () => {
  const plan = await readJson(fixture("valid-work-plan.json"));
  assert.deepEqual(validateWorkPlan(plan), []);
  plan.views = plan.views.filter((view) => view.name !== "Decisions");
  assert.match(validateWorkPlan(plan).join("\n"), /views must include Decisions/u);
  plan.views.push({ name: "Decisions", layout: "table", filter: "label:kind:decision", visibleFields: ["title"] });
  plan.issues[1].parentKey = undefined;
  assert.match(validateWorkPlan(plan).join("\n"), /must have parentKey/u);
  plan.issues[1].parentKey = "product.launch";
  plan.issues = plan.issues.filter((issue) => issue.kind !== "task" && issue.kind !== "decision");
  plan.coverage = [{ requirement: "Launch scope", issueKeys: ["product.launch"] }];
  assert.match(validateWorkPlan(plan).join("\n"), /outcome must have at least one direct sub-issue/u);
});

test("schema-v2 coverage maps every planned issue", async () => {
  const plan = await readJson(fixture("valid-work-plan.json"));
  plan.coverage[1].issueKeys = [];
  assert.match(validateWorkPlan(plan).join("\n"), /coverage must reference issue key product\.analytics-decision/u);
});

test("lightweight estimation sizes children without double-counting parent outcomes", async () => {
  const plan = await readJson(fixture("valid-work-plan.json"));
  assert.deepEqual(validateWorkPlan(plan), []);
  plan.issues[0].estimate = 8;
  assert.match(validateWorkPlan(plan).join("\n"), /omitted for an outcome/u);
  delete plan.issues[0].estimate;
  delete plan.issues[2].estimateReason;
  assert.match(validateWorkPlan(plan).join("\n"), /estimateReason/u);
  plan.issues[2].estimate = 4;
  assert.match(validateWorkPlan(plan).join("\n"), /one of 1, 2, 3, 5, 8, 13/u);
});

test("postflight result must match setup, views, hierarchy, fields, and relations", async () => {
  const binding = await readJson(fixture("valid-project-binding.json"));
  const plan = await readJson(fixture("valid-work-plan.json"));
  plan.mode = "apply";
  plan.setup.mode = "ensure";
  const result = {
    schemaVersion: 1,
    capturedAt: "2026-08-12T12:00:00Z",
    project: { owner: plan.project.owner, number: plan.project.number, linkedRepositories: binding.github.repositories },
    fields: plan.setup.requiredFields,
    views: plan.views,
    workflows: plan.setup.workflows.map(({ name, state }) => ({ name, state })),
    issues: plan.issues.map((issue, index) => ({
      key: issue.key,
      url: `https://github.com/${issue.repository}/issues/${index + 1}`,
      repository: issue.repository,
      title: issue.title,
      kind: issue.kind,
      status: issue.status,
      role: issue.role,
      priority: issue.priority,
      estimate: issue.estimate,
      parentKey: issue.parentKey,
      milestoneKey: issue.milestoneKey,
      blockedByKeys: issue.blockedByKeys ?? [],
      relatedKeys: issue.relatedKeys ?? [],
    })),
    capabilityGaps: [],
  };
  assert.deepEqual(validateProjectResult(plan, result, { binding }), []);
  result.views = result.views.filter((view) => view.name !== "Delivery board");
  assert.match(validateProjectResult(plan, result, { binding }).join("\n"), /result\.views is missing Delivery board/u);
  result.views = plan.views;
  result.issues[1].parentKey = undefined;
  assert.match(validateProjectResult(plan, result, { binding }).join("\n"), /parentKey does not match plan/u);
  result.issues[1].parentKey = plan.issues[1].parentKey;
  result.capabilityGaps = ["saved view mutation unavailable"];
  assert.match(validateProjectResult(plan, result, { binding }).join("\n"), /unresolved capability gaps/u);
});

test("handoff requires terminal delivery evidence before Done", async () => {
  const handoff = await readJson(fixture("valid-handoff.json"));
  assert.deepEqual(validateHandoff(handoff), []);
  assert.match(renderLegacyHandoff(handoff), /Handoff · software-engineer → qa/u);
  handoff.next.status = "Done";
  assert.match(validateHandoff(handoff).join("\n"), /terminal delivery\.phase/u);
  handoff.delivery.phase = "terminal";
  assert.deepEqual(validateHandoff(handoff), []);
});

test("Project update requires explicit publish mode", async () => {
  const update = await readJson(fixture("valid-project-update.json"));
  assert.deepEqual(validateProjectUpdate(update), []);
  assert.match(validateProjectUpdate(update, { forPublish: true }).join("\n"), /mode must be publish/u);
  update.mode = "publish";
  assert.deepEqual(validateProjectUpdate(update, { forPublish: true }), []);
});

test("lifecycle detects closed or complete Project with open work", async () => {
  const snapshot = await readJson(fixture("project-snapshot.json"));
  snapshot.project.closed = true;
  assert.equal(analyzeProjectLifecycle(snapshot).code, "closed-with-open-work");
  snapshot.project.closed = false;
  snapshot.project.latestStatusUpdate.status = "COMPLETE";
  assert.equal(analyzeProjectLifecycle(snapshot).code, "complete-with-open-work");
});

test("inactive Project with active work requires resume decision", async () => {
  const snapshot = await readJson(fixture("project-snapshot.json"));
  snapshot.project.latestStatusUpdate.status = "INACTIVE";
  const result = analyzeProjectLifecycle(snapshot);
  assert.equal(result.code, "inactive-with-active-work");
  assert.equal(result.requiresDecision, true);
});

test("continuous empty Project stays open and does not auto-complete", async () => {
  const snapshot = await readJson(fixture("project-snapshot.json"));
  snapshot.items.forEach((item) => { item.status = "Done"; item.contentState = "CLOSED"; });
  snapshot.project.latestStatusUpdate.status = "ON_TRACK";
  const result = analyzeProjectLifecycle(snapshot);
  assert.equal(result.code, "continuous-needs-outcome");
  assert.match(result.recommendedAction, /do not auto-close or publish COMPLETE/u);
});

test("Project health normalization preserves native status update values", async () => {
  const snapshot = await readJson(fixture("project-snapshot.json"));
  snapshot.project.latestStatusUpdate.status = "at risk";
  assert.equal(resolveProjectLifecycle(snapshot).health, "AT_RISK");
});

test("Issue state and Project item Status mismatches are explicit", async () => {
  const snapshot = await readJson(fixture("project-snapshot.json"));
  snapshot.items[0].contentState = "CLOSED";
  assert.equal(analyzeProjectLifecycle(snapshot).code, "item-content-state-mismatch");
  snapshot.items[0].contentState = "OPEN";
  snapshot.items[0].status = "Done";
  assert.equal(analyzeProjectLifecycle(snapshot).code, "item-content-state-mismatch");
});

test("project report shows queues, milestones, PR delivery, and lifecycle", async () => {
  const report = buildProjectReport(await readJson(fixture("project-snapshot.json")));
  assert.match(report, /0\/4 items Done \(0%\)/u);
  assert.match(report, /Terminal mismatch/u);
  assert.match(report, /Project state: \*\*open\*\*; latest native status update: \*\*AT_RISK\*\*/u);
  assert.match(report, /Public launch.*0\/4 Done/u);
  assert.match(report, /qa:\*\* 0 Ready, 0 active, 1 review, 0 ready to deliver/u);
  assert.doesNotMatch(report, /\bclaim token\b|\bheartbeat\b|\.github-ops/iu);
});

test("hook routes create, issue execution, status, and reconciliation", async () => {
  const repo = await mkdtemp(join(tmpdir(), "github-project-hook-"));
  await writeFile(join(repo, ".github-project-ops.json"), await readFile(fixture("valid-project-binding.json")));
  const hook = join(root, "scripts", "hook-entry.mjs");
  const run = (prompt) => runProcess(process.execPath, [hook, "UserPromptSubmit"], JSON.stringify({ cwd: repo, prompt }));
  assert.match(await run("Hãy tạo milestone và các issues cho launch"), /\$github-create-work/u);
  assert.match(await run("Hãy thực hiện issue example-org\/product#42"), /\$github-do-issue/u);
  assert.match(await run("Hãy báo cáo Project status và health"), /\$github-project-status/u);
  assert.match(await run("Hãy reconcile resolved blocker"), /\$github-reconcile/u);
  assert.match(await run("Hãy breakdown backlog thành sub-issues, estimate nhẹ và tạo các views chuẩn"), /\$github-create-work.*standard saved views/u);
});

test("hook arbitrates GitHub and Linear without dual-routing generic work", async () => {
  const repo = await mkdtemp(join(tmpdir(), "github-project-router-"));
  await writeFile(join(repo, ".github-project-ops.json"), await readFile(fixture("valid-project-binding.json")));
  await writeFile(join(repo, ".linear-project-ops.json"), JSON.stringify({ project: { linearProjectId: "linear-project", linearTeamId: "linear-team" } }));
  const hook = join(root, "scripts", "hook-entry.mjs");
  const run = (prompt) => runProcess(process.execPath, [hook, "UserPromptSubmit"], JSON.stringify({ cwd: repo, prompt }));
  assert.match(await run("Hãy tạo issues cho roadmap"), /project-ops-router.*ambiguous/su);
  assert.doesNotMatch(await run("Hãy tạo issues cho roadmap"), /\$github-create-work/u);
  assert.match(await run("Hãy tạo GitHub issues và sub-issues cho roadmap"), /\$github-create-work/u);
  assert.equal(await run("Hãy tạo Linear issues cho roadmap"), "");
  assert.match(await run("Đồng bộ Linear ABC-123 với GitHub example-org\/product#42"), /project-ops-router.*cross-tracker/su);
});

test("explicit GitHub planning request bootstraps safely without a binding", async () => {
  const repo = await mkdtemp(join(tmpdir(), "github-project-unbound-"));
  const hook = join(root, "scripts", "hook-entry.mjs");
  const output = await runProcess(process.execPath, [hook, "UserPromptSubmit"], JSON.stringify({ cwd: repo, prompt: "Tạo GitHub Project issues và views chuẩn" }));
  assert.match(output, /binding="missing".*read-only GitHub target discovery/su);
});

test("Git baseline capture requires worktree isolation and validates its record", async () => {
  const repo = await mkdtemp(join(tmpdir(), "github-delivery-"));
  await exec("git", ["init", "-q", repo]);
  await exec("git", ["-C", repo, "config", "user.email", "test@example.com"]);
  await exec("git", ["-C", repo, "config", "user.name", "Test"]);
  await writeFile(join(repo, "README.md"), "base\n");
  await exec("git", ["-C", repo, "add", "README.md"]);
  await exec("git", ["-C", repo, "commit", "-qm", "base"]);

  await assert.rejects(captureGitBaseline({ repository: repo, issueId: "example-org/product#42" }), /worktree/u);

  const linked = join(repo, ".worktrees", "issue-42");
  await exec("git", ["-C", repo, "worktree", "add", "-q", linked, "-b", "issue-42-launch"]);
  const baseline = await captureGitBaseline({ repository: linked, issueId: "example-org/product#42" });
  assert.deepEqual(validateGitBaseline(baseline), []);
  assert.equal(baseline.issueId, "example-org/product#42");
});

function runProcess(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || `process exited ${code}`)));
    child.stdin.end(input);
  });
}
