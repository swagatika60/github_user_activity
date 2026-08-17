require("dotenv").config();

const { createApp } = require("./app");
const db = require("./lib/db");

const PORT = process.env.PORT || 3000;

async function start() {
    await db.init();
    const app = createApp();

    app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
        console.log(`GitHub token: ${process.env.GITHUB_TOKEN ? "configured" : "not set (optional)"}`);
        console.log(`JWT secret: ${process.env.JWT_SECRET ? "configured" : "using dev default"}`);
    });
}

start().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
});
