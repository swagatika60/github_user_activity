const cache = require("./cache");
const { summarizeEvents } = require("./activity");

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

function slimRepo(repo) {
    return {
        name: repo.name,
        full_name: repo.full_name,
        description: repo.description,
        language: repo.language,
        stargazers_count: repo.stargazers_count,
        forks_count: repo.forks_count,
        fork: repo.fork,
        html_url: repo.html_url,
        updated_at: repo.updated_at,
        topics: repo.topics || [],
    };
}

// Aggregate repo languages into a ranked list with percentages (top 8).
function aggregateLanguages(repos) {
    const counts = {};
    let total = 0;
    for (const repo of repos || []) {
        if (!repo.language) continue;
        counts[repo.language] = (counts[repo.language] || 0) + 1;
        total += 1;
    }
    return Object.entries(counts)
        .map(([name, count]) => ({ name, count, percentage: total ? Math.round((count / total) * 100) : 0 }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, 8);
}

// Per-day activity counts over the last `days` days, for the heatmap grid.
function buildContributions(events, days = 196) {
    const dayMap = new Map();
    for (const event of events || []) {
        if (!event.created_at) continue;
        const date = event.created_at.slice(0, 10);
        dayMap.set(date, (dayMap.get(date) || 0) + 1);
    }
    const now = new Date();
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
        const date = new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10);
        out.push({ date, count: dayMap.get(date) || 0 });
    }
    return out;
}

async function lookupUser(owner) {
    const [userRes, eventsRes, reposRes] = await Promise.all([
        fetchGitHub(`/users/${owner}`, { cacheKey: `user:${owner}` }),
        fetchGitHub(`/users/${owner}/events?per_page=100`, {
            cacheKey: `events:${owner}`,
            ttlMs: 2 * 60 * 1000,
        }),
        fetchGitHub(`/users/${owner}/repos?per_page=100&sort=updated`, {
            cacheKey: `repos:${owner}`,
            ttlMs: 5 * 60 * 1000,
        }),
    ]);

    const repos = reposRes.data.map(slimRepo).sort((a, b) => b.stargazers_count - a.stargazers_count);

    return {
        type: "user",
        profile: userRes.data,
        events: eventsRes.data,
        repos: repos.slice(0, 30),
        repoCount: repos.length,
        languages: aggregateLanguages(reposRes.data),
        contributions: buildContributions(eventsRes.data),
        activityGraph: summarizeEvents(eventsRes.data),
        cached: userRes.cached && eventsRes.cached && reposRes.cached,
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

async function lookupUserStarred(owner) {
    const res = await fetchGitHub(`/users/${owner}/starred?per_page=30&sort=created`, {
        cacheKey: `starred:${owner}`,
        ttlMs: 5 * 60 * 1000,
    });

    return {
        type: "starred",
        user: owner,
        repos: res.data.map(slimRepo),
        cached: res.cached,
        rateLimit: res.rateLimit,
    };
}

async function userSummary(owner) {
    const [userRes, reposRes] = await Promise.all([
        fetchGitHub(`/users/${owner}`, { cacheKey: `user:${owner}` }),
        fetchGitHub(`/users/${owner}/repos?per_page=100&sort=updated`, {
            cacheKey: `repos:${owner}`,
            ttlMs: 5 * 60 * 1000,
        }),
    ]);

    const repos = reposRes.data || [];
    const languages = aggregateLanguages(repos);
    const p = userRes.data;

    return {
        login: p.login,
        name: p.name,
        avatar_url: p.avatar_url,
        html_url: p.html_url,
        bio: p.bio,
        location: p.location,
        company: p.company,
        public_repos: p.public_repos,
        followers: p.followers,
        following: p.following,
        created_at: p.created_at,
        totalStars: repos.reduce((sum, r) => sum + (r.stargazers_count || 0), 0),
        topLanguage: languages[0] ? languages[0].name : null,
        languages,
    };
}

async function compareUsers(user1, user2) {
    const [a, b] = await Promise.all([userSummary(user1), userSummary(user2)]);
    return { type: "compare", user1: a, user2: b };
}

async function lookupRepoTrees(owner, repo) {
    const repoRes = await fetchGitHub(`/repos/${owner}/${repo}`, {
        cacheKey: `repo:${owner}/${repo}`,
    });
    const branch = repoRes.data.default_branch || "main";
    const treeRes = await fetchGitHub(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, {
        cacheKey: `tree:${owner}/${repo}:${branch}`,
        ttlMs: 10 * 60 * 1000,
    });

    const nodes = (treeRes.data.tree || [])
        .filter((node) => node.path && node.type)
        .map((node) => ({ path: node.path, type: node.type, size: node.size || 0 }))
        .slice(0, 400);

    return {
        type: "tree",
        owner,
        repo,
        branch,
        truncated: Boolean(treeRes.data.truncated) || nodes.length >= 400,
        tree: nodes,
        cached: repoRes.cached && treeRes.cached,
        rateLimit: repoRes.rateLimit,
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
    lookupUserStarred,
    compareUsers,
    lookupRepoTrees,
    slimRepo,
};
