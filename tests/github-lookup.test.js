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

test("lookupUser returns the profile, events, repos, languages and contributions", async () => {
    const now = new Date().toISOString();
    mockGitHub({
        "/users/alice": { body: { login: "alice", name: "Alice", public_repos: 5 } },
        "/users/alice/events?per_page=100": {
            body: [
                { id: "1", type: "PushEvent", created_at: now, repo: { name: "alice/x" }, payload: { ref: "refs/heads/main", commits: [{}, {}] } },
                { id: "2", type: "PullRequestEvent", created_at: now, repo: { name: "alice/y" }, payload: { action: "opened" } },
            ],
        },
        "/users/alice/repos?per_page=100&sort=updated": {
            body: [
                { name: "x", full_name: "alice/x", description: null, language: "JavaScript", stargazers_count: 3, forks_count: 1, fork: false, html_url: "https://github.com/alice/x", updated_at: now, topics: [] },
                { name: "y", full_name: "alice/y", description: null, language: "JavaScript", stargazers_count: 1, forks_count: 0, fork: false, html_url: "https://github.com/alice/y", updated_at: now, topics: [] },
            ],
        },
    });

    const result = await github.lookupUser("alice");

    assert.strictEqual(result.type, "user");
    assert.strictEqual(result.profile.login, "alice");
    assert.strictEqual(result.events.length, 2);
    assert.strictEqual(result.repos.length, 2);
    assert.strictEqual(result.repoCount, 2);
    assert.strictEqual(result.repos[0].stargazers_count, 3);
    assert.deepStrictEqual(result.languages[0], { name: "JavaScript", count: 2, percentage: 100 });
    assert.strictEqual(result.contributions.length, 196);
    assert.strictEqual(result.activityGraph.totals.commits, 2);
    assert.strictEqual(result.activityGraph.totals.prs, 1);
    assert.strictEqual(result.cached, false);
    assert.strictEqual(result.rateLimit.remaining, 4999);
    assert.strictEqual(result.rateLimit.limit, 5000);
});

test("lookupUser serves the second call from cache", async () => {
    mockGitHub({
        "/users/cacheduser": { body: { login: "cacheduser" } },
        "/users/cacheduser/events?per_page=100": { body: [] },
        "/users/cacheduser/repos?per_page=100&sort=updated": { body: [] },
    });

    await github.lookupUser("cacheduser");
    const second = await github.lookupUser("cacheduser");

    assert.strictEqual(second.cached, true);
    // First call makes one request per endpoint (profile, events, repos); the
    // second call makes none because everything is served from cache.
    const profileCalls = requests.filter((r) => r.path === "/users/cacheduser");
    assert.strictEqual(profileCalls.length, 1);
    assert.strictEqual(requests.length, 3);
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
        "/users/ghost/events?per_page=100": { status: 404, body: {} },
        "/users/ghost/repos?per_page=100&sort=updated": { status: 404, body: {} },
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

test("lookupUserStarred returns slim starred repos", async () => {
    const now = new Date().toISOString();
    mockGitHub({
        "/users/alice/starred?per_page=30&sort=created": {
            body: [
                { name: "starrepo", full_name: "other/starrepo", description: "nice", language: "Go", stargazers_count: 42, forks_count: 3, fork: false, html_url: "https://github.com/other/starrepo", updated_at: now, topics: [] },
            ],
        },
    });

    const result = await github.lookupUserStarred("alice");

    assert.strictEqual(result.type, "starred");
    assert.strictEqual(result.user, "alice");
    assert.strictEqual(result.repos.length, 1);
    assert.strictEqual(result.repos[0].full_name, "other/starrepo");
    assert.strictEqual(result.repos[0].stargazers_count, 42);
});

test("compareUsers summarizes two profiles with stars and top language", async () => {
    mockGitHub({
        "/users/anna": { body: { login: "anna", name: "Anna", public_repos: 8, followers: 100, following: 5, created_at: "2020-01-01T00:00:00Z", bio: null, location: null, company: null, avatar_url: "", html_url: "" } },
        "/users/anna/repos?per_page=100&sort=updated": {
            body: [
                { name: "r1", language: "Python", stargazers_count: 10 },
                { name: "r2", language: "Python", stargazers_count: 5 },
                { name: "r3", language: "Go", stargazers_count: 0 },
            ],
        },
        "/users/bob": { body: { login: "bob", name: "Bob", public_repos: 3, followers: 10, following: 2, created_at: "2021-05-05T00:00:00Z", bio: null, location: null, company: null, avatar_url: "", html_url: "" } },
        "/users/bob/repos?per_page=100&sort=updated": {
            body: [{ name: "x", language: "Rust", stargazers_count: 1 }],
        },
    });

    const result = await github.compareUsers("anna", "bob");

    assert.strictEqual(result.type, "compare");
    assert.strictEqual(result.user1.login, "anna");
    assert.strictEqual(result.user1.public_repos, 8);
    assert.strictEqual(result.user1.totalStars, 15);
    assert.strictEqual(result.user1.topLanguage, "Python");
    assert.strictEqual(result.user2.followers, 10);
    assert.strictEqual(result.user2.topLanguage, "Rust");
});

test("lookupRepoTrees returns a flattened file tree with the default branch", async () => {
    mockGitHub({
        "/repos/acme/widgets": { body: { full_name: "acme/widgets", default_branch: "main" } },
        "/repos/acme/widgets/git/trees/main?recursive=1": {
            body: {
                truncated: false,
                tree: [
                    { path: "src", type: "tree", size: 0 },
                    { path: "src/index.js", type: "blob", size: 100 },
                    { path: "README.md", type: "blob", size: 50 },
                ],
            },
        },
    });

    const result = await github.lookupRepoTrees("acme", "widgets");

    assert.strictEqual(result.type, "tree");
    assert.strictEqual(result.branch, "main");
    assert.strictEqual(result.truncated, false);
    assert.strictEqual(result.tree.length, 3);
    assert.deepStrictEqual(result.tree[1], { path: "src/index.js", type: "blob", size: 100 });
});
