const ACTIVE_ITEM_STATUSES = new Set(["in progress", "in review", "ready to deliver", "delivery verification"]);
const STARTED_ITEM_STATUSES = new Set([...ACTIVE_ITEM_STATUSES, "done"]);
const TERMINAL_ITEM_STATUSES = new Set(["done", "canceled", "cancelled"]);
const HEALTH = new Set(["ON_TRACK", "AT_RISK", "OFF_TRACK", "INACTIVE", "COMPLETE"]);

export function resolveProjectLifecycle(snapshot) {
  const project = snapshot?.project ?? {};
  const latest = project.latestStatusUpdate ?? project.statusUpdate ?? null;
  const status = normalizeHealth(latest?.status ?? project.healthStatus);
  return {
    state: project.closed === true || normalize(project.state) === "closed" ? "closed" : "open",
    health: status,
    lifecycleMode: project.lifecycle?.mode ?? project.lifecycleMode ?? "unspecified",
    updateId: latest?.id,
    updatedAt: latest?.createdAt ?? latest?.updatedAt,
  };
}

export function analyzeProjectLifecycle(snapshot) {
  if (!snapshot?.project) throw new Error("snapshot.project is required");
  const lifecycle = resolveProjectLifecycle(snapshot);
  const items = (Array.isArray(snapshot.items) ? snapshot.items : [])
    .filter((item) => normalize(item.status) !== "canceled" && normalize(item.status) !== "cancelled");
  const openItems = items.filter((item) => !isTerminalItem(item));
  const activeItems = items.filter((item) => ACTIVE_ITEM_STATUSES.has(normalize(item.status)));
  const startedItems = items.filter((item) => STARTED_ITEM_STATUSES.has(normalize(item.status)) || isContentTerminal(item));
  const closedContentNonterminal = items.filter((item) => isContentTerminal(item) && !TERMINAL_ITEM_STATUSES.has(normalize(item.status)));
  const openContentTerminalStatus = items.filter((item) => !isContentTerminal(item) && TERMINAL_ITEM_STATUSES.has(normalize(item.status)) && hasOpenContentState(item));
  const evidence = [];
  if (startedItems.length) evidence.push(`${startedItems.length} item đã bắt đầu hoặc hoàn thành`);
  if (activeItems.length) evidence.push(`${activeItems.length} item đang ở active/review/delivery phase`);
  const base = { lifecycle, evidence, openItemCount: openItems.length, activeItemCount: activeItems.length };

  if (closedContentNonterminal.length || openContentTerminalStatus.length) {
    return { code: "item-content-state-mismatch", consistency: "mismatch", ...base, message: `${closedContentNonterminal.length} closed/merged content item còn workflow state chưa terminal; ${openContentTerminalStatus.length} open content item mang terminal workflow state.`, requiresDecision: false, recommendedAction: "Re-read built-in workflow effects and reconcile Project Status with the underlying Issue or pull request state." };
  }

  if (lifecycle.state === "closed" && openItems.length) {
    return { code: "closed-with-open-work", consistency: "mismatch", ...base, message: `Project đã đóng nhưng còn ${openItems.length} item chưa terminal.`, requiresDecision: true, recommendedAction: "Decide whether to reopen the Project or cancel/move the remaining work." };
  }
  if (lifecycle.health === "COMPLETE" && openItems.length) {
    return { code: "complete-with-open-work", consistency: "mismatch", ...base, message: `Latest Project update là COMPLETE nhưng còn ${openItems.length} item chưa terminal.`, requiresDecision: true, recommendedAction: "Publish a corrective lifecycle update only after an explicit CPO decision." };
  }
  if (lifecycle.health === "INACTIVE" && activeItems.length) {
    return { code: "inactive-with-active-work", consistency: "mismatch", ...base, message: `Project đang INACTIVE nhưng có ${activeItems.length} item đang thực thi hoặc delivery.`, requiresDecision: true, recommendedAction: "Decide whether to resume the Project or stop the active work." };
  }
  if (lifecycle.state === "open" && openItems.length === 0) {
    if (lifecycle.lifecycleMode === "continuous") {
      return { code: "continuous-needs-outcome", consistency: "advisory", ...base, message: "Continuous Project đang không có outcome mở; giữ Project open và yêu cầu outcome tiếp theo.", requiresDecision: true, recommendedAction: "CPO defines the next outcome or milestone; do not auto-close or publish COMPLETE." };
    }
    return { code: "bounded-needs-completion-decision", consistency: "advisory", ...base, message: "Open bounded Project không còn item mở; cần xác minh completion criteria.", requiresDecision: true, recommendedAction: "Verify completion criteria, then explicitly publish COMPLETE and/or close, or create the next outcome." };
  }
  if (lifecycle.state === "open" && startedItems.length && !lifecycle.health) {
    return { code: "missing-status-update", consistency: "advisory", ...base, message: "Project đã có execution evidence nhưng chưa có native status update.", requiresDecision: false, recommendedAction: "Draft an evidence-based status update; do not infer ON_TRACK from activity alone." };
  }
  if (lifecycle.state === "open" && lifecycle.health === "COMPLETE" && openItems.length === 0) {
    return { code: "complete-update-project-open", consistency: "advisory", ...base, message: "Latest update là COMPLETE nhưng Project vẫn open.", requiresDecision: true, recommendedAction: "Confirm whether the Project should remain open for another outcome or be explicitly closed." };
  }
  return { code: "consistent", consistency: "consistent", ...base, message: "Project lifecycle nhất quán với work state quan sát được." };
}

function isTerminalItem(item) {
  return TERMINAL_ITEM_STATUSES.has(normalize(item.status)) || isContentTerminal(item);
}

function isContentTerminal(item) {
  const type = normalize(item.contentType ?? item.type);
  const state = normalize(item.contentState ?? item.state);
  return (type === "issue" && state === "closed") || (type === "pullrequest" && ["closed", "merged"].includes(state));
}

function hasOpenContentState(item) {
  const type = normalize(item.contentType ?? item.type);
  const state = normalize(item.contentState ?? item.state);
  return (type === "issue" && state === "open") || (type === "pullrequest" && ["open", "draft"].includes(state));
}

function normalize(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeHealth(value) {
  if (typeof value !== "string") return null;
  const status = value.trim().toUpperCase().replace(/[ -]+/gu, "_");
  return HEALTH.has(status) ? status : null;
}
