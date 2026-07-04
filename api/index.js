require("dotenv").config();

const { createApp } = require("../app");
const db = require("../lib/db");

let app;
let ready;

async function getApp() {
    if (!ready) {
        ready = (async () => {
            await db.init();
            app = createApp();
            return app;
        })();
    }
    return ready;
}

module.exports = async (req, res) => {
    const expressApp = await getApp();
    return expressApp(req, res);
};
