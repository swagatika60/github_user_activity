// const result = document.querySelector(".container")

// result.addEventListener ('search', e  =>{
// function getActivity(){
//     let name = document.getElementById("username").value;

//     document.getElementById("output").textContent = name;
// }

// const getData = async () => {
//     const response = await fetch('swag.json')
//      console.log(response)
//     const data = await response.json()
//     return data

//     if(response.status !== 200){
//         throw new Error('Error fetching todos')
//     }
// }

// getData() 
// .then(data =>console.log("resolved",data))
// .catch(err => console.log("rejected",err.message))

async function getActivity() {
    const username = document.getElementById("username").value;
    const result = document.getElementById("output");

    // 1. Check if the input field is empty
    if (!username.trim()) {
        result.innerHTML = "<p>Please enter a username first!</p>";
        return;
    }

    result.innerHTML = "Loading...";

    try {
        const response = await fetch(
            `https://api.github.com/users/${username}/events`
        );

        if (!response.ok) {
            throw new Error("User not found");
        }

        const events = await response.json();

        // 2. Check if the user has no recent activity
        if (events.length === 0) {
            result.innerHTML = "<h2>Recent Activity</h2><p>No recent activity found for this user.</p>";
            return;
        }

        let output = `<h2>Recent Activity</h2>`;

        events.slice(0, 10).forEach(event => {
            let message = "";
switch (event.type) {
    case "PushEvent":
        // Get the branch name being pushed to (e.g., "refs/heads/main" -> "main")
        const branchRef = event.payload.ref || "";
        const branchName = branchRef.replace("refs/heads/", "");
        
        // Dynamic clean message matching GitHub's updated API specs
        if (branchName) {
            message = `📌 Pushed updates to the <code>${branchName}</code> branch in <strong>${event.repo.name}</strong>`;
        } else {
            message = `📌 Pushed code updates to <strong>${event.repo.name}</strong>`;
        }
        break;

    case "WatchEvent":
        message = `⭐ Starred <strong>${event.repo.name}</strong>`;
        break;

    case "ForkEvent":
        message = `🍴 Forked <strong>${event.repo.name}</strong>`;
        break;

    case "CreateEvent":
        message = `✨ Created a new ${event.payload.ref_type || 'repository'} in <strong>${event.repo.name}</strong>`;
        break;

    default:
        // Cleans up camelCase text (e.g., "IssueCommentEvent" becomes "Issue Comment Event")
        const cleanEventName = event.type.replace(/([A-Z])/g, ' $1').trim();
        message = `🔹 ${cleanEventName} on <strong>${event.repo.name}</strong>`;
}


            output += `<div class="activity">${message}</div>`;
        });

        result.innerHTML = output;

    } catch (error) {

        result.innerHTML = `<p style="color: red;"> Error: ${error.message}</p>`;

    }
}

