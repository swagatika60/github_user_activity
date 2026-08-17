const express = require("express");
const cors = require("cors");
const path = require("path");
const { parseGitHubInput } = require("./lib/parser");
const github = require("./lib/github");
const cache = require("./lib/cache");
const db = require("./lib/db");
const auth = require("./lib/auth");

function createApp() {
    const app = express();

    app.use(cors());
    app.use(express.json());
    app.use(express.static(path.join(__dirname)));

    app.get("/api/health", async (_req, res) => {
        res.json({
            status: "ok",
            githubToken: Boolean(process.env.GITHUB_TOKEN),
            database: db.getDriver(),
            cache: cache.stats(),
        });
    });

    app.post("/api/auth/register", async (req, res) => {
        try {
            const user = await auth.registerUser(req.body);
            const token = auth.signToken(user);
            res.status(201).json({ user, token });
        } catch (error) {
            res.status(error.status || 500).json({ error: error.message });
        }
    });

    app.post("/api/auth/login", async (req, res) => {
        try {
            const user = await auth.loginUser(req.body);
            const token = auth.signToken(user);
            res.json({ user, token });
        } catch (error) {
            res.status(error.status || 500).json({ error: error.message });
        }
    });

    app.get("/api/auth/me", auth.authMiddleware, async (req, res) => {
        try {
            const user = await auth.getUserById(req.user.id);
            if (!user) {
                return res.status(404).json({ error: "User not found." });
            }
            res.json({ user });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.get("/api/history", auth.authMiddleware, async (req, res) => {
        try {
            const history = await auth.getSearchHistory(req.user.id);
            res.json({ history });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.delete("/api/history", auth.authMiddleware, async (req, res) => {
        try {
            await auth.clearSearchHistory(req.user.id);
            res.json({ ok: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.get("/api/user/starred", async (req, res) => {
        const user = String(req.query.user || "").trim();
        if (!user) {
            return res.status(400).json({ error: "Missing user parameter." });
        }
        try {
            const result = await github.lookupUserStarred(user);
            res.json(result);
        } catch (error) {
            res.status(error.status || 500).json({
                error: error.message || "Unexpected server error",
                rateLimit: error.rateLimit,
            });
        }
    });

    app.get("/api/compare", async (req, res) => {
        const user1 = String(req.query.user1 || "").trim();
        const user2 = String(req.query.user2 || "").trim();
        if (!user1 || !user2) {
            return res.status(400).json({ error: "Both user1 and user2 parameters are required." });
        }
        if (user1.toLowerCase() === user2.toLowerCase()) {
            return res.status(400).json({ error: "Pick two different users to compare." });
        }
        try {
            const result = await github.compareUsers(user1, user2);
            res.json(result);
        } catch (error) {
            res.status(error.status || 500).json({
                error: error.message || "Unexpected server error",
                rateLimit: error.rateLimit,
            });
        }
    });

    app.get("/api/repo/tree", async (req, res) => {
        const owner = String(req.query.owner || "").trim();
        const repo = String(req.query.repo || "").trim();
        if (!owner || !repo) {
            return res.status(400).json({ error: "Missing owner or repo parameter." });
        }
        try {
            const result = await github.lookupRepoTrees(owner, repo);
            res.json(result);
        } catch (error) {
            res.status(error.status || 500).json({
                error: error.message || "Unexpected server error",
                rateLimit: error.rateLimit,
            });
        }
    });

    app.get("/api/search", auth.optionalAuth, async (req, res) => {
        const input = String(req.query.q || "").trim();
        const parsed = parseGitHubInput(input);

        if (parsed.type === "empty") {
            return res.status(400).json({ error: "Please enter a GitHub username or link." });
        }

        if (parsed.type === "invalid") {
            return res.status(400).json({ error: "That link does not look like a supported GitHub URL." });
        }

        try {
            let result;

            switch (parsed.type) {
                case "user":
                    result = await github.lookupUser(parsed.owner);
                    break;
                case "username":
                    result = await github.lookupUser(parsed.username);
                    break;
                case "repo":
                    result = await github.lookupRepo(parsed.owner, parsed.repo);
                    break;
                case "issue":
                    result = await github.lookupIssue(parsed.owner, parsed.repo, parsed.number);
                    break;
                case "pull":
                    result = await github.lookupPull(parsed.owner, parsed.repo, parsed.number);
                    break;
                case "commit":
                    result = await github.lookupCommit(parsed.owner, parsed.repo, parsed.sha);
                    break;
                default:
                    result = await github.lookupActivity(parsed.username);
                    break;
            }

            if (req.user) {
                await auth.saveSearchHistory(req.user.id, input, result.type);
            }

            res.json(result);
        } catch (error) {
            res.status(error.status || 500).json({
                error: error.message || "Unexpected server error",
                rateLimit: error.rateLimit,
            });
        }
    });

    app.get("*", (_req, res) => {
        res.sendFile(path.join(__dirname, "index.html"));
    });

    return app;
}

module.exports = { createApp };
