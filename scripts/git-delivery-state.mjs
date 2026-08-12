import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, relative, sep } from "node:path";

const execFileAsync = promisify(execFile);

export async function captureGitBaseline(worktree, issue) {
  const root = await git(worktree, ["rev-parse", "--show-toplevel"]);
  const status = await git(root, ["status", "--porcelain=v1"]);
  if (status) throw new Error("Git worktree baseline must be clean");
  const branch = await git(root, ["branch", "--show-current"]);
  if (!branch || !branch.includes(String(issue).replace(/^.*#/u, ""))) throw new Error("Git branch must contain the issue number");
  return {
    schemaVersion: 1,
    issue,
    worktree: root,
    branch,
    head: await git(root, ["rev-parse", "HEAD"]),
    capturedAt: new Date().toISOString(),
  };
}

export async function validateGitDelivery(baseline, scopePaths) {
  if (!baseline?.worktree || !baseline?.head) return ["baseline is invalid"];
  const errors = [];
  const root = resolve(baseline.worktree);
  const status = await git(root, ["status", "--porcelain=v1"]);
  if (status) errors.push("delivery worktree must be clean");
  const head = await git(root, ["rev-parse", "HEAD"]);
  if (head === baseline.head) errors.push("delivery must contain at least one commit after baseline");
  const branch = await git(root, ["branch", "--show-current"]);
  const issueNumber = String(baseline.issue).replace(/^.*#/u, "");
  if (!branch.includes(issueNumber)) errors.push("delivery branch no longer contains the issue number");
  const paths = (await git(root, ["diff", "--name-only", `${baseline.head}...${head}`])).split("\n").filter(Boolean);
  if (!Array.isArray(scopePaths) || !scopePaths.length) errors.push("scopePaths must be a non-empty array");
  else for (const path of paths) if (!scopePaths.some((scope) => within(path, scope))) errors.push(`committed path outside declared scope: ${path}`);
  return errors;
}

async function git(cwd, args) {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return stdout.trim();
}

function within(path, scope) {
  const normalizedPath = relative(".", path).split(sep).join("/");
  const normalizedScope = relative(".", scope).split(sep).join("/").replace(/\/$/u, "");
  return normalizedPath === normalizedScope || normalizedPath.startsWith(`${normalizedScope}/`);
}
