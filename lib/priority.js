const DAY_MS = 24 * 60 * 60 * 1000;

// An item with no activity for this long is overdue (red).
const RED_AFTER_DAYS = 14;
// An item with no activity for this long needs attention (yellow).
const YELLOW_AFTER_DAYS = 7;
// A long-open item (regardless of recent activity) needs attention.
const LONG_OPEN_DAYS = 30;

const PRIORITY_RANK = { red: 0, yellow: 1, green: 2 };

const URGENT_LABELS = new Set([
    "urgent",
    "high priority",
    "priority: high",
    "priority:high",
    "p1",
    "priority 1",
    "critical",
    "blocker",
]);

const ATTENTION_LABELS = new Set([
    "needs attention",
    "medium priority",
    "priority: medium",
    "priority:medium",
    "p2",
    "priority 2",
    "wip",
]);

function daysSince(dateString) {
    if (!dateString) return 0;
    const elapsed = Date.now() - new Date(dateString).getTime();
    return elapsed > 0 ? elapsed / DAY_MS : 0;
}

function labelNames(labels) {
    return (labels || []).map((label) => (typeof label === "string" ? label : label.name || "").toLowerCase());
}

function dayCount(days) {
    return Math.max(1, Math.round(days));
}

function daysAgoText(days) {
    const n = dayCount(days);
    return n === 1 ? "1 day ago" : `${n} days ago`;
}

function daysText(days) {
    const n = dayCount(days);
    return n === 1 ? "1 day" : `${n} days`;
}

/**
 * Classify an issue or pull request as "red", "yellow", or "green" and
 * explain why, e.g. { level: "red", reason: "Overdue review — pending for 9 days" }.
 *
 * - Red: an urgent label, no activity for 14+ days, or a review request
 *   that has been pending for 7+ days.
 * - Yellow: a "needs attention" label, no activity for 7+ days, an open
 *   item older than 30 days, or a pending review request.
 * - Green: everything else (recently active, nothing pending).
 */
function classify(item, options = {}) {
    const labels = labelNames(item.labels);

    const urgent = labels.find((name) => URGENT_LABELS.has(name));
    if (urgent) return { level: "red", reason: `Urgent label: ${urgent}` };

    const attention = labels.find((name) => ATTENTION_LABELS.has(name));
    if (attention) return { level: "yellow", reason: `Needs attention label: ${attention}` };

    const staleDays = daysSince(item.updated_at || item.created_at);
    const ageDays = daysSince(item.created_at);

    if (staleDays > RED_AFTER_DAYS) {
        return { level: "red", reason: `Overdue — no activity for ${daysText(staleDays)}` };
    }
    if (options.reviewRequested && staleDays > YELLOW_AFTER_DAYS) {
        return { level: "red", reason: `Overdue review — requested ${daysAgoText(staleDays)}` };
    }
    if (options.reviewRequested) {
        return {
            level: "yellow",
            reason: staleDays < 1 ? "Review requested today" : `Review requested ${daysAgoText(staleDays)}`,
        };
    }
    if (staleDays > YELLOW_AFTER_DAYS) {
        return { level: "yellow", reason: `No activity for ${daysText(staleDays)}` };
    }
    if (ageDays > LONG_OPEN_DAYS) {
        return { level: "yellow", reason: `Open for ${daysText(ageDays)}` };
    }
    return { level: "green", reason: "Recently active" };
}

function computePriority(item, options = {}) {
    return classify(item, options).level;
}

function priorityReason(item, options = {}) {
    return classify(item, options).reason;
}

/** Count priorities across groups of classified items and derive an overall level. */
function summarize(groups) {
    const counts = { red: 0, yellow: 0, green: 0 };
    for (const items of Object.values(groups)) {
        for (const item of items) {
            if (counts[item.priority] != null) counts[item.priority] += 1;
        }
    }
    const level = counts.red > 0 ? "red" : counts.yellow > 0 ? "yellow" : "green";
    return { ...counts, level };
}

/**
 * Pick the top actionable items: non-green items sorted by priority
 * (red before yellow), then by staleness (oldest updated first), capped at `limit`.
 */
function selectTopActions(items, limit = 5) {
    return items
        .filter((item) => PRIORITY_RANK[item.priority] < PRIORITY_RANK.green)
        .sort((a, b) => {
            if (PRIORITY_RANK[a.priority] !== PRIORITY_RANK[b.priority]) {
                return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
            }
            return new Date(a.updated_at || 0) - new Date(b.updated_at || 0);
        })
        .slice(0, limit);
}

module.exports = { classify, computePriority, priorityReason, summarize, selectTopActions };
