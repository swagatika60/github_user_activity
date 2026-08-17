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
    document.getElementById("output").addEventListener("click", handleOutputClick);

    initInteractiveEffects();
    setupAuthUI();
    initApp().then(handleUrlParams);
});

// Mouse-following spotlight, 3D card tilt and click ripples. Uses event
// delegation so dynamically rendered cards/buttons get the effects too.
function initInteractiveEffects() {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    // Cursor glow (fine pointers only, skipped for reduced motion).
    if (!reduceMotion && window.matchMedia?.("(pointer: fine)").matches) {
        const glow = document.createElement("div");
        glow.id = "cursor-glow";
        glow.setAttribute("aria-hidden", "true");
        document.body.appendChild(glow);

        let raf = 0;
        window.addEventListener("mousemove", (event) => {
            if (raf) return;
            raf = requestAnimationFrame(() => {
                raf = 0;
                glow.style.opacity = "1";
                glow.style.left = `${event.clientX}px`;
                glow.style.top = `${event.clientY}px`;
            });
        });
        document.addEventListener("mouseleave", () => {
            glow.style.opacity = "0";
        });
    }

    // Card spotlight + subtle 3D tilt on repo cards.
    document.addEventListener("mousemove", (event) => {
        const card = event.target.closest(".detail-card, .repo-card");
        if (!card) return;
        const rect = card.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        card.style.setProperty("--mx", `${x}px`);
        card.style.setProperty("--my", `${y}px`);
        if (!reduceMotion && card.classList.contains("repo-card")) {
            const px = x / rect.width - 0.5;
            const py = y / rect.height - 0.5;
            card.style.transform = `perspective(600px) rotateY(${(px * 5).toFixed(2)}deg) rotateX(${(-py * 5).toFixed(2)}deg) translateY(-2px)`;
        }
    });
    document.addEventListener("mouseout", (event) => {
        const card = event.target.closest(".repo-card");
        if (card) card.style.transform = "";
    });

    // Click ripple on buttons and chips.
    document.addEventListener("click", (event) => {
        const btn = event.target.closest(".tool-btn, .submit-btn, .auth-btn, .filter-chip, .result-tab");
        if (!btn || btn.disabled) return;
        const rect = btn.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height) * 2;
        const span = document.createElement("span");
        span.className = "ripple";
        span.style.width = `${size}px`;
        span.style.height = `${size}px`;
        span.style.left = `${event.clientX - rect.left - size / 2}px`;
        span.style.top = `${event.clientY - rect.top - size / 2}px`;
        btn.appendChild(span);
        setTimeout(() => span.remove(), 650);
    });
}

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
        const avatar = currentUser.avatar_url || currentUser.avatarUrl || "";
        area.innerHTML = `
            ${avatar ? `<img class="user-avatar" src="${avatar}" alt="${escapeHtml(currentUser.name || "")}">` : ""}
            <span class="user-greeting">Hi, ${escapeHtml(currentUser.name || currentUser.email)}</span>
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
    const numeric = typeof value === "number" && Number.isFinite(value);
    return `<div class="stat"><span class="stat-value" ${numeric ? `data-count="${value}"` : ""}>${value}</span><span class="stat-label">${label}</span></div>`;
}

// Animate numeric .stat-value elements up to their target (eased count-up).
function animateStats(container) {
    if (!container) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    container.querySelectorAll(".stat-value[data-count]").forEach((el) => {
        const target = Number(el.dataset.count);
        if (!Number.isFinite(target)) return;
        const duration = 700;
        const start = performance.now();
        const tick = (now) => {
            const progress = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - progress, 3);
            el.textContent = Math.round(target * eased).toLocaleString();
            if (progress < 1) requestAnimationFrame(tick);
            else el.textContent = target.toLocaleString();
        };
        requestAnimationFrame(tick);
    });
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
        case "PullRequestEvent":
        case "PullRequestReviewEvent": {
            const pr = event.payload?.pull_request;
            // The public events feed omits html_url on PR payloads, so derive
            // the exact link from the repo + PR number when needed.
            const prHref = pr?.html_url || (pr?.number ? `${repoUrl}/pull/${pr.number}` : "");
            const prLink = prHref
                ? `<a href="${prHref}" target="_blank" rel="noopener" class="repo-link">PR #${pr.number}</a>`
                : repoLink;
            const action = event.payload?.action ? ` ${event.payload.action}` : "";
            return { icon: "default", message: `Pull request${action} ${prLink} in ${repoLink}`, ago };
        }
        case "IssuesEvent":
        case "IssueCommentEvent": {
            const issue = event.payload?.issue;
            const issueLink = issue?.html_url
                ? `<a href="${issue.html_url}" target="_blank" rel="noopener" class="repo-link">issue #${issue.number}</a>`
                : repoLink;
            const action = event.payload?.action ? ` ${event.payload.action}` : "";
            return { icon: "default", message: `Issue${action} ${issueLink} in ${repoLink}`, ago };
        }
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

    const overview = `
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
        </div>`;

    const tabs = [
        { key: "overview", label: "Overview", body: overview },
        {
            key: "heatmap",
            label: "Heatmap",
            body: data.contributions?.length
                ? renderHeatmap(data.contributions)
                : '<div class="empty-state">No contribution data available.</div>',
        },
        {
            key: "languages",
            label: "Languages",
            body: data.languages?.length
                ? renderLanguages(data.languages)
                : '<div class="empty-state">No language data available.</div>',
        },
        { key: "repos", label: "Repositories", body: renderReposSection(data.repos || []) },
        {
            key: "activity",
            label: "Activity",
            body: `${data.activityGraph ? renderActivityGraph(data.activityGraph) : ""}${renderActivityListWithFilters(data.events || [], "Recent Activity")}`,
        },
    ];

    const tabBar = tabs
        .map((tab, index) => `<button type="button" class="result-tab ${index === 0 ? "active" : ""}" data-tab="${tab.key}">${tab.label}</button>`)
        .join("");
    const panels = tabs
        .map(
            (tab, index) =>
                `<div class="tab-panel ${index === 0 ? "active" : ""}" data-panel="${tab.key}">${tab.body}</div>`
        )
        .join("");

    return `
        ${toolbarHtml({ canStar: true, canCompare: true })}
        <div class="result-tabs">${tabBar}</div>
        <div class="result-tab-panels">${panels}</div>`;
}

function renderRepo(data) {
    const repo = data.repo;
    const topics =
        repo.topics?.length > 0
            ? repo.topics.map((t) => `<span class="topic-tag">${escapeHtml(t)}</span>`).join("")
            : '<span class="detail-muted">No topics</span>';

    return `
        ${renderMetaBanner(data.cached, data.rateLimit)}
        ${toolbarHtml({ isRepo: true })}
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
    return `
        ${renderMetaBanner(data.cached, data.rateLimit)}
        ${toolbarHtml({ canCompare: true })}
        ${renderActivityListWithFilters(data.events || [], `Recent Activity · @${escapeHtml(data.username)}`)}
    `;
}

const LANGUAGE_COLORS = {
    JavaScript: "#f1e05a",
    TypeScript: "#3178c6",
    Python: "#3572A5",
    Go: "#00ADD8",
    Rust: "#dea584",
    Java: "#b07219",
    "C++": "#f34b7d",
    C: "#555555",
    "C#": "#178600",
    HTML: "#e34c26",
    CSS: "#563d7c",
    Shell: "#89e051",
    Ruby: "#701516",
    PHP: "#4F5D95",
    Swift: "#F05138",
    Kotlin: "#A97BFF",
    Dart: "#00B4AB",
    Dockerfile: "#384d54",
    SQL: "#e38c00",
    Vue: "#41b883",
    Svelte: "#ff3e00",
    Scala: "#c22d40",
    "Jupyter Notebook": "#DA5B0B",
    Lua: "#000080",
    R: "#198CE7",
    Zig: "#ec915c",
    "Objective-C": "#438eff",
    PowerShell: "#012456",
};

function renderRepoCard(repo) {
    const language = repo.language || "";
    const languageDot = language
        ? `<span class="repo-lang"><span class="lang-dot" style="background:${LANGUAGE_COLORS[language] || "#8b949e"}"></span>${escapeHtml(language)}</span>`
        : "";

    return `
        <a class="repo-card" href="${repo.html_url}" target="_blank" rel="noopener">
            <div class="repo-card-top">
                <span class="repo-name">${escapeHtml(repo.name)}</span>
                ${repo.fork ? '<span class="repo-badge">fork</span>' : ""}
            </div>
            <p class="repo-desc">${escapeHtml(truncateText(repo.description, 140))}</p>
            <div class="repo-card-meta">
                ${languageDot}
                ${repo.stargazers_count ? `<span>★ ${repo.stargazers_count}</span>` : ""}
                ${repo.forks_count ? `<span>⑂ ${repo.forks_count}</span>` : ""}
                <span>Updated ${timeAgo(repo.updated_at)}</span>
            </div>
        </a>`;
}

function renderPriorityBanner(priority) {
    const parts = [];
    if (priority.red) parts.push(`<span class="pri-red">🔴 ${priority.red} urgent</span>`);
    if (priority.yellow) parts.push(`<span class="pri-yellow">🟡 ${priority.yellow} need attention</span>`);
    if (priority.green) parts.push(`<span class="pri-green">🟢 ${priority.green} healthy</span>`);
    const body = parts.length ? parts.join(" · ") : "🟢 All clear";
    return `<div class="priority-banner priority-${priority.level}">${body}</div>`;
}

const GITHUB_ICON =
    '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';

function openGitHubButton(item) {
    return `<a class="open-btn" href="${item.html_url}" target="_blank" rel="noopener" aria-label="Open on GitHub">${GITHUB_ICON}<span class="open-btn-text">Open on GitHub</span></a>`;
}

function renderPriorityItem(item) {
    const reason = item.reason ? `<span class="priority-reason">${escapeHtml(item.reason)}</span>` : "";
    return `
        <div class="priority-item priority-${item.priority}">
            <span class="priority-dot"></span>
            <a class="priority-body" href="${item.html_url}" target="_blank" rel="noopener" title="${escapeHtml(item.reason || item.priority)}">
                <span class="priority-title">${escapeHtml(item.title)}</span>
                ${reason}
            </a>
            <span class="priority-meta">${escapeHtml(item.repository)}#${item.number} · ${timeAgo(item.updated_at)}</span>
            ${openGitHubButton(item)}
        </div>`;
}

function renderPriorityList(items, title, emptyText) {
    const rows = items.length
        ? items.map(renderPriorityItem).join("")
        : `<div class="empty-state">${emptyText}</div>`;
    return `
        <h3 class="section-title priority-section-title">${title} <span class="count-badge">${items.length}</span></h3>
        <div class="priority-list">${rows}</div>`;
}

function renderTopAction(item, index) {
    return `
        <div class="priority-item priority-${item.priority}">
            <span class="action-rank">${index + 1}</span>
            <a class="priority-body" href="${item.html_url}" target="_blank" rel="noopener" title="${escapeHtml(item.reason || item.priority)}">
                <span class="priority-title"><span class="type-badge">${escapeHtml(item.type)}</span>${escapeHtml(item.title)}</span>
                <span class="priority-reason">${escapeHtml(item.reason)}</span>
            </a>
            <span class="priority-meta">${escapeHtml(item.repository)}#${item.number} · ${timeAgo(item.updated_at)}</span>
            ${openGitHubButton(item)}
        </div>`;
}

function renderTopActions(actions) {
    return `
        <h3 class="section-title priority-section-title">What should I do first? <span class="count-badge">${actions.length}</span></h3>
        <div class="priority-list">${actions.map(renderTopAction).join("")}</div>`;
}

const ACTIVITY_CATEGORIES = ["commits", "prs", "issues", "reviews", "branches"];
const ACTIVITY_COLORS = {
    commits: "#58a6ff",
    prs: "#2ea043",
    issues: "#d29922",
    reviews: "#bc8cff",
    branches: "#f0883e",
};
const ACTIVITY_LABELS = {
    commits: "Commits",
    prs: "Pull requests",
    issues: "Issues",
    reviews: "Reviews",
    branches: "Branches",
};

function activityDayLabel(date) {
    return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "short" });
}

function renderActivityGraph(graph) {
    const chartHeight = 120;
    const maxDayTotal = Math.max(
        1,
        ...graph.byDay.map((day) => ACTIVITY_CATEGORIES.reduce((sum, c) => sum + day[c], 0))
    );

    const columns = graph.byDay
        .map((day, index) => {
            const segments = ACTIVITY_CATEGORIES.filter((c) => day[c] > 0)
                .map(
                    (c) =>
                        `<div class="bar-segment bar-${c}" style="height:${Math.round((day[c] / maxDayTotal) * chartHeight)}px" title="${ACTIVITY_LABELS[c]}: ${day[c]}"></div>`
                )
                .join("");
            return `
                <div class="bar-column" title="${day.date}">
                    <div class="bar-stack" style="animation-delay:${index * 35}ms">${segments || '<div class="bar-empty"></div>'}</div>
                    <span class="bar-label">${activityDayLabel(day.date)}</span>
                </div>`;
        })
        .join("");

    const chips = ACTIVITY_CATEGORIES.map(
        (c) =>
            `<span class="stat-chip"><span class="lang-dot" style="background:${ACTIVITY_COLORS[c]}"></span>${graph.totals[c]} ${escapeHtml(ACTIVITY_LABELS[c].toLowerCase())}</span>`
    ).join("");

    const legend = ACTIVITY_CATEGORIES.map(
        (c) => `<span><span class="lang-dot" style="background:${ACTIVITY_COLORS[c]}"></span>${ACTIVITY_LABELS[c]}</span>`
    ).join("");

    const repoRows = graph.byRepo
        .map((repo) => {
            const counts = ACTIVITY_CATEGORIES.filter((c) => repo[c] > 0)
                .map((c) => `${repo[c]} ${escapeHtml(ACTIVITY_LABELS[c].toLowerCase())}`)
                .join(" · ");
            return `
                <div class="repo-activity-row">
                    <span class="repo-activity-name">${escapeHtml(repo.name)}</span>
                    <span class="repo-activity-counts">${counts || "—"}</span>
                </div>`;
        })
        .join("");

    return `
        <h3 class="section-title priority-section-title">GitHub activity <span class="count-badge">last 14 days</span></h3>
        <div class="activity-chips">${chips}</div>
        <div class="bar-chart">${columns}</div>
        <div class="bar-legend">${legend}</div>
        ${graph.byRepo.length ? `<div class="repo-activity-list">${repoRows}</div>` : ""}`;
}

const MAX_REPO_CARDS = 12;

function profileCardHtml(profile) {
    return `
        <div class="detail-card hero-card">
            <div class="profile-header">
                <img src="${profile.avatar_url}" alt="${escapeHtml(profile.login)}" class="avatar">
                <div class="profile-info">
                    <h2>${escapeHtml(profile.name || profile.login)}</h2>
                    <a href="${profile.html_url}" target="_blank" rel="noopener" class="repo-link">@${escapeHtml(profile.login)}</a>
                    <p class="detail-description">${escapeHtml(truncateText(profile.bio, 300))}</p>
                </div>
            </div>
            <div class="stats-grid">
                ${renderStat("Repos", profile.public_repos)}
                ${renderStat("Followers", profile.followers)}
                ${renderStat("Following", profile.following)}
            </div>
            ${renderDetailRow("Company", escapeHtml(profile.company || "—"))}
            ${renderDetailRow("Location", escapeHtml(profile.location || "—"))}
            ${renderDetailRow("Joined", formatDate(profile.created_at))}
        </div>`;
}

function renderReposSection(repos) {
    const shown = repos.slice(0, MAX_REPO_CARDS);
    const extra = repos.length - shown.length;
    const cards = shown.length
        ? shown.map(renderRepoCard).join("")
        : '<div class="empty-state">No repositories found.</div>';
    return `
        <h2 class="section-title">Repositories</h2>
        <div class="repo-grid">${cards}</div>
        ${extra > 0 ? `<p class="detail-muted">+ ${extra} more repositories</p>` : ""}`;
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

        window.__lastResult = { query: input, data };

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
        animateStats(output);
    } catch (error) {
        showError(error.message);
        updateRateLimitFooter(null);
    } finally {
        document.getElementById("search-btn").disabled = false;
    }
}

// ---------------------------------------------------------------------------
// Modern features: toolbar, heatmap, languages, filters, compare, tree, flow
// ---------------------------------------------------------------------------

window.__lastResult = null;

function toolbarHtml({ canStar = false, canCompare = false, isRepo = false } = {}) {
    const buttons = [
        `<button type="button" class="tool-btn" data-action="export" title="Download the result as JSON">⬇ Export</button>`,
        `<button type="button" class="tool-btn" data-action="share" title="Copy a shareable link">🔗 Share</button>`,
        canStar ? `<button type="button" class="tool-btn" data-action="starred" title="Show starred repositories">★ Starred</button>` : "",
        canCompare ? `<button type="button" class="tool-btn" data-action="compare" title="Compare two GitHub users">⚖ Compare</button>` : "",
        isRepo ? `<button type="button" class="tool-btn" data-action="tree" title="Browse the repository file tree">🌲 File tree</button>` : "",
    ].filter(Boolean).join("");
    return `<div class="result-toolbar">${buttons}</div>`;
}

function exportJson(data, filename) {
    const safeName = String(filename).replace(/[^\w.\-]+/g, "_").toLowerCase() || "github-result";
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeName}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function buildShareUrl() {
    const url = new URL(window.location.href);
    url.search = "";
    if (window.__lastResult?.isCompare) {
        url.searchParams.set("c", [window.__lastResult.data.user1.login, window.__lastResult.data.user2.login].join("|"));
    } else if (window.__lastResult?.query) {
        url.searchParams.set("q", window.__lastResult.query);
    }
    return url.toString();
}

async function copyShareLink(btn) {
    const url = buildShareUrl();
    const original = btn.textContent;
    try {
        await navigator.clipboard.writeText(url);
    } catch {
        window.prompt("Copy this link:", url);
    }
    btn.textContent = "✓ Copied";
    setTimeout(() => {
        btn.textContent = original;
    }, 1600);
}

async function loadStarred(btn) {
    const login = window.__lastResult?.data?.profile?.login;
    const toolbar = btn.closest(".result-toolbar");
    if (!login || !toolbar) return;
    btn.disabled = true;
    btn.textContent = "Loading…";
    try {
        const response = await fetch(`/api/user/starred?user=${encodeURIComponent(login)}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to load starred repos");
        const section = document.createElement("div");
        section.className = "starred-section";
        section.innerHTML = `
            <h3 class="section-title">Starred repositories <span class="count-badge">${data.repos.length}</span></h3>
            ${data.repos.length
                ? `<div class="repo-grid">${data.repos.map(renderRepoCard).join("")}</div>`
                : `<div class="empty-state">${escapeHtml(login)} hasn't starred any repositories yet.</div>`}`;
        toolbar.insertAdjacentElement("afterend", section);
        btn.textContent = "✓ Starred";
        section.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
        const err = document.createElement("div");
        err.className = "error-message";
        err.textContent = error.message;
        toolbar.insertAdjacentElement("afterend", err);
    } finally {
        btn.disabled = false;
    }
}

function comparePanelHtml(prefillA = "", prefillB = "") {
    return `
        <div class="detail-card compare-panel" id="compare-panel">
            <h2 class="section-title">Compare GitHub users</h2>
            <div class="compare-form">
                <input type="text" id="compare-user1" placeholder="first username" value="${escapeHtml(prefillA)}" autocomplete="off">
                <span class="compare-vs">vs</span>
                <input type="text" id="compare-user2" placeholder="second username" value="${escapeHtml(prefillB)}" autocomplete="off">
                <button type="button" class="submit-btn" id="compare-run">Compare</button>
            </div>
            <div id="compare-result"></div>
        </div>`;
}

function openCompare(result) {
    const existing = document.getElementById("compare-panel");
    if (existing) {
        existing.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
    }
    const login = result?.data?.profile?.login || result?.data?.username || "";
    document.getElementById("output").insertAdjacentHTML("beforeend", comparePanelHtml(login, ""));
    document.getElementById("compare-run").addEventListener("click", runCompare);
    document.getElementById("compare-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function runCompare() {
    const user1El = document.getElementById("compare-user1");
    const user2El = document.getElementById("compare-user2");
    const resultEl = document.getElementById("compare-result");
    const a = (user1El.value || "").trim();
    const b = (user2El.value || "").trim();
    if (!a || !b) {
        resultEl.innerHTML = '<div class="error-message">Enter both usernames.</div>';
        return;
    }
    if (a.toLowerCase() === b.toLowerCase()) {
        resultEl.innerHTML = '<div class="error-message">Pick two different users to compare.</div>';
        return;
    }
    resultEl.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Comparing ${escapeHtml(a)} vs ${escapeHtml(b)}…</p></div>`;
    try {
        const response = await fetch(`/api/compare?user1=${encodeURIComponent(a)}&user2=${encodeURIComponent(b)}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Compare failed");
        window.__lastResult = { query: `${a} vs ${b}`, data, isCompare: true };
        resultEl.innerHTML = renderCompare(data);
        animateStats(resultEl);
        updateRateLimitFooter(data.rateLimit);
    } catch (error) {
        resultEl.innerHTML = `<div class="error-message">${escapeHtml(error.message)}</div>`;
    }
}

function compareCardHtml(user) {
    const langs = (user.languages || [])
        .slice(0, 4)
        .map(
            (l) =>
                `<span class="compare-lang"><span class="lang-dot" style="background:${LANGUAGE_COLORS[l.name] || "#8b949e"}"></span>${escapeHtml(l.name)} ${l.percentage}%</span>`
        )
        .join("");
    return `
        <div class="detail-card compare-card">
            <div class="profile-header">
                <img src="${user.avatar_url}" alt="${escapeHtml(user.login)}" class="avatar">
                <div class="profile-info">
                    <h2>${escapeHtml(user.name || user.login)}</h2>
                    <a href="${user.html_url}" target="_blank" rel="noopener" class="repo-link">@${escapeHtml(user.login)}</a>
                </div>
            </div>
            <p class="detail-description">${escapeHtml(truncateText(user.bio, 160))}</p>
            ${user.topLanguage ? `<div class="detail-row"><span class="detail-label">Top language</span><span class="detail-value">${escapeHtml(user.topLanguage)}</span></div>` : ""}
            ${langs ? `<div class="compare-langs">${langs}</div>` : ""}
        </div>`;
}

function renderCompare(data) {
    const a = data.user1;
    const b = data.user2;
    const cmp = (av, bv) => (av === bv ? "" : av > bv ? "wins" : "");
    const rows = [
        ["Repositories", a.public_repos, b.public_repos],
        ["Followers", a.followers, b.followers],
        ["Following", a.following, b.following],
        ["Total stars*", a.totalStars, b.totalStars],
    ];
    const tableRows = rows
        .map(
            ([label, av, bv]) => `
                <tr>
                    <td class="cmp-label">${label}</td>
                    <td class="cmp-val ${cmp(av, bv) === "wins" ? "cmp-winner" : ""}">${av}</td>
                    <td class="cmp-val ${cmp(bv, av) === "wins" ? "cmp-winner" : ""}">${bv}</td>
                </tr>`
        )
        .join("");
    return `
        <div class="compare-grid">${compareCardHtml(a)}${compareCardHtml(b)}</div>
        <div class="detail-card compare-table-wrap">
            <table class="compare-table">
                <tbody>${tableRows}</tbody>
            </table>
            <p class="detail-muted">* Stars summed across up to 100 repos · Top language: ${escapeHtml(a.topLanguage || "—")} vs ${escapeHtml(b.topLanguage || "—")}</p>
        </div>`;
}

async function loadRepoTree(btn) {
    const repo = window.__lastResult?.data?.repo;
    const toolbar = btn.closest(".result-toolbar");
    if (!repo || !toolbar) return;
    const [owner, name] = String(repo.full_name).split("/");
    btn.disabled = true;
    btn.textContent = "Loading…";
    try {
        const response = await fetch(`/api/repo/tree?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(name)}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to load file tree");
        const section = document.createElement("div");
        section.className = "tree-section";
        section.innerHTML = `
            <h3 class="section-title">File tree <span class="count-badge">${data.tree.length} items</span></h3>
            ${data.truncated ? `<p class="detail-muted">Large repository — showing the first ${data.tree.length} paths (${escapeHtml(data.branch)} branch).</p>` : ""}
            <div class="repo-tree">${buildTreeHtml(data.tree)}</div>`;
        toolbar.insertAdjacentElement("afterend", section);
        section.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
        const err = document.createElement("div");
        err.className = "error-message";
        err.textContent = error.message;
        toolbar.insertAdjacentElement("afterend", err);
    } finally {
        btn.textContent = "🌲 File tree";
        btn.disabled = false;
    }
}

function treeFileIcon(name) {
    const ext = (name.split(".").pop() || "").toLowerCase();
    if (/^(js|ts|jsx|tsx|mjs|cjs)$/.test(ext)) return "🟨";
    if (/^(css|scss|html)$/.test(ext)) return "🟧";
    if (/^(json|ya?ml|toml)$/.test(ext)) return "⬜";
    if (/^(md|txt)$/.test(ext)) return "📝";
    if (/^(png|jpe?g|gif|svg|webp)$/.test(ext)) return "🖼";
    return "📄";
}

function buildTreeHtml(paths, cap = 250) {
    const root = { dirs: new Map(), files: [] };
    let count = 0;
    for (const node of paths || []) {
        if (count >= cap) break;
        const parts = node.path.split("/");
        let cur = root;
        parts.forEach((part, i) => {
            const isLast = i === parts.length - 1;
            if (isLast) {
                if (node.type === "tree") {
                    if (!cur.dirs.has(part)) cur.dirs.set(part, { dirs: new Map(), files: [] });
                } else {
                    cur.files.push({ name: part, path: node.path, size: node.size });
                }
            } else {
                if (!cur.dirs.has(part)) cur.dirs.set(part, { dirs: new Map(), files: [] });
                cur = cur.dirs.get(part);
            }
        });
        count += 1;
    }

    const renderNode = (name, node) => {
        const dirs = [...node.dirs.entries()]
            .sort(([x], [y]) => x.localeCompare(y))
            .map(([n, child]) => renderNode(n, child))
            .join("");
        const files = node.files
            .sort((x, y) => x.name.localeCompare(y.name))
            .map(
                (f) =>
                    `<div class="tree-file" title="${escapeHtml(f.path)}${f.size ? ` · ${f.size} bytes` : ""}"><span class="tree-icon">${treeFileIcon(f.name)}</span>${escapeHtml(f.name)}</div>`
            )
            .join("");
        return `<details class="tree-dir" open><summary><span class="tree-icon">📁</span>${escapeHtml(name)}</summary>${dirs}${files}</details>`;
    };

    const dirs = [...root.dirs.entries()]
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([n, child]) => renderNode(n, child))
        .join("");
    const files = root.files
        .sort((x, y) => x.name.localeCompare(y.name))
        .map(
            (f) =>
                `<div class="tree-file" title="${escapeHtml(f.path)}${f.size ? ` · ${f.size} bytes` : ""}"><span class="tree-icon">${treeFileIcon(f.name)}</span>${escapeHtml(f.name)}</div>`
        )
        .join("");
    return dirs + files || '<div class="empty-state">No files found.</div>';
}

const HEAT_LEVELS = ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"];

function renderHeatmap(contributions) {
    const max = Math.max(1, ...contributions.map((d) => d.count));
    const cells = contributions
        .map((d) => {
            const level = d.count === 0 ? 0 : Math.min(4, 1 + Math.round((d.count / max) * 3));
            return `<span class="heat-cell heat-${level}" title="${d.date}: ${d.count} activity event${d.count === 1 ? "" : "s"}"></span>`;
        })
        .join("");
    const legend = HEAT_LEVELS.map((_, i) => `<span class="heat-cell heat-${i}"></span>`).join("");
    return `
        <h3 class="section-title">Contribution activity <span class="count-badge">last 28 weeks</span></h3>
        <div class="detail-card heat-card">
            <div class="heatmap">${cells}</div>
            <div class="heat-legend"><span class="detail-muted">Less</span>${legend}<span class="detail-muted">More</span></div>
        </div>`;
}

function renderLanguages(languages) {
    const bars = languages
        .map(
            (l) => `
                <div class="lang-bar-row">
                    <span class="lang-bar-name">${escapeHtml(l.name)}</span>
                    <span class="lang-bar-track"><span class="lang-bar-fill" style="width:${l.percentage}%;background:${LANGUAGE_COLORS[l.name] || "#8b949e"}"></span></span>
                    <span class="lang-bar-pct">${l.percentage}%</span>
                </div>`
        )
        .join("");
    return `
        <h3 class="section-title">Top languages</h3>
        <div class="detail-card lang-card"><div class="lang-bars">${bars}</div></div>`;
}

function renderFlowDiagram(data) {
    const total = (g) => (g ? Object.values(g.totals).reduce((sum, n) => sum + n, 0) : 0);
    const steps = [
        { label: "Open pull requests", value: data.openPRs?.length || 0, color: "#58a6ff" },
        { label: "Reviews needed", value: data.reviewRequests?.length || 0, color: "#bc8cff" },
        { label: "Assigned issues", value: data.assignedIssues?.length || 0, color: "#d29922" },
        { label: "Activity (last 14 days)", value: total(data.activityGraph), color: "#2ea043" },
        { label: "Repositories", value: data.repos?.length || 0, color: "#f0883e" },
    ];
    const body = steps
        .map(
            (s) => `
                <div class="flow-step" style="--flow-color:${s.color}">
                    <div class="flow-marker"><span class="flow-dot"></span></div>
                    <div class="flow-content">
                        <span class="flow-label">${s.label}</span>
                        <span class="flow-value">${s.value}</span>
                    </div>
                </div>`
        )
        .join("");
    return `
        <h3 class="section-title">Workflow overview</h3>
        <div class="detail-card flow-card"><div class="flow-stepper">${body}</div></div>`;
}

const ACTIVITY_FILTERS = [
    { key: "all", label: "All", match: () => true },
    { key: "push", label: "Pushes", match: (e) => e.type === "PushEvent" },
    { key: "pr", label: "Pull requests", match: (e) => e.type === "PullRequestEvent" || e.type === "PullRequestReviewEvent" },
    { key: "issue", label: "Issues", match: (e) => e.type === "IssuesEvent" || e.type === "IssueCommentEvent" },
    { key: "star", label: "Stars", match: (e) => e.type === "WatchEvent" },
    { key: "fork", label: "Forks", match: (e) => e.type === "ForkEvent" },
];

function renderActivityListWithFilters(rawEvents, title, filterKey = "all") {
    const filter = ACTIVITY_FILTERS.find((f) => f.key === filterKey) || ACTIVITY_FILTERS[0];
    const filtered = (rawEvents || []).filter(filter.match);
    const chips = ACTIVITY_FILTERS.map(
        (f) =>
            `<button type="button" class="filter-chip ${f.key === filterKey ? "active" : ""}" data-filter="${f.key}">${f.label}</button>`
    ).join("");
    const items = filtered.length
        ? filtered
              .map((e) => {
                  const { icon, message, ago } = formatActivityMessage(e);
                  return `<article class="activity-item activity-${icon}"><div class="activity-content">${message}</div><time class="activity-time">${ago}</time></article>`;
              })
              .join("")
        : '<div class="empty-state">No activity of this type.</div>';
    return `
        <div class="activity-block" data-title="${escapeHtml(title)}">
            <h2 class="section-title">${title} <span class="count-badge">${filtered.length}</span></h2>
            <div class="filter-chips">${chips}</div>
            <div class="activity-list">${items}</div>
        </div>`;
}

function handleOutputClick(event) {
    const tabBtn = event.target.closest("[data-tab]");
    if (tabBtn) {
        const tabBar = tabBtn.closest(".result-tabs");
        const panels = tabBar?.nextElementSibling;
        if (!panels) return;
        tabBar.querySelectorAll(".result-tab").forEach((btn) => btn.classList.toggle("active", btn === tabBtn));
        panels.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === tabBtn.dataset.tab));
        return;
    }

    const actionBtn = event.target.closest("[data-action]");
    if (actionBtn) {
        const result = window.__lastResult;
        if (!result) return;
        const action = actionBtn.dataset.action;
        if (action === "export") exportJson(result.data, result.query || "github-result");
        else if (action === "share") copyShareLink(actionBtn);
        else if (action === "starred") loadStarred(actionBtn);
        else if (action === "compare") openCompare(result);
        else if (action === "tree") loadRepoTree(actionBtn);
        return;
    }

    const chip = event.target.closest("[data-filter]");
    if (chip) {
        const block = chip.closest(".activity-block");
        const title = block.dataset.title;
        const events = window.__lastResult?.data?.events || [];
        block.outerHTML = renderActivityListWithFilters(events, title, chip.dataset.filter);
    }
}

async function handleUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    const c = params.get("c");
    if (c && c.includes("|")) {
        const [a, b] = c.split("|");
        document.getElementById("username").value = a;
        openCompare({ data: { profile: { login: a } } });
        document.getElementById("compare-user1").value = a;
        document.getElementById("compare-user2").value = b;
        await runCompare();
    } else if (q) {
        document.getElementById("username").value = q;
        await getActivity();
    }
}
