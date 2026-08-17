const crypto = require("crypto");
const auth = require("./auth");
const priority = require("./priority");
const activity = require("./activity");

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || "";
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || "";
const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const API_URL = "https://api.github.com";
const OAUTH_SCOPES = "read:user user:email";
const STATE_COOKIE = "github_oauth_state";
const STATE_TTL_MS = 10 * 60 * 1000;
const USER_AGENT = "Github-User-Activity-App";

function isConfigured() {
    return Boolean(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET);
}

function getRedirectUri(req) {
    if (process.env.GITHUB_REDIRECT_URI) {
        return process.env.GITHUB_REDIRECT_URI;
    }
    if (process.env.PUBLIC_BASE_URL) {
        return `${process.env.PUBLIC_BASE_URL.replace(/\/+$/, "")}/api/auth/github/callback`;
    }
    const proto = (req.headers["x-forwarded-proto"] || "").split(",")[0].trim() || req.protocol || "http";
    return `${proto}://${req.get("host")}/api/auth/github/callback`;
}

function safeEqual(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

function readCookie(req, name) {
    const header = req.headers.cookie || "";
    for (const part of header.split(";")) {
        const idx = part.indexOf("=");
        if (idx === -1) continue;
        if (part.slice(0, idx).trim() === name) {
            const value = part.slice(idx + 1).trim();
            try {
                return decodeURIComponent(value);
            } catch {
                return value;
            }
        }
    }
    return "";
}

function getEncryptionKey() {
    return crypto
        .createHash("sha256")
        .update(process.env.JWT_SECRET || "dev-secret-change-in-production")
        .digest();
}

function encryptToken(plain) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptToken(stored) {
    const parts = String(stored).split(":");
    if (parts.length !== 4 || parts[0] !== "v1") {
        const error = new Error("Stored GitHub token is invalid.");
        error.status = 500;
        throw error;
    }
    const decipher = crypto.createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(parts[1], "base64"));
    decipher.setAuthTag(Buffer.from(parts[2], "base64"));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64")), decipher.final()]).toString("utf8");
}

async function githubFetch(path, token) {
    const response = await fetch(`${API_URL}${path}`, {
        headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "User-Agent": USER_AGENT,
            "X-GitHub-Api-Version": "2022-11-28",
        },
    });

    const rateLimit = {
        remaining: Number(response.headers.get("x-ratelimit-remaining") || 0),
        limit: Number(response.headers.get("x-ratelimit-limit") || 0),
        reset: Number(response.headers.get("x-ratelimit-reset") || 0),
    };

    if (!response.ok) {
        const error = new Error(`GitHub API error (${response.status})`);
        error.status = response.status;
        error.rateLimit = rateLimit;
        throw error;
    }

    const data = await response.json();
    return { data, rateLimit };
}

function startOAuth(req, res) {
    if (!isConfigured()) {
        return sendOAuthPage(
            res,
            503,
            "GitHub sign-in is not configured on this server. Add GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET to the environment and restart."
        );
    }

    const state = crypto.randomBytes(24).toString("hex");
    const verifier = crypto.randomBytes(32).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

    const params = new URLSearchParams({
        client_id: GITHUB_CLIENT_ID,
        redirect_uri: getRedirectUri(req),
        scope: OAUTH_SCOPES,
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
    });

    res.cookie(STATE_COOKIE, `${state}.${verifier}`, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: STATE_TTL_MS,
        path: "/",
    });

    res.redirect(`${AUTHORIZE_URL}?${params.toString()}`);
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function sendOAuthPage(res, status, message, token) {
    const content = token
        ? `<div class="spinner"></div><p>Signing you in…</p><script>try{localStorage.setItem("github-viewer-token",${JSON.stringify(token).replace(/</g, "\\u003c")});}catch(e){}window.location.replace("/");</script>`
        : `<div class="error"><p>${escapeHtml(message)}</p><a href="/">← Back to app</a></div>`;

    res.status(status).send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GitHub sign in</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0d1117; color: #c9d1d9; display: grid; place-items: center; min-height: 100vh; margin: 0; }
        .card { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 32px; max-width: 380px; text-align: center; }
        .error { color: #f85149; margin-bottom: 16px; }
        a { color: #58a6ff; text-decoration: none; }
        .spinner { width: 28px; height: 28px; border: 3px solid #30363d; border-top-color: #58a6ff; border-radius: 50%; margin: 0 auto 16px; animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <div class="card">${content}</div>
</body>
</html>`);
}

async function handleCallback(req, res) {
    const { code, state } = req.query;
    const errorParam = req.query.error;
    const cookie = readCookie(req, STATE_COOKIE);
    res.clearCookie(STATE_COOKIE, { path: "/" });

    if (errorParam) {
        const message =
            errorParam === "access_denied"
                ? "GitHub sign in was cancelled."
                : `GitHub authorization failed: ${escapeHtml(errorParam)}`;
        return sendOAuthPage(res, 400, message);
    }

    if (!code || !state || !cookie) {
        return sendOAuthPage(res, 400, "Missing OAuth parameters. Please try signing in again.");
    }

    const [cookieState, verifier] = cookie.split(".");
    if (!cookieState || !verifier || !safeEqual(cookieState, state)) {
        return sendOAuthPage(res, 400, "Security check failed. Please try signing in again.");
    }

    try {
        const redirectUri = getRedirectUri(req);
        const tokenResponse = await fetch(TOKEN_URL, {
            method: "POST",
            headers: { Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify({
                client_id: GITHUB_CLIENT_ID,
                client_secret: GITHUB_CLIENT_SECRET,
                code,
                redirect_uri: redirectUri,
                code_verifier: verifier,
            }),
        });

        const tokenData = await tokenResponse.json();
        if (!tokenResponse.ok || !tokenData.access_token) {
            // Surface GitHub's reason (e.g. redirect_uri_mismatch, bad_verification_code)
            // so the failure is diagnosable instead of a generic message.
            throw new Error(tokenData.error_description || tokenData.error || "Failed to exchange OAuth code");
        }

        const accessToken = tokenData.access_token;
        const profile = await githubFetch("/user", accessToken);
        const email = await fetchPrimaryEmail(accessToken, profile.data.email);

        const user = await auth.upsertGithubUser({ profile: profile.data, email });
        await auth.setGithubToken(user.id, encryptToken(accessToken));

        sendOAuthPage(res, 200, null, auth.signToken(user));
    } catch (error) {
        console.error("GitHub OAuth error:", error.message);
        sendOAuthPage(res, 500, `Sign in with GitHub failed: ${escapeHtml(error.message)}`);
    }
}

async function fetchPrimaryEmail(token, profileEmail) {
    if (profileEmail) return profileEmail;
    try {
        const { data } = await githubFetch("/user/emails", token);
        const primary = data.find((entry) => entry.primary && entry.verified) || data.find((entry) => entry.verified);
        if (primary?.email) return primary.email;
    } catch {
        // Email scope denied — fall back to the noreply address in upsertGithubUser.
    }
    return null;
}

async function safeSearch(query, token) {
    try {
        const { data } = await githubFetch(`/search/issues?q=${encodeURIComponent(query)}&per_page=10&sort=updated`, token);
        return data;
    } catch (error) {
        console.error(`GitHub search failed (${query}):`, error.message);
        return null;
    }
}

async function safeFetch(path, token) {
    try {
        return await githubFetch(path, token);
    } catch (error) {
        console.error(`GitHub fetch failed (${path}):`, error.message);
        return null;
    }
}

async function fetchAccount(userId) {
    const blob = await auth.getGithubToken(userId);
    if (!blob) {
        const error = new Error("No GitHub account linked to this user.");
        error.status = 404;
        throw error;
    }

    const token = decryptToken(blob);
    const [userResult, reposResult] = await Promise.all([
        githubFetch("/user", token),
        githubFetch("/user/repos?per_page=50&sort=updated&affiliation=owner", token),
    ]);

    const login = userResult.data.login;
    const [openPRs, reviewRequests, assignedIssues, activityResult] = await Promise.all([
        safeSearch(`is:pr+author:${login}+is:open`, token),
        safeSearch(`is:pr+review-requested:${login}+is:open`, token),
        safeSearch(`is:issue+assignee:${login}+is:open`, token),
        safeFetch(`/users/${encodeURIComponent(login)}/events?per_page=100`, token),
    ]);
    const activityEvents = activityResult?.data || [];

    const openPRItems = (openPRs?.items || []).map((item) => {
        const { level, reason } = priority.classify(item);
        return { ...slimIssue(item), type: "PR", priority: level, reason };
    });
    const reviewItems = (reviewRequests?.items || []).map((item) => {
        const { level, reason } = priority.classify(item, { reviewRequested: true });
        return { ...slimIssue(item), type: "Review", priority: level, reason };
    });
    const issueItems = (assignedIssues?.items || []).map((item) => {
        const { level, reason } = priority.classify(item);
        return { ...slimIssue(item), type: "Issue", priority: level, reason };
    });

    return {
        type: "account",
        profile: slimProfile(userResult.data),
        repos: reposResult.data.map(slimRepo),
        openPRs: openPRItems,
        reviewRequests: reviewItems,
        assignedIssues: issueItems,
        recentActivity: activityEvents.slice(0, 10).map(slimEvent),
        activityGraph: activity.summarizeEvents(activityEvents),
        topActions: priority.selectTopActions([...openPRItems, ...reviewItems, ...issueItems], 5),
        priority: priority.summarize({
            openPRs: openPRItems,
            reviewRequests: reviewItems,
            assignedIssues: issueItems,
        }),
        rateLimit: userResult.rateLimit,
    };
}

function slimIssue(item) {
    return {
        number: item.number,
        title: item.title,
        state: item.state,
        repository: (item.repository_url || "").replace("https://api.github.com/repos/", ""),
        html_url: item.html_url,
        labels: (item.labels || []).map((label) => label.name),
        created_at: item.created_at,
        updated_at: item.updated_at,
    };
}

function slimEvent(event) {
    const pullRequest = event.payload?.pull_request;
    const issue = event.payload?.issue;
    return {
        id: event.id,
        type: event.type,
        created_at: event.created_at,
        repo: event.repo ? { name: event.repo.name } : null,
        payload: {
            ref: event.payload?.ref,
            ref_type: event.payload?.ref_type,
            action: event.payload?.action,
            // The public events feed omits html_url on PR payloads, so derive
            // the exact link from the repo + PR number when needed.
            pull_request: pullRequest
                ? {
                      number: pullRequest.number,
                      html_url:
                          pullRequest.html_url ||
                          (event.repo?.name && pullRequest.number
                              ? `https://github.com/${event.repo.name}/pull/${pullRequest.number}`
                              : undefined),
                  }
                : undefined,
            issue: issue ? { number: issue.number, html_url: issue.html_url } : undefined,
        },
    };
}

function slimProfile(user) {
    return {
        login: user.login,
        id: user.id,
        name: user.name,
        avatar_url: user.avatar_url,
        html_url: user.html_url,
        bio: user.bio,
        company: user.company,
        location: user.location,
        public_repos: user.public_repos,
        followers: user.followers,
        following: user.following,
        created_at: user.created_at,
    };
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
    };
}

module.exports = { isConfigured, startOAuth, handleCallback, fetchAccount, encryptToken, decryptToken };
