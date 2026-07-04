const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const db = require("./db");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const TOKEN_EXPIRY = "7d";

function signToken(user) {
    return jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, {
        expiresIn: TOKEN_EXPIRY,
    });
}

function verifyToken(token) {
    return jwt.verify(token, JWT_SECRET);
}

function authMiddleware(req, res, next) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) {
        return res.status(401).json({ error: "Authentication required." });
    }

    try {
        req.user = verifyToken(token);
        next();
    } catch {
        return res.status(401).json({ error: "Invalid or expired session." });
    }
}

function optionalAuth(req, _res, next) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (token) {
        try {
            req.user = verifyToken(token);
        } catch {
            req.user = null;
        }
    }
    next();
}

async function registerUser({ email, name, password }) {
    const normalizedEmail = email.trim().toLowerCase();
    const displayName = name.trim();

    if (!normalizedEmail || !displayName || !password) {
        const error = new Error("Email, name, and password are required.");
        error.status = 400;
        throw error;
    }

    if (password.length < 6) {
        const error = new Error("Password must be at least 6 characters.");
        error.status = 400;
        throw error;
    }

    const existing = await db.get("SELECT id FROM users WHERE email = ?", [normalizedEmail]);
    if (existing) {
        const error = new Error("An account with this email already exists.");
        error.status = 409;
        throw error;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    if (db.getDriver() === "postgres") {
        const row = await db.get(
            "INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?) RETURNING id, email, name, created_at",
            [normalizedEmail, displayName, passwordHash]
        );
        return row;
    }

    const result = await db.run("INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)", [
        normalizedEmail,
        displayName,
        passwordHash,
    ]);
    return db.get("SELECT id, email, name, created_at FROM users WHERE id = ?", [result.lastID]);
}

async function loginUser({ email, password }) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await db.get("SELECT id, email, name, password_hash, created_at FROM users WHERE email = ?", [
        normalizedEmail,
    ]);

    if (!user) {
        const error = new Error("Invalid email or password.");
        error.status = 401;
        throw error;
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
        const error = new Error("Invalid email or password.");
        error.status = 401;
        throw error;
    }

    delete user.password_hash;
    return user;
}

async function getUserById(id) {
    return db.get("SELECT id, email, name, created_at FROM users WHERE id = ?", [id]);
}

async function saveSearchHistory(userId, query, resultType) {
    await db.run("INSERT INTO search_history (user_id, query, result_type) VALUES (?, ?, ?)", [
        userId,
        query,
        resultType || null,
    ]);

    const rows = await db.all(
        "SELECT id FROM search_history WHERE user_id = ? ORDER BY created_at DESC, id DESC",
        [userId]
    );

    if (rows.length > 50) {
        const stale = rows.slice(50);
        for (const row of stale) {
            await db.run("DELETE FROM search_history WHERE id = ? AND user_id = ?", [row.id, userId]);
        }
    }
}

async function getSearchHistory(userId, limit = 20) {
    return db.all(
        "SELECT query, result_type, created_at FROM search_history WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
        [userId, limit]
    );
}

async function clearSearchHistory(userId) {
    await db.run("DELETE FROM search_history WHERE user_id = ?", [userId]);
}

module.exports = {
    signToken,
    authMiddleware,
    optionalAuth,
    registerUser,
    loginUser,
    getUserById,
    saveSearchHistory,
    getSearchHistory,
    clearSearchHistory,
};
