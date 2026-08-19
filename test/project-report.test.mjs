import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildProjectReport } from "../scripts/build-project-report.mjs";
import { validateHandoff } from "../scripts/lib.mjs";
import {
  deriveLogicalIssueState,
  normalizeProjectSnapshot,
} from "../scripts/project-snapshot.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function fixture(name) {
  return JSON.parse(await readFile(join(root, "tests", "fixtures", name), "utf8"));
}

test("logical item state uses a fresh validated handoff and exposes unknown states", async () => {
  const handoff = await fixture("valid-handoff-v2.json");
  assert.deepEqual(deriveLogicalIssueState({
    key: "octo-org/product#123",
    status: "In Review",
    updatedAt: handoff.observedState.issueUpdatedAt,
    latestHandoff: handoff,
  }), { state: "ready-to-deliver", source: "handoff", handoffStale: false });

  assert.deepEqual(deriveLogicalIssueState({ status: "Custom Quality Gate" }), {
    state: "unknown",
    source: "unknown",
    handoffStale: false,
  });
});

test("post-mutation appliedState keeps a handoff fresh after the run's own writes", async () => {
  const handoff = await fixture("valid-handoff-v2.json");
  handoff.appliedState = { issueUpdatedAt: "2026-08-18T10:05:00.000Z", status: "In Review" };
  assert.equal(validateHandoff(handoff).length, 0);
  assert.deepEqual(deriveLogicalIssueState({
    key: "octo-org/product#123",
    status: "In Review",
    updatedAt: "2026-08-18T10:05:00.000Z",
    latestHandoff: handoff,
  }), { state: "ready-to-deliver", source: "handoff", handoffStale: false });

  const stale = await fixture("valid-handoff-v2.json");
  const derived = deriveLogicalIssueState({
    key: "octo-org/product#123",
    status: "In Review",
    updatedAt: "2026-08-18T10:05:00.000Z",
    latestHandoff: stale,
  });
  assert.equal(derived.source, "physical");
  assert.equal(derived.handoffStale, true);
});

test("workspace state maps and stock names normalize instead of degrading to unknown", async () => {
  const snapshot = await fixture("project-snapshot.json");
  snapshot.workflow = { states: { "Quality Gate": "in-review" } };
  snapshot.items = [
    { id: "PVTI_a", title: "Custom state work", status: "Quality Gate", priority: "high", role: "qa", repository: "example-org/product", contentState: "OPEN" },
    { id: "PVTI_b", title: "Stock todo work", status: "Todo", priority: "normal", role: "tech-lead", repository: "example-org/product", contentState: "OPEN" },
    { id: "PVTI_c", title: "Stock backlog work", status: "Backlog", priority: "low", role: "tech-lead", repository: "example-org/product", contentState: "OPEN" },
  ];
  const normalized = normalizeProjectSnapshot(snapshot);
  assert.equal(normalized.issues[0].logicalState, "in-review");
  assert.equal(normalized.issues[1].logicalState, "ready");
  assert.equal(normalized.issues[2].logicalState, "refinement");
});

test("report exposes logical delivery queues, diagnostics, PR risk, and at most five actions", async () => {
  const snapshot = await fixture("project-snapshot.json");
  const review = await fixture("valid-handoff-v2.json");
  snapshot.items[1].key = "octo-org/product#123";
  snapshot.items[1].updatedAt = review.observedState.issueUpdatedAt;
  snapshot.items[1].latestHandoff = review;
  snapshot.items[2].status = "Custom Quality Gate";
  snapshot.items[0].prioritySource = "policy-default";
  snapshot.items[1].pullRequest.isDraft = true;

  const report = buildProjectReport(snapshot);
  for (const heading of [
    "Ready to Deliver",
    "Delivery Verification",
    "Unknown state diagnostics",
    "Stale handoffs",
    "Terminal mismatches",
    "PR risk",
  ]) assert.match(report, new RegExp(heading, "u"));
  assert.match(report, /policy-default/u);
  assert.match(report, /Custom Quality Gate/u);
  const actions = report.split("## Hành động tiếp theo")[1]
    .split("\n")
    .filter((line) => line.startsWith("- "));
  assert.ok(actions.length <= 5, `expected at most five actions, received ${actions.length}`);
});

test("physical Done without terminal evidence is a mismatch, not verified completion", async () => {
  const snapshot = await fixture("project-snapshot.json");
  const report = buildProjectReport(snapshot);
  assert.match(report, /0\/4 items Done \(0%\)/u);
  assert.match(report, /Terminal mismatch/u);

  const doneItem = snapshot.items.find((item) => item.status === "Done");
  doneItem.terminalVerified = true;
  const verified = buildProjectReport(snapshot);
  assert.match(verified, /1\/4 items Done \(25%\)/u);
});

test("terminal items never sit in the blocker queue and closed blockers resolve", async () => {
  const snapshot = await fixture("project-snapshot.json");
  snapshot.items = [
    { id: "PVTI_d", key: "done.blocked", title: "Done with old blocker", status: "Done", terminalVerified: true, priority: "high", role: "tech-lead", repository: "example-org/product", contentState: "CLOSED", blockedBy: [{ key: "open.dep", state: "OPEN" }] },
    { id: "PVTI_e", key: "open.dep", title: "Open dependency", status: "In Progress", priority: "normal", role: "tech-lead", repository: "example-org/product", contentState: "OPEN" },
    { id: "PVTI_f", key: "task.unblocked", title: "Blocked only by closed work", status: "Ready", priority: "normal", role: "tech-lead", repository: "example-org/product", contentState: "OPEN", blockedBy: [{ key: "closed.dep", state: "CLOSED" }] },
  ];
  const report = buildProjectReport(snapshot);
  assert.doesNotMatch(report, /Blocked: .*Done with old blocker/u);
  assert.match(report, /Ready 1;/u);
});

test("Projects v2 node ids do not shadow the issue key for handoff matching", async () => {
  const handoff = await fixture("valid-handoff-v2.json");
  const derived = deriveLogicalIssueState({
    id: "PVTI_2",
    key: "octo-org/product#123",
    status: "In Review",
    updatedAt: handoff.observedState.issueUpdatedAt,
    latestHandoff: handoff,
  });
  assert.deepEqual(derived, { state: "ready-to-deliver", source: "handoff", handoffStale: false });
});

test("lifecycle analysis follows the logical axis of the same report", async () => {
  const snapshot = await fixture("project-snapshot.json");
  snapshot.project.closed = true;
  // items marked Done on the board while their Issues are still OPEN: the
  // report counts 0 verified Done and lifecycle must keep treating them as
  // open work under a closed Project
  snapshot.items = snapshot.items.map((item) => ({ ...item, status: "Done", contentState: "OPEN" }));
  const report = buildProjectReport(snapshot);
  assert.match(report, /0\/4 items Done \(0%\)/u);
  assert.doesNotMatch(report, /Consistency: \*\*Nhất quán\*\*/u, "board-Done with open content must not read as a consistent closed project");
});
