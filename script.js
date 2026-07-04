document.addEventListener("DOMContentLoaded", () => {
    const usernameInput = document.getElementById("username");
    if (usernameInput) {
        usernameInput.addEventListener("keypress", (event) => {
            if (event.key === "Enter") {
                getActivity();
            }
        });
    }
});

async function getActivity() {
    const username = document.getElementById("username").value;
    const result = document.getElementById("output");

    // 1. Check if the input field is empty
    if (!username.trim()) {
        result.innerHTML = '<div class="error-message">Please enter a GitHub username first!</div>';
        return;
    }

    result.innerHTML = '<div class="message">Loading...</div>';

    try {
        const response = await fetch(
            `https://api.github.com/users/${username}/events`
        );

        if (!response.ok) {
            throw new Error(response.status === 404 ? "User not found" : "Error fetching activity");
        }

        const events = await response.json();

        // 2. Check if the user has no recent activity
        if (events.length === 0) {
            result.innerHTML = '<h2>Recent Activity</h2><div class="message">No recent activity found for this user.</div>';
            return;
        }

        let output = `<h2>Recent Activity</h2>`;

        events.slice(0, 10).forEach(event => {
            let message = "";
            const repoUrl = `https://github.com/${event.repo.name}`;
            const repoLink = `<a href="${repoUrl}" target="_blank" class="repo-link">${event.repo.name}</a>`;

            switch (event.type) {
                case "PushEvent":
                    // Get the branch name being pushed to (e.g., "refs/heads/main" -> "main")
                    const branchRef = event.payload.ref || "";
                    const branchName = branchRef.replace("refs/heads/", "");
                    
                    // Dynamic clean message matching GitHub's updated API specs
                    if (branchName) {
                        message = `📌 Pushed updates to the <code>${branchName}</code> branch in ${repoLink}`;
                    } else {
                        message = `📌 Pushed code updates to ${repoLink}`;
                    }
                    break;

                case "WatchEvent":
                    message = `⭐ Starred ${repoLink}`;
                    break;

                case "ForkEvent":
                    message = `🍴 Forked ${repoLink}`;
                    break;

                case "CreateEvent":
                    message = `✨ Created a new ${event.payload.ref_type || 'repository'} in ${repoLink}`;
                    break;

                default:
                    // Cleans up camelCase text (e.g., "IssueCommentEvent" becomes "Issue Comment Event")
                    const cleanEventName = event.type.replace(/([A-Z])/g, ' $1').trim();
                    message = `🔹 ${cleanEventName} on ${repoLink}`;
            }

            output += `<div class="activity">${message}</div>`;
        });

        result.innerHTML = output;

    } catch (error) {
        result.innerHTML = `<div class="error-message">Error: ${error.message}</div>`;
    }
}

