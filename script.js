document.addEventListener("DOMContentLoaded", () => {
    const usernameInput = document.getElementById("username");
    if (!usernameInput) return;

    usernameInput.addEventListener("keypress", (event) => {
        if (event.key === "Enter") {
            getActivity();
        }
    });

    usernameInput.addEventListener("paste", () => {
        setTimeout(getActivity, 0);
    });
});

function parseGitHubInput(input) {
    const trimmed = input.trim().replace(/^@/, "");

    if (!trimmed) {
        return { type: "empty" };
    }

    const looksLikeUrl =
        trimmed.includes("github.com") ||
        trimmed.startsWith("http://") ||
        trimmed.startsWith("https://");

    if (!looksLikeUrl) {
        return { type: "username", username: trimmed };
    }

    let url;
    try {
        url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    } catch {
        return { type: "invalid" };
    }

    const host = url.hostname.replace(/^www\./, "");
    if (host !== "github.com") {
        return { type: "invalid" };
    }

    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length === 0) {
        return { type: "invalid" };
    }

    const [owner, repo, section, id] = parts;

    if (parts.length === 1) {
        return { type: "user", owner };
    }

    if (parts.length === 2) {
        return { type: "repo", owner, repo };
    }

    if (section === "issues" && id && /^\d+$/.test(id)) {
        return { type: "issue", owner, repo, number: id };
    }

    if (section === "pull" && id && /^\d+$/.test(id)) {
        return { type: "pull", owner, repo, number: id };
    }

    if (parts.length === 2) {
        return { type: "repo", owner, repo };
    }

    return { type: "repo", owner, repo };
}

async function fetchGitHub(path) {
    const response = await fetch(`https://api.github.com${path}`);

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error("Resource not found");
        }
        throw new Error("Error fetching data from GitHub");
    }

    return response.json();
}

function formatDate(dateString) {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
}

function truncateText(text, maxLength = 280) {
    if (!text) return "No description provided.";
    const cleaned = text.trim();
    if (cleaned.length <= maxLength) return cleaned;
    return `${cleaned.slice(0, maxLength).trim()}…`;
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function renderStat(label, value) {
    return `<div class="stat"><span class="stat-value">${value}</span><span class="stat-label">${label}</span></div>`;
}

function renderDetailRow(label, value) {
    return `<div class="detail-row"><span class="detail-label">${label}</span><span class="detail-value">${value}</span></div>`;
}

async function describeUser(owner) {
    const user = await fetchGitHub(`/users/${owner}`);
    const events = await fetchGitHub(`/users/${owner}/events?per_page=5`);

    const profileUrl = user.html_url;
    const avatar = user.avatar_url
        ? `<img src="${user.avatar_url}" alt="${escapeHtml(user.login)}" class="avatar">`
        : "";

    let activityHtml = "";
    if (events.length === 0) {
        activityHtml = '<div class="message">No recent public activity.</div>';
    } else {
        activityHtml = events
            .map((event) => {
                const repoUrl = `https://github.com/${event.repo.name}`;
                const repoLink = `<a href="${repoUrl}" target="_blank" class="repo-link">${event.repo.name}</a>`;
                const cleanEventName = event.type.replace(/Event$/, "").replace(/([A-Z])/g, " $1").trim();
                return `<div class="activity compact">${cleanEventName} on ${repoLink}</div>`;
            })
            .join("");
    }

    return `
        <div class="detail-card">
            <div class="profile-header">
                ${avatar}
                <div>
                    <h2>${escapeHtml(user.name || user.login)}</h2>
                    <a href="${profileUrl}" target="_blank" class="repo-link">@${escapeHtml(user.login)}</a>
                </div>
            </div>
            <p class="detail-description">${escapeHtml(truncateText(user.bio, 400))}</p>
            <div class="stats-grid">
                ${renderStat("Repos", user.public_repos)}
                ${renderStat("Followers", user.followers)}
                ${renderStat("Following", user.following)}
                ${renderStat("Gists", user.public_gists)}
            </div>
            ${renderDetailRow("Company", escapeHtml(user.company || "—"))}
            ${renderDetailRow("Location", escapeHtml(user.location || "—"))}
            ${renderDetailRow("Joined", formatDate(user.created_at))}
            ${renderDetailRow("Profile", `<a href="${profileUrl}" target="_blank" class="repo-link">${profileUrl}</a>`)}
        </div>
        <h3 class="section-title">Recent Activity</h3>
        ${activityHtml}
    `;
}

async function describeRepo(owner, repo) {
    const data = await fetchGitHub(`/repos/${owner}/${repo}`);
    const repoUrl = data.html_url;

    const topics =
        data.topics && data.topics.length > 0
            ? data.topics.map((topic) => `<span class="topic-tag">${escapeHtml(topic)}</span>`).join("")
            : '<span class="detail-muted">No topics listed</span>';

    return `
        <div class="detail-card">
            <h2>${escapeHtml(data.full_name)}</h2>
            <p class="detail-description">${escapeHtml(truncateText(data.description, 400))}</p>
            <div class="stats-grid">
                ${renderStat("Stars", data.stargazers_count)}
                ${renderStat("Forks", data.forks_count)}
                ${renderStat("Issues", data.open_issues_count)}
                ${renderStat("Watchers", data.subscribers_count || data.watchers_count)}
            </div>
            ${renderDetailRow("Language", escapeHtml(data.language || "Not detected"))}
            ${renderDetailRow("Default branch", `<code>${escapeHtml(data.default_branch)}</code>`)}
            ${renderDetailRow("License", escapeHtml(data.license?.spdx_id || data.license?.name || "None"))}
            ${renderDetailRow("Created", formatDate(data.created_at))}
            ${renderDetailRow("Last updated", formatDate(data.updated_at))}
            ${renderDetailRow("Homepage", data.homepage ? `<a href="${data.homepage}" target="_blank" class="repo-link">${escapeHtml(data.homepage)}</a>` : "—")}
            ${renderDetailRow("Repository", `<a href="${repoUrl}" target="_blank" class="repo-link">${repoUrl}</a>`)}
            <div class="detail-row topics-row">
                <span class="detail-label">Topics</span>
                <span class="detail-value topic-list">${topics}</span>
            </div>
        </div>
    `;
}

async function describeIssue(owner, repo, number) {
    const data = await fetchGitHub(`/repos/${owner}/${repo}/issues/${number}`);
    const issueUrl = data.html_url;
    const labels =
        data.labels && data.labels.length > 0
            ? data.labels.map((label) => `<span class="label-tag">${escapeHtml(label.name)}</span>`).join("")
            : '<span class="detail-muted">No labels</span>';

    return `
        <div class="detail-card">
            <span class="badge badge-${data.state}">${escapeHtml(data.state)}</span>
            <h2>#${data.number} ${escapeHtml(data.title)}</h2>
            <p class="detail-meta">Opened by <a href="${data.user.html_url}" target="_blank" class="repo-link">${escapeHtml(data.user.login)}</a> on ${formatDate(data.created_at)}</p>
            <p class="detail-description">${escapeHtml(truncateText(data.body, 500))}</p>
            <div class="stats-grid">
                ${renderStat("Comments", data.comments)}
                ${renderStat("Assignees", data.assignees?.length || 0)}
            </div>
            ${renderDetailRow("Repository", `<a href="https://github.com/${owner}/${repo}" target="_blank" class="repo-link">${owner}/${repo}</a>`)}
            ${renderDetailRow("Updated", formatDate(data.updated_at))}
            ${renderDetailRow("Closed", data.closed_at ? formatDate(data.closed_at) : "Still open")}
            ${renderDetailRow("Issue link", `<a href="${issueUrl}" target="_blank" class="repo-link">${issueUrl}</a>`)}
            <div class="detail-row topics-row">
                <span class="detail-label">Labels</span>
                <span class="detail-value topic-list">${labels}</span>
            </div>
        </div>
    `;
}

async function describePull(owner, repo, number) {
    const data = await fetchGitHub(`/repos/${owner}/${repo}/pulls/${number}`);
    const pullUrl = data.html_url;
    const labels =
        data.labels && data.labels.length > 0
            ? data.labels.map((label) => `<span class="label-tag">${escapeHtml(label.name)}</span>`).join("")
            : '<span class="detail-muted">No labels</span>';

    const mergeStatus = data.merged
        ? `Merged on ${formatDate(data.merged_at)}`
        : data.state === "closed"
          ? "Closed without merge"
          : "Open";

    return `
        <div class="detail-card">
            <span class="badge badge-${data.merged ? "merged" : data.state}">${data.merged ? "merged" : escapeHtml(data.state)}</span>
            <h2>#${data.number} ${escapeHtml(data.title)}</h2>
            <p class="detail-meta">Opened by <a href="${data.user.html_url}" target="_blank" class="repo-link">${escapeHtml(data.user.login)}</a> on ${formatDate(data.created_at)}</p>
            <p class="detail-description">${escapeHtml(truncateText(data.body, 500))}</p>
            <div class="stats-grid">
                ${renderStat("Commits", data.commits ?? "—")}
                ${renderStat("+Additions", data.additions ?? "—")}
                ${renderStat("−Deletions", data.deletions ?? "—")}
                ${renderStat("Changed files", data.changed_files ?? "—")}
            </div>
            ${renderDetailRow("Base branch", `<code>${escapeHtml(data.base.ref)}</code> ← ${escapeHtml(data.base.repo.full_name)}`)}
            ${renderDetailRow("Head branch", `<code>${escapeHtml(data.head.ref)}</code> ← ${escapeHtml(data.head.repo.full_name)}`)}
            ${renderDetailRow("Merge status", mergeStatus)}
            ${renderDetailRow("Repository", `<a href="https://github.com/${owner}/${repo}" target="_blank" class="repo-link">${owner}/${repo}</a>`)}
            ${renderDetailRow("Pull request", `<a href="${pullUrl}" target="_blank" class="repo-link">${pullUrl}</a>`)}
            <div class="detail-row topics-row">
                <span class="detail-label">Labels</span>
                <span class="detail-value topic-list">${labels}</span>
            </div>
        </div>
    `;
}

function formatActivityMessage(event) {
    const repoUrl = `https://github.com/${event.repo.name}`;
    const repoLink = `<a href="${repoUrl}" target="_blank" class="repo-link">${event.repo.name}</a>`;

    switch (event.type) {
        case "PushEvent": {
            const branchRef = event.payload.ref || "";
            const branchName = branchRef.replace("refs/heads/", "");
            if (branchName) {
                return `📌 Pushed updates to the <code>${branchName}</code> branch in ${repoLink}`;
            }
            return `📌 Pushed code updates to ${repoLink}`;
        }
        case "WatchEvent":
            return `⭐ Starred ${repoLink}`;
        case "ForkEvent":
            return `🍴 Forked ${repoLink}`;
        case "CreateEvent":
            return `✨ Created a new ${event.payload.ref_type || "repository"} in ${repoLink}`;
        default: {
            const cleanEventName = event.type.replace(/([A-Z])/g, " $1").trim();
            return `🔹 ${cleanEventName} on ${repoLink}`;
        }
    }
}

async function showUserActivity(username) {
    const events = await fetchGitHub(`/users/${username}/events`);

    if (events.length === 0) {
        return '<h2>Recent Activity</h2><div class="message">No recent activity found for this user.</div>';
    }

    let output = `<h2>Recent Activity for @${escapeHtml(username)}</h2>`;
    events.slice(0, 10).forEach((event) => {
        output += `<div class="activity">${formatActivityMessage(event)}</div>`;
    });

    return output;
}

async function getActivity() {
    const input = document.getElementById("username").value;
    const result = document.getElementById("output");
    const parsed = parseGitHubInput(input);

    if (parsed.type === "empty") {
        result.innerHTML =
            '<div class="error-message">Please enter a GitHub username or paste a GitHub link.</div>';
        return;
    }

    if (parsed.type === "invalid") {
        result.innerHTML =
            '<div class="error-message">That link does not look like a supported GitHub URL.</div>';
        return;
    }

    result.innerHTML = '<div class="message">Loading details...</div>';

    try {
        let output = "";

        switch (parsed.type) {
            case "user":
                output = await describeUser(parsed.owner);
                break;
            case "repo":
                output = await describeRepo(parsed.owner, parsed.repo);
                break;
            case "issue":
                output = await describeIssue(parsed.owner, parsed.repo, parsed.number);
                break;
            case "pull":
                output = await describePull(parsed.owner, parsed.repo, parsed.number);
                break;
            case "username":
            default:
                output = await showUserActivity(parsed.username);
                break;
        }

        result.innerHTML = output;
    } catch (error) {
        result.innerHTML = `<div class="error-message">Error: ${error.message}</div>`;
    }
}
