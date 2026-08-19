import { validateProjectBinding, validateWorkPlan } from "./lib.mjs";

export function validateProjectResult(plan, result, { binding } = {}) {
  const errors = plan?.schemaVersion === 4
    ? [...validateWorkPlan(plan, { owner: binding?.github?.owner, projectNumber: binding?.github?.projectNumber, repositories: binding?.github?.repositories, forApply: true })]
    : [...validateWorkPlan(plan, { binding })];
  if (!result || typeof result !== "object" || Array.isArray(result)) return [...errors, "result must be an object"];
  if (result.schemaVersion !== 1) errors.push("result.schemaVersion must be 1");
  if (result.capturedAt === undefined || Number.isNaN(Date.parse(result.capturedAt))) errors.push("result.capturedAt must be an ISO timestamp");
  if (result.project?.owner !== plan.project?.owner) errors.push("result.project.owner does not match plan");
  if (result.project?.number !== plan.project?.number) errors.push("result.project.number does not match plan");
  if (binding) errors.push(...validateProjectBinding(binding).map((error) => `binding: ${error}`));

  const linkedRepositories = new Set(array(result.project?.linkedRepositories));
  for (const repository of binding?.github?.repositories ?? []) {
    if (!linkedRepositories.has(repository)) errors.push(`result.project.linkedRepositories is missing ${repository}`);
  }

  const fields = new Set(array(result.fields));
  for (const field of plan.setup?.requiredFields ?? []) {
    if (!fields.has(field)) errors.push(`result.fields is missing ${field}`);
  }

  const actualViews = keyed(result.views, "name", "result.views", errors);
  for (const expected of plan.views ?? []) {
    const actual = actualViews.get(expected.name);
    if (!actual) {
      errors.push(`result.views is missing ${expected.name}`);
      continue;
    }
    for (const property of ["layout", "groupBy", "filter", "sortBy"]) {
      if (expected[property] !== undefined && actual[property] !== expected[property]) errors.push(`result view ${expected.name}.${property} does not match plan`);
    }
    if (!sameSet(expected.visibleFields, actual.visibleFields)) errors.push(`result view ${expected.name}.visibleFields does not match plan`);
  }

  const actualWorkflows = keyed(result.workflows, "name", "result.workflows", errors);
  for (const expected of plan.setup?.workflows ?? []) {
    if (expected.state === "preserve") continue;
    const actual = actualWorkflows.get(expected.name);
    if (!actual) errors.push(`result.workflows is missing ${expected.name}`);
    else if (actual.state !== expected.state) errors.push(`result workflow ${expected.name}.state does not match plan`);
  }

  const actualIssues = keyed(result.issues, "key", "result.issues", errors);
  for (const expected of plan.issues ?? []) {
    const actual = actualIssues.get(expected.key);
    if (!actual) {
      errors.push(`result.issues is missing ${expected.key}`);
      continue;
    }
    if (!/^https:\/\/github\.com\//u.test(actual.url ?? "")) errors.push(`result issue ${expected.key}.url must be a GitHub URL`);
    for (const property of ["repository", "title", "kind", "status", "role", "priority", "estimate", "parentKey", "milestoneKey"]) {
      if (expected[property] !== undefined && actual[property] !== expected[property]) errors.push(`result issue ${expected.key}.${property} does not match plan`);
      if (expected[property] === undefined && ["estimate", "parentKey"].includes(property) && actual[property] !== undefined) errors.push(`result issue ${expected.key}.${property} must be omitted`);
    }
    for (const property of ["blockedByKeys", "relatedKeys"]) {
      if (!sameSet(expected[property] ?? [], actual[property] ?? [])) errors.push(`result issue ${expected.key}.${property} does not match plan`);
    }
  }

  if (Array.isArray(result.capabilityGaps) && result.capabilityGaps.length) errors.push(`result has unresolved capability gaps: ${result.capabilityGaps.join("; ")}`);
  return [...new Set(errors)];
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function keyed(value, key, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return new Map();
  }
  const output = new Map();
  value.forEach((item, index) => {
    if (typeof item?.[key] !== "string" || !item[key]) errors.push(`${path}[${index}].${key} must be a non-empty string`);
    else if (output.has(item[key])) errors.push(`${path}[${index}].${key} is duplicated`);
    else output.set(item[key], item);
  });
  return output;
}

function sameSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  return left.length === right.length && left.every((value) => right.includes(value));
}
