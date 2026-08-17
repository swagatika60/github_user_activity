const { test, before, after } = require("node:test");
const assert = require("node:assert");

// Must be set before requiring lib/github, which reads it at load time.
process.env.GITHUB_TOKEN = "ghp_test_secret_token";

// No database is initialized here: the lookups only use the memory cache.
const github = require("../lib/github");

const realFetch = global.fetch;
let capturedHeaders = null;

before(() => {
    global.fetch = async (_url, options = {}) => {
        capturedHeaders = options.headers || {};
        return {
            ok: true,
            status: 200,
            headers: new Headers({
                "x-ratelimit-remaining": "4999",
                "x-ratelimit-limit": "5000",
                "x-ratelimit-reset": "0",
            }),
            json: async () => ({ full_name: "acme/widgets", stargazers_count: 1 }),
        };
    };
});

after(() => {
    global.fetch = realFetch;
});

test("GitHub requests include the configured token as a Bearer header", async () => {
    await github.lookupRepo("acme", "widgets");

    assert.strictEqual(capturedHeaders.Authorization, "Bearer ghp_test_secret_token");
    assert.strictEqual(capturedHeaders["User-Agent"], "Github-User-Activity-App");
    assert.strictEqual(capturedHeaders.Accept, "application/vnd.github+json");
});
