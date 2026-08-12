#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_GRACE_MS = 10 * 60 * 1000;

export async function acquireWorkLock(root, issue, owner, { now = Date.now(), ttlMs = DEFAULT_TTL_MS } = {}) {
  const directory = lockDirectory(root, issue);
  await mkdir(join(root, ".github-ops", "locks"), { recursive: true });
  try {
    await mkdir(directory);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(`work lock already exists for ${issue}`);
    throw error;
  }
  const record = { schemaVersion: 1, issue, owner, token: randomUUID(), acquiredAt: new Date(now).toISOString(), expiresAt: new Date(now + ttlMs).toISOString() };
  await writeFile(join(directory, "lock.json"), `${JSON.stringify(record, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return record;
}

export async function inspectWorkLock(root, issue, { includeToken = false } = {}) {
  const record = await readLock(root, issue);
  return includeToken ? record : { ...record, token: "[redacted]" };
}

export async function renewWorkLock(root, issue, token, { now = Date.now(), ttlMs = DEFAULT_TTL_MS } = {}) {
  const record = await readLock(root, issue);
  assertToken(record, token);
  const updated = { ...record, expiresAt: new Date(now + ttlMs).toISOString() };
  await writeFile(join(lockDirectory(root, issue), "lock.json"), `${JSON.stringify(updated, null, 2)}\n`, { mode: 0o600 });
  return updated;
}

export async function releaseWorkLock(root, issue, token) {
  const record = await readLock(root, issue);
  assertToken(record, token);
  await rm(lockDirectory(root, issue), { recursive: true });
}

export async function recoverWorkLock(root, issue, { now = Date.now(), graceMs = DEFAULT_GRACE_MS } = {}) {
  const record = await readLock(root, issue);
  const recoverAfter = Date.parse(record.expiresAt) + graceMs;
  if (!Number.isFinite(recoverAfter) || now < recoverAfter) throw new Error("work lock is not recoverable before expiry plus grace");
  await rm(lockDirectory(root, issue), { recursive: true });
  return { issue: record.issue, owner: record.owner, recoveredAt: new Date(now).toISOString() };
}

function lockDirectory(root, issue) {
  const slug = String(issue).toLowerCase().replace(/[^a-z0-9.-]+/gu, "-").replace(/^-|-$/gu, "");
  if (!slug) throw new Error("issue is required");
  return join(resolve(root), ".github-ops", "locks", `${slug}.lock`);
}

async function readLock(root, issue) {
  return JSON.parse(await readFile(join(lockDirectory(root, issue), "lock.json"), "utf8"));
}

function assertToken(record, token) {
  if (!token || token !== record.token) throw new Error("work lock token mismatch");
}

async function cli() {
  const [command, root, issue, value] = process.argv.slice(2);
  if (!command || !root || !issue) throw new Error("Usage: work-lock.mjs <acquire|inspect|renew|release|recover> <root> <issue> [owner-or-token]");
  if (command === "acquire") return acquireWorkLock(root, issue, value ?? "unknown");
  if (command === "inspect") return inspectWorkLock(root, issue);
  if (command === "renew") return renewWorkLock(root, issue, value);
  if (command === "release") return releaseWorkLock(root, issue, value);
  if (command === "recover") return recoverWorkLock(root, issue);
  throw new Error(`unknown command ${command}`);
}

if (process.argv[1]?.endsWith("work-lock.mjs")) {
  try {
    const result = await cli();
    if (result !== undefined) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}
