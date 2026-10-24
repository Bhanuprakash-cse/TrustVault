
require("dotenv").config();

const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const dbConfig = {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || "trustvault",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

if (process.env.DB_SSL === "true") {
    const caPath = path.join(__dirname, "ca.pem");

    dbConfig.ssl = {
        ca: fs.readFileSync(caPath, "utf8"),
        rejectUnauthorized: true
    };
}

const db = mysql.createPool(dbConfig);

module.exports = db;
