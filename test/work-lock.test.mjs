import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acquireWorkLock, inspectWorkLock, recoverWorkLock, releaseWorkLock } from "../scripts/work-lock.mjs";

test("work lock serializes local issue execution and redacts its token", async () => {
  const root = await mkdtemp(join(tmpdir(), "github-project-lock-"));
  const lock = await acquireWorkLock(root, "example-org/product#42", "codex", { now: 1_000, ttlMs: 5_000 });
  await assert.rejects(() => acquireWorkLock(root, "example-org/product#42", "claude"), /already exists/u);
  assert.equal((await inspectWorkLock(root, "example-org/product#42")).token, "[redacted]");
  await assert.rejects(() => releaseWorkLock(root, "example-org/product#42", "wrong"), /token mismatch/u);
  await releaseWorkLock(root, "example-org/product#42", lock.token);
});

test("expired work lock needs expiry plus grace for recovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "github-project-lock-"));
  await acquireWorkLock(root, "example-org/product#43", "codex", { now: 1_000, ttlMs: 1_000 });
  await assert.rejects(() => recoverWorkLock(root, "example-org/product#43", { now: 2_500, graceMs: 1_000 }), /not recoverable/u);
  const result = await recoverWorkLock(root, "example-org/product#43", { now: 3_001, graceMs: 1_000 });
  assert.equal(result.issue, "example-org/product#43");
});
