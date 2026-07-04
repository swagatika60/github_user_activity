const store = new Map();
const DEFAULT_TTL_MS = 5 * 60 * 1000;

function get(key) {
    const entry = store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return null;
    }
    return entry.value;
}

function set(key, value, ttlMs = DEFAULT_TTL_MS) {
    store.set(key, {
        value,
        expiresAt: Date.now() + ttlMs,
    });
}

function stats() {
    return { entries: store.size };
}

module.exports = { get, set, stats };
