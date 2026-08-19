#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { readJson } from "./lib.mjs";
import { analyzeProjectLifecycle, resolveProjectLifecycle } from "./project-lifecycle.mjs";
import { normalizeProjectSnapshot } from "./project-snapshot.mjs";

const PRIORITY = new Map([["urgent", 0], ["high", 1], ["normal", 2], ["low", 3], ["none", 4]]);
const RESULT_LABEL = Object.freeze({ consistent: "Nhất quán", mismatch: "Bất nhất", advisory: "Cần chú ý", unknown: "Không xác định" });

export function buildProjectReport(input) {
  if (!input?.project?.id || !input?.project?.title) throw new Error("snapshot.project.id and title are required");
  const snapshot = normalizeProjectSnapshot(input);
  const asOf = new Date(snapshot.asOf ?? Date.now());
  if (Number.isNaN(asOf.valueOf())) throw new Error("snapshot.asOf is invalid");
  const issues = snapshot.issues.filter((issue) => issue.logicalState !== "canceled");
  // Blocker endpoints resolve against every snapshot issue, including canceled
  // ones: a closed or canceled blocker no longer blocks anything, and terminal
  // work is never actionable as blocked.
  const allByKey = new Map(snapshot.issues.map((issue) => [issue.key ?? issue.id ?? issue.title, issue]));
  const blockerOpen = (ref) => {
    if (ref && typeof ref === "object" && ref.state !== undefined) return ref.state !== "CLOSED";
    const blocker = allByKey.get(ref?.key ?? ref);
    if (!blocker) return true;
    return blocker.logicalState !== "done" && blocker.logicalState !== "canceled" && blocker.contentState !== "CLOSED";
  };
  const done = issues.filter((issue) => issue.logicalState === "done" && issue.terminalVerified === true);
  const terminalMismatches = issues.filter((issue) => issue.logicalState === "done" && issue.terminalVerified !== true);
  const blocked = issues.filter((issue) => issue.logicalState !== "done"
    && (issue.logicalState === "blocked" || (issue.blockedBy ?? []).some(blockerOpen)));
  const byState = (state) => issues.filter((issue) => issue.logicalState === state);
  const ready = byState("ready").filter((issue) => !blocked.includes(issue));
  const active = byState("in-progress");
  const review = byState("in-review");
  const readyToDeliver = byState("ready-to-deliver");
  const deliveryVerification = byState("delivery-verification");
  const refinement = byState("refinement");
  const unknown = byState("unknown");
  const staleHandoffs = issues.filter((issue) => issue.handoffStale);
  const missingPriority = issues.filter((issue) => !issue.priority || issue.priority === "none");
  const estimated = issues.filter((issue) => typeof issue.estimate === "number");
  const totalEffort = estimated.reduce((sum, issue) => sum + issue.estimate, 0);
  const doneEffort = estimated.filter((issue) => issue.logicalState === "done" && issue.terminalVerified === true).reduce((sum, issue) => sum + issue.estimate, 0);
  const percent = issues.length ? Math.round((done.length / issues.length) * 100) : 0;
  const effortPercent = totalEffort ? Math.round((doneEffort / totalEffort) * 100) : null;
  const roles = [...new Set(issues.flatMap((issue) => [issue.role ?? issue.ownerRole, issue.reviewerRole]).filter(Boolean))].sort();
  const lifecycle = analyzeProjectLifecycle({ ...snapshot, items: snapshot.issues });
  const resolved = resolveProjectLifecycle(snapshot);
  const milestones = Array.isArray(snapshot.milestones) ? snapshot.milestones : [];
  const prProblems = issues.filter((issue) => issue.pullRequest && (issue.pullRequest.isDraft || issue.pullRequest.requiredChecks === "failing" || issue.pullRequest.reviewDecision === "CHANGES_REQUESTED" || issue.pullRequest.reviewedSha !== issue.pullRequest.headSha));

  const queue = (list, roleField = "role") => list
    .slice()
    .sort((left, right) => compareIssues(left, right, issues, asOf))
    .map((issue) => {
      const prioritySource = issue.prioritySource === "policy-default" ? "; priority source policy-default" : "";
      return `- ${link(issue.title, issue.url)} — ${issue.repository ?? "unknown repo"}; ${issue.priority ?? "none"}${prioritySource}; role ${issue[roleField] ?? issue.role ?? "chưa gán"}.`;
    });

  const milestoneLines = milestones.map((milestone) => {
    const scoped = issues.filter((issue) => issue.milestone === milestone.title && issue.repository === milestone.repository);
    const completed = scoped.filter((issue) => issue.logicalState === "done" && issue.terminalVerified === true).length;
    const atRisk = scoped.some((issue) => blocked.includes(issue));
    return `- ${link(milestone.title, milestone.url)} — ${completed}/${scoped.length} Done${milestone.dueOn ? `; due ${milestone.dueOn}` : ""}${atRisk ? "; có rủi ro" : ""}.`;
  });

  const phases = Array.isArray(snapshot.phases) ? snapshot.phases : [];
  const phaseLines = phases.map((phase) => {
    const scoped = issues.filter((issue) => issue.phaseKey === phase.key);
    const outcomes = scoped.filter((issue) => (issue.type ?? issue.kind) === "outcome").length;
    return `- ${phase.order ?? "?"}. ${phase.objective ?? phase.name ?? phase.key} — ${outcomes} outcome; ${scoped.length} issue.`;
  });

  const nextActions = buildNextActions({ issues, ready, review, readyToDeliver, deliveryVerification, lifecycle, asOf });

  return [
    `# GitHub Project status — ${snapshot.project.title}`,
    "", `Data timestamp: ${asOf.toISOString()}`, `Project: ${link(snapshot.project.title, snapshot.project.url)} (${snapshot.project.id})`,
    "", "## Project lifecycle", "",
    `- Project state: **${resolved.state}**; latest native status update: **${resolved.health ?? "none"}**; mode: **${resolved.lifecycleMode}**.`,
    `- Consistency: **${RESULT_LABEL[lifecycle.consistency] ?? lifecycle.consistency}** — ${lifecycle.message}`,
    `- Evidence: ${lifecycle.evidence.length ? lifecycle.evidence.join("; ") : "no execution evidence"}.`,
    ...(lifecycle.recommendedAction ? [`- Recommendation: ${lifecycle.recommendedAction}`] : []),
    "", "## Progress", "",
    `- ${done.length}/${issues.length} items Done (${percent}%).`,
    `- ${effortPercent === null ? "No estimate denominator" : `${doneEffort}/${totalEffort} estimated effort Done (${effortPercent}%)`}.`,
    `- Refinement ${refinement.length}; Ready ${ready.length}; In Progress ${active.length}; In Review ${review.length}; Ready to Deliver ${readyToDeliver.length}; Delivery Verification ${deliveryVerification.length}; Blocked ${blocked.length}; Unknown ${unknown.length}.`,
    "", "## Milestones", "", ...(milestoneLines.length ? milestoneLines : ["- No repository milestone data."]),
    "", "## Logical phases and outcomes", "", ...(phaseLines.length ? phaseLines : ["- No logical phase metadata."]),
    "", "## Role queues", "", ...(roles.length ? roles.map((role) => `- **${role}:** ${ready.filter((issue) => (issue.role ?? issue.ownerRole) === role).length} Ready, ${active.filter((issue) => (issue.role ?? issue.ownerRole) === role).length} active, ${review.filter((issue) => (issue.reviewerRole ?? issue.role) === role).length} review, ${readyToDeliver.filter((issue) => (issue.role ?? issue.ownerRole) === role).length} ready to deliver.`) : ["- No role field values found."]),
    "", "## Ready", "", ...(queue(ready).length ? queue(ready) : ["- No unblocked Ready items."]),
    "", "## Active work", "", ...(queue(active).length ? queue(active) : ["- No items In Progress."]),
    "", "## Review", "", ...(queue(review, "reviewerRole").length ? queue(review, "reviewerRole") : ["- No items In Review."]),
    "", "## Ready to Deliver", "", ...(queue(readyToDeliver).length ? queue(readyToDeliver) : ["- No items Ready to Deliver."]),
    "", "## Delivery Verification", "", ...(queue(deliveryVerification).length ? queue(deliveryVerification) : ["- No items in Delivery Verification."]),
    "", "## Blockers and PR risks", "",
    ...(blocked.length ? blocked.map((issue) => `- Blocked: ${link(issue.title, issue.url)} — cần ${issue.blocker?.neededFrom ?? "làm rõ người xử lý"}.`) : ["- No blocked items."]),
    ...(prProblems.length ? prProblems.map((issue) => `- PR risk: ${link(issue.title, issue.pullRequest.url ?? issue.url)} — draft, stale review, failing checks, or changes requested.`) : ["- No observed PR delivery mismatch."]),
    "", "## Unknown state diagnostics", "", ...(unknown.length ? unknown.map((issue) => `- ${link(issue.title, issue.url)} — physical status ${issue.observedStatus}.`) : ["- No unknown item states."]),
    ...(missingPriority.length ? missingPriority.map((issue) => `- ${link(issue.title, issue.url)} — missing or legacy-none priority; excluded from next-action ranking.`) : []),
    "", "## Stale handoffs", "", ...(staleHandoffs.length ? staleHandoffs.map((issue) => `- ${link(issue.title, issue.url)} — latest handoff is stale and was not used for logical state.`) : ["- No stale handoffs."]),
    "", "## Terminal mismatches", "", ...(terminalMismatches.length ? terminalMismatches.map((issue) => `- Terminal mismatch: ${link(issue.title, issue.url)} — Done lacks validated mode-specific terminal evidence.`) : ["- No terminal mismatches."]),
    "", "## Hành động tiếp theo", "", ...(nextActions.length ? nextActions : ["- Làm rõ Refinement, tháo blocker hoặc để CPO quyết định outcome tiếp theo."]),
    "",
  ].join("\n");
}

function buildNextActions({ issues, ready, review, readyToDeliver, deliveryVerification, lifecycle, asOf }) {
  const actions = [];
  if (lifecycle.requiresDecision) actions.push(`- CPO/Project lead: ${lifecycle.recommendedAction}`);
  const candidates = [...readyToDeliver, ...deliveryVerification, ...review, ...ready]
    .filter((issue) => issue.priority && issue.priority !== "none")
    .sort((left, right) => compareIssues(left, right, issues, asOf));
  for (const issue of candidates) {
    const action = {
      "ready-to-deliver": `- ${issue.role ?? "Owner"}: perform authorized delivery for ${link(issue.title, issue.url)}.`,
      "delivery-verification": `- ${issue.reviewerRole ?? issue.role ?? "Verifier"}: verify terminal evidence for ${link(issue.title, issue.url)}.`,
      "in-review": `- ${issue.reviewerRole ?? "Reviewer"}: review ${link(issue.title, issue.url)}.`,
      ready: `- ${issue.role ?? "Owner"}: thực hiện ${link(issue.title, issue.url)}.`,
    }[issue.logicalState];
    if (action) actions.push(action);
    if (actions.length === 5) break;
  }
  return actions.slice(0, 5);
}

function compareIssues(left, right, issues, asOf) {
  const stateRank = new Map([["ready-to-deliver", 0], ["delivery-verification", 1], ["in-review", 2], ["ready", 3], ["blocked", 4], ["refinement", 5]]);
  const blockedImpact = (issue) => issues.filter((candidate) => (candidate.blockedBy ?? []).some((blocker) => (blocker.key ?? blocker.id ?? blocker) === (issue.key ?? issue.id))).length;
  const overdue = (issue) => issue.dueDate && new Date(issue.dueDate) < asOf ? 0 : 1;
  const committedIteration = (issue) => issue.iteration || issue.iterationId ? 0 : 1;
  const leftTuple = [stateRank.get(left.logicalState) ?? 9, -blockedImpact(left), PRIORITY.get(left.priority) ?? 9, overdue(left), left.dueDate ?? "9999", left.milestoneDueOn ?? "9999", committedIteration(left), left.iteration ?? left.iterationId ?? "", left.key ?? left.id ?? left.title ?? ""];
  const rightTuple = [stateRank.get(right.logicalState) ?? 9, -blockedImpact(right), PRIORITY.get(right.priority) ?? 9, overdue(right), right.dueDate ?? "9999", right.milestoneDueOn ?? "9999", committedIteration(right), right.iteration ?? right.iterationId ?? "", right.key ?? right.id ?? right.title ?? ""];
  for (let index = 0; index < leftTuple.length; index += 1) {
    const comparison = typeof leftTuple[index] === "number" ? leftTuple[index] - rightTuple[index] : String(leftTuple[index]).localeCompare(String(rightTuple[index]));
    if (comparison !== 0) return comparison;
  }
  return 0;
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
