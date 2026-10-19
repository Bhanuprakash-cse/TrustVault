
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const db = require("./db");

const app = express();

const authRoutes = require("./routes/auth");

app.use(helmet());

app.use(
    cors({
        origin: process.env.FRONTEND_URL || "http://localhost:5173"
    })
);

app.use(express.json({ limit: "100kb" }));

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

module.exports = app;
