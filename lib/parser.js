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

    if (section === "commit" && id) {
        return { type: "commit", owner, repo, sha: id };
    }

    return { type: "repo", owner, repo };
}

module.exports = { parseGitHubInput };
