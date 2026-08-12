#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { readJson } from "./lib.mjs";
import { analyzeProjectLifecycle, resolveProjectLifecycle } from "./project-lifecycle.mjs";

const PRIORITY = new Map([["urgent", 0], ["high", 1], ["normal", 2], ["low", 3], ["none", 4]]);
const RESULT_LABEL = Object.freeze({ consistent: "Nhất quán", mismatch: "Bất nhất", advisory: "Cần chú ý" });

export function buildProjectReport(snapshot) {
  if (!snapshot?.project?.id || !snapshot?.project?.title) throw new Error("snapshot.project.id and title are required");
  const asOf = new Date(snapshot.asOf ?? Date.now());
  if (Number.isNaN(asOf.valueOf())) throw new Error("snapshot.asOf is invalid");
  const items = (Array.isArray(snapshot.items) ? snapshot.items : []).filter((item) => !["Canceled", "Cancelled"].includes(item.status));
  const lifecycle = analyzeProjectLifecycle(snapshot);
  const resolved = resolveProjectLifecycle(snapshot);
  const byStatus = (status) => items.filter((item) => item.status === status);
  const done = byStatus("Done");
  const estimated = items.filter((item) => typeof item.estimate === "number");
  const totalEffort = estimated.reduce((sum, item) => sum + item.estimate, 0);
  const doneEffort = estimated.filter((item) => item.status === "Done").reduce((sum, item) => sum + item.estimate, 0);
  const percent = items.length ? Math.round((done.length / items.length) * 100) : 0;
  const effortPercent = totalEffort ? Math.round((doneEffort / totalEffort) * 100) : null;
  const roles = [...new Set(items.map((item) => item.role).filter(Boolean))].sort();
  const ready = byStatus("Ready").filter((item) => !(item.blockedBy ?? []).some((blocker) => blocker.state !== "CLOSED"));
  const active = byStatus("In Progress");
  const review = byStatus("In Review");
  const delivery = byStatus("Ready to Deliver");
  const verification = byStatus("Delivery Verification");
  const blocked = byStatus("Blocked");
  const milestones = Array.isArray(snapshot.milestones) ? snapshot.milestones : [];
  const prProblems = items.filter((item) => item.pullRequest && (item.pullRequest.isDraft || item.pullRequest.requiredChecks === "failing" || item.pullRequest.reviewDecision === "CHANGES_REQUESTED" || item.pullRequest.reviewedSha !== item.pullRequest.headSha));
  const queue = (list) => list.slice().sort((a, b) => (PRIORITY.get(a.priority ?? "none") ?? 4) - (PRIORITY.get(b.priority ?? "none") ?? 4)).map((item) => `- ${link(item.title, item.url)} — ${item.repository ?? "unknown repo"}; ${item.priority ?? "none"}; role ${item.role ?? "chưa gán"}.`);
  const milestoneLines = milestones.map((milestone) => {
    const scoped = items.filter((item) => item.milestone === milestone.title && item.repository === milestone.repository);
    return `- ${link(milestone.title, milestone.url)} — ${scoped.filter((item) => item.status === "Done").length}/${scoped.length} Done${milestone.dueOn ? `; due ${milestone.dueOn}` : ""}.`;
  });

  return [
    `# GitHub Project status — ${snapshot.project.title}`,
    "", `Data timestamp: ${asOf.toISOString()}`, `Project: ${link(snapshot.project.title, snapshot.project.url)} (${snapshot.project.id})`,
    "", "## Project lifecycle", "",
    `- Project state: **${resolved.state}**; latest native status update: **${resolved.health ?? "none"}**; mode: **${resolved.lifecycleMode}**.`,
    `- Consistency: **${RESULT_LABEL[lifecycle.consistency] ?? lifecycle.consistency}** — ${lifecycle.message}`,
    `- Evidence: ${lifecycle.evidence.length ? lifecycle.evidence.join("; ") : "no execution evidence"}.`,
    ...(lifecycle.recommendedAction ? [`- Recommendation: ${lifecycle.recommendedAction}`] : []),
    "", "## Progress", "",
    `- ${done.length}/${items.length} items Done (${percent}%).`,
    `- ${effortPercent === null ? "No estimate denominator" : `${doneEffort}/${totalEffort} estimated effort Done (${effortPercent}%)`}.`,
    `- Ready ${ready.length}; In Progress ${active.length}; In Review ${review.length}; Ready to Deliver ${delivery.length}; Delivery Verification ${verification.length}; Blocked ${blocked.length}.`,
    "", "## Milestones", "", ...(milestoneLines.length ? milestoneLines : ["- No repository milestone data."]),
    "", "## Role queues", "", ...(roles.length ? roles.map((role) => `- **${role}:** ${ready.filter((item) => item.role === role).length} Ready, ${active.filter((item) => item.role === role).length} active, ${review.filter((item) => item.role === role).length} review, ${delivery.filter((item) => item.role === role).length} ready to deliver.`) : ["- No role field values found."]),
    "", "## Ready", "", ...(queue(ready).length ? queue(ready) : ["- No unblocked Ready items."]),
    "", "## Review and delivery", "", ...(queue([...review, ...delivery, ...verification]).length ? queue([...review, ...delivery, ...verification]) : ["- No review or delivery items."]),
    "", "## Blockers and PR risks", "", ...(blocked.length ? queue(blocked) : ["- No blocked items."]), ...(prProblems.length ? prProblems.map((item) => `- PR risk: ${link(item.title, item.pullRequest.url ?? item.url)} — draft, stale review, failing checks, or changes requested.`) : ["- No observed PR delivery mismatch."]),
    "", "## Next actions", "",
    ...(lifecycle.recommendedAction ? [`1. ${lifecycle.recommendedAction}`] : []),
    ...(review.length ? [`${lifecycle.recommendedAction ? 2 : 1}. Reviewer roles process ${review.length} In Review item(s).`] : []),
    ...(delivery.length ? [`${lifecycle.recommendedAction || review.length ? 2 + Number(Boolean(review.length)) : 1}. Authorized delivery owners process ${delivery.length} Ready to Deliver item(s).`] : []),
    ...(!lifecycle.recommendedAction && !review.length && !delivery.length && ready.length ? [`1. Start the highest-priority unblocked Ready item.`] : []),
    ...(!lifecycle.recommendedAction && !review.length && !delivery.length && !ready.length ? ["1. Resolve blockers or let the CPO define the next outcome."] : []),
    "",
  ].join("\n");
}

function link(label, url) {
  return url ? `[${label}](${url})` : label;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) {
    process.stderr.write("Usage: build-project-report.mjs <snapshot.json>\n");
    process.exit(2);
  }
  try {
    process.stdout.write(`${buildProjectReport(await readJson(process.argv[2]))}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}
