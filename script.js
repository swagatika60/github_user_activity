const HISTORY_KEY = "github-viewer-history";
const AUTH_TOKEN_KEY = "github-viewer-token";
const MAX_HISTORY = 8;

let currentUser = null;

document.addEventListener("DOMContentLoaded", () => {
    const input = document.getElementById("username");
    const searchBtn = document.getElementById("search-btn");
    const clearHistoryBtn = document.getElementById("clear-history");

    searchBtn.addEventListener("click", getActivity);
    input.addEventListener("keypress", (event) => {
        if (event.key === "Enter") getActivity();
    });
    input.addEventListener("paste", () => setTimeout(getActivity, 0));
    clearHistoryBtn.addEventListener("click", clearHistory);

    setupAuthUI();
    initApp();
});

async function initApp() {
    await checkHealth();
    await restoreSession();
    await renderHistory();
}

function getToken() {
    return localStorage.getItem(AUTH_TOKEN_KEY);
}

function getAuthHeaders() {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch(url, options = {}) {
    return fetch(url, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...getAuthHeaders(),
            ...options.headers,
        },
    });
}

function setupAuthUI() {
    document.getElementById("open-auth").addEventListener("click", () => openAuthModal("login"));
    document.getElementById("close-auth").addEventListener("click", closeAuthModal);
    document.getElementById("auth-backdrop").addEventListener("click", closeAuthModal);

    document.querySelectorAll(".auth-tab").forEach((tab) => {
        tab.addEventListener("click", () => switchAuthTab(tab.dataset.tab));
    });

    document.getElementById("login-form").addEventListener("submit", handleLogin);
    document.getElementById("register-form").addEventListener("submit", handleRegister);
}

function openAuthModal(tab = "login") {
    document.getElementById("auth-modal").hidden = false;
    switchAuthTab(tab);
}

function closeAuthModal() {
    document.getElementById("auth-modal").hidden = true;
    document.getElementById("login-error").hidden = true;
    document.getElementById("register-error").hidden = true;
}

function switchAuthTab(tab) {
    const isLogin = tab === "login";
    document.querySelectorAll(".auth-tab").forEach((el) => {
        el.classList.toggle("active", el.dataset.tab === tab);
    });
    document.getElementById("login-form").hidden = !isLogin;
    document.getElementById("register-form").hidden = isLogin;
    document.getElementById("auth-title").textContent = isLogin ? "Welcome back" : "Create account";
    document.getElementById("auth-subtitle").textContent = isLogin
        ? "Sign in to save search history across devices."
        : "Register to persist your searches in the database.";
}

async function handleLogin(event) {
    event.preventDefault();
    const errorEl = document.getElementById("login-error");
    errorEl.hidden = true;

    try {
        const response = await apiFetch("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({
                email: document.getElementById("login-email").value,
                password: document.getElementById("login-password").value,
            }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Login failed");

        localStorage.setItem(AUTH_TOKEN_KEY, data.token);
        currentUser = data.user;
        updateAuthUI();
        closeAuthModal();
        await renderHistory();
    } catch (error) {
        errorEl.textContent = error.message;
        errorEl.hidden = false;
    }
}

async function handleRegister(event) {
    event.preventDefault();
    const errorEl = document.getElementById("register-error");
    errorEl.hidden = true;

    try {
        const response = await apiFetch("/api/auth/register", {
            method: "POST",
            body: JSON.stringify({
                name: document.getElementById("register-name").value,
                email: document.getElementById("register-email").value,
                password: document.getElementById("register-password").value,
            }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Registration failed");

        localStorage.setItem(AUTH_TOKEN_KEY, data.token);
        currentUser = data.user;
        updateAuthUI();
        closeAuthModal();
        await renderHistory();
    } catch (error) {
        errorEl.textContent = error.message;
        errorEl.hidden = false;
    }
}

async function restoreSession() {
    if (!getToken()) {
        updateAuthUI();
        return;
    }

    try {
        const response = await apiFetch("/api/auth/me");
        if (!response.ok) throw new Error("session expired");
        const data = await response.json();
        currentUser = data.user;
    } catch {
        localStorage.removeItem(AUTH_TOKEN_KEY);
        currentUser = null;
    }

    updateAuthUI();
}

function logout() {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    currentUser = null;
    updateAuthUI();
    renderHistory();
}

function updateAuthUI() {
    const area = document.getElementById("auth-area");

    if (currentUser) {
        area.innerHTML = `
            <span class="user-greeting">Hi, ${escapeHtml(currentUser.name)}</span>
            <button type="button" class="text-btn" id="logout-btn">Sign out</button>`;
        document.getElementById("logout-btn").addEventListener("click", logout);
        return;
    }

    area.innerHTML = `<button type="button" class="auth-btn" id="open-auth">Sign in</button>`;
    document.getElementById("open-auth").addEventListener("click", () => openAuthModal("login"));
}

async function checkHealth() {
    const statusEl = document.getElementById("api-status");
    const dot = statusEl.querySelector(".status-dot");
    const text = statusEl.querySelector(".status-text");

    try {
        const response = await fetch("/api/health");
        if (!response.ok) throw new Error("offline");
        const data = await response.json();
        dot.classList.add("online");
        const dbLabel = data.database === "postgres" ? "PostgreSQL" : "SQLite";
        text.textContent = data.githubToken
            ? `API · ${dbLabel} · token active`
            : `API · ${dbLabel}`;
    } catch {
        dot.classList.add("offline");
        text.textContent = "Backend offline — run npm start";
    }
}

function getLocalHistory() {
    try {
        return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    } catch {
        return [];
    }
}

function saveLocalHistory(query) {
    const trimmed = query.trim();
    if (!trimmed || currentUser) return;

    const history = getLocalHistory().filter((item) => item !== trimmed);
    history.unshift(trimmed);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
}

async function saveHistory(query) {
    if (currentUser) {
        await renderHistory();
        return;
    }
    saveLocalHistory(query);
    await renderHistory();
}

async function clearHistory() {
    if (currentUser) {
        await apiFetch("/api/history", { method: "DELETE" });
    } else {
        localStorage.removeItem(HISTORY_KEY);
    }
    await renderHistory();
}

async function getHistoryItems() {
    if (currentUser) {
        const response = await apiFetch("/api/history");
        if (!response.ok) return [];
        const data = await response.json();
        return data.history.map((item) => item.query);
    }
    return getLocalHistory();
}

async function renderHistory() {
    const history = await getHistoryItems();
    const section = document.getElementById("history-section");
    const list = document.getElementById("history-list");
    const header = section.querySelector(".history-header h2");

    if (currentUser) {
        header.textContent = "Your saved searches";
    } else {
        header.textContent = "Recent searches";
    }

    if (history.length === 0) {
        section.hidden = true;
        return;
    }

    section.hidden = false;
    list.innerHTML = history
        .map(
            (item) =>
                `<button type="button" class="history-item" data-query="${escapeHtml(item)}">${escapeHtml(item)}</button>`
        )
        .join("");

    list.querySelectorAll(".history-item").forEach((btn) => {
        btn.addEventListener("click", () => {
            document.getElementById("username").value = btn.dataset.query;
            getActivity();
        });
    });
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function formatDate(dateString) {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
}

function timeAgo(dateString) {
    if (!dateString) return "";
    const seconds = Math.floor((Date.now() - new Date(dateString)) / 1000);
    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

function truncateText(text, maxLength = 280) {
    if (!text) return "No description provided.";
    const cleaned = text.trim();
    if (cleaned.length <= maxLength) return cleaned;
    return `${cleaned.slice(0, maxLength).trim()}…`;
}

function renderStat(label, value) {
    return `<div class="stat"><span class="stat-value">${value}</span><span class="stat-label">${label}</span></div>`;
}

function renderDetailRow(label, value) {
    return `<div class="detail-row"><span class="detail-label">${label}</span><span class="detail-value">${value}</span></div>`;
}

function renderMetaBanner(cached, rateLimit) {
    const parts = [];
    if (cached) parts.push("Cached result");
    if (rateLimit?.remaining != null) {
        parts.push(`${rateLimit.remaining} API calls left`);
    }
    if (parts.length === 0) return "";
    return `<div class="meta-banner">${parts.join(" · ")}</div>`;
}

function updateRateLimitFooter(rateLimit) {
    const el = document.getElementById("rate-limit-info");
    if (!rateLimit?.remaining) {
        el.textContent = "";
        return;
    }
    el.textContent = `Rate limit: ${rateLimit.remaining}/${rateLimit.limit}`;
}

function formatActivityMessage(event) {
    const repoUrl = `https://github.com/${event.repo.name}`;
    const repoLink = `<a href="${repoUrl}" target="_blank" rel="noopener" class="repo-link">${event.repo.name}</a>`;
    const ago = timeAgo(event.created_at);

    switch (event.type) {
        case "PushEvent": {
            const branchName = (event.payload.ref || "").replace("refs/heads/", "");
            const msg = branchName
                ? `Pushed to <code>${escapeHtml(branchName)}</code> in ${repoLink}`
                : `Pushed code to ${repoLink}`;
            return { icon: "push", message: msg, ago };
        }
        case "WatchEvent":
            return { icon: "star", message: `Starred ${repoLink}`, ago };
        case "ForkEvent":
            return { icon: "fork", message: `Forked ${repoLink}`, ago };
        case "CreateEvent":
            return {
                icon: "create",
                message: `Created ${escapeHtml(event.payload.ref_type || "repository")} in ${repoLink}`,
                ago,
            };
        default: {
            const name = event.type.replace(/Event$/, "").replace(/([A-Z])/g, " $1").trim();
            return { icon: "default", message: `${name} on ${repoLink}`, ago };
        }
    }
}

function renderActivityList(events, title) {
    if (!events.length) {
        return `<h2 class="section-title">${title}</h2><div class="empty-state">No recent activity found.</div>`;
    }

    const items = events
        .map(({ icon, message, ago }) => {
            return `
                <article class="activity-item activity-${icon}">
                    <div class="activity-content">${message}</div>
                    <time class="activity-time">${ago}</time>
                </article>`;
        })
        .join("");

    return `<h2 class="section-title">${title}</h2><div class="activity-list">${items}</div>`;
}

function renderUser(data) {
    const user = data.profile;
    const profileUrl = user.html_url;

    const events = data.events.map(formatActivityMessage);

    return `
        ${renderMetaBanner(data.cached, data.rateLimit)}
        <div class="detail-card hero-card">
            <div class="profile-header">
                <img src="${user.avatar_url}" alt="${escapeHtml(user.login)}" class="avatar">
                <div class="profile-info">
                    <h2>${escapeHtml(user.name || user.login)}</h2>
                    <a href="${profileUrl}" target="_blank" rel="noopener" class="repo-link">@${escapeHtml(user.login)}</a>
                    <p class="detail-description">${escapeHtml(truncateText(user.bio, 400))}</p>
                </div>
            </div>
            <div class="stats-grid">
                ${renderStat("Repos", user.public_repos)}
                ${renderStat("Followers", user.followers)}
                ${renderStat("Following", user.following)}
                ${renderStat("Gists", user.public_gists)}
            </div>
            ${renderDetailRow("Company", escapeHtml(user.company || "—"))}
            ${renderDetailRow("Location", escapeHtml(user.location || "—"))}
            ${renderDetailRow("Joined", formatDate(user.created_at))}
            ${renderDetailRow("Profile", `<a href="${profileUrl}" target="_blank" rel="noopener" class="repo-link">${profileUrl}</a>`)}
        </div>
        ${renderActivityList(events, "Recent Activity")}
    `;
}

function renderRepo(data) {
    const repo = data.repo;
    const topics =
        repo.topics?.length > 0
            ? repo.topics.map((t) => `<span class="topic-tag">${escapeHtml(t)}</span>`).join("")
            : '<span class="detail-muted">No topics</span>';

    return `
        ${renderMetaBanner(data.cached, data.rateLimit)}
        <div class="detail-card">
            <div class="card-top">
                <span class="type-badge">Repository</span>
                <h2>${escapeHtml(repo.full_name)}</h2>
            </div>
            <p class="detail-description">${escapeHtml(truncateText(repo.description, 400))}</p>
            <div class="stats-grid">
                ${renderStat("Stars", repo.stargazers_count)}
                ${renderStat("Forks", repo.forks_count)}
                ${renderStat("Issues", repo.open_issues_count)}
                ${renderStat("Watchers", repo.subscribers_count || repo.watchers_count)}
            </div>
            ${renderDetailRow("Language", escapeHtml(repo.language || "Not detected"))}
            ${renderDetailRow("Branch", `<code>${escapeHtml(repo.default_branch)}</code>`)}
            ${renderDetailRow("License", escapeHtml(repo.license?.spdx_id || repo.license?.name || "None"))}
            ${renderDetailRow("Created", formatDate(repo.created_at))}
            ${renderDetailRow("Updated", formatDate(repo.updated_at))}
            ${renderDetailRow("Link", `<a href="${repo.html_url}" target="_blank" rel="noopener" class="repo-link">${repo.html_url}</a>`)}
            <div class="detail-row topics-row">
                <span class="detail-label">Topics</span>
                <span class="detail-value topic-list">${topics}</span>
            </div>
        </div>
    `;
}

function renderIssue(data) {
    const issue = data.issue;

    const labels =
        issue.labels?.length > 0
            ? issue.labels.map((l) => `<span class="label-tag">${escapeHtml(l.name)}</span>`).join("")
            : '<span class="detail-muted">No labels</span>';

    return `
        ${renderMetaBanner(data.cached, data.rateLimit)}
        <div class="detail-card">
            <div class="card-top">
                <span class="badge badge-${issue.state}">${escapeHtml(issue.state)}</span>
                <span class="type-badge">Issue</span>
            </div>
            <h2>#${issue.number} ${escapeHtml(issue.title)}</h2>
            <p class="detail-meta">By <a href="${issue.user.html_url}" target="_blank" rel="noopener" class="repo-link">${escapeHtml(issue.user.login)}</a> · ${formatDate(issue.created_at)}</p>
            <p class="detail-description">${escapeHtml(truncateText(issue.body, 500))}</p>
            <div class="stats-grid stats-grid-2">
                ${renderStat("Comments", issue.comments)}
                ${renderStat("Assignees", issue.assignees?.length || 0)}
            </div>
            ${renderDetailRow("Updated", formatDate(issue.updated_at))}
            ${renderDetailRow("Closed", issue.closed_at ? formatDate(issue.closed_at) : "Open")}
            ${renderDetailRow("Link", `<a href="${issue.html_url}" target="_blank" rel="noopener" class="repo-link">${issue.html_url}</a>`)}
            <div class="detail-row topics-row">
                <span class="detail-label">Labels</span>
                <span class="detail-value topic-list">${labels}</span>
            </div>
        </div>
    `;
}

function renderPull(data) {
    const pull = data.pull;
    const state = pull.merged ? "merged" : pull.state;

    const labels =
        pull.labels?.length > 0
            ? pull.labels.map((l) => `<span class="label-tag">${escapeHtml(l.name)}</span>`).join("")
            : '<span class="detail-muted">No labels</span>';

    return `
        ${renderMetaBanner(data.cached, data.rateLimit)}
        <div class="detail-card">
            <div class="card-top">
                <span class="badge badge-${state}">${state}</span>
                <span class="type-badge">Pull Request</span>
            </div>
            <h2>#${pull.number} ${escapeHtml(pull.title)}</h2>
            <p class="detail-meta">By <a href="${pull.user.html_url}" target="_blank" rel="noopener" class="repo-link">${escapeHtml(pull.user.login)}</a> · ${formatDate(pull.created_at)}</p>
            <p class="detail-description">${escapeHtml(truncateText(pull.body, 500))}</p>
            <div class="stats-grid">
                ${renderStat("+Lines", pull.additions ?? "—")}
                ${renderStat("−Lines", pull.deletions ?? "—")}
                ${renderStat("Files", pull.changed_files ?? "—")}
                ${renderStat("Commits", pull.commits ?? "—")}
            </div>
            ${renderDetailRow("Base", `<code>${escapeHtml(pull.base.ref)}</code>`)}
            ${renderDetailRow("Head", `<code>${escapeHtml(pull.head.ref)}</code>`)}
            ${renderDetailRow("Link", `<a href="${pull.html_url}" target="_blank" rel="noopener" class="repo-link">${pull.html_url}</a>`)}
            <div class="detail-row topics-row">
                <span class="detail-label">Labels</span>
                <span class="detail-value topic-list">${labels}</span>
            </div>
        </div>
    `;
}

function renderCommit(data) {
    const commit = data.commit;
    const message = commit.commit.message.split("\n")[0];
    const fullName = `${data.owner}/${data.repo}`;
    const authorLink = commit.author?.html_url
        ? `<a href="${commit.author.html_url}" target="_blank" rel="noopener" class="repo-link">${escapeHtml(commit.commit.author.name)}</a>`
        : escapeHtml(commit.commit.author.name);

    return `
        ${renderMetaBanner(data.cached, data.rateLimit)}
        <div class="detail-card">
            <div class="card-top">
                <span class="type-badge">Commit</span>
                <code class="sha-badge">${escapeHtml(commit.sha.slice(0, 7))}</code>
            </div>
            <h2>${escapeHtml(message)}</h2>
            <p class="detail-meta">By ${authorLink} · ${formatDate(commit.commit.author.date)}</p>
            <div class="stats-grid stats-grid-2">
                ${renderStat("Additions", commit.stats?.additions ?? "—")}
                ${renderStat("Deletions", commit.stats?.deletions ?? "—")}
            </div>
            ${renderDetailRow("Repository", `<a href="https://github.com/${fullName}" target="_blank" rel="noopener" class="repo-link">${fullName}</a>`)}
            ${renderDetailRow("Full SHA", `<code>${escapeHtml(commit.sha)}</code>`)}
            ${renderDetailRow("Link", `<a href="${commit.html_url}" target="_blank" rel="noopener" class="repo-link">${commit.html_url}</a>`)}
        </div>
    `;
}

function renderActivity(data) {
    const events = data.events.map(formatActivityMessage);
    return `
        ${renderMetaBanner(data.cached, data.rateLimit)}
        ${renderActivityList(events, `Recent Activity · @${escapeHtml(data.username)}`)}
    `;
}

function showLoading() {
    document.getElementById("output").innerHTML = `
        <div class="loading-state">
            <div class="spinner"></div>
            <p>Fetching from GitHub...</p>
        </div>`;
}

function showError(message) {
    document.getElementById("output").innerHTML = `<div class="error-message">${escapeHtml(message)}</div>`;
}

async function getActivity() {
    const input = document.getElementById("username").value.trim();
    const output = document.getElementById("output");

    if (!input) {
        showError("Please enter a GitHub username or paste a GitHub link.");
        return;
    }

    showLoading();
    document.getElementById("search-btn").disabled = true;

    try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(input)}`, {
            headers: getAuthHeaders(),
        });
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Search failed");
        }

        await saveHistory(input);
        updateRateLimitFooter(data.rateLimit);

        let html = "";
        switch (data.type) {
            case "user":
                html = renderUser(data);
                break;
            case "repo":
                html = renderRepo(data);
                break;
            case "issue":
                html = renderIssue(data);
                break;
            case "pull":
                html = renderPull(data);
                break;
            case "commit":
                html = renderCommit(data);
                break;
            case "activity":
            default:
                html = renderActivity(data);
                break;
        }

        output.innerHTML = html;
    } catch (error) {
        showError(error.message);
        updateRateLimitFooter(null);
    } finally {
        document.getElementById("search-btn").disabled = false;
    }
}
