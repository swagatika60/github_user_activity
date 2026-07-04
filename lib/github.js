const cache = require("./cache");

const GITHUB_API = "https://api.github.com";
const TOKEN = process.env.GITHUB_TOKEN || "";

async function fetchGitHub(path, { cacheKey, ttlMs } = {}) {
    if (cacheKey) {
        const cached = await cache.get(cacheKey);
        if (cached) {
            return { ...cached, cached: true };
        }
    }

    const headers = {
        Accept: "application/vnd.github+json",
        "User-Agent": "Github-User-Activity-App",
    };

    if (TOKEN) {
        headers.Authorization = `Bearer ${TOKEN}`;
    }

    const response = await fetch(`${GITHUB_API}${path}`, { headers });

    const rateLimit = {
        remaining: Number(response.headers.get("x-ratelimit-remaining") || 0),
        limit: Number(response.headers.get("x-ratelimit-limit") || 0),
        reset: Number(response.headers.get("x-ratelimit-reset") || 0),
    };

    if (!response.ok) {
        const error = new Error(
            response.status === 404
                ? "Resource not found"
                : response.status === 403
                  ? "GitHub API rate limit reached. Add GITHUB_TOKEN to .env for higher limits."
                  : "Error fetching data from GitHub"
        );
        error.status = response.status;
        error.rateLimit = rateLimit;
        throw error;
    }

    const data = await response.json();
    const result = { data, cached: false, rateLimit };

    if (cacheKey) {
        await cache.set(cacheKey, result, ttlMs);
    }

    return result;
}

async function lookupUser(owner) {
    const [userRes, eventsRes] = await Promise.all([
        fetchGitHub(`/users/${owner}`, { cacheKey: `user:${owner}` }),
        fetchGitHub(`/users/${owner}/events?per_page=10`, {
            cacheKey: `events:${owner}`,
            ttlMs: 2 * 60 * 1000,
        }),
    ]);

    return {
        type: "user",
        profile: userRes.data,
        events: eventsRes.data,
        cached: userRes.cached && eventsRes.cached,
        rateLimit: userRes.rateLimit,
    };
}

async function lookupActivity(username) {
    const eventsRes = await fetchGitHub(`/users/${username}/events?per_page=10`, {
        cacheKey: `activity:${username}`,
        ttlMs: 2 * 60 * 1000,
    });

    return {
        type: "activity",
        username,
        events: eventsRes.data,
        cached: eventsRes.cached,
        rateLimit: eventsRes.rateLimit,
    };
}

async function lookupRepo(owner, repo) {
    const repoRes = await fetchGitHub(`/repos/${owner}/${repo}`, {
        cacheKey: `repo:${owner}/${repo}`,
    });

    return {
        type: "repo",
        repo: repoRes.data,
        cached: repoRes.cached,
        rateLimit: repoRes.rateLimit,
    };
}

async function lookupIssue(owner, repo, number) {
    const issueRes = await fetchGitHub(`/repos/${owner}/${repo}/issues/${number}`, {
        cacheKey: `issue:${owner}/${repo}/${number}`,
        ttlMs: 2 * 60 * 1000,
    });

    return {
        type: "issue",
        issue: issueRes.data,
        cached: issueRes.cached,
        rateLimit: issueRes.rateLimit,
    };
}

async function lookupPull(owner, repo, number) {
    const pullRes = await fetchGitHub(`/repos/${owner}/${repo}/pulls/${number}`, {
        cacheKey: `pull:${owner}/${repo}/${number}`,
        ttlMs: 2 * 60 * 1000,
    });

    return {
        type: "pull",
        pull: pullRes.data,
        cached: pullRes.cached,
        rateLimit: pullRes.rateLimit,
    };
}

async function lookupCommit(owner, repo, sha) {
    const commitRes = await fetchGitHub(`/repos/${owner}/${repo}/commits/${sha}`, {
        cacheKey: `commit:${owner}/${repo}/${sha}`,
    });

    return {
        type: "commit",
        commit: commitRes.data,
        owner,
        repo,
        cached: commitRes.cached,
        rateLimit: commitRes.rateLimit,
    };
}

module.exports = {
    lookupUser,
    lookupActivity,
    lookupRepo,
    lookupIssue,
    lookupPull,
    lookupCommit,
};
