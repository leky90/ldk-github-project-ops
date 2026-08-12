#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, join, parse } from "node:path";

const event = process.argv[2];
let input = "";
for await (const chunk of process.stdin) input += chunk;

try {
  const payload = input ? JSON.parse(input) : {};
  const binding = await findBinding(payload.cwd || process.cwd());
  if (!binding) process.exit(0);
  const output = handle(event, payload, binding);
  if (output) process.stdout.write(output);
} catch {
  process.exit(0);
}

export function handle(name, payload, binding) {
  const attrs = `owner="${escapeXml(binding.owner)}" project_number="${binding.projectNumber}"`;
  if (name === "SessionStart") return wrap(attrs, "This repository is bound to one GitHub Project v2. Preserve Project → milestone/iteration → parent Issue → sub-issue hierarchy. Use native dependencies and linked pull requests. For normal work, perform one role phase with $github-do-issue.");
  if (name === "UserPromptSubmit") {
    const prompt = String(payload.prompt ?? payload.userPrompt ?? "");
    if (/(?:hòa giải|hoà giải|reconcile|recover.*lock|sửa.*(?:project|issue).*(?:sai|lệch)|cleanup|dọn.*(?:item|issue|comment)|resolved blocker)/iu.test(prompt)) return wrap(attrs, "Use $github-reconcile. Scope repair to the named Project item and relations unless a Project-wide audit is explicitly requested. Preview destructive, close/reopen, archive, merge, and bulk changes.");
    if (/(?:báo cáo|tổng quan|tiến độ|project status|status report|project update|health|on track|at risk|off track|inactive|complete)/iu.test(prompt)) return wrap(attrs, "Use $github-project-status. Read Project open/closed state, latest native status update, item Status fields, milestones, dependencies, and PR delivery evidence. Reports are read-only; publish or close/reopen only on a direct request.");
    if (/(?:tạo|khởi tạo|capture|brainstorm|prd|product brief|đề xuất|lên kế hoạch).*(?:issue|github project|tính năng|dự án|công việc|milestone|roadmap)|(?:issue|github project|milestone).*(?:tạo|khởi tạo)/iu.test(prompt)) return wrap(attrs, "Use $github-create-work. Use native GitHub Project v2 fields, repository milestones, actual Issues, direct sub-issues, dependencies, and durable repository resources. Preview planning prompts; apply direct create/update prompts.");
    if (/(?:thực hiện|xử lý|làm|review|kiểm thử|kiểm tra).*(?:issue|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+|#\d+)|(?:issue|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+|#\d+).*(?:thực hiện|xử lý|làm|review|kiểm thử|kiểm tra)/iu.test(prompt)) return wrap(attrs, "Use $github-do-issue. Read the Issue, Project item fields, assignee, native dependencies, linked PRs, DoR/DoD, role, and delivery contract; perform one role phase; publish one human handoff; re-read every changed object.");
    return "";
  }
  const toolName = String(payload.tool_name ?? payload.toolName ?? "");
  if (name === "PreToolUse" && isGitHubMutation(toolName)) return wrap(attrs, "Before mutating GitHub, verify the exact owner, Project number/node ID, repository, item ID, live field/option IDs, current assignee/role/state, native relations, delivery authority, and durable evidence. Do not publish machine telemetry or raw JSON.");
  if (name === "PostToolUse" && isGitHubMutation(toolName)) return wrap(attrs, "Re-read the affected Project item and underlying Issue or pull request. Verify fields, assignee, hierarchy, dependency endpoints, comment, delivery evidence, and Project lifecycle match the actual result; report skipped, conflicted, and failed mutations.");
  if (name === "Stop") return wrap(attrs, "If Issue work occurred, leave at most one human handoff/review/blocked comment and release the local lock. Software delivery must account for scoped Git changes, PR state, tests, and terminal cleanup before Done.");
  return "";
}

function isGitHubMutation(name) {
  return /(?:github|create|update|edit|delete|archive|close|reopen|assign|comment|label|project|issue|pull|relation|milestone|graphql)/iu.test(name);
}

async function findBinding(start) {
  let current = start;
  const root = parse(current).root;
  while (true) {
    try {
      const raw = JSON.parse(await readFile(join(current, ".github-project-ops.json"), "utf8"));
      const owner = raw.github?.owner;
      const projectNumber = raw.github?.projectNumber;
      if (typeof owner === "string" && owner && Number.isInteger(projectNumber) && projectNumber > 0) return { owner, projectNumber };
    } catch {
      // Hooks fail open and never block unrelated repositories.
    }
    if (current === root) return null;
    current = dirname(current);
  }
}

function wrap(attrs, message) {
  return `<ldk-github-project-ops ${attrs}>\n${message}\n</ldk-github-project-ops>`;
}

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
