const { test, after } = require("node:test");
const assert = require("node:assert");

// Note: the GitHub lookups only depend on the cache, which falls back to
// memory-only when no database driver is initialized. We deliberately do NOT
// initialize the database here so no better-sqlite3 statements are created
// (avoiding a native crash at process teardown on Node 24).

const github = require("../lib/github");

const realFetch = global.fetch;
let requests = [];

function mockGitHub(routes) {
    requests = [];
    global.fetch = async (url, options = {}) => {
        const path = String(url).replace("https://api.github.com", "");
        requests.push({ path, headers: options.headers || {} });
        const route = routes[path];
        if (!route) throw new Error(`No mock registered for ${path}`);
        const status = route.status || 200;
        return {
            ok: status < 400,
            status,
            headers: new Headers({
                "x-ratelimit-remaining": "4999",
                "x-ratelimit-limit": "5000",
                "x-ratelimit-reset": "0",
            }),
            json: async () => route.body,
        };
    };
}

after(() => {
    global.fetch = realFetch;
});

test("lookupUser returns the profile and recent events", async () => {
    mockGitHub({
        "/users/alice": { body: { login: "alice", name: "Alice", public_repos: 5 } },
        "/users/alice/events?per_page=10": { body: [{ id: "1", type: "PushEvent" }] },
    });

    const result = await github.lookupUser("alice");

    assert.strictEqual(result.type, "user");
    assert.strictEqual(result.profile.login, "alice");
    assert.deepStrictEqual(result.events, [{ id: "1", type: "PushEvent" }]);
    assert.strictEqual(result.cached, false);
    assert.strictEqual(result.rateLimit.remaining, 4999);
    assert.strictEqual(result.rateLimit.limit, 5000);
});

test("lookupUser serves the second call from cache", async () => {
    mockGitHub({
        "/users/cacheduser": { body: { login: "cacheduser" } },
        "/users/cacheduser/events?per_page=10": { body: [] },
    });

    await github.lookupUser("cacheduser");
    const second = await github.lookupUser("cacheduser");

    assert.strictEqual(second.cached, true);
    // First call makes one profile request; the second call makes none (both
    // profile and events are served from cache).
    const profileCalls = requests.filter((r) => r.path === "/users/cacheduser");
    assert.strictEqual(profileCalls.length, 1);
    assert.strictEqual(requests.length, 2);
});

test("lookupActivity returns events for a username", async () => {
    mockGitHub({
        "/users/bob/events?per_page=10": { body: [{ id: "9", type: "WatchEvent" }] },
    });

    const result = await github.lookupActivity("bob");

    assert.strictEqual(result.type, "activity");
    assert.strictEqual(result.username, "bob");
    assert.deepStrictEqual(result.events, [{ id: "9", type: "WatchEvent" }]);
    assert.strictEqual(result.cached, false);
});

test("lookupRepo returns repository details", async () => {
    mockGitHub({
        "/repos/acme/widgets": { body: { full_name: "acme/widgets", stargazers_count: 10, language: "Go" } },
    });

    const result = await github.lookupRepo("acme", "widgets");

    assert.strictEqual(result.type, "repo");
    assert.strictEqual(result.repo.full_name, "acme/widgets");
    assert.strictEqual(result.repo.stargazers_count, 10);
    assert.strictEqual(result.rateLimit.remaining, 4999);
});

test("lookupIssue returns issue details", async () => {
    mockGitHub({
        "/repos/acme/widgets/issues/42": { body: { number: 42, title: "Bug", state: "open" } },
    });

    const result = await github.lookupIssue("acme", "widgets", 42);

    assert.strictEqual(result.type, "issue");
    assert.strictEqual(result.issue.number, 42);
    assert.strictEqual(result.issue.title, "Bug");
});

test("lookupPull returns pull request details", async () => {
    mockGitHub({
        "/repos/acme/widgets/pulls/99": { body: { number: 99, title: "Fix", merged: true } },
    });

    const result = await github.lookupPull("acme", "widgets", 99);

    assert.strictEqual(result.type, "pull");
    assert.strictEqual(result.pull.number, 99);
    assert.strictEqual(result.pull.merged, true);
});

test("lookupCommit returns commit details with owner and repo", async () => {
    mockGitHub({
        "/repos/acme/widgets/commits/abc123": {
            body: { sha: "abc123", commit: { message: "fix: things" } },
        },
    });

    const result = await github.lookupCommit("acme", "widgets", "abc123");

    assert.strictEqual(result.type, "commit");
    assert.strictEqual(result.commit.sha, "abc123");
    assert.strictEqual(result.owner, "acme");
    assert.strictEqual(result.repo, "widgets");
});

test("404 responses surface the not-found error", async () => {
    mockGitHub({
        "/users/ghost": { status: 404, body: {} },
        "/users/ghost/events?per_page=10": { status: 404, body: {} },
    });

    await assert.rejects(
        () => github.lookupUser("ghost"),
        (error) => error.status === 404 && error.message === "Resource not found"
    );
});

test("403 responses surface the rate limit error with remaining quota", async () => {
    mockGitHub({
        "/repos/ratelimited/repo": { status: 403, body: {} },
    });

    await assert.rejects(
        () => github.lookupRepo("ratelimited", "repo"),
        (error) =>
            error.status === 403 &&
            /rate limit/i.test(error.message) &&
            error.rateLimit.remaining === 4999
    );
});

test("requests carry Accept and User-Agent and no token by default", async () => {
    mockGitHub({
        "/repos/headers/check": { body: { full_name: "headers/check" } },
    });

    await github.lookupRepo("headers", "check");

    assert.strictEqual(requests.length, 1);
    assert.strictEqual(requests[0].path, "/repos/headers/check");
    assert.strictEqual(requests[0].headers.Accept, "application/vnd.github+json");
    assert.strictEqual(requests[0].headers["User-Agent"], "Github-User-Activity-App");
    assert.strictEqual(requests[0].headers.Authorization, undefined);
});
