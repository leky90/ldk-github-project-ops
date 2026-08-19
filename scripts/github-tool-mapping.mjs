const MUTATION_VERBS = new Set([
  "create", "update", "add", "remove", "delete", "merge", "push", "close", "reopen",
  "fork", "submit", "request", "reprioritize", "transfer", "archive", "set", "edit",
  "assign", "dispatch",
]);
const READ_VERBS = new Set(["get", "list", "search", "download", "compare"]);

// Operation names exposed by real GitHub MCP connectors. Hosts register the
// server under arbitrary names (github, opaque connector UUIDs), so the
// operation segment is the only stable signal for those hosts.
const KNOWN_GITHUB_OPERATIONS = new Set([
  "create_issue", "update_issue", "get_issue", "list_issues", "search_issues",
  "add_issue_comment", "update_issue_comment", "get_issue_comments",
  "add_sub_issue", "remove_sub_issue", "reprioritize_sub_issue", "list_sub_issues",
  "create_pull_request", "update_pull_request", "merge_pull_request",
  "get_pull_request", "list_pull_requests", "get_pull_request_files",
  "get_pull_request_status", "get_pull_request_comments", "get_pull_request_reviews",
  "create_pull_request_review", "request_copilot_review",
  "create_or_update_file", "push_files", "get_file_contents", "delete_file",
  "create_repository", "fork_repository", "search_repositories",
  "create_branch", "list_branches", "list_commits", "get_commit",
  "search_code", "search_users",
  "create_milestone", "update_milestone", "list_milestones",
  "add_project_item", "update_project_item", "delete_project_item",
  "list_project_items", "list_project_fields", "get_project", "list_projects",
]);

export function classifyGitHubOperation(toolName) {
  if (typeof toolName !== "string" || !toolName) return "not-github";
  const normalized = toolName.trim().toLowerCase();
  const segments = normalized.split(/__|[.:/]/u).filter(Boolean);
  const operation = segments.at(-1);
  const serverIsGitHub = segments.some((segment) => segment === "github" || segment === "gh" || /^github[-_]/u.test(segment));
  const otherTracker = segments.some((segment) => segment === "linear" || /^linear[-_]/u.test(segment));
  if (otherTracker) return "not-github";
  if (!serverIsGitHub && !KNOWN_GITHUB_OPERATIONS.has(operation)) return "not-github";
  const verb = operation.split("_", 1)[0];
  if (MUTATION_VERBS.has(verb)) return "mutation";
  if (READ_VERBS.has(verb)) return "read";
  return "unknown";
}

export function mapStatusOption(binding, logicalState) {
  const key = {
    refinement: "refinement",
    ready: "ready",
    "in-progress": "inProgress",
    "in-review": "inReview",
    "ready-to-deliver": "readyToDeliver",
    "delivery-verification": "deliveryVerification",
    blocked: "blocked",
    done: "done",
    canceled: "canceled",
  }[logicalState];
  const option = key ? binding?.statuses?.[key] : undefined;
  if (!option) throw new Error(`no bound status option for logical state ${logicalState}`);
  return option;
}
