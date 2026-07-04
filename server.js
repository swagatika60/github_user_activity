require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const { parseGitHubInput } = require("./lib/parser");
const github = require("./lib/github");
const cache = require("./lib/cache");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get("/api/health", (_req, res) => {
    res.json({
        status: "ok",
        githubToken: Boolean(process.env.GITHUB_TOKEN),
        cache: cache.stats(),
    });
});

app.get("/api/search", async (req, res) => {
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
            case "username":
            default:
                result = await github.lookupActivity(parsed.username);
                break;
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

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`GitHub token: ${process.env.GITHUB_TOKEN ? "configured" : "not set (optional)"}`);
});
