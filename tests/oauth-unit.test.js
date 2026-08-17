const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert");
const jwt = require("jsonwebtoken");

// Must be set before requiring modules that read env at load time.
process.env.JWT_SECRET = "unit-test-secret";
process.env.SQLITE_DB_PATH = ":memory:";

const db = require("../lib/db");
const auth = require("../lib/auth");
const oauth = require("../lib/oauth");
const { createApp } = require("../app");

let server;
let base;

before(async () => {
    await db.init();
    const app = createApp();
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
    if (server) server.close();
    // Close the DB and run GC so pending better-sqlite3 statements are finalized
    // while the isolate is still alive (avoids a native crash at teardown).
    db.close();
    if (global.gc) global.gc();
});

beforeEach(async () => {
    await db.run("DELETE FROM search_history");
    await db.run("DELETE FROM users");
});

test("OAuth is not configured without client credentials", () => {
    assert.strictEqual(oauth.isConfigured(), false);
});

test("GitHub token encryption round-trips", () => {
    const token = "gho_abcdef1234567890";
    const blob = oauth.encryptToken(token);
    assert.notStrictEqual(blob, token);
    assert.strictEqual(oauth.decryptToken(blob), token);
});

test("decrypt fails when JWT_SECRET changes", () => {
    const blob = oauth.encryptToken("gho_secret_1");
    const original = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "a-different-secret";
    try {
        assert.throws(() => oauth.decryptToken(blob));
    } finally {
        process.env.JWT_SECRET = original;
    }
});

test("upsertGithubUser creates a new account with a normalized email", async () => {
    const user = await auth.upsertGithubUser({
        profile: { id: 101, login: "octocat", name: "The Octocat", avatar_url: "https://a/1.png" },
        email: "OCTOCAT@Example.com",
    });
    assert.strictEqual(user.email, "octocat@example.com");
    assert.strictEqual(user.github_login, "octocat");
    assert.strictEqual(user.avatar_url, "https://a/1.png");
});

test("upsertGithubUser is idempotent for the same GitHub id", async () => {
    const profile = { id: 202, login: "idem", name: "Idem", avatar_url: "https://a/2.png" };
    const first = await auth.upsertGithubUser({ profile, email: "idem@example.com" });
    const second = await auth.upsertGithubUser({ profile, email: "idem@example.com" });
    assert.strictEqual(second.id, first.id);
});

test("upsertGithubUser links an existing email account", async () => {
    const registered = await auth.registerUser({ name: "Link", email: "link@example.com", password: "secret123" });
    const linked = await auth.upsertGithubUser({
        profile: { id: 303, login: "linkgh", name: "Link GH", avatar_url: "https://a/3.png" },
        email: "link@example.com",
    });
    assert.strictEqual(linked.id, registered.id);
    assert.strictEqual(linked.github_login, "linkgh");
});

test("stored GitHub tokens can be retrieved", async () => {
    const user = await auth.upsertGithubUser({
        profile: { id: 404, login: "tokenuser", name: "Token", avatar_url: "https://a/4.png" },
        email: "token@example.com",
    });
    const blob = oauth.encryptToken("gho_persisted_token");
    await auth.setGithubToken(user.id, blob);
    assert.strictEqual(await auth.getGithubToken(user.id), blob);
});

test("signed JWTs carry GitHub claims", async () => {
    const user = await auth.upsertGithubUser({
        profile: { id: 505, login: "jwtuser", name: "JWT", avatar_url: "https://a/5.png" },
        email: "jwt@example.com",
    });
    const payload = jwt.verify(auth.signToken(user), process.env.JWT_SECRET);
    assert.strictEqual(payload.githubLogin, "jwtuser");
    assert.strictEqual(payload.githubId, 505);
    assert.strictEqual(payload.avatarUrl, "https://a/5.png");
});

test("password login is blocked for OAuth-only accounts", async () => {
    await auth.upsertGithubUser({
        profile: { id: 606, login: "nopw", name: "No PW", avatar_url: "https://a/6.png" },
        email: "nopw@example.com",
    });
    await assert.rejects(
        () => auth.loginUser({ email: "nopw@example.com", password: "guess-anything" }),
        (error) => error.status === 401
    );
});

test("GET /api/auth/github returns a friendly 503 page when OAuth is not configured", async () => {
    const res = await fetch(`${base}/api/auth/github`);
    assert.strictEqual(res.status, 503);
    const html = await res.text();
    assert.match(html, /GITHUB_CLIENT_ID/);
    assert.match(html, /Back to app/);
});

test("GET /api/health reports GitHub OAuth as not configured", async () => {
    const res = await fetch(`${base}/api/health`);
    const body = await res.json();
    assert.strictEqual(body.githubOAuth, false);
});

test("GET /api/account requires authentication", async () => {
    const res = await fetch(`${base}/api/account`);
    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.match(body.error, /Authentication required/);
});

test("GET /api/auth/github/callback without params returns an error page", async () => {
    const res = await fetch(`${base}/api/auth/github/callback`);
    assert.strictEqual(res.status, 400);
    const html = await res.text();
    assert.match(html, /Missing OAuth parameters/);
});

test("GET /api/auth/github/callback handles a denied authorization", async () => {
    const res = await fetch(`${base}/api/auth/github/callback?error=access_denied`);
    assert.strictEqual(res.status, 400);
    const html = await res.text();
    assert.match(html, /cancelled/i);
});
