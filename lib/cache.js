const db = require("./db");

const memoryStore = new Map();
const DEFAULT_TTL_MS = 5 * 60 * 1000;

async function getFromDb(key) {
    try {
        const row = await db.get("SELECT cache_value, expires_at FROM api_cache WHERE cache_key = ?", [key]);
        if (!row) return null;
        if (Date.now() > Number(row.expires_at)) {
            await db.run("DELETE FROM api_cache WHERE cache_key = ?", [key]);
            return null;
        }
        return JSON.parse(row.cache_value);
    } catch {
        return null;
    }
}

async function setInDb(key, value, ttlMs) {
    const driver = db.getDriver();
    if (!driver) return;

    const expiresAt = Date.now() + ttlMs;
    const cacheValue = JSON.stringify(value);

    if (driver === "postgres") {
        await db.run(
            "INSERT INTO api_cache (cache_key, cache_value, expires_at) VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET cache_value = excluded.cache_value, expires_at = excluded.expires_at",
            [key, cacheValue, expiresAt]
        );
        return;
    }

    await db.run(
        "INSERT OR REPLACE INTO api_cache (cache_key, cache_value, expires_at) VALUES (?, ?, ?)",
        [key, cacheValue, expiresAt]
    );
}

async function get(key) {
    const memoryEntry = memoryStore.get(key);
    if (memoryEntry) {
        if (Date.now() > memoryEntry.expiresAt) {
            memoryStore.delete(key);
        } else {
            return memoryEntry.value;
        }
    }

    const dbEntry = await getFromDb(key);
    if (dbEntry) {
        memoryStore.set(key, {
            value: dbEntry,
            expiresAt: Date.now() + DEFAULT_TTL_MS,
        });
        return dbEntry;
    }

    return null;
}

async function set(key, value, ttlMs = DEFAULT_TTL_MS) {
    memoryStore.set(key, {
        value,
        expiresAt: Date.now() + ttlMs,
    });
    await setInDb(key, value, ttlMs);
}

function stats() {
    return { memoryEntries: memoryStore.size };
}

module.exports = { get, set, stats };
