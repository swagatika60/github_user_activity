const { test, before, after } = require("node:test");
const assert = require("node:assert");

// No database is initialized here: the new feature endpoints only use the
// memory cache, so no better-sqlite3 native module is loaded.
const { createApp } = require("../app");

const realFetch = global.fetch;
let server;
let base;

before(async () => {
    const app = createApp();
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${server.address().port}`;

    global.fetch = async (url, options = {}) => {
        const u = String(url);
        if (u.startsWith(base)) {
            return realFetch(u, options);
        }

        const respond = (data, status = 200) => ({
            ok: status < 400,
            status,
            headers: new Headers({
                "x-ratelimit-remaining": "4900",
                "x-ratelimit-limit": "5000",
                "x-ratelimit-reset": "0",
            }),
            json: async () => data,
        });

        const now = new Date().toISOString();
        if (u.includes("/users/anna")) {
            if (u.includes("/repos")) {
                return respond([
                    { name: "r1", language: "Python", stargazers_count: 10 },
                    { name: "r2", language: "Python", stargazers_count: 5 },
                    { name: "r3", language: "Go", stargazers_count: 0 },
                ]);
            }
            return respond({ login: "anna", name: "Anna", public_repos: 8, followers: 100, following: 5, created_at: "2020-01-01T00:00:00Z", bio: null, location: null, company: null, avatar_url: "", html_url: "" });
        }
        if (u.includes("/users/bob")) {
            if (u.includes("/repos")) {
                return respond([{ name: "x", language: "Rust", stargazers_count: 1 }]);
            }
            return respond({ login: "bob", name: "Bob", public_repos: 3, followers: 10, following: 2, created_at: "2021-05-05T00:00:00Z", bio: null, location: null, company: null, avatar_url: "", html_url: "" });
        }
        if (u.includes("/users/alice/starred")) {
            return respond([
                { name: "starrepo", full_name: "other/starrepo", description: "nice", language: "Go", stargazers_count: 42, forks_count: 3, fork: false, html_url: "https://github.com/other/starrepo", updated_at: now, topics: [] },
            ]);
        }
        if (u.includes("/repos/acme/widgets/git/trees")) {
            return respond({
                truncated: false,
                tree: [
                    { path: "src", type: "tree", size: 0 },
                    { path: "src/index.js", type: "blob", size: 100 },
                    { path: "README.md", type: "blob", size: 50 },
                ],
            });
        }
        if (u.includes("/repos/acme/widgets")) {
            return respond({ full_name: "acme/widgets", default_branch: "main" });
        }
        throw new Error(`Unmocked GitHub request: ${u}`);
    };
});

after(() => {
    global.fetch = realFetch;
    server.close();
});

test("GET /api/compare returns both user summaries", async () => {
    const res = await fetch(`${base}/api/compare?user1=anna&user2=bob`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.type, "compare");
    assert.strictEqual(data.user1.login, "anna");
    assert.strictEqual(data.user1.totalStars, 15);
    assert.strictEqual(data.user1.topLanguage, "Python");
    assert.strictEqual(data.user2.topLanguage, "Rust");
});

test("GET /api/compare requires both users and different users", async () => {
    const missing = await fetch(`${base}/api/compare?user1=anna`);
    assert.strictEqual(missing.status, 400);

    const same = await fetch(`${base}/api/compare?user1=anna&user2=ANNA`);
    assert.strictEqual(same.status, 400);
    const body = await same.json();
    assert.match(body.error, /different/i);
});

test("GET /api/user/starred returns starred repos", async () => {
    const res = await fetch(`${base}/api/user/starred?user=alice`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.type, "starred");
    assert.strictEqual(data.repos[0].full_name, "other/starrepo");
});

test("GET /api/user/starred requires a user", async () => {
    const res = await fetch(`${base}/api/user/starred`);
    assert.strictEqual(res.status, 400);
});

test("GET /api/repo/tree returns the flattened tree", async () => {
    const res = await fetch(`${base}/api/repo/tree?owner=acme&repo=widgets`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.type, "tree");
    assert.strictEqual(data.branch, "main");
    assert.strictEqual(data.tree.length, 3);
});
