
const express = require("express");
const fs = require("fs");
const path = require("path");

const db = require("../db");
const { authenticateToken, allowRoles } = require("../middleware/auth");
const { writeAuditLog } = require("../utils/audit");

const router = express.Router();

const PRIVATE_DIR = path.resolve(__dirname, "..", "private_uploads");

// Every route in this file requires a logged-in admin.
router.use(authenticateToken, allowRoles("admin"));

// 1. Admin dashboard statistics
router.get("/dashboard", async (req, res) => {
    try {
        const [[userStats]] = await db.execute(
            "SELECT COUNT(*) AS totalUsers FROM users"
        );

        const [[documentStats]] = await db.execute(
            "SELECT COUNT(*) AS totalDocuments FROM documents"
        );

        const [[auditStats]] = await db.execute(
            `SELECT COUNT(*) AS totalAuditEvents,
                    SUM(CASE WHEN result = 'denied' THEN 1 ELSE 0 END) AS deniedEvents
             FROM audit_logs`
        );

        return res.status(200).json({
            message: "Admin dashboard loaded successfully.",
            stats: {
                totalUsers: Number(userStats.totalUsers),
                totalDocuments: Number(documentStats.totalDocuments),
                totalAuditEvents: Number(auditStats.totalAuditEvents || 0),
                deniedEvents: Number(auditStats.deniedEvents || 0)
            }
        });
    } catch (error) {
        console.error("Admin dashboard error:", error.message);
        return res.status(500).json({
            message: "Internal server error."
        });
    }
});

// 2. List every user's documents
router.get("/documents", async (req, res) => {
    try {
        const [documents] = await db.execute(
            `SELECT
                d.id,
                d.owner_id,
                d.name,
                d.category,
                d.mime_type,
                d.size_bytes,
                d.created_at,
                u.name AS owner_name,
                u.email AS owner_email
             FROM documents d
             LEFT JOIN users u ON u.id = d.owner_id
             ORDER BY d.id DESC`
        );

        return res.status(200).json({
            message: "All documents retrieved successfully.",
            count: documents.length,
            documents
        });
    } catch (error) {
        console.error("Admin documents error:", error.message);
        return res.status(500).json({
            message: "Internal server error."
        });
    }
});

// 3. Read document metadata
router.get("/documents/:id", async (req, res) => {
    try {
        const documentId = Number(req.params.id);

        if (!Number.isSafeInteger(documentId) || documentId <= 0) {
            return res.status(400).json({
                message: "Invalid document ID."
            });
        }

        const [rows] = await db.execute(
            `SELECT
                d.id,
                d.owner_id,
                d.name,
                d.category,
                d.mime_type,
                d.size_bytes,
                d.created_at,
                u.name AS owner_name,
                u.email AS owner_email
             FROM documents d
             LEFT JOIN users u ON u.id = d.owner_id
             WHERE d.id = ?`,
            [documentId]
        );

        if (rows.length === 0) {
            await writeAuditLog({
                actorUserId: req.user.id,
                documentId,
                action: "admin_document_read",
                result: "denied",
                details: { reason: "Document not found" }
            });

            return res.status(404).json({
                message: "Document not found."
            });
        }

        await writeAuditLog({
            actorUserId: req.user.id,
            documentId,
            action: "admin_document_read",
            result: "success",
            details: { documentName: rows[0].name }
        });

        return res.status(200).json({
            message: "Document details retrieved successfully.",
            document: rows[0]
        });
    } catch (error) {
        console.error("Admin document read error:", error.message);
        return res.status(500).json({
            message: "Internal server error."
        });
    }
});

// 4. Download any user's document
router.get("/documents/:id/download", async (req, res) => {
    try {
        const documentId = Number(req.params.id);

        if (!Number.isSafeInteger(documentId) || documentId <= 0) {
            return res.status(400).json({
                message: "Invalid document ID."
            });
        }

        const [rows] = await db.execute(
            `SELECT id, name, storage_key, mime_type
             FROM documents
             WHERE id = ?`,
            [documentId]
        );

        if (rows.length === 0) {
            await writeAuditLog({
                actorUserId: req.user.id,
                documentId,
                action: "admin_document_download",
                result: "denied",
                details: { reason: "Document not found" }
            });

            return res.status(404).json({
                message: "Document not found."
            });
        }

        const document = rows[0];
        const filename = path.basename(document.storage_key);
        const filePath = path.resolve(PRIVATE_DIR, filename);

        // Ensure the requested file remains inside private storage.
        if (path.dirname(filePath) !== PRIVATE_DIR) {
            return res.status(400).json({
                message: "Invalid file path."
            });
        }

        
if (!fs.existsSync(filePath)) {
    await writeAuditLog({
        actorUserId: req.user.id,
        documentId,
        action: "admin_document_download",
        result: "denied",
        details: {
            reason: "Stored file not found",
            documentName: document.name
        }
    });

    return res.status(404).json({
        message: "Stored file not found."
    });
}


        await writeAuditLog({
            actorUserId: req.user.id,
            documentId,
            action: "admin_document_download",
            result: "success",
            details: { documentName: document.name }
        });

        return res.download(filePath, filename);
    } catch (error) {
        console.error("Admin document download error:", error.message);
        if (!res.headersSent) {
            return res.status(500).json({
                message: "Internal server error."
            });
        }
    }
});

// 5. Delete a document and preserve its audit history
router.delete("/documents/:id", async (req, res) => {
    let connection;
    let document;
    let documentId;

    try {
        documentId = Number(req.params.id);

        if (!Number.isSafeInteger(documentId) || documentId <= 0) {
            return res.status(400).json({
                message: "Invalid document ID."
            });
        }

        const [rows] = await db.execute(
            `SELECT id, name, storage_key
             FROM documents
             WHERE id = ?`,
            [documentId]
        );

        if (rows.length === 0) {
            await writeAuditLog({
                actorUserId: req.user.id,
                documentId,
                action: "admin_document_delete",
                result: "denied",
                details: { reason: "Document not found" }
            });

            return res.status(404).json({
                message: "Document not found."
            });
        }

        document = rows[0];
        connection = await db.getConnection();
        await connection.beginTransaction();

        // Keep previous audit events, recording the deleted document ID
        // in their details before removing the document relationship.
        await connection.execute(
            `UPDATE audit_logs
             SET details = JSON_SET(
                    COALESCE(details, JSON_OBJECT()),
                    '$.deleted_document_id',
                    ?
                 ),
                 document_id = NULL
             WHERE document_id = ?`,
            [documentId, documentId]
        );

        await connection.execute(
            "DELETE FROM document_permissions WHERE document_id = ?",
            [documentId]
        );

        await connection.execute(
            "DELETE FROM documents WHERE id = ?",
            [documentId]
        );

        await connection.commit();
        connection.release();
        connection = null;

        // Remove the private file after the database transaction succeeds.
        const filename = path.basename(document.storage_key);
        const filePath = path.resolve(PRIVATE_DIR, filename);
        let fileRemoved = true;

        if (path.dirname(filePath) === PRIVATE_DIR) {
            try {
                await fs.promises.unlink(filePath);
            } catch (fileError) {
                if (fileError.code !== "ENOENT") {
                    fileRemoved = false;
                    console.error("Private file cleanup failed:", fileError.message);
                }
            }
        } else {
            fileRemoved = false;
        }

        await writeAuditLog({
            actorUserId: req.user.id,
            documentId: null,
            action: "admin_document_delete",
            result: "success",
            details: {
                deletedDocumentId: documentId,
                documentName: document.name,
                fileRemoved
            }
        });

        return res.status(200).json({
            message: "Document deleted successfully.",
            deletedDocumentId: documentId,
            fileRemoved
        });
    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error("Rollback failed:", rollbackError.message);
            }
            connection.release();
        }

        console.error("Admin document delete error:", error.message);

        if (!res.headersSent) {
            return res.status(500).json({
                message: "Internal server error."
            });
        }
    }
});

module.exports = router;
