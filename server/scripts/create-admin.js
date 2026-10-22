require("dotenv").config();

const bcrypt = require("bcryptjs");
const db = require("../db");

async function main() {
    const name = process.env.TV_ADMIN_NAME?.trim();
    const email = process.env.TV_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.TV_ADMIN_PASSWORD;

    if (
        !name ||
        !email ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        !password ||
        password.length < 12 ||
        password.length > 72
    ) {
        throw new Error(
            "Provide a name, valid email, and password of 12-72 characters."
        );
    }

    const [existing] = await db.execute(
        "SELECT id FROM users WHERE email = ?",
        [email]
    );

    if (existing.length > 0) {
        throw new Error(
            "That email already exists. No account was changed."
        );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const [result] = await db.execute(
        `INSERT INTO users (name, email, password_hash, role)
         VALUES (?, ?, ?, 'admin')`,
        [name, email, passwordHash]
    );

    console.log("Development admin created successfully.");
    console.log("User ID:", result.insertId);
    console.log("Role: admin");
}

main()
    .catch((error) => {
        console.error("Admin creation failed:", error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await db.end();
    });
