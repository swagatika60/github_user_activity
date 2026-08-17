const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]+$/;

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
        const parts = trimmed.split("/").filter(Boolean);
        if (parts.length === 1) {
            return { type: "username", username: parts[0] };
        }
        return classifyParts(parts);
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

    return classifyParts(parts);
}

function classifyParts(parts) {
    const [owner, repo, section, id] = parts;

    if (!owner || !OWNER_PATTERN.test(owner)) {
        return { type: "invalid" };
    }

    if (parts.length === 1) {
        return { type: "user", owner };
    }

    if (!repo || !REPO_PATTERN.test(repo)) {
        return { type: "invalid" };
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

    if (section === "commit" && id) {
        return { type: "commit", owner, repo, sha: id };
    }

    return { type: "repo", owner, repo };
}

module.exports = { parseGitHubInput };
