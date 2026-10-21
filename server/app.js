
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const db = require("./db");

const app = express();

const authRoutes = require("./routes/auth");

const {
    authenticateToken,
    allowRoles
} = require("./middleware/auth");

const documentRoutes = require("./routes/documents");

const { writeAuditLog } = require("./utils/audit");

app.use(helmet());

app.use(
    cors({
        origin: process.env.FRONTEND_URL || "http://localhost:5173"
    })
);

app.use(express.json({ limit: "100kb" }));

app.use("/api/documents", documentRoutes);

app.use("/api/auth", authRoutes);

app.get("/api/health", async (req, res) => {
    try {
        const [rows] = await db.query(
            "SELECT DATABASE() AS db, 1 AS connected"
        );

        res.json({
            status: "ok",
            database: "connected",
            databaseName: rows[0].db
        });
    } catch (error) {
        console.error(
            "Health check failed:",
            error.code,
            error.message
        );

        res.status(503).json({
            status: "error",
            message: "Service unavailable"
        });
    }
});

// Protected route: any authenticated user
app.get("/api/auth/me", authenticateToken, (req, res) => {
    res.json({
        message: "Authentication successful.",
        user: req.user
    });
});

// Admin-only test route
app.get(
    "/api/admin/test",
    authenticateToken,
    allowRoles("admin"),
    (req, res) => {
        res.json({
            message: "Admin access granted."
        });
    }
);


 // Admin-only audit activity dashboard
app.get(
    "/api/admin/audit-logs",
    authenticateToken,
    allowRoles("admin"),
    async (req, res) => {
        try {
            const limit = Math.min(
                Math.max(Number.parseInt(req.query.limit, 10) || 20, 1),
                100
            );

            const [logs] = await db.execute(
                `SELECT
                    id,
                    actor_user_id,
                    document_id,
                    action,
                    result,
                    details,
                    created_at
                 FROM audit_logs
                 ORDER BY created_at DESC
                 LIMIT ?`,
                [limit]
            );

            return res.status(200).json({
                message: "Audit activity retrieved successfully.",
                count: logs.length,
                logs
            });
        } catch (error) {
            console.error("Audit dashboard failed:", error.message);

            return res.status(500).json({
                message: "Internal server error."
            });
        }
    }
);


module.exports = app;
