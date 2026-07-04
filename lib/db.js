const fs = require("fs");
const path = require("path");

let driver = null;
let sqlite = null;
let pool = null;

function toPostgresParams(sql, params) {
    let index = 0;
    const pgSql = sql.replace(/\?/g, () => `$${++index}`);
    return [pgSql, params];
}

async function init() {
    if (process.env.DATABASE_URL) {
        driver = "postgres";
        const { Pool } = require("pg");
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.PGSSL === "false" ? false : { rejectUnauthorized: false },
        });
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS search_history (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                query TEXT NOT NULL,
                result_type TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS api_cache (
                cache_key TEXT PRIMARY KEY,
                cache_value TEXT NOT NULL,
                expires_at BIGINT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_search_history_user_id ON search_history(user_id);
        `);
        console.log("Database: PostgreSQL connected");
        return;
    }

    driver = "sqlite";
    const Database = require("better-sqlite3");
    const dataDir = path.join(__dirname, "..", "data");
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    sqlite = new Database(path.join(dataDir, "app.db"));
    sqlite.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS search_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            query TEXT NOT NULL,
            result_type TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS api_cache (
            cache_key TEXT PRIMARY KEY,
            cache_value TEXT NOT NULL,
            expires_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_search_history_user_id ON search_history(user_id);
    `);
    console.log("Database: SQLite (data/app.db)");
}

async function get(sql, params = []) {
    if (driver === "postgres") {
        const [pgSql, pgParams] = toPostgresParams(sql, params);
        const result = await pool.query(pgSql, pgParams);
        return result.rows[0] || null;
    }
    return sqlite.prepare(sql).get(...params) || null;
}

async function all(sql, params = []) {
    if (driver === "postgres") {
        const [pgSql, pgParams] = toPostgresParams(sql, params);
        const result = await pool.query(pgSql, pgParams);
        return result.rows;
    }
    return sqlite.prepare(sql).all(...params);
}

async function run(sql, params = []) {
    if (driver === "postgres") {
        const [pgSql, pgParams] = toPostgresParams(sql, params);
        const result = await pool.query(pgSql, pgParams);
        return {
            lastID: result.rows[0]?.id,
            changes: result.rowCount,
        };
    }
    const info = sqlite.prepare(sql).run(...params);
    return {
        lastID: Number(info.lastInsertRowid),
        changes: info.changes,
    };
}

function getDriver() {
    return driver;
}

module.exports = { init, get, all, run, getDriver };
