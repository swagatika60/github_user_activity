const { test } = require("node:test");
const assert = require("node:assert");
const { summarizeEvents } = require("../lib/activity");

function event(type, overrides = {}) {
    return {
        id: String(Math.random()),
        type,
        created_at: new Date().toISOString(),
        repo: { name: "owner/repo" },
        payload: {},
        ...overrides,
    };
}

test("counts commits, PRs, issues, reviews, and branches from events", () => {
    const events = [
        event("PushEvent", { payload: { commits: [{}, {}, {}] } }),
        event("PullRequestEvent", { payload: { action: "opened" } }),
        event("IssuesEvent", { payload: { action: "opened" } }),
        event("PullRequestReviewEvent", { payload: { action: "submitted" } }),
        event("CreateEvent", { payload: { ref_type: "branch" } }),
    ];
    const { totals, byRepo } = summarizeEvents(events);
    assert.deepStrictEqual(totals, { commits: 3, prs: 1, issues: 1, reviews: 1, branches: 1 });
    assert.strictEqual(byRepo[0].name, "owner/repo");
    assert.strictEqual(byRepo[0].total, 7);
});

test("a PushEvent without a commits payload counts as one commit", () => {
    const { totals } = summarizeEvents([event("PushEvent")]);
    assert.strictEqual(totals.commits, 1);
});

test("ignores tags, watch/fork events, and unknown event types", () => {
    const events = [
        event("CreateEvent", { payload: { ref_type: "tag" } }),
        event("CreateEvent", { payload: { ref_type: "repository" } }),
        event("WatchEvent"),
        event("ForkEvent"),
        event("SomethingElse"),
    ];
    const { totals, byRepo } = summarizeEvents(events);
    assert.deepStrictEqual(totals, { commits: 0, prs: 0, issues: 0, reviews: 0, branches: 0 });
    assert.strictEqual(byRepo.length, 0);
});

test("buckets activity into the last 14 days", () => {
    const events = [event("PullRequestEvent")];
    const { byDay } = summarizeEvents(events);
    assert.strictEqual(byDay.length, 14);
    const todayBucket = byDay[byDay.length - 1];
    assert.strictEqual(todayBucket.date, new Date().toISOString().slice(0, 10));
    assert.strictEqual(todayBucket.prs, 1);
    const yesterdayBucket = byDay[byDay.length - 2];
    assert.strictEqual(yesterdayBucket.prs, 0);
});

test("groups and ranks activity per repository", () => {
    const events = [
        event("PushEvent", { payload: { commits: [{}] }, repo: { name: "a/one" } }),
        event("PushEvent", { payload: { commits: [{}] }, repo: { name: "a/one" } }),
        event("IssuesEvent", { repo: { name: "b/two" } }),
    ];
    const { byRepo } = summarizeEvents(events);
    assert.deepStrictEqual(byRepo.map((r) => r.name), ["a/one", "b/two"]);
    assert.strictEqual(byRepo[0].commits, 2);
    assert.strictEqual(byRepo[1].issues, 1);
});

test("caps the per-repository breakdown", () => {
    const events = Array.from({ length: 8 }, (_, i) =>
        event("PushEvent", { payload: { commits: [{}] }, repo: { name: `repo-${i}` } })
    );
    assert.strictEqual(summarizeEvents(events, { maxRepos: 3 }).byRepo.length, 3);
});

test("handles missing or null events", () => {
    const empty = summarizeEvents(null);
    assert.deepStrictEqual(empty.totals, { commits: 0, prs: 0, issues: 0, reviews: 0, branches: 0 });
    assert.strictEqual(empty.byDay.length, 14);
    assert.strictEqual(empty.byRepo.length, 0);
});
