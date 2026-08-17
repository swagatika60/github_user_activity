const fs = require("fs");
const path = require("path");

let driver = null;
let sqlite = null;
let pool = null;
let prepared = new Map();

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
                github_id BIGINT,
                github_login TEXT,
                avatar_url TEXT,
                github_token TEXT,
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

            ALTER TABLE users ADD COLUMN IF NOT EXISTS github_id BIGINT;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS github_login TEXT;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS github_token TEXT;
            CREATE UNIQUE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id);
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

    const sqlitePath = process.env.SQLITE_DB_PATH || path.join(dataDir, "app.db");
    sqlite = new Database(sqlitePath);
    sqlite.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            github_id INTEGER,
            github_login TEXT,
            avatar_url TEXT,
            github_token TEXT,
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

    const userColumns = prepareStatement("PRAGMA table_info(users)")
        .all()
        .map((column) => column.name);

    if (!userColumns.includes("github_id")) sqlite.exec("ALTER TABLE users ADD COLUMN github_id INTEGER");
    if (!userColumns.includes("github_login")) sqlite.exec("ALTER TABLE users ADD COLUMN github_login TEXT");
    if (!userColumns.includes("avatar_url")) sqlite.exec("ALTER TABLE users ADD COLUMN avatar_url TEXT");
    if (!userColumns.includes("github_token")) sqlite.exec("ALTER TABLE users ADD COLUMN github_token TEXT");
    sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id)");
    console.log("Database: SQLite (data/app.db)");
}

// Reuse prepared statements. Keeping references lets us explicitly close them
// before the database, which avoids a better-sqlite3 crash during V8 teardown
// on newer Node versions (statement cleanup hooks firing with a null env).
function prepareStatement(sql) {
    let statement = prepared.get(sql);
    if (!statement) {
        statement = sqlite.prepare(sql);
        prepared.set(sql, statement);
    }
    return statement;
}

async function get(sql, params = []) {
    if (driver === "postgres") {
        const [pgSql, pgParams] = toPostgresParams(sql, params);
        const result = await pool.query(pgSql, pgParams);
        return result.rows[0] || null;
    }
    return prepareStatement(sql).get(...params) || null;
}

async function all(sql, params = []) {
    if (driver === "postgres") {
        const [pgSql, pgParams] = toPostgresParams(sql, params);
        const result = await pool.query(pgSql, pgParams);
        return result.rows;
    }
    return prepareStatement(sql).all(...params);
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
    const info = prepareStatement(sql).run(...params);
    return {
        lastID: Number(info.lastInsertRowid),
        changes: info.changes,
    };
}

function close() {
    if (driver === "postgres") {
        if (pool) {
            pool.end();
            pool = null;
        }
        return;
    }
    if (sqlite) {
        for (const statement of prepared.values()) {
            try {
                statement.close();
            } catch {
                // Already closed.
            }
        }
        prepared.clear();
        try {
            sqlite.close();
        } catch {
            // Already closed.
        }
        sqlite = null;
    }
}

// Close statements and the SQLite connection on normal exit. Explicitly closing
// prepared statements unregisters their cleanup hooks, avoiding a better-sqlite3
// crash during V8 teardown on newer Node versions.
process.on("exit", () => {
    if (driver === "sqlite") {
        close();
    }
});

function getDriver() {
    return driver;
}

module.exports = { init, get, all, run, close, getDriver };
