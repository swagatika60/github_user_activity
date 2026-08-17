const { test } = require("node:test");
const assert = require("node:assert");
const { parseGitHubInput } = require("../lib/parser");

test("returns empty for blank input", () => {
    assert.deepStrictEqual(parseGitHubInput(""), { type: "empty" });
    assert.deepStrictEqual(parseGitHubInput("   "), { type: "empty" });
});

test("treats plain input as a username", () => {
    assert.deepStrictEqual(parseGitHubInput("torvalds"), { type: "username", username: "torvalds" });
    assert.deepStrictEqual(parseGitHubInput("  torvalds  "), { type: "username", username: "torvalds" });
});

test("strips a leading @ from usernames", () => {
    assert.deepStrictEqual(parseGitHubInput("@torvalds"), { type: "username", username: "torvalds" });
});

test("parses profile URLs", () => {
    const expected = { type: "user", owner: "torvalds" };
    assert.deepStrictEqual(parseGitHubInput("https://github.com/torvalds"), expected);
    assert.deepStrictEqual(parseGitHubInput("http://github.com/torvalds"), expected);
    assert.deepStrictEqual(parseGitHubInput("www.github.com/torvalds"), expected);
    assert.deepStrictEqual(parseGitHubInput("github.com/torvalds"), expected);
    assert.deepStrictEqual(parseGitHubInput("https://GITHUB.COM/torvalds"), expected);
});

test("parses repository URLs", () => {
    assert.deepStrictEqual(parseGitHubInput("https://github.com/facebook/react"), {
        type: "repo",
        owner: "facebook",
        repo: "react",
    });
    assert.deepStrictEqual(parseGitHubInput("https://github.com/facebook/react/"), {
        type: "repo",
        owner: "facebook",
        repo: "react",
    });
});

test("parses issue URLs", () => {
    assert.deepStrictEqual(parseGitHubInput("https://github.com/facebook/react/issues/42"), {
        type: "issue",
        owner: "facebook",
        repo: "react",
        number: "42",
    });
    assert.deepStrictEqual(parseGitHubInput("https://github.com/facebook/react/issues/42/"), {
        type: "issue",
        owner: "facebook",
        repo: "react",
        number: "42",
    });
});

test("parses pull request URLs", () => {
    assert.deepStrictEqual(parseGitHubInput("https://github.com/facebook/react/pull/99"), {
        type: "pull",
        owner: "facebook",
        repo: "react",
        number: "99",
    });
});

test("parses commit URLs", () => {
    assert.deepStrictEqual(parseGitHubInput("https://github.com/facebook/react/commit/abc123"), {
        type: "commit",
        owner: "facebook",
        repo: "react",
        sha: "abc123",
    });
});

test("falls back to a repo for unmatched deep links", () => {
    assert.deepStrictEqual(parseGitHubInput("https://github.com/facebook/react/tree/main"), {
        type: "repo",
        owner: "facebook",
        repo: "react",
    });
    assert.deepStrictEqual(parseGitHubInput("https://github.com/facebook/react/issues/not-a-number"), {
        type: "repo",
        owner: "facebook",
        repo: "react",
    });
});

test("rejects URLs that are not GitHub", () => {
    assert.deepStrictEqual(parseGitHubInput("https://example.com/foo"), { type: "invalid" });
    assert.deepStrictEqual(parseGitHubInput("https://gitlab.com/torvalds"), { type: "invalid" });
    assert.deepStrictEqual(parseGitHubInput("https://github.com"), { type: "invalid" });
    assert.deepStrictEqual(parseGitHubInput("not a url"), { type: "username", username: "not a url" });
});
