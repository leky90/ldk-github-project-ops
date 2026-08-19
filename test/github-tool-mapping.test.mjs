import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { classifyGitHubOperation, mapStatusOption } from "../scripts/github-tool-mapping.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("GitHub operation classification uses verbs, not entity nouns", () => {
  for (const name of [
    "mcp__github__create_issue",
    "mcp__github__update_issue",
    "mcp__github__add_issue_comment",
    "mcp__github__merge_pull_request",
    "mcp__github__add_sub_issue",
    "mcp__github__push_files",
    "create_pull_request",
  ]) assert.equal(classifyGitHubOperation(name), "mutation", name);

  for (const name of [
    "mcp__github__get_issue",
    "mcp__github__list_issues",
    "mcp__github__search_code",
    "mcp__github__get_pull_request_status",
    "list_sub_issues",
  ]) assert.equal(classifyGitHubOperation(name), "read", name);

  assert.equal(classifyGitHubOperation("mcp__github__rotate_widget"), "unknown");
  assert.equal(classifyGitHubOperation("mcp__linear-server__save_issue"), "not-github");
  assert.equal(classifyGitHubOperation("bash"), "not-github");
});

test("UUID-named connectors classify by the GitHub operation catalog", () => {
  assert.equal(classifyGitHubOperation("mcp__b51fc322-0044-4834-8ab1-c42c4aa5dab6__create_issue"), "mutation");
  assert.equal(classifyGitHubOperation("mcp__b51fc322-0044-4834-8ab1-c42c4aa5dab6__list_pull_requests"), "read");
  assert.equal(classifyGitHubOperation("mcp__b51fc322-0044-4834-8ab1-c42c4aa5dab6__random_tool"), "not-github");
});

test("hook matchers fire for real connector tool names", async () => {
  const hooks = JSON.parse(await readFile(join(root, "hooks", "hooks.json"), "utf8"));
  for (const event of ["PreToolUse", "PostToolUse"]) {
    const matcher = new RegExp(hooks.hooks[event][0].matcher, "u");
    for (const name of [
      "mcp__github__create_issue",
      "mcp__github__merge_pull_request",
      "mcp__b51fc322-0044-4834-8ab1-c42c4aa5dab6__create_issue",
    ]) assert.match(name, matcher, `${event} matcher must cover ${name}`);
  }
});

test("logical states resolve to bound Projects v2 status option ids", async () => {
  const binding = JSON.parse(await readFile(join(root, "tests", "fixtures", "valid-project-binding.json"), "utf8"));
  assert.equal(mapStatusOption(binding, "ready"), binding.statuses.ready);
  assert.equal(mapStatusOption(binding, "ready-to-deliver"), binding.statuses.readyToDeliver);
  assert.equal(mapStatusOption(binding, "delivery-verification"), binding.statuses.deliveryVerification);
  assert.throws(() => mapStatusOption(binding, "unknown-state"), /logical state/u);
});
