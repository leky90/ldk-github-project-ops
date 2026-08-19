import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  DELIVERY_MODES,
  DELIVERY_PHASES,
  validateDeliveryVerification,
  validateHandoffTransition,
} from "./delivery-lifecycle.mjs";
import { validatePlanningStructure } from "./work-structure.mjs";
import { validateLegacyHandoff, validateLegacyWorkPlan } from "./legacy-lib.mjs";

export { DELIVERY_MODES, DELIVERY_PHASES } from "./delivery-lifecycle.mjs";

const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const GITHUB_ISSUE_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[1-9][0-9]*$/u;
const KEY_PATTERN = /^[a-z0-9][a-z0-9._:-]{2,95}$/u;
const ROLE_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;
const SECRET_KEY_PATTERN = /(?:api[_-]?key|access[_-]?token|secret|password|private[_-]?key|credential|authorization)/iu;
const SECRET_VALUE_PATTERNS = [
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/u,
  /\bBearer\s+[A-Za-z0-9._-]{20,}\b/iu,
  /\bsk-[A-Za-z0-9_-]{16,}\b/u,
  /\blin_api_[A-Za-z0-9_-]{16,}\b/u,
  /\blin_oauth_[A-Za-z0-9_-]{16,}\b/u,
  /\bgh[opusr]_[A-Za-z0-9_]{20,}\b/u,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
];

// Paths that identify a private machine (home dirs, temp dirs, drive roots,
// UNC shares). Narrower than containsLocalEvidence: repo-relative references
// stay legal in planning contracts, but these must never reach Linear.
const PRIVATE_LOCAL_PATH_PATTERNS = [
  /\bfile:\/\//iu,
  /(?:^|[\s([{\x22'\x60])~\//u,
  /(?:^|[\s([{\x22'\x60])\/(?:Users|home|tmp|private|var\/folders)(?:\/|\b)/u,
  /[A-Za-z]:\\/u,
  /\\\\[A-Za-z0-9_.$-]+\\/u,
];

function containsPrivateLocalPath(value) {
  if (typeof value !== "string") return false;
  return PRIVATE_LOCAL_PATH_PATTERNS.some((pattern) => pattern.test(value));
}

function containsLocalEvidence(value) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (containsPrivateLocalPath(text)) return true;
  if (/(?:^|[\s([{\x22'\x60])(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,12}(?::\d+)?(?:$|[\s)\]}\x22'\x60])/u.test(text)) return true;
  if (/(?:^|[\s([{\x22'\x60])\b(?:assets|docs|evals|examples|references|schemas|scripts|skills|test|tests|packages|src|app|lib|\.claude-plugin|\.codex-plugin)\//u.test(text)) return true;
  return /(?:^|[\s([{"'`])(?:\/(?:Users|home|tmp|private|var\/folders)(?:\/|\b)|[A-Za-z]:\\|\.{0,2}\/|(?:docs|tests|src|app|lib|\.delivery|\.github-ops)\/)/u.test(text);
}

function containsHiddenCoordinationDetail(value) {
  if (typeof value !== "string") return false;
  const sessionId = /(?:\bses_[A-Za-z0-9_-]+\b|\bsession[ _-]?id\b|\b(?:review\s+)?session\s+(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9][A-Za-z0-9_-]{2,}\b|\bsession\s+[0-9a-f]{8}-[0-9a-f-]{27,}\b)/iu;
  const modelId = /(?:\bmodel[ _-]?id\b|\b(?:openai|anthropic|google|xai|mistral|meta)\/[A-Za-z0-9._-]+\b|\b(?:o[1-9][0-9]?|gpt-[A-Za-z0-9._-]+|claude-[A-Za-z0-9._-]+|gemini-[A-Za-z0-9._-]+)\b|\b(?:sonnet|opus|haiku)\s*[0-9][A-Za-z0-9.-]*\b)/iu;
  const promptPayload = /(?:\b(?:reviewer|system|user|assistant|resume|raw)[ _-]?prompt\b|\bprompt\s*(?::|=)\s*(?:hidden|internal|system|user|assistant|reveal))/iu;
  const coordination = /(?:\brun[ _-]?id\b|\b(?:claim|lease|lock)[ _-]?token\b|\bheartbeat\b|\bbaselineId\b|\braw (?:handoff|validator) JSON\b)/iu;
  return sessionId.test(value) || modelId.test(value) || promptPayload.test(value) || coordination.test(value);
}

function isCommentSafe(value) {
  return !containsLocalEvidence(value) && !containsHiddenCoordinationDetail(value);
}

export const DEFAULT_ROLES = Object.freeze({
  cpo: { label: "role:cpo", defaultReviewer: "tech-lead" },
  "product-manager": { label: "role:product-manager", defaultReviewer: "cpo" },
  "tech-lead": { label: "role:tech-lead", defaultReviewer: "cpo" },
  "software-engineer": { label: "role:software-engineer", defaultReviewer: "qa" },
  qa: { label: "role:qa", defaultReviewer: "tech-lead" },
  "content-director": { label: "role:content-director", defaultReviewer: "cpo" },
  "content-writer": { label: "role:content-writer", defaultReviewer: "content-director" },
  "marketing-lead": { label: "role:marketing-lead", defaultReviewer: "cpo" },
  marketer: { label: "role:marketer", defaultReviewer: "marketing-lead" },
  "sales-manager": { label: "role:sales-manager", defaultReviewer: "cpo" },
  "sales-representative": { label: "role:sales-representative", defaultReviewer: "sales-manager" },
});

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export function parseCli(args) {
  const positional = [];
  const flags = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const [name, inline] = value.slice(2).split("=", 2);
    if (inline !== undefined) {
      flags.set(name, inline);
    } else if (args[index + 1] && !args[index + 1].startsWith("--")) {
      flags.set(name, args[index + 1]);
      index += 1;
    } else {
      flags.set(name, true);
    }
  }
  return { positional, flags };
}

export function stableKey(...parts) {
  return parts
    .flat()
    .filter((part) => part !== undefined && part !== null && String(part).trim())
    .map((part) => String(part).trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, ""))
    .filter(Boolean)
    .join(".");
}


export function findSecretPaths(value, path = "$", matches = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findSecretPaths(entry, `${path}[${index}]`, matches));
    return matches;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) matches.push(path);
    return matches;
  }
  for (const [key, entry] of Object.entries(value)) {
    const child = `${path}.${key}`;
    if (SECRET_KEY_PATTERN.test(key)) matches.push(child);
    findSecretPaths(entry, child, matches);
  }
  return matches;
}

function requiredString(value, location, errors) {
  if (typeof value !== "string" || !value.trim()) errors.push(`${location} is required`);
}

function rejectUnknownProperties(value, allowed, location, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${location}.${key} is an unexpected additional property`);
  }
}

function validateRole(role, location, roles, errors, { optional = false } = {}) {
  if (role === undefined && optional) return;
  if (typeof role !== "string" || !ROLE_PATTERN.test(role)) {
    errors.push(`${location} must be a role slug`);
  } else if (roles && !Object.hasOwn(roles, role)) {
    errors.push(`${location} references unknown role ${role}`);
  }
}

function validateRepository(repository, location, allowed, errors) {
  if (typeof repository !== "string" || !REPOSITORY_PATTERN.test(repository)) errors.push(`${location} is invalid`);
  else if (allowed.size && !allowed.has(repository)) errors.push(`${location} is outside the binding repositories`);
}

function validateStringArray(value, location, errors, { nonEmpty = false } = {}) {
  if (!Array.isArray(value)) {
    errors.push(`${location} must be an array`);
    return;
  }
  if (nonEmpty && value.length === 0) errors.push(`${location} must be non-empty`);
  if (new Set(value).size !== value.length) errors.push(`${location} must contain unique values`);
  value.forEach((entry, index) => requiredString(entry, `${location}[${index}]`, errors));
}

export function normalizeProjectBinding(binding) {
  return structuredClone(binding);
}

export function validateProjectBinding(binding, { allowPlaceholders = false } = {}) {
  const errors = [];
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) return ["binding must be an object"];
  if (binding.schemaVersion !== 1) return ["schemaVersion must be 1"];
  const github = binding.github;
  if (!github || typeof github !== "object" || Array.isArray(github)) {
    errors.push("github must be an object");
  } else {
    requiredString(github.owner, "github.owner", errors);
    if (!Number.isInteger(github.projectNumber) || github.projectNumber < 1) errors.push("github.projectNumber must be a positive integer");
    if (!Array.isArray(github.repositories) || github.repositories.length === 0) {
      errors.push("github.repositories must be a non-empty array");
    } else {
      if (new Set(github.repositories).size !== github.repositories.length) errors.push("github.repositories must contain unique values");
      github.repositories.forEach((repo, index) => {
        if (typeof repo !== "string" || !REPOSITORY_PATTERN.test(repo)) errors.push(`github.repositories[${index}] is invalid`);
      });
    }
    if (!allowPlaceholders && typeof github.owner === "string" && /^replace-with-/u.test(github.owner)) errors.push("github.owner is a placeholder");
  }
  for (const field of ["status", "role", "priority", "deliveryPhase", "estimate"]) requiredString(binding.fields?.[field], `fields.${field}`, errors);
  for (const status of ["refinement", "ready", "inProgress", "inReview", "readyToDeliver", "deliveryVerification", "blocked", "done", "canceled"]) {
    requiredString(binding.statuses?.[status], `statuses.${status}`, errors);
  }
  if (binding.roles !== undefined) validateStringArray(binding.roles, "roles", errors, { nonEmpty: true });
  const secretPaths = findSecretPaths(binding);
  if (secretPaths.length) errors.push(`secret-like data is forbidden at: ${[...new Set(secretPaths)].join(", ")}`);
  return [...new Set(errors)];
}

export function detectCycles(keys, dependencies) {
  const visiting = new Set();
  const visited = new Set();
  const cycles = [];
  function visit(key, path) {
    if (visiting.has(key)) {
      const start = path.indexOf(key);
      cycles.push([...path.slice(start), key]);
      return;
    }
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dependency of dependencies.get(key) ?? []) if (keys.has(dependency)) visit(dependency, [...path, key]);
    visiting.delete(key);
    visited.add(key);
  }
  for (const key of keys) visit(key, []);
  return cycles;
}

export function validateWorkPlan(plan, { owner, projectNumber, repositories, binding, forApply = false, roles = DEFAULT_ROLES } = {}) {
  if (plan?.schemaVersion === 1 || plan?.schemaVersion === 2) {
    const errors = validateLegacyWorkPlan(plan, { binding });
    if (forApply) errors.push("migration to work plan v4 is required before apply");
    return [...new Set(errors)];
  }
  if (plan?.schemaVersion === 4) return validateWorkPlanV4(plan, { owner, projectNumber, repositories, forApply, roles });
  const errors = [];
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return ["plan must be an object"];
  if (plan.schemaVersion !== 3) errors.push("schemaVersion must be 3");
  if (forApply && plan.schemaVersion === 3) errors.push("migration to work plan v4 is required before apply");
  if (plan.kind !== "github-role-work-plan") errors.push("kind must be github-role-work-plan");
  if (!new Set(["preview", "apply"]).has(plan.mode)) errors.push("mode must be preview or apply");
  if (forApply && plan.mode !== "apply") errors.push("mode must be apply for mutations");
  requiredString(plan.summary, "summary", errors);

  const project = plan.project;
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    errors.push("project must be an object");
  } else {
    rejectUnknownProperties(project, new Set([
      "owner", "number", "repositories", "name", "description",
      "lifecycle", "priority", "startDate", "targetDate",
    ]), "project", errors);
    requiredString(project.owner, "project.owner", errors);
    if (!Number.isInteger(project.number) || project.number < 1) errors.push("project.number must be a positive integer");
    if (owner && project.owner !== owner) errors.push(`project.owner ${project.owner} does not match bound owner ${owner}`);
    if (projectNumber && project.number !== projectNumber) errors.push(`project.number ${project.number} does not match bound Project ${projectNumber}`);
    if (project.repositories !== undefined) validateStringArray(project.repositories, "project.repositories", errors, { nonEmpty: true });
    if (project.lifecycle !== undefined) {
      const lifecycle = project.lifecycle;
      if (!lifecycle || typeof lifecycle !== "object" || Array.isArray(lifecycle)) {
        errors.push("project.lifecycle must be an object");
      } else {
        if (!new Set(["bounded", "continuous"]).has(lifecycle.mode)) errors.push("project.lifecycle.mode is invalid");
        validateStringArray(lifecycle.completionCriteria, "project.lifecycle.completionCriteria", errors);
      }
    }
    if (project.priority !== undefined && !new Set(["urgent", "high", "normal", "low", "none"]).has(project.priority)) errors.push("project.priority is invalid");
    validateOptionalDate(project.startDate, "project.startDate", errors);
    validateOptionalDate(project.targetDate, "project.targetDate", errors);
    if (isDateAfter(project.startDate, project.targetDate)) errors.push("project.startDate cannot be after project.targetDate");
    if (project.memberIds !== undefined) validateStringArray(project.memberIds, "project.memberIds", errors);
    if (project.initiativeKeys !== undefined) validateStringArray(project.initiativeKeys, "project.initiativeKeys", errors);
  }

  const milestones = Array.isArray(plan.milestones) ? plan.milestones : [];
  const allowedRepositories = new Set(((Array.isArray(repositories) && repositories.length ? repositories : plan.project?.repositories) ?? (Array.isArray(plan.issues) ? plan.issues.map((item) => item?.repository) : [])).filter(Boolean));
  const resources = Array.isArray(plan.resources) ? plan.resources : [];
  const issues = Array.isArray(plan.issues) ? plan.issues : [];
  if (!Array.isArray(plan.milestones)) errors.push("milestones must be an array");
  if (!Array.isArray(plan.resources)) errors.push("resources must be an array");
  if (!Array.isArray(plan.issues) || issues.length === 0) errors.push("issues must be a non-empty array");

  const allKeys = new Set();
  const milestoneKeys = new Set();
  const resourceKeys = new Set();
  const issueKeys = new Set();
  const issueByKey = new Map();
  function register(key, location, collection) {
    if (typeof key !== "string" || !KEY_PATTERN.test(key)) errors.push(`${location}.key is invalid`);
    if (allKeys.has(key)) errors.push(`duplicate stable key: ${key}`);
    allKeys.add(key);
    collection.add(key);
  }

  milestones.forEach((item, index) => {
    const at = `milestones[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) return errors.push(`${at} must be an object`);
    register(item.key, at, milestoneKeys);
    validateRepository(item.repository, `${at}.repository`, allowedRepositories, errors);
    requiredString(item.name, `${at}.name`, errors);
    validateOptionalDate(item.targetDate, `${at}.targetDate`, errors);
    if (isDateAfter(project?.startDate, item.targetDate)) errors.push(`${at}.targetDate cannot be before project.startDate`);
    if (isDateAfter(item.targetDate, project?.targetDate)) errors.push(`${at}.targetDate cannot be after project.targetDate`);
  });

  resources.forEach((item, index) => {
    const at = `resources[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) return errors.push(`${at} must be an object`);
    register(item.key, at, resourceKeys);
    requiredString(item.title, `${at}.title`, errors);
    if (!new Set(["document", "url", "repository", "reference"]).has(item.type)) errors.push(`${at}.type is invalid`);
    if (!item.url && !item.content) errors.push(`${at} must include url or content`);
  });

  issues.forEach((item, index) => {
    const at = `issues[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) return errors.push(`${at} must be an object`);
    register(item.key, at, issueKeys);
    issueByKey.set(item.key, item);
    validateRepository(item.repository, `${at}.repository`, allowedRepositories, errors);
    if (!new Set(["outcome", "task", "decision"]).has(item.type)) errors.push(`${at}.type is invalid; use outcome instead of an issue-level initiative`);
    requiredString(item.title, `${at}.title`, errors);
    requiredString(item.outcome, `${at}.outcome`, errors);
    requiredString(item.deliverable, `${at}.deliverable`, errors);
    if (plan.schemaVersion === 3 && item.delivery === undefined) errors.push(`${at}.delivery is required for schemaVersion 3`);
    if (item.delivery !== undefined) {
      if (!item.delivery || typeof item.delivery !== "object" || Array.isArray(item.delivery)) {
        errors.push(`${at}.delivery must be an object`);
      } else {
        if (!DELIVERY_MODES.includes(item.delivery.mode)) errors.push(`${at}.delivery.mode is invalid`);
        validateRole(item.delivery.ownerRole, `${at}.delivery.ownerRole`, roles, errors);
        if (item.delivery.target !== undefined) requiredString(item.delivery.target, `${at}.delivery.target`, errors);
        validateStringArray(item.delivery.verification, `${at}.delivery.verification`, errors, { nonEmpty: true });
        if (item.type === "decision" && item.delivery.mode !== "decision") errors.push(`${at}.decision requires delivery.mode decision`);
      }
    }
    if (!new Set(["Refinement", "Ready", "Blocked"]).has(item.status)) errors.push(`${at}.status is invalid`);
    if (!new Set(["urgent", "high", "normal", "low", "none"]).has(item.priority)) errors.push(`${at}.priority is invalid`);
    validateRole(item.ownerRole, `${at}.ownerRole`, roles, errors);
    validateRole(item.reviewerRole, `${at}.reviewerRole`, roles, errors, { optional: true });
    validateStringArray(item.definitionOfReady, `${at}.definitionOfReady`, errors, { nonEmpty: true });
    validateStringArray(item.definitionOfDone, `${at}.definitionOfDone`, errors, { nonEmpty: true });
    validateStringArray(item.resourceKeys, `${at}.resourceKeys`, errors);
    if (item.labels !== undefined) validateStringArray(item.labels, `${at}.labels`, errors);
    validateOptionalDate(item.dueDate, `${at}.dueDate`, errors);
    if (item.estimate !== undefined && (typeof item.estimate !== "number" || item.estimate < 0 || !Number.isFinite(item.estimate))) errors.push(`${at}.estimate must be a non-negative number`);
    if (item.type === "outcome" && item.parentKey) errors.push(`${at}.parentKey is forbidden for outcome`);
    if (item.type === "decision" && item.status === "Ready") errors.push(`${at}.decision must remain Refinement or Blocked until decided`);
    if (!item.relations || typeof item.relations !== "object" || Array.isArray(item.relations)) {
      errors.push(`${at}.relations must be an object`);
    } else {
      validateStringArray(item.relations.blockedByKeys, `${at}.relations.blockedByKeys`, errors);
      validateStringArray(item.relations.relatedToKeys, `${at}.relations.relatedToKeys`, errors);
    }
    if (item.externalBlocker !== undefined) {
      if (!item.externalBlocker || typeof item.externalBlocker !== "object" || Array.isArray(item.externalBlocker)) {
        errors.push(`${at}.externalBlocker must be an object`);
      } else {
        requiredString(item.externalBlocker.reason, `${at}.externalBlocker.reason`, errors);
        validateRole(item.externalBlocker.ownerRole, `${at}.externalBlocker.ownerRole`, roles, errors);
        requiredString(item.externalBlocker.resumeWhen, `${at}.externalBlocker.resumeWhen`, errors);
      }
    }
    const blockedByKeys = Array.isArray(item.relations?.blockedByKeys) ? item.relations.blockedByKeys : [];
    if (item.status === "Ready" && blockedByKeys.length > 0) errors.push(`${at}.Ready cannot have blockedByKeys`);
    if (item.status === "Ready" && item.externalBlocker !== undefined) errors.push(`${at}.Ready cannot have an externalBlocker`);
    if (item.status === "Blocked" && blockedByKeys.length === 0 && item.externalBlocker === undefined) {
      errors.push(`${at}.Blocked requires blockedByKeys or externalBlocker`);
    }
  });

  issues.forEach((item, index) => {
    const at = `issues[${index}]`;
    if (item?.parentKey) {
      const parent = issueByKey.get(item.parentKey);
      if (!parent) errors.push(`${at}.parentKey references unknown issue ${item.parentKey}`);
      else if (parent.type !== "outcome") errors.push(`${at}.parentKey must reference an outcome issue`);
    }
    if (item?.milestoneKey && !milestoneKeys.has(item.milestoneKey)) errors.push(`${at}.milestoneKey references unknown milestone ${item.milestoneKey}`);
    for (const key of item?.resourceKeys ?? []) if (!resourceKeys.has(key)) errors.push(`${at}.resourceKeys references unknown resource ${key}`);
    const relations = item?.relations ?? {};
    for (const field of ["blockedByKeys", "relatedToKeys"]) {
      for (const key of relations[field] ?? []) if (!issueKeys.has(key)) errors.push(`${at}.relations.${field} references unknown issue ${key}`);
    }
    if (relations.duplicateOfKey !== undefined) requiredString(relations.duplicateOfKey, `${at}.relations.duplicateOfKey`, errors);
    if (relations.duplicateOfKey && !issueKeys.has(relations.duplicateOfKey)) errors.push(`${at}.relations.duplicateOfKey references unknown issue ${relations.duplicateOfKey}`);
    if ((relations.blockedByKeys ?? []).includes(item?.key) || (relations.relatedToKeys ?? []).includes(item?.key) || relations.duplicateOfKey === item?.key) errors.push(`${at} cannot relate to itself`);
    for (const key of relations.blockedByKeys ?? []) {
      if ((relations.relatedToKeys ?? []).includes(key) || relations.duplicateOfKey === key) errors.push(`${at}.relations cannot assign multiple relation types to ${key}`);
    }
    if (relations.duplicateOfKey && (relations.relatedToKeys ?? []).includes(relations.duplicateOfKey)) errors.push(`${at}.relations cannot assign multiple relation types to ${relations.duplicateOfKey}`);
  });
  const dependencies = new Map(issues.map((item) => [item.key, item.relations?.blockedByKeys ?? []]));
  for (const cycle of detectCycles(issueKeys, dependencies)) errors.push(`dependency cycle: ${cycle.join(" -> ")}`);
  const secretPaths = findSecretPaths(plan);
  if (secretPaths.length) errors.push(`secret-like data is forbidden at: ${[...new Set(secretPaths)].join(", ")}`);
  return [...new Set(errors)];
}

function validateWorkPlanV4(plan, options) {
  const errors = [];
  const allowedPriorities = new Set(["urgent", "high", "normal", "low"]);
  const compatibilityPlan = structuredClone(plan);
  compatibilityPlan.schemaVersion = 3;
  delete compatibilityPlan.planningStage;
  delete compatibilityPlan.sourceOutcomeKey;
  delete compatibilityPlan.phases;

  rejectUnknownProperties(plan, new Set([
    "schemaVersion", "kind", "mode", "planningStage", "sourceOutcomeKey", "summary",
    "project", "phases", "milestones", "resources", "issues",
  ]), "plan", errors);
  rejectUnknownProperties(plan.project, new Set([
    "owner", "number", "repositories", "name", "description",
    "lifecycle", "priority", "startDate", "targetDate",
  ]), "project", errors);
  rejectUnknownProperties(plan.project?.lifecycle, new Set(["mode", "completionCriteria"]), "project.lifecycle", errors);
  if (plan.project?.lifecycle !== undefined && (!Array.isArray(plan.project.lifecycle.completionCriteria) || plan.project.lifecycle.completionCriteria.length === 0)) {
    errors.push("project.lifecycle.completionCriteria must be non-empty");
  }
  if (plan.project?.priority !== undefined && !allowedPriorities.has(plan.project.priority)) errors.push("project.priority is invalid");

  const milestones = Array.isArray(plan.milestones) ? plan.milestones : [];
  const milestoneKeys = new Set(milestones.map((item) => item?.key));
  milestones.forEach((item, index) => rejectUnknownProperties(
    item,
    new Set(["key", "githubMilestone", "repository", "name", "description", "targetDate"]),
    `milestones[${index}]`,
    errors,
  ));

  const resources = Array.isArray(plan.resources) ? plan.resources : [];
  resources.forEach((item, index) => rejectUnknownProperties(
    item,
    new Set(["key", "title", "type", "url", "content"]),
    `resources[${index}]`,
    errors,
  ));

  const phases = Array.isArray(plan.phases) ? plan.phases : [];
  if (plan.phases !== undefined && !Array.isArray(plan.phases)) errors.push("phases must be an array");
  const phaseKeys = new Set();
  const phaseOrders = new Set();
  phases.forEach((phase, index) => {
    const at = `phases[${index}]`;
    rejectUnknownProperties(phase, new Set([
      "key", "order", "objective", "entryCriteria", "exitCriteria", "milestoneKeys",
    ]), at, errors);
    if (typeof phase?.key !== "string" || !KEY_PATTERN.test(phase.key)) errors.push(`${at}.key is invalid`);
    if (phaseKeys.has(phase?.key)) errors.push(`duplicate phase key: ${phase.key}`);
    phaseKeys.add(phase?.key);
    if (!Number.isInteger(phase?.order) || phase.order < 1) errors.push(`${at}.order must be a positive integer`);
    if (phaseOrders.has(phase?.order)) errors.push(`duplicate phase order: ${phase.order}`);
    phaseOrders.add(phase?.order);
    requiredString(phase?.objective, `${at}.objective`, errors);
    validateStringArray(phase?.entryCriteria, `${at}.entryCriteria`, errors, { nonEmpty: true });
    validateStringArray(phase?.exitCriteria, `${at}.exitCriteria`, errors, { nonEmpty: true });
    validateStringArray(phase?.milestoneKeys, `${at}.milestoneKeys`, errors);
    for (const key of phase?.milestoneKeys ?? []) if (!milestoneKeys.has(key)) errors.push(`${at}.milestoneKeys references unknown milestone ${key}`);
  });

  const issues = Array.isArray(plan.issues) ? plan.issues : [];
  const issueByKey = new Map(issues.map((issue) => [issue?.key, issue]));
  issues.forEach((item, index) => {
    const at = `issues[${index}]`;
    rejectUnknownProperties(item, new Set([
      "key", "githubIssue", "repository", "type", "parentKey", "title", "outcome", "context", "deliverable",
      "delivery", "status", "priority", "ownerRole", "reviewerRole", "assignees", "phaseKey",
      "prioritySource",
      "milestoneKey", "iterationId", "estimate", "estimateReason", "dueDate", "labels", "definitionOfReady",
      "definitionOfDone", "acceptanceCriteria", "resourceKeys", "externalBlocker", "relations",
    ]), at, errors);
    rejectUnknownProperties(item?.delivery, new Set(["mode", "ownerRole", "target", "verification"]), `${at}.delivery`, errors);
    rejectUnknownProperties(item?.relations, new Set(["blockedByKeys", "relatedToKeys", "duplicateOfKey"]), `${at}.relations`, errors);
    rejectUnknownProperties(item?.externalBlocker, new Set(["reason", "ownerRole", "resumeWhen"]), `${at}.externalBlocker`, errors);
    if (item?.type === "task" && !item.parentKey) errors.push(`${at}.parentKey is required for task`);
    if (item?.type === "outcome" && Object.hasOwn(item, "parentKey")) errors.push(`${at}.parentKey is forbidden for outcome`);
    if (!allowedPriorities.has(item?.priority)) errors.push(`${at}.priority is invalid`);
    if (!new Set(["explicit", "inherited", "policy-default"]).has(item?.prioritySource)) errors.push(`${at}.prioritySource is invalid`);
    if (item?.prioritySource === "policy-default" && item?.priority !== "normal") errors.push(`${at}.prioritySource policy-default requires priority normal`);
    if (item?.prioritySource === "inherited") {
      const parent = issueByKey.get(item.parentKey);
      if (!parent || parent.priority !== item.priority) errors.push(`${at}.prioritySource inherited requires the direct parent priority to match`);
    }
    if (item?.phaseKey !== undefined && !phaseKeys.has(item.phaseKey)) errors.push(`${at}.phaseKey references unknown phase ${item.phaseKey}`);
    for (const field of ["title", "outcome", "context", "deliverable"]) {
      if (containsPrivateLocalPath(item?.[field])) errors.push(`${at}.${field} contains a private local path and must not reach Linear`);
    }

    const checks = item?.delivery?.verification;
    if (Array.isArray(checks)) {
      checks.forEach((check, checkIndex) => rejectUnknownProperties(
        check,
        new Set(["mode", "check"]),
        `${at}.delivery.verification[${checkIndex}]`,
        errors,
      ));
      errors.push(...validateDeliveryVerification({ deliveryMode: item?.delivery?.mode, checks })
        .map((error) => `${at}.${error}`));
    } else {
      errors.push(`${at}.delivery.verification must be an array of objects`);
    }

    if (compatibilityPlan.issues?.[index]?.delivery) {
      compatibilityPlan.issues[index].delivery.verification = Array.isArray(checks)
        ? checks.map((check) => typeof check?.check === "string" ? check.check : "")
        : checks;
    }
    if (compatibilityPlan.issues?.[index]) delete compatibilityPlan.issues[index].phaseKey;
    if (compatibilityPlan.issues?.[index]) delete compatibilityPlan.issues[index].prioritySource;
  });

  (Array.isArray(plan.resources) ? plan.resources : []).forEach((resource, index) => {
    for (const field of ["title", "content", "url"]) {
      if (containsPrivateLocalPath(resource?.[field])) errors.push(`resources[${index}].${field} contains a private local path and must not reach Linear`);
    }
  });
  for (const field of ["name", "summary", "description"]) {
    if (containsPrivateLocalPath(plan.project?.[field])) errors.push(`project.${field} contains a private local path and must not reach Linear`);
  }

  errors.push(...validatePlanningStructure(plan));
  // The compatibility pass is an internal structural check of the derived v3
  // shape; forApply must not propagate or every canonical v4 apply would be
  // rejected with a demand to migrate to v4.
  errors.push(...validateWorkPlan(compatibilityPlan, { ...options, forApply: false }));
  return [...new Set(errors)];
}

function validateOptionalDate(value, location, errors) {
  if (value === undefined) return;
  if (parseIsoDate(value) === null) errors.push(`${location} must be a valid ISO date`);
}

function isDateAfter(left, right) {
  const leftValue = parseIsoDate(left);
  const rightValue = parseIsoDate(right);
  return leftValue !== null && rightValue !== null && leftValue > rightValue;
}

function parseIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.valueOf();
}

export function validateProjectUpdate(update, { projectId, forPublish = false } = {}) {
  const errors = [];
  if (!update || typeof update !== "object" || Array.isArray(update)) return ["project update must be an object"];
  if (update.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (update.kind !== "github-project-update") errors.push("kind must be github-project-update");
  if (!new Set(["preview", "publish"]).has(update.mode)) errors.push("mode must be preview or publish");
  if (forPublish && update.mode !== "publish") errors.push("mode must be publish for a Linear mutation");
  requiredString(update.projectId, "projectId", errors);
  if (projectId && update.projectId !== projectId) errors.push(`projectId ${update.projectId} does not match bound Project ${projectId}`);
  if (!new Set(["ON_TRACK", "AT_RISK", "OFF_TRACK", "INACTIVE", "COMPLETE"]).has(update.health)) errors.push("health is invalid");
  requiredString(update.summary, "summary", errors);
  validateStringArray(update.progress, "progress", errors);
  validateStringArray(update.risks, "risks", errors);
  validateStringArray(update.nextSteps, "nextSteps", errors, { nonEmpty: true });
  if (!Array.isArray(update.evidence)) errors.push("evidence must be an array");
  else update.evidence.forEach((item, index) => {
    requiredString(item?.label, `evidence[${index}].label`, errors);
    requiredString(item?.value, `evidence[${index}].value`, errors);
  });
  collectUnsafeCommentPaths({
    summary: update.summary,
    progress: update.progress,
    risks: update.risks,
    nextSteps: update.nextSteps,
    evidence: (Array.isArray(update.evidence) ? update.evidence : []).flatMap((item) => [item?.label, item?.value]),
  }, "", errors);
  const secretPaths = findSecretPaths(update);
  if (secretPaths.length) errors.push(`secret-like data is forbidden at: ${[...new Set(secretPaths)].join(", ")}`);
  return [...new Set(errors)];
}

export function renderProjectUpdate(update) {
  const errors = validateProjectUpdate(update);
  if (errors.length) throw new Error(`invalid project update: ${errors.join("; ")}`);
  const bullets = (items, fallback) => items.length ? items.map((item) => `- ${item}`) : [`- ${fallback}`];
  const evidence = update.evidence.length ? update.evidence.map((item) => `- **${item.label}:** ${item.value}`) : ["- Chưa có evidence mới."];
  const health = { ON_TRACK: "On track", AT_RISK: "At risk", OFF_TRACK: "Off track", INACTIVE: "Inactive", COMPLETE: "Complete" }[update.health];
  return [
    `# Project Update · ${health}`,
    "", update.summary,
    "", "## Tiến độ", "", ...bullets(update.progress, "Chưa có thay đổi tiến độ được ghi nhận."),
    "", "## Rủi ro", "", ...bullets(update.risks, "Không có rủi ro được ghi nhận."),
    "", "## Bước tiếp theo", "", ...bullets(update.nextSteps, "Chưa xác định."),
    "", "## Bằng chứng", "", ...evidence,
    "",
  ].join("\n");
}

export function validateLegacyCleanupPlan(plan, { projectId, forApply = false } = {}) {
  const errors = [];
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return ["cleanup plan must be an object"];
  if (plan.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (plan.kind !== "github-legacy-cleanup-plan") errors.push("kind must be github-legacy-cleanup-plan");
  if (!new Set(["preview", "apply"]).has(plan.mode)) errors.push("mode must be preview or apply");
  if (forApply && plan.mode !== "apply") errors.push("mode must be apply for destructive cleanup");
  requiredString(plan.projectId, "projectId", errors);
  if (projectId && plan.projectId !== projectId) errors.push(`projectId ${plan.projectId} does not match bound Project ${projectId}`);
  if (typeof plan.planId !== "string" || !KEY_PATTERN.test(plan.planId)) errors.push("planId is invalid");
  if (typeof plan.snapshotAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(plan.snapshotAt) || Number.isNaN(Date.parse(plan.snapshotAt))) errors.push("snapshotAt must be a valid ISO timestamp with timezone");
  if (!Array.isArray(plan.entries) || plan.entries.length === 0) errors.push("entries must be a non-empty array");
  const ids = new Set();
  const destructive = new Set(["MERGE_THEN_DELETE", "CONVERT_TO_RESOURCE_THEN_DELETE", "DELETE_ISSUE", "DELETE_COMMENT"]);
  for (const [index, entry] of (plan.entries ?? []).entries()) {
    const at = `entries[${index}]`;
    if (!new Set(["issue", "comment", "resource"]).has(entry?.entityType)) errors.push(`${at}.entityType is invalid`);
    requiredString(entry?.id, `${at}.id`, errors);
    if (ids.has(entry?.id)) errors.push(`duplicate cleanup entity id: ${entry.id}`);
    ids.add(entry?.id);
    if (!new Set(["KEEP", "NORMALIZE", "MERGE_THEN_DELETE", "CONVERT_TO_RESOURCE_THEN_DELETE", "DELETE_ISSUE", "DELETE_COMMENT", "NEEDS_DECISION"]).has(entry?.action)) errors.push(`${at}.action is invalid`);
    requiredString(entry?.reason, `${at}.reason`, errors);
    validateStringArray(entry?.preserve, `${at}.preserve`, errors);
    if ((entry?.action === "MERGE_THEN_DELETE") && !entry.canonicalIssueId) errors.push(`${at}.canonicalIssueId is required for MERGE_THEN_DELETE`);
    if (entry?.action === "DELETE_ISSUE" && entry?.entityType !== "issue") errors.push(`${at}.DELETE_ISSUE requires entityType issue`);
    if (entry?.action === "DELETE_COMMENT" && entry?.entityType !== "comment") errors.push(`${at}.DELETE_COMMENT requires entityType comment`);
    if (forApply && destructive.has(entry?.action) && entry?.approved !== true) errors.push(`${at}.approved must be explicitly approved (true) for destructive cleanup`);
  }
  const secretPaths = findSecretPaths(plan);
  if (secretPaths.length) errors.push(`secret-like data is forbidden at: ${[...new Set(secretPaths)].join(", ")}`);
  return [...new Set(errors)];
}

export function validateHandoff(handoff, { roles = DEFAULT_ROLES } = {}) {
  if (handoff?.schemaVersion === 2) return validateHandoffV2(handoff, { roles });
  return validateLegacyHandoff(handoff);
}

function validateHandoffV2(handoff, { roles }) {
  const errors = [];
  const eventTypes = new Set(["handoff", "review", "delivery", "verification", "blocked", "reconciliation"]);
  const evidenceKinds = new Set(["url", "github-resource", "commit", "text", "local-note", "local-file", "validator", "report"]);
  const sharedEvidenceKinds = new Set(["url", "github-resource", "commit", "text"]);

  rejectUnknownProperties(handoff, new Set([
    "schemaVersion", "kind", "type", "issueId", "fromRole", "toRole", "summary", "observedAt",
    "observedState", "appliedState", "transition", "deliverables", "checks", "evidence", "knownLimitations",
    "nextAction", "delivery", "review", "verification", "blocker", "software", "nextExecution",
  ]), "handoff", errors);
  if (handoff.kind !== "github-role-handoff") errors.push("kind must be github-role-handoff");
  if (!eventTypes.has(handoff.type)) errors.push("type is invalid");
  if (typeof handoff.issueId !== "string" || !GITHUB_ISSUE_PATTERN.test(handoff.issueId)) errors.push("issueId must be owner/repo#number");
  requiredString(handoff.summary, "summary", errors);
  requiredString(handoff.nextAction, "nextAction", errors);
  validateRole(handoff.fromRole, "fromRole", roles, errors);
  validateRole(handoff.toRole, "toRole", roles, errors, { optional: true });
  validateTimestamp(handoff.observedAt, "observedAt", errors);

  rejectUnknownProperties(handoff.observedState, new Set(["issueUpdatedAt", "status", "logicalState"]), "observedState", errors);
  if (!handoff.observedState || typeof handoff.observedState !== "object" || Array.isArray(handoff.observedState)) {
    errors.push("observedState must be an object");
  } else {
    validateTimestamp(handoff.observedState.issueUpdatedAt, "observedState.issueUpdatedAt", errors);
    requiredString(handoff.observedState.status, "observedState.status", errors);
    requiredString(handoff.observedState.logicalState, "observedState.logicalState", errors);
    if (Date.parse(handoff.observedAt) < Date.parse(handoff.observedState.issueUpdatedAt)) errors.push("observedAt cannot be before observedState.issueUpdatedAt");
  }

  if (handoff.appliedState !== undefined) {
    rejectUnknownProperties(handoff.appliedState, new Set(["issueUpdatedAt", "status"]), "appliedState", errors);
    if (!handoff.appliedState || typeof handoff.appliedState !== "object" || Array.isArray(handoff.appliedState)) {
      errors.push("appliedState must be an object");
    } else {
      validateTimestamp(handoff.appliedState.issueUpdatedAt, "appliedState.issueUpdatedAt", errors);
      requiredString(handoff.appliedState.status, "appliedState.status", errors);
      if (typeof handoff.observedState?.issueUpdatedAt === "string"
        && Date.parse(handoff.appliedState.issueUpdatedAt) < Date.parse(handoff.observedState.issueUpdatedAt)) {
        errors.push("appliedState.issueUpdatedAt cannot predate observedState.issueUpdatedAt");
      }
    }
  }

  rejectUnknownProperties(handoff.transition, new Set(["from", "to"]), "transition", errors);
  if (!handoff.transition || typeof handoff.transition !== "object" || Array.isArray(handoff.transition)) {
    errors.push("transition must be an object");
  } else {
    requiredString(handoff.transition.from, "transition.from", errors);
    requiredString(handoff.transition.to, "transition.to", errors);
    if (handoff.observedState?.logicalState !== handoff.transition.from) errors.push("observedState.logicalState must match transition.from");
  }

  if (!Array.isArray(handoff.checks)) errors.push("checks must be an array");
  else handoff.checks.forEach((check, index) => {
    rejectUnknownProperties(check, new Set(["item", "passed"]), `checks[${index}]`, errors);
    requiredString(check?.item, `checks[${index}].item`, errors);
    if (typeof check?.passed !== "boolean") errors.push(`checks[${index}].passed must be boolean`);
  });

  if (!Array.isArray(handoff.evidence)) errors.push("evidence must be an array");
  else handoff.evidence.forEach((item, index) => {
    const at = `evidence[${index}]`;
    rejectUnknownProperties(item, new Set(["kind", "label", "value", "visibility"]), at, errors);
    if (!evidenceKinds.has(item?.kind)) errors.push(`${at}.kind is invalid`);
    requiredString(item?.label, `${at}.label`, errors);
    requiredString(item?.value, `${at}.value`, errors);
    if (!new Set(["shared", "local"]).has(item?.visibility)) errors.push(`${at}.visibility is invalid`);
    if (item?.visibility === "shared" && (!sharedEvidenceKinds.has(item.kind) || containsLocalEvidence(item.value))) {
      errors.push(`${at} shared evidence must not contain a local path or unsupported kind`);
    }
  });

  if (!handoff.delivery || typeof handoff.delivery !== "object" || Array.isArray(handoff.delivery)) {
    errors.push("delivery is required and must be an object");
  } else {
    rejectUnknownProperties(handoff.delivery, new Set(["mode", "ownerRole", "phase", "target", "checks"]), "delivery", errors);
    if (!DELIVERY_MODES.includes(handoff.delivery.mode)) errors.push("delivery.mode is invalid");
    validateRole(handoff.delivery.ownerRole, "delivery.ownerRole", roles, errors);
    if (!DELIVERY_PHASES.includes(handoff.delivery.phase)) errors.push("delivery.phase is invalid");
    if (handoff.delivery.target !== undefined) requiredString(handoff.delivery.target, "delivery.target", errors);
    if (Array.isArray(handoff.delivery.checks)) {
      handoff.delivery.checks.forEach((check, index) => rejectUnknownProperties(
        check,
        new Set(["mode", "check", "passed"]),
        `delivery.checks[${index}]`,
        errors,
      ));
      errors.push(...validateDeliveryVerification({ deliveryMode: handoff.delivery.mode, checks: handoff.delivery.checks }));
    } else {
      errors.push("delivery.checks must be a non-empty array");
    }
  }

  if (handoff.nextExecution !== undefined) {
    rejectUnknownProperties(handoff.nextExecution, new Set(["sessionPolicy", "modelClass", "effort", "reason"]), "nextExecution", errors);
    if (!new Set(["reuse", "new-preferred", "new-required"]).has(handoff.nextExecution?.sessionPolicy)) errors.push("nextExecution.sessionPolicy is invalid");
    if (!new Set(["fast", "standard", "reasoning"]).has(handoff.nextExecution?.modelClass)) errors.push("nextExecution.modelClass is invalid");
    if (!new Set(["low", "medium", "high"]).has(handoff.nextExecution?.effort)) errors.push("nextExecution.effort is invalid");
    requiredString(handoff.nextExecution?.reason, "nextExecution.reason", errors);
  }

  if (handoff.type === "handoff") {
    validateRole(handoff.toRole, "toRole", roles, errors);
    validateStringArray(handoff.deliverables, "deliverables", errors, { nonEmpty: true });
    if (!Array.isArray(handoff.checks) || handoff.checks.length === 0) errors.push("handoff checks must include the Definition of Done");
    if ((handoff.checks ?? []).some((check) => check?.passed !== true)) errors.push("all Definition of Done checks must pass before handoff");
  }
  if (handoff.type === "review") {
    rejectUnknownProperties(handoff.review, new Set(["decision", "findings", "independence"]), "review", errors);
    if (!Array.isArray(handoff.checks) || handoff.checks.length === 0) errors.push("review checks must include the reviewed Definition of Done");
    if (!Array.isArray(handoff.evidence) || handoff.evidence.length === 0) errors.push("review evidence must be non-empty");
    if (!new Set(["passed", "changes-requested"]).has(handoff.review?.decision)) errors.push("review.decision is invalid");
    if (!Array.isArray(handoff.review?.findings)) errors.push("review.findings must be an array");
    if (handoff.review?.decision === "passed" && !new Set(["fresh-session", "fresh-subagent", "external-reviewer"]).has(handoff.review?.independence)) errors.push("review.independence is required for a passed review");
    if (handoff.review?.decision === "passed" && (handoff.checks ?? []).some((check) => check?.passed !== true)) errors.push("a passed review requires all checks to pass");
    if (handoff.review?.decision === "changes-requested") validateRole(handoff.toRole, "toRole", roles, errors);
  }
  if (handoff.type === "verification") {
    rejectUnknownProperties(handoff.verification, new Set(["decision"]), "verification", errors);
    if (!Array.isArray(handoff.checks) || handoff.checks.length === 0) errors.push("verification checks must be non-empty");
    if (!Array.isArray(handoff.evidence) || handoff.evidence.length === 0) errors.push("verification evidence must be non-empty");
    if (!new Set(["passed", "failed"]).has(handoff.verification?.decision)) errors.push("verification.decision is invalid");
    if (handoff.verification?.decision === "passed" && handoff.transition?.to === "done") {
      if (handoff.fromRole !== handoff.delivery?.ownerRole) errors.push("verification fromRole must match delivery.ownerRole");
      if (!Array.isArray(handoff.checks) || handoff.checks.length === 0 || handoff.checks.some((check) => check?.passed !== true)) errors.push("terminal verification requires all declared checks to pass");
      const sharedEvidence = (handoff.evidence ?? []).filter((item) => item?.visibility === "shared" && isCommentSafe(item.value));
      if (sharedEvidence.length === 0) errors.push("terminal verification requires shared evidence");
    }
  }
  if (handoff.type === "blocked") {
    rejectUnknownProperties(handoff.blocker, new Set(["reason", "impact", "neededFrom", "resumeWhen"]), "blocker", errors);
    for (const field of ["reason", "impact", "neededFrom", "resumeWhen"]) requiredString(handoff.blocker?.[field], `blocker.${field}`, errors);
  }

  if (handoff.delivery && handoff.transition) {
    errors.push(...validateHandoffTransition({
      type: handoff.type,
      reviewDecision: handoff.review?.decision,
      verificationDecision: handoff.verification?.decision,
      deliveryMode: handoff.delivery.mode,
      from: handoff.transition.from,
      to: handoff.transition.to,
      checks: handoff.delivery.checks,
    }));
    const expectedPhase = {
      "in-review": "review",
      "ready-to-deliver": "ready-to-deliver",
      "delivery-verification": "delivery-verification",
      done: "complete",
    }[handoff.transition.to];
    if (expectedPhase && handoff.delivery.phase !== expectedPhase) errors.push(`delivery.phase must be ${expectedPhase} for transition.to ${handoff.transition.to}`);
  }

  if (handoff.software !== undefined) validateSoftwareHandoff(handoff, roles, errors);
  validateCommentSafety(handoff, errors);
  const secretPaths = findSecretPaths(handoff);
  if (secretPaths.length) errors.push(`secret-like data is forbidden at: ${[...new Set(secretPaths)].join(", ")}`);
  return [...new Set(errors)];
}

export function validateHandoffAgainstIssue(handoff, issue) {
  const errors = [];
  if (handoff?.schemaVersion !== 2) return ["handoff v2 is required for live-state validation"];
  if (!issue || typeof issue !== "object" || Array.isArray(issue)) return ["current issue snapshot is required"];
  if (handoff.issueId !== issue.id) errors.push(`handoff issueId ${handoff.issueId} does not match current issue ${issue.id}`);
  if (handoff.observedState?.issueUpdatedAt !== issue.updatedAt) errors.push("handoff observation is stale; issueUpdatedAt changed");
  if (typeof issue.status !== "string" || handoff.observedState?.status !== issue.status) errors.push("handoff observed physical status does not match current issue status");
  if (handoff.transition?.from !== issue.logicalState) errors.push("handoff transition.from does not match current logical state");
  return [...new Set(errors)];
}

function validateCommentSafety(handoff, errors) {
  const rendered = {
    summary: handoff.summary,
    deliverables: handoff.deliverables,
    checks: (handoff.checks ?? []).map((check) => check?.item),
    evidence: (handoff.evidence ?? []).filter((item) => item?.visibility === "shared").flatMap((item) => [item.label, item.value]),
    knownLimitations: handoff.knownLimitations,
    deliveryTarget: handoff.delivery?.target,
    reviewFindings: handoff.review?.findings,
    blocker: handoff.blocker,
    nextAction: handoff.nextAction,
  };
  collectUnsafeCommentPaths(rendered, "", errors);
}

function collectUnsafeCommentPaths(value, path, errors) {
  if (typeof value === "string") {
    if (!isCommentSafe(value)) errors.push(`${path || "comment"} is not comment-safe: local paths and hidden coordination details are forbidden`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectUnsafeCommentPaths(item, `${path}[${index}]`, errors));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) collectUnsafeCommentPaths(item, path ? `${path}.${key}` : key, errors);
}

function validateTimestamp(value, location, errors) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) || Number.isNaN(Date.parse(value))) {
    errors.push(`${location} must be a valid ISO timestamp with timezone`);
  }
}

function validateSoftwareHandoff(handoff, roles, errors) {
  if (!handoff.software || typeof handoff.software !== "object" || Array.isArray(handoff.software)) {
    errors.push("software must be an object");
    return;
  }
  if (handoff.type !== "handoff") errors.push("software evidence is only valid for a handoff");
  rejectUnknownProperties(handoff.software, new Set(["commitSha", "branchName", "branchPushed", "pullRequestUrl", "ciStatus", "git"]), "software", errors);
  rejectUnknownProperties(handoff.software.git, new Set(["baselineId", "changeBaseSha", "scopePaths"]), "software.git", errors);
  if (handoff.fromRole !== "software-engineer") errors.push("software evidence requires fromRole software-engineer");
  validateRole(handoff.fromRole, "fromRole", roles, errors);
  if (typeof handoff.software.commitSha !== "string" || !/^[0-9a-f]{7,64}$/iu.test(handoff.software.commitSha)) errors.push("software.commitSha is invalid");
  requiredString(handoff.software.branchName, "software.branchName", errors);
  if (handoff.software.branchPushed !== undefined && typeof handoff.software.branchPushed !== "boolean") errors.push("software.branchPushed must be boolean");
  if (handoff.software.pullRequestUrl !== undefined && (typeof handoff.software.pullRequestUrl !== "string" || !/^https?:\/\//u.test(handoff.software.pullRequestUrl))) errors.push("software.pullRequestUrl must be an http(s) URL");
  if (handoff.software.ciStatus !== undefined && !new Set(["passed", "failed", "pending", "not-configured"]).has(handoff.software.ciStatus)) errors.push("software.ciStatus is invalid");
  if (typeof handoff.software.git?.baselineId !== "string" || !/^[0-9a-f]{64}$/iu.test(handoff.software.git.baselineId)) errors.push("software.git.baselineId is invalid");
  if (typeof handoff.software.git?.changeBaseSha !== "string" || !/^[0-9a-f]{7,64}$/iu.test(handoff.software.git.changeBaseSha)) errors.push("software.git.changeBaseSha is invalid");
  validateStringArray(handoff.software.git?.scopePaths, "software.git.scopePaths", errors, { nonEmpty: true });
}

export function renderWorkComment(handoff, { roles = DEFAULT_ROLES } = {}) {
  const errors = validateHandoff(handoff, { roles });
  if (errors.length) throw new Error(`invalid handoff: ${errors.join("; ")}`);
  const role = (value) => value?.replaceAll("-", " ") ?? "—";
  const commentText = (value, fallback = "Local-only detail omitted.") => isCommentSafe(value) ? value : fallback;
  const compactBullets = (items, { fallback = "- Không có.", limit = 3, overflowLabel = "mục" } = {}) => {
    if (!items?.length) return [fallback];
    const visible = items.slice(0, limit).map((item) => `- ${commentText(item)}`);
    const hidden = items.length - visible.length;
    if (hidden > 0) visible.push(`- +${hidden} ${overflowLabel} khác được giữ trong artifact bền vững.`);
    return visible;
  };
  const localOnlyEvidence = containsLocalEvidence;
  const visibleEvidence = (handoff.evidence ?? []).filter((item) => {
    if (handoff.schemaVersion === 2 && (item.visibility !== "shared" || !new Set(["url", "github-resource", "commit", "text"]).has(item.kind))) return false;
    return !localOnlyEvidence(item.value);
  });
  const hiddenLocalEvidenceCount = (handoff.evidence ?? []).length - visibleEvidence.length;
  const evidence = visibleEvidence.length
    ? visibleEvidence.slice(0, 3).map((item) => `- **${commentText(item.label)}:** ${commentText(item.value)}`)
    : ["- Không có bằng chứng truy cập được đính kèm."];
  if (visibleEvidence.length > 3) evidence.push(`- +${visibleEvidence.length - 3} bằng chứng khác được giữ trong artifact bền vững.`);
  if (hiddenLocalEvidenceCount > 0) evidence.push(`- ${hiddenLocalEvidenceCount} bằng chứng local-only được giữ ngoài Linear.`);
  const passedChecks = (handoff.checks ?? []).filter((item) => item.passed).length;
  const checks = handoff.checks?.length
    ? [
        `- [${passedChecks === handoff.checks.length ? "x" : " "}] ${passedChecks}/${handoff.checks.length} checks passed.`,
        ...handoff.checks.filter((item) => !item.passed).slice(0, 3).map((item) => `- [ ] ${commentText(item.item)}`),
      ]
    : ["- Không có kiểm tra được khai báo."];
  const delivery = handoff.delivery ? [
    "", "## Delivery", "",
    `- **Mode:** ${handoff.delivery.mode}`,
    `- **Phase:** ${handoff.delivery.phase}`,
    ...(handoff.delivery.target ? [`- **Target:** ${commentText(handoff.delivery.target)}`] : []),
  ] : [];
  const next = ["", "## Bước tiếp theo", "", commentText(handoff.nextAction)];
  if (handoff.type === "handoff") return [
    `## ✅ Bàn giao · ${role(handoff.fromRole)} → ${role(handoff.toRole)}`,
    "", "## Kết quả", "", commentText(handoff.summary),
    "", "## Sản phẩm bàn giao", "", ...compactBullets(handoff.deliverables, { overflowLabel: "sản phẩm bàn giao" }),
    "", "## Kiểm tra DoD", "", ...checks,
    "", "## Bằng chứng", "", ...evidence,
    "", "## Giới hạn đã biết", "", ...compactBullets(handoff.knownLimitations, { overflowLabel: "giới hạn" }),
    ...delivery,
    ...next, "",
  ].join("\n");
  if (handoff.type === "review") {
    const passed = handoff.review.decision === "passed";
    const independence = handoff.schemaVersion === 2 && passed
      ? ["", "Independent review was recorded before this transition."]
      : [];
    return [
      `## ${passed ? "✅ Review đạt" : "🔁 Yêu cầu chỉnh sửa"} · ${role(handoff.fromRole)}`,
      "", "## Kết luận", "", commentText(handoff.summary),
      ...independence,
      "", "## Kiểm tra DoD", "", ...checks,
      "", "## Phát hiện", "", ...compactBullets(handoff.review.findings, { limit: 5, overflowLabel: "phát hiện" }),
      "", "## Bằng chứng", "", ...evidence,
      ...delivery,
      ...next, "",
    ].join("\n");
  }
  if (handoff.type === "delivery") return [
    `## Delivery performed · ${role(handoff.fromRole)}`,
    "", "## Result", "", commentText(handoff.summary),
    "", "## Evidence", "", ...evidence,
    ...delivery,
    ...next, "",
  ].join("\n");
  if (handoff.type === "verification") {
    const passed = handoff.verification?.decision === "passed";
    return [
      `## Delivery verification ${passed ? "passed" : "failed"} · ${role(handoff.fromRole)}`,
      "", "## Result", "", commentText(handoff.summary),
      "", "## Terminal checks", "", ...checks,
      "", "## Evidence", "", ...evidence,
      ...delivery,
      ...next, "",
    ].join("\n");
  }
  if (handoff.type === "blocked") return [
    `## ⛔ Bị chặn · ${role(handoff.fromRole)}`,
    "", "## Tình trạng", "", commentText(handoff.summary),
    "", "## Nguyên nhân", "", commentText(handoff.blocker.reason),
    "", "## Ảnh hưởng", "", commentText(handoff.blocker.impact),
    "", "## Cần từ", "", commentText(handoff.blocker.neededFrom),
    "", "## Tiếp tục khi", "", commentText(handoff.blocker.resumeWhen),
    ...delivery,
    ...next, "",
  ].join("\n");
  return [
    `## 🧭 Hòa giải · ${role(handoff.fromRole)}`,
    "", "## Kết quả", "", commentText(handoff.summary),
    "", "## Bằng chứng", "", ...evidence,
    ...delivery,
    ...next, "",
  ].join("\n");
}
