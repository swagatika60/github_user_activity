const { test } = require("node:test");
const assert = require("node:assert");
const { classify, computePriority, priorityReason, selectTopActions, summarize } = require("../lib/priority");

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days) => new Date(Date.now() - days * DAY).toISOString();

test("items with recent activity are green", () => {
    assert.strictEqual(computePriority({ updated_at: daysAgo(1), created_at: daysAgo(3) }), "green");
});

test("no activity for 7-14 days is yellow", () => {
    assert.strictEqual(computePriority({ updated_at: daysAgo(8), created_at: daysAgo(8) }), "yellow");
});

test("no activity for over 14 days is red", () => {
    assert.strictEqual(computePriority({ updated_at: daysAgo(15), created_at: daysAgo(15) }), "red");
});

test("urgent labels make an item red regardless of activity", () => {
    assert.strictEqual(computePriority({ updated_at: daysAgo(1), labels: [{ name: "urgent" }] }), "red");
    assert.strictEqual(computePriority({ updated_at: daysAgo(1), labels: ["p1"] }), "red");
});

test("attention labels make an item yellow", () => {
    assert.strictEqual(computePriority({ updated_at: daysAgo(1), labels: ["needs attention"] }), "yellow");
    assert.strictEqual(computePriority({ updated_at: daysAgo(1), labels: [{ name: "p2" }] }), "yellow");
});

test("pending review requests are at least yellow", () => {
    assert.strictEqual(
        computePriority({ updated_at: daysAgo(1), created_at: daysAgo(2) }, { reviewRequested: true }),
        "yellow"
    );
});

test("review requests pending over 7 days are red", () => {
    assert.strictEqual(
        computePriority({ updated_at: daysAgo(9), created_at: daysAgo(9) }, { reviewRequested: true }),
        "red"
    );
});

test("long-open items are yellow even when recently updated", () => {
    assert.strictEqual(computePriority({ updated_at: daysAgo(1), created_at: daysAgo(45) }), "yellow");
});

test("overdue reviews are red and explain why", () => {
    const result = classify({ updated_at: daysAgo(9), created_at: daysAgo(9) }, { reviewRequested: true });
    assert.strictEqual(result.level, "red");
    assert.strictEqual(result.reason, "Overdue review — requested 9 days ago");
});

test("pending reviews are yellow with a time-based reason", () => {
    const result = classify({ updated_at: daysAgo(1), created_at: daysAgo(2) }, { reviewRequested: true });
    assert.strictEqual(result.level, "yellow");
    assert.strictEqual(result.reason, "Review requested 1 day ago");
});

test("priorityReason explains every level with short reasons", () => {
    assert.strictEqual(priorityReason({ updated_at: daysAgo(1), created_at: daysAgo(2) }), "Recently active");
    assert.strictEqual(priorityReason({ updated_at: daysAgo(20), created_at: daysAgo(20) }), "Overdue — no activity for 20 days");
    assert.strictEqual(priorityReason({ updated_at: daysAgo(10), created_at: daysAgo(10) }), "No activity for 10 days");
    assert.strictEqual(priorityReason({ updated_at: daysAgo(1), created_at: daysAgo(45) }), "Open for 45 days");
    assert.strictEqual(priorityReason({ updated_at: daysAgo(1), labels: [{ name: "urgent" }] }), "Urgent label: urgent");
    assert.strictEqual(priorityReason({ updated_at: daysAgo(1), labels: [{ name: "p2" }] }), "Needs attention label: p2");
});

test("summarize counts priorities and derives the overall level", () => {
    const summary = summarize({
        openPRs: [{ priority: "red" }, { priority: "green" }],
        reviewRequests: [{ priority: "yellow" }],
        assignedIssues: [],
    });
    assert.deepStrictEqual(summary, { red: 1, yellow: 1, green: 1, level: "red" });
});

test("selectTopActions ranks red before yellow and excludes green", () => {
    const actions = selectTopActions([
        { title: "b", priority: "yellow", updated_at: daysAgo(2) },
        { title: "c", priority: "green", updated_at: daysAgo(1) },
        { title: "a", priority: "red", updated_at: daysAgo(5) },
    ]);
    assert.deepStrictEqual(actions.map((a) => a.title), ["a", "b"]);
});

test("selectTopActions sorts by staleness within the same priority", () => {
    const actions = selectTopActions([
        { title: "newer", priority: "red", updated_at: daysAgo(2) },
        { title: "older", priority: "red", updated_at: daysAgo(20) },
    ]);
    assert.deepStrictEqual(actions.map((a) => a.title), ["older", "newer"]);
});

test("selectTopActions caps at the requested limit", () => {
    const items = Array.from({ length: 8 }, (_, i) => ({
        title: `item${i}`,
        priority: i % 2 ? "yellow" : "red",
        updated_at: daysAgo(i + 1),
    }));
    assert.strictEqual(selectTopActions(items).length, 5);
    assert.strictEqual(selectTopActions(items, 3).length, 3);
});

test("selectTopActions returns empty when nothing needs attention", () => {
    assert.deepStrictEqual(selectTopActions([{ title: "ok", priority: "green", updated_at: daysAgo(1) }]), []);
});

test("summarize falls back to yellow then green", () => {
    assert.strictEqual(summarize({ a: [{ priority: "yellow" }] }).level, "yellow");
    assert.strictEqual(summarize({ a: [{ priority: "green" }] }).level, "green");
    assert.strictEqual(summarize({ a: [] }).level, "green");
});
