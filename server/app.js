
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

 // Admin-only audit activity dashboard
app.get(
    "/api/admin/audit-logs",
    authenticateToken,
    allowRoles("admin"),
    async (req, res) => {
        try {
            const { action, result } = req.query;
            let limit = 20;

            if (req.query.limit !== undefined) {
                const rawLimit = req.query.limit;

                if (
                    typeof rawLimit !== "string" ||
                    !/^\d+$/.test(rawLimit) ||
                    Number(rawLimit) < 1
                ) {
                    return res.status(400).json({
                        message: "Limit must be a positive integer."
                    });
                }

                limit = Math.min(Number(rawLimit), 100);
            }

            if (
                action !== undefined &&
                (
                    typeof action !== "string" ||
                    !/^[a-z][a-z0-9_]{0,49}$/.test(action)
                )
            ) {
                return res.status(400).json({
                    message: "Invalid action filter."
                });
            }

            if (
                result !== undefined &&
                (
                    typeof result !== "string" ||
                    !["success", "denied"].includes(result)
                )
            ) {
                return res.status(400).json({
                    message: "Result must be success or denied."
                });
            }

            const conditions = [];
            const params = [];

            if (action !== undefined) {
                conditions.push("action = ?");
                params.push(action);
            }

            if (result !== undefined) {
                conditions.push("result = ?");
                params.push(result);
            }

            const whereClause = conditions.length
                ? `WHERE ${conditions.join(" AND ")}`
                : "";

            params.push(limit);

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
                 ${whereClause}
                 ORDER BY created_at DESC, id DESC
                 LIMIT ?`,
                params
            );

            return res.status(200).json({
                message: "Audit activity retrieved successfully.",
                count: logs.length,
                filters: {
                    action: action ?? null,
                    result: result ?? null,
                    limit
                },
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
