const HISTORY_KEY = "github-viewer-history";
const AUTH_TOKEN_KEY = "github-viewer-token";
const MAX_HISTORY = 8;

let currentUser = null;

let welcomeHtml = null;

document.addEventListener("DOMContentLoaded", () => {
    const input = document.getElementById("username");
    const searchBtn = document.getElementById("search-btn");
    const clearHistoryBtn = document.getElementById("clear-history");

    /* remember the landing-page welcome markup so "Back" can restore it */
    welcomeHtml = document.getElementById("output").innerHTML;

    document.getElementById("back-home").addEventListener("click", goHome);
    document.querySelector(".brand").addEventListener("click", goHome);

    searchBtn.addEventListener("click", getActivity);
    input.addEventListener("keypress", (event) => {
        if (event.key === "Enter") getActivity();
    });
    input.addEventListener("paste", () => setTimeout(getActivity, 0));
    clearHistoryBtn.addEventListener("click", clearHistory);
    document.getElementById("output").addEventListener("click", handleOutputClick);

    const searchClear = document.getElementById("search-clear");
    input.addEventListener("input", () => {
        searchClear.hidden = !input.value;
    });
    searchClear.addEventListener("click", () => {
        input.value = "";
        searchClear.hidden = true;
        input.focus();
    });
    document.getElementById("header-compare").addEventListener("click", () => {
        openCompare({ data: { profile: { login: "" } } });
    });

    /* main-page "try" chips and welcome CTAs */
    document.addEventListener("click", (event) => {
        const compareBtn = event.target.closest("[data-open-compare]");
        if (compareBtn) {
            openCompare({ data: { profile: { login: "" } } });
            return;
        }
        const queryBtn = event.target.closest("[data-query]");
        if (queryBtn) {
            const input = document.getElementById("username");
            if (input) input.value = queryBtn.dataset.query;
            getActivity();
        }
    });

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

const STAT_ICONS = {
    Repos: "🗂",
    Followers: "👥",
    Following: "➕",
    Gists: "💬",
    Stars: "⭐",
    Forks: "⑂",
    Issues: "🐞",
    Watchers: "👀",
    Comments: "💬",
    Assignees: "🧑",
    "+Lines": "➕",
    "−Lines": "➖",
    Files: "📄",
    Commits: "📝",
};

function renderStat(label, value) {
    const numeric = typeof value === "number" && Number.isFinite(value);
    const icon = STAT_ICONS[label] ? `<span class="stat-icon" aria-hidden="true">${STAT_ICONS[label]}</span>` : "";
    return `<div class="stat"><span class="stat-value">${icon}<span class="stat-num" ${numeric ? `data-count="${value}"` : ""}>${value}</span></span><span class="stat-label">${label}</span></div>`;
}

// Animate numeric .stat-value elements up to their target (eased count-up).
function animateStats(container) {
    if (!container) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    container.querySelectorAll(".stat-num[data-count]").forEach((el) => {
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

/* ------------------------------------------------------------------ *
 * Issues & PRs triage — open items grouped by how much attention
 * they need: red (7+ days) · yellow (2–7 days) · green (< 2 days)   *
 * ------------------------------------------------------------------ */
function buildTriageItems(events) {
    const prMap = new Map();
    const issueMap = new Map();

    const store = (map, key, item) => {
        const existing = map.get(key);
        // prefer the richer (full-payload) version of an item
        if (!existing || (!existing.full && item.full)) map.set(key, item);
    };

    for (const e of events || []) {
        const repo = e.repo?.name;
        const action = e.payload?.action || "";
        const eventDate = e.created_at;
        const pr = e.payload?.pull_request;
        const issue = e.payload?.issue;

        /* Issues payloads carry the full object — including PRs, which GitHub
           exposes here with title/state/dates even though PR events truncate it */
        if (issue?.number && repo) {
            const isPr = Boolean(issue.pull_request) || String(issue.node_id || "").startsWith("PR_");
            const map = isPr ? prMap : issueMap;
            const key = `${repo}#${issue.number}`;
            store(map, key, {
                kind: isPr ? "pr" : "issue",
                number: issue.number,
                title: issue.title || "",
                state: issue.state || (action === "closed" ? "closed" : "open"),
                created_at: issue.created_at || eventDate,
                repo,
                url: issue.html_url || (isPr ? `https://github.com/${repo}/pull/${issue.number}` : `https://github.com/${repo}/issues/${issue.number}`),
                comments: issue.comments || 0,
                author: issue.user?.login || "",
                closed_at: issue.closed_at || "",
                full: true,
            });
        }

        /* PR events only carry number + head/base refs — keep them as a
           fallback when the full object never came through */
        if (pr?.number && repo && (e.type === "PullRequestEvent" || e.type === "PullRequestReviewEvent")) {
            const key = `${repo}#${pr.number}`;
            store(prMap, key, {
                kind: "pr",
                number: pr.number,
                title: "",
                state: action === "closed" ? "closed" : "open",
                created_at: eventDate,
                repo,
                url: `https://github.com/${repo}/pull/${pr.number}`,
                headRef: pr.head?.ref || "",
                baseRef: pr.base?.ref || "",
                comments: 0,
                author: "",
                full: false,
            });
        }
    }

    return { prs: [...prMap.values()], issues: [...issueMap.values()] };
}

function triagePriority(item) {
    const daysSince = (iso) => (Date.now() - new Date(iso).getTime()) / 86400000;
    if (item.state === "open") {
        const days = daysSince(item.created_at);
        if (days >= 7) return "attention";
        if (days >= 2) return "middle";
        return "recent";
    }
    /* closed/merged items count as recent when they happened within 3 days */
    const closedDays = item.closed_at ? daysSince(item.closed_at) : daysSince(item.created_at);
    return closedDays <= 3 ? "recent" : null;
}

function renderTriageItem(item) {
    const badge =
        item.kind === "pr"
            ? '<span class="triage-badge triage-pr">PR</span>'
            : '<span class="triage-badge triage-issue">Issue</span>';
    const title = item.title || (item.kind === "pr" ? `Pull request #${item.number}` : `Issue #${item.number}`);
    const refs =
        item.headRef && item.baseRef
            ? `<code>${escapeHtml(item.headRef)}</code> → <code>${escapeHtml(item.baseRef)}</code> · `
            : "";
    const author = item.author ? ` · by <b>@${escapeHtml(item.author)}</b>` : "";
    const comments = item.comments ? ` · <b>${item.comments}</b> comment${item.comments === 1 ? "" : "s"}` : "";
    return `
        <a class="triage-item" href="${item.url}" target="_blank" rel="noopener">
            ${badge}
            <span class="triage-item-body">
                <span class="triage-item-title">${escapeHtml(title)}</span>
                <span class="triage-item-meta">${refs}opened ${timeAgo(item.created_at)}${author}${comments}</span>
            </span>
            <span class="triage-item-num">#${item.number}</span>
        </a>`;
}

function renderTriage(events) {
    const { prs, issues } = buildTriageItems(events);
    const all = [...prs, ...issues];

    if (!all.length) {
        return `
            <h3 class="section-title">Issues &amp; Pull requests</h3>
            <div class="empty-state">No pull requests or issues found in recent activity.</div>`;
    }

    const blocks = [
        {
            key: "attention",
            label: "Needs attention",
            color: "#f85149",
            icon: "🔴",
            desc: "Open PRs & issues waiting 7+ days — review or reply to these first.",
        },
        {
            key: "middle",
            label: "Middle",
            color: "#d29922",
            icon: "🟡",
            desc: "Open items from the last week — keep them moving.",
        },
        {
            key: "recent",
            label: "Recent",
            color: "#2ea043",
            icon: "🟢",
            desc: "Fresh items from the last 48 hours — the newest activity.",
        },
    ];

    const closed = all.filter((item) => triagePriority(item) === null);

    return `
        <h3 class="section-title">Issues &amp; Pull requests <span class="count-badge">${all.length} open</span></h3>
        <p class="triage-intro">Open PRs &amp; issues from the last 90 days, grouped by how long they've been waiting — each item links to its exact page.</p>
        ${blocks
            .map((block) => {
                const items = all.filter((item) => triagePriority(item) === block.key);
                const MAX_BLOCK_ITEMS = 10;
                const shown = items.slice(0, MAX_BLOCK_ITEMS);
                const more = items.length - shown.length;
                return `
                    <div class="triage-block" style="--triage-color:${block.color}">
                        <div class="triage-block-head">
                            <span class="triage-block-icon">${block.icon}</span>
                            <h4>${block.label}</h4>
                            <span class="count-badge">${items.length}</span>
                        </div>
                        <p class="triage-block-desc">${block.desc}</p>
                        ${shown.length ? `<div class="triage-list">${renderRepoGroups(shown)}${more ? `<p class="triage-more">+ ${more} more…</p>` : ""}</div>` : '<div class="triage-empty">Nothing here — all clear 🎉</div>'}
                    </div>`;
            })
            .join("")}
        ${closed.length ? `<p class="triage-closed">Also: ${closed.length} PR${closed.length === 1 ? "" : "s"} or issue${closed.length === 1 ? "" : "s"} were closed or merged more than 3 days ago.</p>` : ""}`;
}

/* group triage items by repository so every repo is clearly named */
function renderRepoGroups(items) {
    const map = new Map();
    for (const item of items) {
        if (!map.has(item.repo)) map.set(item.repo, []);
        map.get(item.repo).push(item);
    }
    const groups = [...map.entries()]
        .map(([repo, repoItems]) => ({ repo, repoItems }))
        .sort((a, b) => b.repoItems.length - a.repoItems.length);

    return groups
        .map(
            ({ repo, repoItems }) => `
                <div class="triage-repo-group">
                    <a class="triage-repo-name" href="https://github.com/${escapeHtml(repo)}" target="_blank" rel="noopener">
                        <span class="triage-repo-ic">📦</span>
                        ${escapeHtml(repo)}
                        <span class="triage-repo-count">${repoItems.length}</span>
                    </a>
                    ${repoItems
                        .slice()
                        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                        .map(renderTriageItem)
                        .join("")}
                </div>`
        )
        .join("");
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
        { key: "triage", label: "Issues & PRs", body: renderTriage(data.events || []) },
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
            body: `${data.activityGraph ? renderActivityGraph(data.activityGraph) : ""}${renderActivityListWithFilters(data.events || [], `Activity history · ${data.eventCount || (data.events || []).length} events`)}`,
        },
        {
            key: "graph",
            label: "Graph",
            body: `<div class="graph-tab">
                <div class="graph-tab-toolbar">
                    <span class="graph-tab-title">Activity map</span>
                    <button type="button" class="graph-expand-btn" data-action="graph-fullscreen">⛶ Fullscreen</button>
                </div>
                <div class="graph-host" data-graph-host></div>
            </div>`,
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
    return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function renderActivityGraph(graph) {
    const chartHeight = 120;
    const maxDayTotal = Math.max(
        1,
        ...graph.byDay.map((day) => ACTIVITY_CATEGORIES.reduce((sum, c) => sum + day[c], 0))
    );

    /* label week starts (plus first/last) instead of every day, so long
       windows stay readable */
    const columns = graph.byDay
        .map((day, index) => {
            const isFirst = index === 0;
            const isLast = index === graph.byDay.length - 1;
            const isWeekStart = new Date(`${day.date}T00:00:00Z`).getUTCDay() === 0;
            const showLabel = isFirst || isLast || isWeekStart;
            const segments = ACTIVITY_CATEGORIES.filter((c) => day[c] > 0)
                .map(
                    (c) =>
                        `<div class="bar-segment bar-${c}" style="height:${Math.round((day[c] / maxDayTotal) * chartHeight)}px" title="${ACTIVITY_LABELS[c]}: ${day[c]}"></div>`
                )
                .join("");
            return `
                <div class="bar-column" title="${day.date}">
                    <div class="bar-stack" style="animation-delay:${index * 14}ms">${segments || '<div class="bar-empty"></div>'}</div>
                    <span class="bar-label">${showLabel ? activityDayLabel(day.date) : ""}</span>
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
        <h3 class="section-title priority-section-title">GitHub activity <span class="count-badge">last ${graph.byDay.length} days</span></h3>
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

function showBackButton() {
    const backBtn = document.getElementById("back-home");
    if (backBtn) backBtn.hidden = false;
}

/* return to the landing page: restore the welcome panel and clear the search */
function goHome() {
    if (window.__graphLoop) {
        cancelAnimationFrame(window.__graphLoop);
        window.__graphLoop = null;
    }
    window.__lastResult = null;

    const output = document.getElementById("output");
    if (welcomeHtml) output.innerHTML = welcomeHtml;

    const input = document.getElementById("username");
    if (input) input.value = "";
    const searchClear = document.getElementById("search-clear");
    if (searchClear) searchClear.hidden = true;
    const backBtn = document.getElementById("back-home");
    if (backBtn) backBtn.hidden = true;

    window.history.replaceState({}, "", window.location.pathname);
    window.scrollTo({ top: 0, behavior: "smooth" });
    input?.focus();
}

function showLoading() {
    showBackButton();
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

    showBackButton();

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

        if (window.__graphLoop) {
            cancelAnimationFrame(window.__graphLoop);
            window.__graphLoop = null;
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
    showBackButton();
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
        <h3 class="section-title">Contribution activity <span class="count-badge">last ${Math.ceil(contributions.length / 7)} weeks</span></h3>
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
        { label: "Activity (last 90 days)", value: total(data.activityGraph), color: "#2ea043" },
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
        if (window.__graphLoop) {
            cancelAnimationFrame(window.__graphLoop);
            window.__graphLoop = null;
        }
        if (tabBtn.dataset.tab === "graph") {
            buildActivityGraph(panels.querySelector('[data-panel="graph"] [data-graph-host]'));
        }
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
        else if (action === "graph-fullscreen") openActivityGraph();
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

/* ------------------------------------------------------------------ *
 * Activity Graph — structured radial network with physics            *
 *   Center: user · Ring: repos · Outer ring: PRs/issues · draggable *
 * ------------------------------------------------------------------ */
function buildActivityGraph(host, opts = {}) {
    if (!host) return;
    if (window.__graphLoop) {
        cancelAnimationFrame(window.__graphLoop);
        window.__graphLoop = null;
    }

    const data = window.__lastResult?.data;
    if (!data || data.type !== "user" || !data.profile) {
        host.innerHTML = '<div class="empty-state">Search a user to see their activity graph.</div>';
        return;
    }

    /* fullscreen mode shows everything; the in-tab graph is a compact overview */
    const fullscreen = Boolean(opts.fullscreen);
    const caps = fullscreen
        ? { repos: 30, pr: 14, issue: 14, push: 12, star: 6, fork: 6 }
        : { repos: 10, pr: 8, issue: 8, push: 0, star: 0, fork: 0 };

    const NS = "http://www.w3.org/2000/svg";
    const profile = data.profile;
    const uid = "ag" + Math.random().toString(36).slice(2, 8);
    const W = fullscreen ? Math.max(window.innerWidth - 48, 640) : Math.max(host.clientWidth, 320);
    const H = fullscreen ? Math.max(window.innerHeight - 150, 520) : Math.max(host.clientHeight - 60, 460);
    const cx = W / 2;
    const cy = H / 2;

    /* ---- nodes ---- */
    const nodes = [];
    const nodeMap = new Map();
    const addNode = (n) => {
        nodeMap.set(n.id, n);
        nodes.push(n);
    };

    addNode({
        id: "user",
        kind: "user",
        label: "@" + profile.login,
        r: 32,
        x: cx,
        y: cy,
        vx: 0,
        vy: 0,
        url: profile.html_url,
        avatar: profile.avatar_url,
    });

    const repos = (data.repos || []).slice(0, caps.repos);
    repos.forEach((repo) => {
        addNode({
            id: "repo-" + repo.full_name,
            kind: "repo",
            label: repo.full_name.split("/")[1],
            r: 17,
            x: cx,
            y: cy,
            vx: 0,
            vy: 0,
            url: repo.html_url,
            full: repo.full_name,
            stars: repo.stargazers_count || 0,
        });
    });

    const seenPR = new Set();
    const seenIssue = new Set();
    const seenPush = new Set();
    const seenStar = new Set();
    const seenFork = new Set();
    let prCount = 0;
    let issueCount = 0;
    let pushCount = 0;
    let starCount = 0;
    let forkCount = 0;
    for (const e of data.events || []) {
        const repoName = e.repo?.name;
        const pr = e.payload?.pull_request;
        const issue = e.payload?.issue;
        if (!repoName) continue;
        if ((e.type === "PullRequestEvent" || e.type === "PullRequestReviewEvent") && pr?.number) {
            const key = repoName + "#" + pr.number;
            if (seenPR.has(key) || prCount >= caps.pr || !nodeMap.has("repo-" + repoName)) continue;
            seenPR.add(key);
            prCount++;
            addNode({
                id: "pr-" + key,
                kind: "pr",
                label: "#" + pr.number,
                r: 11,
                x: cx,
                y: cy,
                vx: 0,
                vy: 0,
                url: pr.html_url || `https://github.com/${repoName}/pull/${pr.number}`,
                parent: "repo-" + repoName,
                title: `PR #${pr.number} in ${repoName} — ${pr.title || ""}`.slice(0, 80),
            });
        } else if ((e.type === "IssuesEvent" || e.type === "IssueCommentEvent") && issue?.number) {
            const key = repoName + "#" + issue.number;
            if (seenIssue.has(key) || issueCount >= caps.issue || !nodeMap.has("repo-" + repoName)) continue;
            seenIssue.add(key);
            issueCount++;
            addNode({
                id: "issue-" + key,
                kind: "issue",
                label: "#" + issue.number,
                r: 11,
                x: cx,
                y: cy,
                vx: 0,
                vy: 0,
                url: issue.html_url || `https://github.com/${repoName}/issues/${issue.number}`,
                parent: "repo-" + repoName,
                title: `Issue #${issue.number} in ${repoName} — ${issue.title || ""}`.slice(0, 80),
            });
        } else if (e.type === "PushEvent" && caps.push) {
            const branch = (e.payload?.ref || "").replace("refs/heads/", "") || "HEAD";
            const short = branch.split("/").pop() || branch;
            const key = repoName + "#push:" + short;
            if (seenPush.has(key) || pushCount >= caps.push || !nodeMap.has("repo-" + repoName)) continue;
            seenPush.add(key);
            pushCount++;
            addNode({
                id: "push-" + key,
                kind: "push",
                label: short.slice(0, 10),
                r: 10,
                x: cx,
                y: cy,
                vx: 0,
                vy: 0,
                url: `https://github.com/${repoName}/commits/${encodeURIComponent(branch)}`,
                parent: "repo-" + repoName,
                title: `Pushed to ${branch} in ${repoName}`,
            });
        } else if (e.type === "WatchEvent" && caps.star) {
            const key = repoName + "#star";
            if (seenStar.has(key) || starCount >= caps.star || !nodeMap.has("repo-" + repoName)) continue;
            seenStar.add(key);
            starCount++;
            addNode({
                id: "star-" + key,
                kind: "star",
                label: "Star",
                r: 10,
                x: cx,
                y: cy,
                vx: 0,
                vy: 0,
                url: `https://github.com/${repoName}`,
                parent: "repo-" + repoName,
                title: `Starred ${repoName}`,
            });
        } else if (e.type === "ForkEvent" && caps.fork) {
            const key = repoName + "#fork";
            if (seenFork.has(key) || forkCount >= caps.fork || !nodeMap.has("repo-" + repoName)) continue;
            seenFork.add(key);
            forkCount++;
            addNode({
                id: "fork-" + key,
                kind: "fork",
                label: "Fork",
                r: 10,
                x: cx,
                y: cy,
                vx: 0,
                vy: 0,
                url: `https://github.com/${repoName}`,
                parent: "repo-" + repoName,
                title: `Forked ${repoName}`,
            });
        }
    }

    /* ---- edges ---- */
    const edges = [];
    for (const n of nodes) {
        if (n.kind === "repo") edges.push({ a: "user", b: n.id, rest: 150, kind: "repo" });
        else if (n.parent) edges.push({ a: n.parent, b: n.id, rest: 88, kind: n.kind });
    }

    /* ---- structured layout: "solar system" ----
       user at center → repos on a clean ring → PRs/issues on an outer ring */
    const repoNodes = nodes.filter((n) => n.kind === "repo");
    const ringR = Math.min(fullscreen ? 330 : 215, Math.max(130, 120 + repoNodes.length * (fullscreen ? 10 : 12)));
    repoNodes.forEach((n, i) => {
        const angle = (i / Math.max(repoNodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
        n.angle = angle;
        n.home = {
            x: Math.max(60, Math.min(W - 60, cx + Math.cos(angle) * ringR)),
            y: Math.max(70, Math.min(H - 70, cy + Math.sin(angle) * ringR)),
        };
        n.x = n.home.x;
        n.y = n.home.y;
    });

    /* group leaves per repo, fan them out along the outer ring */
    const leavesByParent = new Map();
    for (const n of nodes) {
        if (!n.parent) continue;
        if (!leavesByParent.has(n.parent)) leavesByParent.set(n.parent, []);
        leavesByParent.get(n.parent).push(n);
    }
    for (const [parentId, leaves] of leavesByParent) {
        const parent = nodeMap.get(parentId);
        if (!parent) continue;
        leaves.forEach((n, i) => {
            const span = Math.min(0.8, leaves.length * 0.09);
            const angle = (parent.angle ?? 0) + (i - (leaves.length - 1) / 2) * span;
            n.home = {
                x: Math.max(45, Math.min(W - 45, cx + Math.cos(angle) * (ringR + (fullscreen ? 118 : 96)))),
                y: Math.max(60, Math.min(H - 60, cy + Math.sin(angle) * (ringR + (fullscreen ? 118 : 96)))),
            };
            n.x = n.home.x;
            n.y = n.home.y;
        });
    }

    /* ---- label pill helper ---- */
    const pill = (text, y) => {
        const w = Math.min(String(text).length, 14) * 6.2 + 18;
        return `
            <rect class="graph-label-pill" x="${-w / 2}" y="${y - 14}" width="${w}" height="18" rx="9"/>
            <text class="graph-label" y="${y - 1}" text-anchor="middle">${escapeHtml(String(text).slice(0, 14))}</text>`;
    };

    /* ---- build svg ---- */
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "activity-graph");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("aria-label", `Activity graph for ${profile.login}`);
    svg.innerHTML = `
        <defs>
            <filter id="${uid}-blur" x="-80%" y="-80%" width="260%" height="260%">
                <feGaussianBlur stdDeviation="7"/>
            </filter>
            <radialGradient id="${uid}-user" cx="35%" cy="35%" r="80%">
                <stop offset="0%" stop-color="#c084fc"/>
                <stop offset="55%" stop-color="#7c3aed"/>
                <stop offset="100%" stop-color="#4c1d95"/>
            </radialGradient>
            <radialGradient id="${uid}-repo" cx="35%" cy="35%" r="80%">
                <stop offset="0%" stop-color="#58a6ff"/>
                <stop offset="100%" stop-color="#1f6feb"/>
            </radialGradient>
            <radialGradient id="${uid}-pr" cx="35%" cy="35%" r="80%">
                <stop offset="0%" stop-color="#c084fc"/>
                <stop offset="100%" stop-color="#8957e5"/>
            </radialGradient>
            <radialGradient id="${uid}-issue" cx="35%" cy="35%" r="80%">
                <stop offset="0%" stop-color="#e3b341"/>
                <stop offset="100%" stop-color="#a8871d"/>
            </radialGradient>
            <radialGradient id="${uid}-push" cx="35%" cy="35%" r="80%">
                <stop offset="0%" stop-color="#3fb950"/>
                <stop offset="100%" stop-color="#238636"/>
            </radialGradient>
            <radialGradient id="${uid}-star" cx="35%" cy="35%" r="80%">
                <stop offset="0%" stop-color="#f0b429"/>
                <stop offset="100%" stop-color="#b08c1d"/>
            </radialGradient>
            <radialGradient id="${uid}-fork" cx="35%" cy="35%" r="80%">
                <stop offset="0%" stop-color="#39c5cf"/>
                <stop offset="100%" stop-color="#1b7d83"/>
            </radialGradient>
            <clipPath id="${uid}-clip"><circle cx="0" cy="0" r="29"/></clipPath>
        </defs>
        <circle class="graph-guide" cx="${cx}" cy="${cy}" r="${ringR}"/>
        <circle class="graph-guide" cx="${cx}" cy="${cy}" r="${ringR + 96}"/>
        <g class="graph-edges"></g>
        <g class="graph-nodes"></g>`;

    /* dense mode: hide labels until hover so big maps stay readable */
    if (fullscreen && nodes.length > 40) svg.classList.add("graph-mode-dense");

    const edgesG = svg.querySelector(".graph-edges");
    const nodesG = svg.querySelector(".graph-nodes");
    const edgeEls = edges.map((e) => {
        const path = document.createElementNS(NS, "path");
        path.setAttribute("class", "graph-edge graph-edge-" + e.kind);
        edgesG.appendChild(path);
        return path;
    });

    const edgePath = (a, b) => {
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const bow = Math.min(24, d * 0.1);
        const cxp = mx - (dy / d) * bow;
        const cyp = my + (dx / d) * bow;
        return `M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${cxp.toFixed(1)},${cyp.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
    };

    const nodeEls = {};
    for (const n of nodes) {
        const g = document.createElementNS(NS, "g");
        g.setAttribute("class", "graph-node graph-node-" + n.kind);
        g.setAttribute("data-id", n.id);
        const titleEl = document.createElementNS(NS, "title");
        titleEl.textContent = n.title || n.full || n.label || "";
        g.appendChild(titleEl);

        let inner;
        if (n.kind === "user") {
            inner = `
                <g class="graph-node-scale">
                    <circle class="graph-user-halo" r="44" fill="url(#${uid}-user)" filter="url(#${uid}-blur)" opacity="0.55"/>
                    <circle class="graph-node-ring" r="32" fill="url(#${uid}-user)"/>
                    <circle class="graph-ring-stroke" r="32"/>
                    <image href="${n.avatar}" width="58" height="58" x="-29" y="-29" clip-path="url(#${uid}-clip)"/>
                    ${pill(n.label, 54)}
                </g>`;
        } else if (n.kind === "repo") {
            inner = `
                <g class="graph-node-scale">
                    <circle class="graph-node-circle" r="17" fill="url(#${uid}-repo)"/>
                    <circle class="graph-node-inner" r="9" fill="rgba(255,255,255,0.16)"/>
                    ${n.stars ? `<text class="graph-star" x="12" y="-7">★</text>` : ""}
                    ${pill(n.label.split("/").pop(), 38)}
                </g>`;
        } else {
            const fillMap = { pr: `${uid}-pr`, issue: `${uid}-issue`, push: `${uid}-push`, star: `${uid}-star`, fork: `${uid}-fork` };
            const fill = `url(#${fillMap[n.kind] || `${uid}-issue`})`;
            inner = `
                <g class="graph-node-scale">
                    <circle class="graph-node-circle" r="11" fill="${fill}"/>
                    ${pill(n.label, 29)}
                </g>`;
        }
        g.innerHTML = inner;
        g.setAttribute("transform", `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`);
        nodesG.appendChild(g);
        nodeEls[n.id] = g;

        /* hover: highlight this node + its edges, dim everything else */
        g.addEventListener("pointerenter", () => {
            const linked = new Set([n.id]);
            for (const e of edges) {
                if (e.a === n.id || e.b === n.id) {
                    linked.add(e.a);
                    linked.add(e.b);
                }
            }
            for (const other of nodes) {
                nodeEls[other.id].classList.toggle("is-dimmed", !linked.has(other.id));
            }
            edgeEls.forEach((el, i) => {
                el.classList.toggle("is-dimmed", !(edges[i].a === n.id || edges[i].b === n.id));
            });
        });
        g.addEventListener("pointerleave", () => {
            for (const other of nodes) nodeEls[other.id].classList.remove("is-dimmed");
            edgeEls.forEach((el) => el.classList.remove("is-dimmed"));
        });
    }

    /* ---- legend ---- */
    const legend = document.createElement("div");
    legend.setAttribute("class", "graph-legend");
    const legendItems = [
        { c: "linear-gradient(135deg,#c084fc,#7c3aed)", t: `<b>${escapeHtml(profile.login)}</b>`, show: true },
        { c: "linear-gradient(135deg,#58a6ff,#1f6feb)", t: `Repositories <b>${repoNodes.length}</b>`, show: true },
        { c: "linear-gradient(135deg,#c084fc,#8957e5)", t: `Pull requests <b>${prCount}</b>`, show: prCount > 0 },
        { c: "linear-gradient(135deg,#e3b341,#a8871d)", t: `Issues <b>${issueCount}</b>`, show: issueCount > 0 },
        { c: "linear-gradient(135deg,#3fb950,#238636)", t: `Pushes <b>${pushCount}</b>`, show: pushCount > 0 },
        { c: "linear-gradient(135deg,#f0b429,#b08c1d)", t: `Stars <b>${starCount}</b>`, show: starCount > 0 },
        { c: "linear-gradient(135deg,#39c5cf,#1b7d83)", t: `Forks <b>${forkCount}</b>`, show: forkCount > 0 },
    ].filter((i) => i.show);
    legend.innerHTML = `
        ${legendItems.map((i) => `<span class="graph-legend-item"><i class="graph-legend-dot" style="background:${i.c}"></i>${i.t}</span>`).join("")}
        <span class="graph-legend-hint">${fullscreen ? "Esc to close · " : ""}Drag to explore · click to open · hover to trace</span>`;

    host.innerHTML = "";
    host.appendChild(svg);
    host.appendChild(legend);

    /* ---- physics ---- */
    let draggedNode = null;
    let dragOffset = { x: 0, y: 0 };
    let moved = 0;

    const toLocal = (ev) => {
        const rect = svg.getBoundingClientRect();
        const sx = W / (rect.width || 1);
        const sy = H / (rect.height || 1);
        return { x: (ev.clientX - rect.left) * sx, y: (ev.clientY - rect.top) * sy };
    };

    svg.addEventListener("pointerdown", (ev) => {
        const g = ev.target.closest(".graph-node");
        if (!g) return;
        const n = nodeMap.get(g.dataset.id);
        if (!n) return;
        ev.preventDefault();
        const p = toLocal(ev);
        draggedNode = n;
        dragOffset = { x: p.x - n.x, y: p.y - n.y };
        moved = 0;
        svg.classList.add("graph-dragging");
        try {
            svg.setPointerCapture(ev.pointerId);
        } catch (_e) { /* ignore */ }
    });

    svg.addEventListener("pointermove", (ev) => {
        if (!draggedNode) return;
        const p = toLocal(ev);
        const nx = p.x - dragOffset.x;
        const ny = p.y - dragOffset.y;
        moved += Math.hypot(nx - draggedNode.x, ny - draggedNode.y);
        draggedNode.x = nx;
        draggedNode.y = ny;
        draggedNode.vx = 0;
        draggedNode.vy = 0;
    });

    svg.addEventListener("pointerup", (ev) => {
        if (!draggedNode) return;
        const n = draggedNode;
        draggedNode = null;
        svg.classList.remove("graph-dragging");
        try {
            svg.releasePointerCapture(ev.pointerId);
        } catch (_e) { /* ignore */ }
        if (moved < 6 && n.url) window.open(n.url, "_blank", "noopener");
    });

    const userNode = nodeMap.get("user");
    const step = () => {
        /* repulsion between every pair (soft — keeps the ring readable) */
        for (let i = 0; i < nodes.length; i++) {
            const a = nodes[i];
            if (a === draggedNode) continue;
            for (let j = i + 1; j < nodes.length; j++) {
                const b = nodes[j];
                if (b === draggedNode) continue;
                let dx = b.x - a.x;
                let dy = b.y - a.y;
                const d = Math.hypot(dx, dy) || 1;
                const f = ((a.r + b.r) * 750) / (d * d);
                const fx = (dx / d) * f;
                const fy = (dy / d) * f;
                a.vx -= fx;
                a.vy -= fy;
                b.vx += fx;
                b.vy += fy;
            }
        }
        /* springs along edges */
        for (const e of edges) {
            const a = nodeMap.get(e.a);
            const b = nodeMap.get(e.b);
            if (!a || !b) continue;
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            const d = Math.hypot(dx, dy) || 1;
            const f = (d - e.rest) * 0.02;
            const fx = (dx / d) * f;
            const fy = (dy / d) * f;
            a.vx += fx;
            a.vy += fy;
            b.vx -= fx;
            b.vy -= fy;
        }
        /* strong "home" pull — keeps the solar-system structure intact */
        for (const n of nodes) {
            if (!n.home) continue;
            const k = n.kind === "user" ? 0.06 : n.kind === "repo" ? 0.055 : 0.05;
            n.vx += (n.home.x - n.x) * k;
            n.vy += (n.home.y - n.y) * k;
        }

        /* integrate */
        for (const n of nodes) {
            if (n === draggedNode) continue;
            n.vx *= 0.84;
            n.vy *= 0.84;
            const speed = Math.hypot(n.vx, n.vy);
            const maxSpeed = 8;
            if (speed > maxSpeed) {
                n.vx = (n.vx / speed) * maxSpeed;
                n.vy = (n.vy / speed) * maxSpeed;
            }
            n.x += n.vx;
            n.y += n.vy;
            n.x = Math.max(20, Math.min(W - 20, n.x));
            n.y = Math.max(20, Math.min(H - 20, n.y));
        }

        /* render curved edges + node positions */
        for (let i = 0; i < edges.length; i++) {
            const e = edges[i];
            const a = nodeMap.get(e.a);
            const b = nodeMap.get(e.b);
            if (a && b) edgeEls[i].setAttribute("d", edgePath(a, b));
        }
        for (const n of nodes) {
            nodeEls[n.id].setAttribute("transform", `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`);
        }
        window.__graphLoop = requestAnimationFrame(step);
    };
    window.__graphLoop = requestAnimationFrame(step);

    /* rebuild on resize while the tab is alive */
    const onResize = () => {
        if (!document.body.contains(host)) {
            window.removeEventListener("resize", onResize);
            return;
        }
        buildActivityGraph(host, { fullscreen });
    };
    window.addEventListener("resize", onResize);
}

/* open the full activity map in its own fullscreen window */
function openActivityGraph() {
    const data = window.__lastResult?.data;
    if (!data || data.type !== "user" || !data.profile) return;
    if (document.querySelector(".graph-modal")) return;

    const backdrop = document.createElement("div");
    backdrop.setAttribute("class", "graph-modal-backdrop");
    backdrop.innerHTML = `
        <div class="graph-modal" role="dialog" aria-modal="true" aria-label="Activity map for ${escapeHtml(data.profile.login)}">
            <header class="graph-modal-header">
                <div class="graph-modal-title">
                    <h3>Activity Map <span>@${escapeHtml(data.profile.login)}</span></h3>
                    <small>Drag to explore · click a node to open · hover to trace connections</small>
                </div>
                <button type="button" class="graph-modal-close" aria-label="Close">&times;</button>
            </header>
            <div class="graph-host graph-modal-body" data-graph-host></div>
        </div>`;
    document.body.appendChild(backdrop);

    const close = () => {
        if (window.__graphLoop) {
            cancelAnimationFrame(window.__graphLoop);
            window.__graphLoop = null;
        }
        document.removeEventListener("keydown", onKey);
        backdrop.remove();
        document.body.style.overflow = "";
    };
    const onKey = (e) => {
        if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("pointerdown", (e) => {
        if (e.target === backdrop) close();
    });
    backdrop.querySelector(".graph-modal-close").addEventListener("click", close);
    document.body.style.overflow = "hidden";

    buildActivityGraph(backdrop.querySelector("[data-graph-host]"), { fullscreen: true });
}
