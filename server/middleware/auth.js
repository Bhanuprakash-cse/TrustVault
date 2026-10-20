
const jwt = require("jsonwebtoken");
const db = require("../db");

async function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            message: "Access denied. Please log in."
        });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
        return res.status(401).json({
            message: "Access denied. Token missing."
        });
    }

    try {
        if (!process.env.JWT_SECRET) {
            console.error("JWT_SECRET is not configured.");

            return res.status(500).json({
                message: "Internal server error."
            });
        }

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        // Read the current user and role from MySQL.
        // Do not trust the role supplied by the token alone.
        const [users] = await db.execute(
            `SELECT id, name, email, role
             FROM users
             WHERE id = ?`,
            [decoded.id]
        );

        if (users.length === 0) {
            return res.status(401).json({
                message: "Invalid user."
            });
        }

        req.user = users[0];

        next();
    } catch (error) {
        if (
            error.name === "JsonWebTokenError" ||
            error.name === "TokenExpiredError" ||
            error.name === "NotBeforeError"
        ) {
            return res.status(401).json({
                message: "Invalid or expired token."
            });
        }

        console.error("Authentication error:", error.message);

        return res.status(500).json({
            message: "Internal server error."
        });
    }
}

function allowRoles(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                message: "Authentication required."
            });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                message: "You do not have permission to perform this action."
            });
        }

        next();
    };
}

module.exports = {
    authenticateToken,
    allowRoles
};
