
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");

const router = express.Router();

function createToken(user) {
    return jwt.sign(
        {
            id: user.id,
            role: user.role
        },
        process.env.JWT_SECRET,
        { expiresIn: "1h" }
    );
}

// Register a new user.
// Public registration always creates a viewer account.
router.post("/register", async (req, res) => {
    try {
        const { name, email, password } = req.body;

        if (
            typeof name !== "string" ||
            typeof email !== "string" ||
            typeof password !== "string" ||
            !name.trim() ||
            !email.trim() ||
            password.length < 8 ||
            password.length > 72
        ) {
            return res.status(400).json({
                message: "Provide a name, valid email, and password of 8–72 characters."
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            return res.status(400).json({
                message: "Enter a valid email address."
            });
        }

        const [existing] = await db.execute(
            "SELECT id FROM users WHERE email = ?",
            [normalizedEmail]
        );

        if (existing.length > 0) {
            return res.status(409).json({
                message: "An account with this email already exists."
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const [result] = await db.execute(
            `INSERT INTO users (name, email, password_hash, role)
             VALUES (?, ?, ?, 'viewer')`,
            [name.trim(), normalizedEmail, passwordHash]
        );

        return res.status(201).json({
            message: "Account created successfully.",
            user: {
                id: result.insertId,
                name: name.trim(),
                email: normalizedEmail,
                role: "viewer"
            }
        });
    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                message: "An account with this email already exists."
            });
        }

        console.error("Registration failed:", error.message);

        return res.status(500).json({
            message: "Unable to register at this time."
        });
    }
});

// Log in an existing user.
router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (
            typeof email !== "string" ||
            typeof password !== "string" ||
            !email.trim() ||
            !password ||
            password.length > 72
        ) {
            return res.status(400).json({
                message: "Email and password are required."
            });
        }

        const [users] = await db.execute(
            `SELECT id, name, email, password_hash, role
             FROM users
             WHERE email = ?`,
            [email.trim().toLowerCase()]
        );

        if (users.length === 0) {
            return res.status(401).json({
                message: "Invalid email or password."
            });
        }

        const user = users[0];
        const passwordMatches = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!passwordMatches) {
            return res.status(401).json({
                message: "Invalid email or password."
            });
        }

        const token = createToken(user);

        return res.json({
            message: "Login successful.",
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        console.error("Login failed:", error.message);

        return res.status(500).json({
            message: "Unable to log in at this time."
        });
    }
});

module.exports = router;
