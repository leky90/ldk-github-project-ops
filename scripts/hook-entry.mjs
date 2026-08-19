#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { classifyGitHubOperation } from "./github-tool-mapping.mjs";
import { dirname, join, parse } from "node:path";

const event = process.argv[2];
let input = "";
for await (const chunk of process.stdin) input += chunk;

try {
  const payload = input ? JSON.parse(input) : {};
  const bindings = await findBindings(payload.cwd || process.cwd());
  const output = handle(event, payload, bindings);
  if (output) process.stdout.write(output);
} catch {
  process.exit(0);
}

export function handle(name, payload, bindings) {
  const binding = bindings.github;
  if (name === "UserPromptSubmit") {
    const prompt = String(payload.prompt ?? payload.userPrompt ?? "");
    const intent = resolveIntent(prompt);
    if (!intent) return "";
    const route = classifyTracker(prompt, bindings);
    if (route === "linear") return "";
    if (route === "ambiguous") return wrapRouter("Both GitHub and Linear are in scope or both repository bindings exist. Ask the owner to choose GitHub or Linear, or to define an explicit cross-tracker source, destination, mapping, and write scope. Do not mutate either tracker yet.");
    if (route !== "github") return "";
    if (!binding) return wrap('binding="missing"', `Use $${intent.skill} for read-only GitHub target discovery. Produce an exact .github-project-ops.json preview and do not infer a Project from its title, another tracker, or stale context. Apply only after the owner/project/repository boundary is unambiguous and setup writes are authorized.`);
    return routeIntent(intent, binding);
  }
  if (!binding) return "";
  const attrs = `owner="${escapeXml(binding.owner)}" project_number="${binding.projectNumber}"`;
  if (name === "SessionStart") return wrap(attrs, `This repository is bound to a GitHub Project v2${bindings.linear ? " and also has a Linear binding; explicit tracker signals win and generic tracker work must be clarified" : ""}. Preserve Project → milestone/iteration → parent Issue → sub-issue hierarchy. Use native dependencies and linked pull requests. For normal work, perform one role phase with $github-do-issue.`);
  const toolName = String(payload.tool_name ?? payload.toolName ?? "");
  const operation = classifyGitHubOperation(toolName);
  if ((name === "PreToolUse" || name === "PostToolUse") && operation === "unknown") return wrap(attrs, "Unknown GitHub tool operation. Treat this as a capability warning, read the tool contract, and do not mutate until its operation class is explicit.");
  if (name === "PreToolUse" && operation === "mutation") return wrap(attrs, "Before mutating GitHub, verify the exact owner, Project number/node ID, repository, item ID, live field/option IDs, current assignee/role/state, native relations, delivery authority, and durable evidence. Do not publish machine telemetry or raw JSON.");
  if (name === "PostToolUse" && operation === "mutation") return wrap(attrs, "Re-read the affected Project item and underlying Issue or pull request. Verify fields, assignee, hierarchy, dependency endpoints, comment, delivery evidence, and Project lifecycle match the actual result; report skipped, conflicted, and failed mutations.");
  if (name === "Stop") return wrap(attrs, "If Issue work occurred, leave at most one human handoff/review/blocked comment and release the local lock. Software delivery must account for scoped Git changes, PR state, tests, and terminal cleanup before Done.");
  return "";
}

function resolveIntent(prompt) {
  if (/(?:đồng bộ|sync|map|mirror|migrate|di chuyển).*(?:github).*(?:linear)|(?:đồng bộ|sync|map|mirror|migrate|di chuyển).*(?:linear).*(?:github)/iu.test(prompt)) return { kind: "cross-tracker", skill: "github-create-work" };
  if (/(?:hòa giải|hoà giải|reconcile|recover.*lock|sửa.*(?:project|issue).*(?:sai|lệch)|cleanup|dọn.*(?:item|issue|comment)|resolved blocker)/iu.test(prompt)) return { kind: "reconcile", skill: "github-reconcile" };
  if (/(?:báo cáo|tổng quan|tiến độ|project status|status report|project update|health|on track|at risk|off track|inactive|complete)/iu.test(prompt)) return { kind: "status", skill: "github-project-status" };
  if (/(?:tạo|khởi tạo|capture|brainstorm|prd|product brief|đề xuất|lên kế hoạch|phân rã|break\s*down|breakdown|sub-?issues?|views?|board|backlog|roadmap|estimate|ước lượng|chuẩn hóa|đồng bộ|sync|organize|update|cập nhật).*(?:issue|project|tính năng|dự án|công việc|milestone|roadmap|view|board|backlog|estimate)|(?:issue|project|milestone|sub-?issues?|views?|board|backlog|roadmap|estimate).*(?:tạo|khởi tạo|phân rã|break\s*down|breakdown|chuẩn hóa|đồng bộ|sync|organize|update|cập nhật)/iu.test(prompt)) return { kind: "create", skill: "github-create-work" };
  if (/(?:thực hiện|xử lý|làm|review|kiểm thử|kiểm tra|work on|do|perform|implement|execute|fix|deliver|ship).*(?:issue|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+|#\d+)|(?:issue|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+|#\d+).*(?:thực hiện|xử lý|làm|review|kiểm thử|kiểm tra)/iu.test(prompt)) return { kind: "execute", skill: "github-do-issue" };
  return null;
}

function routeIntent(intent, binding) {
  const attrs = `owner="${escapeXml(binding.owner)}" project_number="${binding.projectNumber}"`;
  if (intent.kind === "reconcile") return wrap(attrs, "Use $github-reconcile. Scope repair to the named Project item and relations unless a Project-wide audit is explicitly requested. Preview destructive, close/reopen, archive, merge, and bulk changes.");
  if (intent.kind === "status") return wrap(attrs, "Use $github-project-status. Read Project open/closed state, latest native status update, item Status fields, milestones, dependencies, and PR delivery evidence. Reports are read-only; publish or close/reopen only on a direct request.");
  if (intent.kind === "create") return wrap(attrs, "Use $github-create-work. Audit existing setup and coverage before writes; use the standard saved views, actual parent Issues with direct sub-issues, dependencies, and lightweight estimates only where useful. Preview planning prompts; apply direct create/update prompts and verify the full result.");
  return wrap(attrs, "Use $github-do-issue. Read the Issue, Project item fields, assignee, native dependencies, linked PRs, DoR/DoD, role, and delivery contract; perform one role phase; publish one human handoff; re-read every changed object.");
}

export function classifyTracker(prompt, bindings) {
  const hasGitHubSignal = /(?:\bgithub\b|github\.com|\bgh\s+project\b|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+)/iu.test(prompt);
  const hasLinearSignal = /(?:\blinear\b|linear\.app)/iu.test(prompt) || /\b[A-Z][A-Z0-9]{1,9}-\d+\b/u.test(prompt);
  if (hasGitHubSignal && hasLinearSignal) return "ambiguous";
  if (hasGitHubSignal) return "github";
  if (hasLinearSignal) return "linear";
  if (bindings.github && bindings.linear) return "ambiguous";
  if (bindings.github) return "github";
  if (bindings.linear) return "linear";
  return "none";
}

async function findBindings(start) {
  let current = start;
  const root = parse(current).root;
  let github = null;
  let linear = null;
  while (true) {
    github ??= await readGitHubBinding(current);
    linear ??= await readLinearBinding(current);
    if (current === root) return { github, linear };
    current = dirname(current);
  }
}

async function readGitHubBinding(directory) {
  try {
    const raw = JSON.parse(await readFile(join(directory, ".github-project-ops.json"), "utf8"));
    const owner = raw.github?.owner;
    const projectNumber = raw.github?.projectNumber;
    if (typeof owner === "string" && owner && Number.isInteger(projectNumber) && projectNumber > 0) return { owner, projectNumber };
  } catch {
    // Hooks fail open and never block unrelated repositories.
  }
  return null;
}

async function readLinearBinding(directory) {
  try {
    const raw = JSON.parse(await readFile(join(directory, ".linear-project-ops.json"), "utf8"));
    const projectId = raw.project?.linearProjectId ?? raw.linear?.projectId;
    const teamId = raw.project?.linearTeamId ?? raw.linear?.teamId;
    if (isConcreteId(projectId) && isConcreteId(teamId)) return { projectId: String(projectId), teamId: String(teamId) };
  } catch {
    // A peer binding is advisory routing context only.
  }
  return null;
}

function isConcreteId(value) {
  return typeof value === "string" && value.trim().length > 0 && !/^(?:replace-with-|example-)/u.test(value.trim());
}

function wrap(attrs, message) {
  return `<ldk-github-project-ops ${attrs}>\n${message}\n</ldk-github-project-ops>`;
}

function wrapRouter(message) {
  return `<project-ops-router tracker="ambiguous">\n${message}\n</project-ops-router>`;
}

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
