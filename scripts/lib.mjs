import { readFile } from "node:fs/promises";

const SECRET_PATTERNS = [
  /\bgh[opsu]_[A-Za-z0-9_]{20,}\b/u,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/u,
  /\bBearer\s+[A-Za-z0-9._-]{20,}\b/iu,
  /\b(?:GITHUB_TOKEN|GH_TOKEN)\s*=/iu,
];
const STATUSES = new Set(["Refinement", "Ready", "In Progress", "In Review", "Ready to Deliver", "Delivery Verification", "Blocked", "Done", "Canceled"]);
const DELIVERY_MODES = new Set(["artifact-review", "publish", "external-action", "software-merge", "production-release", "operations-change"]);
const ISSUE_KINDS = new Set(["outcome", "task", "decision"]);
const PRIORITIES = new Set(["urgent", "high", "normal", "low", "none"]);
const ESTIMATES = new Set([1, 2, 3, 5, 8, 13]);
const SETUP_FIELDS = new Set(["status", "role", "priority", "deliveryPhase", "estimate"]);
const WORKFLOWS = new Set(["item-added", "closed-issue", "merged-pr", "auto-archive", "auto-add"]);
const WORKFLOW_STATES = new Set(["enabled", "disabled", "preserve"]);
const STANDARD_VIEWS = new Map([
  ["Delivery board", "board"],
  ["Role queues", null],
  ["Roadmap", "roadmap"],
  ["Review & delivery", null],
  ["Blocked", null],
  ["Decisions", null],
]);
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const KEY = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export function containsSecret(value) {
  const serialized = JSON.stringify(value);
  return SECRET_PATTERNS.some((pattern) => pattern.test(serialized));
}

export function stableKey(...parts) {
  return parts
    .flat()
    .filter((part) => part !== undefined && part !== null && String(part).trim())
    .map((part) => String(part).trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, ""))
    .filter(Boolean)
    .join(".");
}

export function validateProjectBinding(binding) {
  const errors = [];
  if (!isObject(binding)) return ["binding must be an object"];
  if (binding.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (!isObject(binding.github)) errors.push("github must be an object");
  else {
    requiredString(binding.github.owner, "github.owner", errors);
    if (!Number.isInteger(binding.github.projectNumber) || binding.github.projectNumber < 1) errors.push("github.projectNumber must be a positive integer");
    if (!Array.isArray(binding.github.repositories) || !binding.github.repositories.length) errors.push("github.repositories must be a non-empty array");
    else {
      unique(binding.github.repositories, "github.repositories", errors);
      binding.github.repositories.forEach((repo, index) => {
        if (typeof repo !== "string" || !REPOSITORY.test(repo)) errors.push(`github.repositories[${index}] is invalid`);
      });
    }
  }
  for (const field of ["status", "role", "priority", "deliveryPhase", "estimate"]) requiredString(binding.fields?.[field], `fields.${field}`, errors);
  for (const status of ["refinement", "ready", "inProgress", "inReview", "readyToDeliver", "deliveryVerification", "blocked", "done", "canceled"]) requiredString(binding.statuses?.[status], `statuses.${status}`, errors);
  if (Array.isArray(binding.roles)) unique(binding.roles, "roles", errors);
  if (containsSecret(binding)) errors.push("binding contains credential-like data");
  return errors;
}

export function validateWorkPlan(plan, { binding, forApply = false } = {}) {
  const errors = [];
  if (!isObject(plan)) return ["plan must be an object"];
  if (![1, 2].includes(plan.schemaVersion)) errors.push("schemaVersion must be 1 or 2");
  if (!["preview", "apply"].includes(plan.mode)) errors.push("mode must be preview or apply");
  if (forApply && plan.mode !== "apply") errors.push("mode must be apply");
  if (forApply && plan.schemaVersion !== 2) errors.push("schemaVersion 2 is required for apply");
  requiredString(plan.project?.owner, "project.owner", errors);
  if (!Number.isInteger(plan.project?.number) || plan.project.number < 1) errors.push("project.number must be a positive integer");
  if (!new Set(["bounded", "continuous"]).has(plan.project?.lifecycle?.mode)) errors.push("project.lifecycle.mode is invalid");
  nonEmptyStringArray(plan.project?.lifecycle?.completionCriteria, "project.lifecycle.completionCriteria", errors);

  if (binding) {
    if (plan.project?.owner !== binding.github?.owner) errors.push("project.owner does not match binding");
    if (plan.project?.number !== binding.github?.projectNumber) errors.push("project.number does not match binding");
  }

  if (!Array.isArray(plan.resources)) errors.push("resources must be an array");
  if (!Array.isArray(plan.milestones)) errors.push("milestones must be an array");
  if (!Array.isArray(plan.issues) || !plan.issues.length) errors.push("issues must be a non-empty array");
  const resources = array(plan.resources);
  const milestones = array(plan.milestones);
  const issues = array(plan.issues);
  const resourceKeys = keySet(resources, "resources", errors);
  const milestoneKeys = keySet(milestones, "milestones", errors);
  const issueKeys = keySet(issues, "issues", errors);
  const allowedRepositories = new Set(binding?.github?.repositories ?? issues.map((issue) => issue.repository));

  if (plan.schemaVersion === 2) validatePlanningContract(plan, issueKeys, errors, { forApply });

  resources.forEach((resource, index) => {
    requiredString(resource.title, `resources[${index}].title`, errors);
    requiredString(resource.url, `resources[${index}].url`, errors);
  });
  milestones.forEach((milestone, index) => {
    validateRepository(milestone.repository, `milestones[${index}].repository`, allowedRepositories, errors);
    requiredString(milestone.title, `milestones[${index}].title`, errors);
  });
  issues.forEach((issue, index) => {
    const prefix = `issues[${index}]`;
    validateRepository(issue.repository, `${prefix}.repository`, allowedRepositories, errors);
    requiredString(issue.title, `${prefix}.title`, errors);
    if (!ISSUE_KINDS.has(issue.kind)) errors.push(`${prefix}.kind is invalid`);
    if (!["Refinement", "Ready", "Blocked"].includes(issue.status)) errors.push(`${prefix}.status is invalid for planning`);
    requiredString(issue.role, `${prefix}.role`, errors);
    nonEmptyStringArray(issue.dor, `${prefix}.dor`, errors);
    nonEmptyStringArray(issue.dod, `${prefix}.dod`, errors);
    nonEmptyStringArray(issue.acceptanceCriteria, `${prefix}.acceptanceCriteria`, errors);
    if (issue.priority !== undefined && !PRIORITIES.has(issue.priority)) errors.push(`${prefix}.priority is invalid`);
    if (plan.schemaVersion === 2 && issue.estimate !== undefined && !ESTIMATES.has(issue.estimate)) errors.push(`${prefix}.estimate must be one of 1, 2, 3, 5, 8, 13`);
    if (plan.schemaVersion === 2 && issue.kind === "outcome" && issue.estimate !== undefined) errors.push(`${prefix}.estimate must be omitted for an outcome to avoid double counting`);
    if (plan.schemaVersion === 2 && plan.estimation?.mode === "none" && issue.estimate !== undefined) errors.push(`${prefix}.estimate must be omitted when estimation.mode is none`);
    if (plan.schemaVersion === 2 && plan.estimation?.mode === "lightweight" && issue.kind !== "outcome" && issue.estimate === undefined) requiredString(issue.estimateReason, `${prefix}.estimateReason`, errors);
    if (!isObject(issue.delivery) || !DELIVERY_MODES.has(issue.delivery?.mode)) errors.push(`${prefix}.delivery.mode is invalid`);
    requiredString(issue.delivery?.ownerRole, `${prefix}.delivery.ownerRole`, errors);
    nonEmptyStringArray(issue.delivery?.verification, `${prefix}.delivery.verification`, errors);
    if (issue.parentKey !== undefined) {
      if (!issueKeys.has(issue.parentKey)) errors.push(`${prefix}.parentKey references an unknown issue`);
      const parent = issues.find((candidate) => candidate.key === issue.parentKey);
      if (parent?.parentKey) errors.push(`${prefix}.parentKey creates hierarchy deeper than one direct sub-issue level`);
      if (parent && parent.kind !== "outcome") errors.push(`${prefix}.parentKey must reference an outcome`);
    } else if (issue.kind !== "outcome") {
      errors.push(`${prefix} must have parentKey unless it is an outcome`);
    }
    refList(issue.resourceKeys, resourceKeys, `${prefix}.resourceKeys`, errors);
    refList(issue.blockedByKeys, issueKeys, `${prefix}.blockedByKeys`, errors, issue.key);
    refList(issue.relatedKeys, issueKeys, `${prefix}.relatedKeys`, errors, issue.key);
    if (issue.milestoneKey !== undefined && !milestoneKeys.has(issue.milestoneKey)) errors.push(`${prefix}.milestoneKey references an unknown milestone`);
  });
  if (plan.schemaVersion === 2) {
    const childrenByParent = new Map();
    issues.forEach((issue) => {
      if (issue.parentKey) childrenByParent.set(issue.parentKey, (childrenByParent.get(issue.parentKey) ?? 0) + 1);
    });
    issues.forEach((issue, index) => {
      if (issue.kind === "outcome" && !childrenByParent.has(issue.key)) errors.push(`issues[${index}] outcome must have at least one direct sub-issue`);
    });
  }
  detectDependencyCycles(issues, errors);
  if (containsSecret(plan)) errors.push("plan contains credential-like data");
  return errors;
}

function validatePlanningContract(plan, issueKeys, errors, { forApply }) {
  if (!isObject(plan.setup)) errors.push("setup must be an object for schemaVersion 2");
  else {
    if (!["audit", "ensure", "preserve"].includes(plan.setup.mode)) errors.push("setup.mode is invalid");
    if (forApply && plan.setup.mode !== "ensure") errors.push("setup.mode must be ensure for apply");
    if (!Array.isArray(plan.setup.requiredFields)) errors.push("setup.requiredFields must be an array");
    else {
      unique(plan.setup.requiredFields, "setup.requiredFields", errors);
      for (const field of SETUP_FIELDS) if (!plan.setup.requiredFields.includes(field)) errors.push(`setup.requiredFields must include ${field}`);
      plan.setup.requiredFields.forEach((field, index) => {
        if (!SETUP_FIELDS.has(field) && !["startDate", "targetDate", "iteration"].includes(field)) errors.push(`setup.requiredFields[${index}] is invalid`);
      });
    }
    if (!Array.isArray(plan.setup.workflows)) errors.push("setup.workflows must be an array");
    else {
      const names = new Set();
      plan.setup.workflows.forEach((workflow, index) => {
        const prefix = `setup.workflows[${index}]`;
        if (!isObject(workflow) || !WORKFLOWS.has(workflow.name)) errors.push(`${prefix}.name is invalid`);
        else if (names.has(workflow.name)) errors.push(`${prefix}.name is duplicated`);
        else names.add(workflow.name);
        if (!WORKFLOW_STATES.has(workflow.state)) errors.push(`${prefix}.state is invalid`);
        if (workflow.state !== "preserve") requiredString(workflow.reason, `${prefix}.reason`, errors);
      });
    }
  }

  if (!isObject(plan.estimation) || !["none", "lightweight"].includes(plan.estimation.mode)) errors.push("estimation.mode must be none or lightweight for schemaVersion 2");
  else if (plan.estimation.mode === "lightweight" && plan.estimation.scale !== "fibonacci") errors.push("estimation.scale must be fibonacci for lightweight estimation");

  if (!Array.isArray(plan.views)) errors.push("views must be an array for schemaVersion 2");
  else {
    const views = new Map();
    plan.views.forEach((view, index) => {
      const prefix = `views[${index}]`;
      requiredString(view?.name, `${prefix}.name`, errors);
      if (!new Set(["table", "board", "roadmap"]).has(view?.layout)) errors.push(`${prefix}.layout is invalid`);
      if (typeof view?.name === "string" && views.has(view.name)) errors.push(`${prefix}.name is duplicated`);
      else if (typeof view?.name === "string") views.set(view.name, view);
      if (view?.groupBy !== undefined) requiredString(view.groupBy, `${prefix}.groupBy`, errors);
      if (view?.filter !== undefined) requiredString(view.filter, `${prefix}.filter`, errors);
      if (!Array.isArray(view?.visibleFields) || !view.visibleFields.length) errors.push(`${prefix}.visibleFields must be a non-empty array`);
      else unique(view.visibleFields, `${prefix}.visibleFields`, errors);
    });
    for (const [name, layout] of STANDARD_VIEWS) {
      if (!views.has(name)) errors.push(`views must include ${name}`);
      else if (layout && views.get(name).layout !== layout) errors.push(`${name} must use ${layout} layout`);
    }
    if (views.get("Delivery board")?.groupBy !== "status") errors.push("Delivery board must groupBy status");
    if (views.get("Role queues")?.groupBy !== "role") errors.push("Role queues must groupBy role");
    for (const name of ["Review & delivery", "Blocked", "Decisions"]) if (!views.get(name)?.filter) errors.push(`${name} must define a filter`);
  }

  if (!Array.isArray(plan.coverage) || !plan.coverage.length) errors.push("coverage must be a non-empty array for schemaVersion 2");
  else {
    const coveredKeys = new Set();
    plan.coverage.forEach((entry, index) => {
      const prefix = `coverage[${index}]`;
      requiredString(entry?.requirement, `${prefix}.requirement`, errors);
      if (!Array.isArray(entry?.issueKeys) || !entry.issueKeys.length) errors.push(`${prefix}.issueKeys must be a non-empty array`);
      else {
        unique(entry.issueKeys, `${prefix}.issueKeys`, errors);
        entry.issueKeys.forEach((key) => {
          coveredKeys.add(key);
          if (!issueKeys.has(key)) errors.push(`${prefix}.issueKeys references unknown key ${key}`);
        });
      }
    });
    issueKeys.forEach((key) => {
      if (!coveredKeys.has(key)) errors.push(`coverage must reference issue key ${key}`);
    });
  }
}

export function validateHandoff(handoff) {
  const errors = [];
  if (!isObject(handoff)) return ["handoff must be an object"];
  if (handoff.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (!new Set(["handoff", "review-passed", "changes-requested", "blocked", "delivered", "verification-passed"]).has(handoff.outcome)) errors.push("outcome is invalid");
  if (typeof handoff.issue !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[1-9][0-9]*$/u.test(handoff.issue)) errors.push("issue must be owner/repo#number");
  for (const field of ["fromRole", "toRole", "summary"]) requiredString(handoff[field], field, errors);
  nonEmptyStringArray(handoff.deliverables, "deliverables", errors);
  if (!Array.isArray(handoff.dod) || !handoff.dod.length) errors.push("dod must be a non-empty array");
  else if (handoff.dod.some((check) => !isObject(check) || typeof check.label !== "string" || typeof check.passed !== "boolean")) errors.push("dod checks are invalid");
  if (!Array.isArray(handoff.evidence) || !handoff.evidence.length) errors.push("evidence must be a non-empty array");
  else if (handoff.evidence.some((item) => !isObject(item) || !item.label || !/^https:\/\//u.test(item.url ?? ""))) errors.push("evidence entries require label and https URL");
  if (!STATUSES.has(handoff.next?.status)) errors.push("next.status is invalid");
  requiredString(handoff.next?.action, "next.action", errors);
  requiredString(handoff.next?.role, "next.role", errors);
  if (!DELIVERY_MODES.has(handoff.delivery?.mode)) errors.push("delivery.mode is invalid");
  if (!new Set(["artifact-review", "ready-to-deliver", "delivery-verification", "terminal"]).has(handoff.delivery?.phase)) errors.push("delivery.phase is invalid");
  if (["Done", "Canceled"].includes(handoff.next?.status) && handoff.delivery?.phase !== "terminal") errors.push("terminal next.status requires terminal delivery.phase");
  if (handoff.dod?.some((check) => check.passed === false) && ["handoff", "review-passed", "delivered", "verification-passed"].includes(handoff.outcome)) errors.push("successful outcome requires every DoD check to pass");
  if (containsSecret(handoff)) errors.push("handoff contains credential-like data");
  return errors;
}

export function validateProjectUpdate(update, { forPublish = false } = {}) {
  const errors = [];
  if (!isObject(update)) return ["update must be an object"];
  if (update.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (!["preview", "publish"].includes(update.mode)) errors.push("mode must be preview or publish");
  if (forPublish && update.mode !== "publish") errors.push("mode must be publish");
  requiredString(update.projectId, "projectId", errors);
  if (!new Set(["ON_TRACK", "AT_RISK", "OFF_TRACK", "INACTIVE", "COMPLETE"]).has(update.status)) errors.push("status is invalid");
  requiredString(update.summary, "summary", errors);
  nonEmptyStringArray(update.progress, "progress", errors);
  nonEmptyStringArray(update.nextActions, "nextActions", errors);
  if (!Array.isArray(update.evidence) || !update.evidence.length || update.evidence.some((item) => !item?.label || !/^https:\/\//u.test(item?.url ?? ""))) errors.push("evidence requires at least one label and https URL");
  if (containsSecret(update)) errors.push("update contains credential-like data");
  return errors;
}

export function renderHandoff(handoff) {
  const heading = handoff.outcome === "review-passed" ? "Review passed" : handoff.outcome === "changes-requested" ? "Changes requested" : handoff.outcome === "blocked" ? "Blocked" : `Handoff · ${handoff.fromRole} → ${handoff.toRole}`;
  return [
    `## ${heading}`,
    "",
    `**Result:** ${handoff.summary}`,
    "",
    "### Deliverables",
    "",
    ...handoff.deliverables.map((item) => `- ${item}`),
    "",
    "### DoD",
    "",
    ...handoff.dod.map((check) => `- [${check.passed ? "x" : " "}] ${check.label}`),
    "",
    "### Evidence",
    "",
    ...handoff.evidence.map((item) => `- [${item.label}](${item.url})`),
    "",
    "### Limitations",
    "",
    ...(handoff.limitations?.length ? handoff.limitations.map((item) => `- ${item}`) : ["- None recorded."]),
    "",
    `**Next:** ${handoff.next.action} → \`${handoff.next.status}\` · role \`${handoff.next.role}\``,
    `**Delivery:** \`${handoff.delivery.mode}\` · \`${handoff.delivery.phase}\``,
    "",
  ].join("\n");
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function requiredString(value, path, errors) {
  if (typeof value !== "string" || !value.trim()) errors.push(`${path} must be a non-empty string`);
}

function nonEmptyStringArray(value, path, errors) {
  if (!Array.isArray(value) || !value.length || value.some((item) => typeof item !== "string" || !item.trim())) errors.push(`${path} must be a non-empty string array`);
  else unique(value, path, errors);
}

function unique(items, path, errors) {
  if (new Set(items).size !== items.length) errors.push(`${path} must contain unique values`);
}

function keySet(items, path, errors) {
  const keys = new Set();
  items.forEach((item, index) => {
    if (typeof item?.key !== "string" || !KEY.test(item.key)) errors.push(`${path}[${index}].key is invalid`);
    else if (keys.has(item.key)) errors.push(`${path}[${index}].key is duplicated`);
    else keys.add(item.key);
  });
  return keys;
}

function validateRepository(repository, path, allowed, errors) {
  if (typeof repository !== "string" || !REPOSITORY.test(repository)) errors.push(`${path} is invalid`);
  else if (allowed.size && !allowed.has(repository)) errors.push(`${path} is outside the binding`);
}

function refList(value, allowed, path, errors, self) {
  if (value === undefined) return;
  if (!Array.isArray(value)) return errors.push(`${path} must be an array`);
  unique(value, path, errors);
  value.forEach((key) => {
    if (!allowed.has(key)) errors.push(`${path} references unknown key ${key}`);
    if (key === self) errors.push(`${path} cannot reference itself`);
  });
}

function detectDependencyCycles(issues, errors) {
  const graph = new Map(issues.map((issue) => [issue.key, issue.blockedByKeys ?? []]));
  const visiting = new Set();
  const visited = new Set();
  const walk = (key) => {
    if (visiting.has(key)) return true;
    if (visited.has(key)) return false;
    visiting.add(key);
    for (const dependency of graph.get(key) ?? []) if (graph.has(dependency) && walk(dependency)) return true;
    visiting.delete(key);
    visited.add(key);
    return false;
  };
  if ([...graph.keys()].some(walk)) errors.push("issue dependency cycle detected");
}
