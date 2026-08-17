const { test, before, after } = require("node:test");
const assert = require("node:assert");

// Must be set before requiring modules that read env at load time.
process.env.JWT_SECRET = "flow-test-secret";
process.env.GITHUB_CLIENT_ID = "client-123";
process.env.GITHUB_CLIENT_SECRET = "secret-456";
process.env.SQLITE_DB_PATH = ":memory:";

const db = require("../lib/db");
const { createApp } = require("../app");

const DAY = 24 * 60 * 60 * 1000;
const recent = (days) => new Date(Date.now() - days * DAY).toISOString();

const realFetch = global.fetch;

let server;
let base;

before(async () => {
    await db.init();
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

        if (u.includes("/login/oauth/access_token")) {
            const body = JSON.parse(options.body);
            assert.ok(body.code_verifier.length >= 43, "PKCE code_verifier is too short");
            assert.strictEqual(body.client_id, "client-123");
            return respond({ access_token: "gho_flow_token", scope: "read:user user:email", token_type: "bearer" });
        }
        if (u.includes("/api.github.com/user/emails")) {
            return respond([{ email: "flow@example.com", primary: true, verified: true }]);
        }
        if (u.includes("/api.github.com/users/") && u.includes("/events")) {
            return respond([
                { id: "e1", type: "PushEvent", created_at: recent(0), repo: { name: "flowuser/hello" }, payload: { ref: "refs/heads/main", commits: [{}, {}] } },
                { id: "e2", type: "PullRequestEvent", created_at: recent(0), repo: { name: "flowuser/hello" }, payload: { action: "opened" } },
                { id: "e3", type: "IssuesEvent", created_at: recent(1), repo: { name: "flowuser/widgets" }, payload: { action: "opened" } },
                { id: "e4", type: "PullRequestReviewEvent", created_at: recent(1), repo: { name: "flowuser/widgets" }, payload: { action: "submitted" } },
                { id: "e5", type: "CreateEvent", created_at: recent(0), repo: { name: "flowuser/hello" }, payload: { ref_type: "branch", ref: "feature" } },
            ]);
        }
        if (u.includes("/api.github.com/search/issues")) {
            const q = new URL(u).searchParams.get("q") || "";
            if (q.includes("review-requested:flowuser")) {
                return respond({
                    total_count: 2,
                    items: [
                        {
                            number: 7,
                            title: "Please review",
                            state: "open",
                            repository_url: "https://api.github.com/repos/flowuser/hello",
                            html_url: "https://github.com/flowuser/hello/pull/7",
                            labels: [],
                            created_at: recent(2),
                            updated_at: recent(1),
                        },
                        {
                            number: 9,
                            title: "Overdue review",
                            state: "open",
                            repository_url: "https://api.github.com/repos/flowuser/hello",
                            html_url: "https://github.com/flowuser/hello/pull/9",
                            labels: [],
                            created_at: recent(10),
                            updated_at: recent(9),
                        },
                    ],
                });
            }
            if (q.includes("assignee:flowuser")) {
                return respond({
                    total_count: 1,
                    items: [
                        {
                            number: 8,
                            title: "Assigned bug",
                            state: "open",
                            repository_url: "https://api.github.com/repos/flowuser/hello",
                            html_url: "https://github.com/flowuser/hello/issues/8",
                            labels: [{ name: "bug" }],
                            created_at: recent(3),
                            updated_at: recent(2),
                        },
                    ],
                });
            }
            return respond({
                total_count: 1,
                items: [
                    {
                        number: 6,
                        title: "My open PR",
                        state: "open",
                        repository_url: "https://api.github.com/repos/flowuser/hello",
                        html_url: "https://github.com/flowuser/hello/pull/6",
                        labels: [],
                        created_at: recent(4),
                        updated_at: recent(2),
                    },
                ],
            });
        }
        if (u.includes("/api.github.com/user/repos")) {
            return respond([
                {
                    name: "hello",
                    full_name: "flowuser/hello",
                    description: "desc",
                    language: "JavaScript",
                    stargazers_count: 10,
                    forks_count: 2,
                    fork: false,
                    html_url: "https://github.com/flowuser/hello",
                    updated_at: "2026-01-01T00:00:00Z",
                },
            ]);
        }
        if (u.includes("/api.github.com/user")) {
            return respond({
                login: "flowuser",
                id: 707,
                name: "Flow User",
                avatar_url: "https://avatars/flow.png",
                html_url: "https://github.com/flowuser",
                bio: "bio",
                company: null,
                location: "Nowhere",
                public_repos: 3,
                followers: 4,
                following: 5,
                created_at: "2020-01-01T00:00:00Z",
            });
        }
        throw new Error(`Unexpected mocked URL: ${u}`);
    };
});

after(async () => {
    global.fetch = realFetch;
    if (server) server.close();
    // Close the DB and run GC so pending better-sqlite3 statements are finalized
    // while the isolate is still alive (avoids a native crash at teardown).
    db.close();
    if (global.gc) {
        global.gc();
        await new Promise((resolve) => setImmediate(resolve));
        global.gc();
    }
});

test("GET /api/health reports GitHub OAuth as configured", async () => {
    const res = await fetch(`${base}/api/health`);
    const body = await res.json();
    assert.strictEqual(body.githubOAuth, true);
});

test("GET /api/auth/github redirects to GitHub with PKCE and an httpOnly state cookie", async () => {
    const res = await fetch(`${base}/api/auth/github`, { redirect: "manual" });
    assert.strictEqual(res.status, 302);

    const location = new URL(res.headers.get("location"));
    assert.strictEqual(location.hostname, "github.com");
    assert.strictEqual(location.searchParams.get("code_challenge_method"), "S256");
    assert.ok(location.searchParams.get("code_challenge"));
    assert.ok(location.searchParams.get("state"));
    assert.ok(location.searchParams.get("redirect_uri"));

    const setCookie = res.headers.get("set-cookie") || "";
    assert.ok(setCookie.includes("github_oauth_state="));
    assert.ok(setCookie.includes("HttpOnly"));
});

test("full OAuth flow: callback issues a session and /api/account returns profile + repos", async () => {
    const startRes = await fetch(`${base}/api/auth/github`, { redirect: "manual" });
    const state = new URL(startRes.headers.get("location")).searchParams.get("state");
    const cookie = startRes.headers.get("set-cookie").split(";")[0];

    const cbRes = await fetch(`${base}/api/auth/github/callback?code=fakecode&state=${state}`, {
        headers: { Cookie: cookie },
        redirect: "manual",
    });
    assert.strictEqual(cbRes.status, 200);
    const html = await cbRes.text();
    assert.ok(html.includes("github-viewer-token"));
    assert.ok(html.includes('window.location.replace("/")'));

    const token = html.match(/github-viewer-token","([^"]+)"/)[1];

    const accountRes = await fetch(`${base}/api/account`, { headers: { Authorization: `Bearer ${token}` } });
    assert.strictEqual(accountRes.status, 200);
    const account = await accountRes.json();
    assert.strictEqual(account.type, "account");
    assert.strictEqual(account.profile.login, "flowuser");
    assert.strictEqual(account.profile.name, "Flow User");
    assert.strictEqual(account.repos.length, 1);
    assert.strictEqual(account.repos[0].name, "hello");
    assert.strictEqual(account.repos[0].language, "JavaScript");
    assert.strictEqual(account.rateLimit.remaining, 4900);

    assert.strictEqual(account.openPRs.length, 1);
    assert.strictEqual(account.openPRs[0].title, "My open PR");
    assert.strictEqual(account.openPRs[0].priority, "green");
    assert.strictEqual(account.openPRs[0].reason, "Recently active");

    assert.strictEqual(account.reviewRequests.length, 2);
    assert.strictEqual(account.reviewRequests[0].title, "Please review");
    assert.strictEqual(account.reviewRequests[0].priority, "yellow");
    assert.strictEqual(account.reviewRequests[0].reason, "Review requested 1 day ago");
    assert.strictEqual(account.reviewRequests[1].title, "Overdue review");
    assert.strictEqual(account.reviewRequests[1].priority, "red");
    assert.strictEqual(account.reviewRequests[1].reason, "Overdue review — requested 9 days ago");

    assert.strictEqual(account.assignedIssues.length, 1);
    assert.strictEqual(account.assignedIssues[0].title, "Assigned bug");
    assert.strictEqual(account.assignedIssues[0].priority, "green");

    assert.strictEqual(account.topActions.length, 2);
    assert.strictEqual(account.topActions[0].title, "Overdue review");
    assert.strictEqual(account.topActions[0].priority, "red");
    assert.strictEqual(account.topActions[0].type, "Review");
    assert.strictEqual(account.topActions[1].title, "Please review");
    assert.strictEqual(account.topActions[1].priority, "yellow");
    assert.strictEqual(account.topActions[1].type, "Review");

    assert.strictEqual(account.recentActivity.length, 5);
    assert.strictEqual(account.recentActivity[0].type, "PushEvent");
    assert.deepStrictEqual(account.priority, { red: 1, yellow: 1, green: 2, level: "red" });

    assert.deepStrictEqual(account.activityGraph.totals, {
        commits: 2,
        prs: 1,
        issues: 1,
        reviews: 1,
        branches: 1,
    });
    assert.strictEqual(account.activityGraph.byRepo.length, 2);
    assert.strictEqual(account.activityGraph.byRepo[0].name, "flowuser/hello");
    assert.strictEqual(account.activityGraph.byRepo[0].commits, 2);
    assert.strictEqual(account.activityGraph.byRepo[1].name, "flowuser/widgets");
    const todayBucket = account.activityGraph.byDay[account.activityGraph.byDay.length - 1];
    assert.strictEqual(todayBucket.commits, 2);
    assert.strictEqual(todayBucket.prs, 1);
    assert.strictEqual(todayBucket.branches, 1);

    const meRes = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    assert.strictEqual(meRes.status, 200);
    const me = await meRes.json();
    assert.strictEqual(me.user.github_login, "flowuser");
    assert.ok(me.user.avatar_url);
});

test("OAuth callback rejects a mismatched state", async () => {
    const startRes = await fetch(`${base}/api/auth/github`, { redirect: "manual" });
    const cookie = startRes.headers.get("set-cookie").split(";")[0];

    const res = await fetch(`${base}/api/auth/github/callback?code=stolen&state=attacker-state`, {
        headers: { Cookie: cookie },
    });
    assert.strictEqual(res.status, 400);
    const html = await res.text();
    assert.match(html, /Security check failed/);
});
