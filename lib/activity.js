const CATEGORIES = ["commits", "prs", "issues", "reviews", "branches"];

/**
 * Map a GitHub event to an activity category (or null to ignore it).
 * PushEvent counts its commits; CreateEvent counts only branches.
 */
function eventCategory(event) {
    switch (event.type) {
        case "PushEvent":
            return "commits";
        case "PullRequestEvent":
            return "prs";
        case "IssuesEvent":
            return "issues";
        case "PullRequestReviewEvent":
            return "reviews";
        case "CreateEvent":
            return event.payload && event.payload.ref_type === "branch" ? "branches" : null;
        default:
            return null;
    }
}

/**
 * Summarize a list of GitHub events (newest first) into:
 * - totals: total counts per category
 * - byDay: one bucket per day over the last `days` days
 * - byRepo: per-repository counts, ranked by total activity, capped at maxRepos
 */
function summarizeEvents(events, { days = 14, maxRepos = 5 } = {}) {
    const totals = { commits: 0, prs: 0, issues: 0, reviews: 0, branches: 0 };
    const repoMap = new Map();
    const dayMap = new Map();

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    for (let i = days - 1; i >= 0; i--) {
        const date = new Date(now - i * dayMs).toISOString().slice(0, 10);
        dayMap.set(date, { date, commits: 0, prs: 0, issues: 0, reviews: 0, branches: 0 });
    }

    for (const event of events || []) {
        const category = eventCategory(event);
        if (!category) continue;

        const count = category === "commits" ? Math.max(1, event.payload?.commits?.length || 1) : 1;
        totals[category] += count;

        const repoName = event.repo?.name || "unknown";
        let repo = repoMap.get(repoName);
        if (!repo) {
            repo = { name: repoName, commits: 0, prs: 0, issues: 0, reviews: 0, branches: 0 };
            repoMap.set(repoName, repo);
        }
        repo[category] += count;

        const date = event.created_at ? event.created_at.slice(0, 10) : null;
        if (date && dayMap.has(date)) {
            dayMap.get(date)[category] += count;
        }
    }

    const byDay = [...dayMap.values()];
    const byRepo = [...repoMap.values()]
        .map((repo) => ({ ...repo, total: CATEGORIES.reduce((sum, c) => sum + repo[c], 0) }))
        .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
        .slice(0, maxRepos);

    return { totals, byDay, byRepo };
}

module.exports = { summarizeEvents, CATEGORIES };
