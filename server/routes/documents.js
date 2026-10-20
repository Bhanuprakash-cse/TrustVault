
const express = require("express");
const db = require("../db");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

const { writeAuditLog } = require("../utils/audit");

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");

// Every document route requires a valid login.
router.use(authenticateToken);


const PRIVATE_DIR = path.join(__dirname, "..", "private_uploads");

fs.mkdirSync(PRIVATE_DIR, { recursive: true });

const allowedTypes = {
    "application/pdf": ".pdf",
    "text/plain": ".txt",
    "image/jpeg": ".jpg",
    "image/png": ".png"
};

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, callback) => {
            callback(null, PRIVATE_DIR);
        },
        filename: (req, file, callback) => {
            const extension = allowedTypes[file.mimetype];
            callback(null, crypto.randomUUID() + extension);
        }
    }),
    limits: {
        fileSize: 5 * 1024 * 1024,
        files: 1
    },
    fileFilter: (req, file, callback) => {
        if (!allowedTypes[file.mimetype]) {
            return callback(
                new Error("Only PDF, TXT, JPEG and PNG files are allowed.")
            );
        }

        callback(null, true);
    }
});

function handleUpload(req, res, next) {
    upload.single("file")(req, res, (error) => {
        if (error) {
            const isSizeError = error.code === "LIMIT_FILE_SIZE";

            return res.status(isSizeError ? 413 : 400).json({
                message: isSizeError
                    ? "File size must not exceed 5 MB."
                    : error.message || "Invalid file upload."
            });
        }

        next();
    });
}


// Find a document and check the current user's access.
async function getDocumentAccess(documentId, userId) {
    
    const [documents] = await db.execute(
        `SELECT id, owner_id, name, category, storage_key,
                mime_type, size_bytes, created_at, updated_at
        FROM documents
        WHERE id = ?`,
        [documentId]
    );


    if (documents.length === 0) {
        return { status: "not_found" };
    }

    const document = documents[0];

    if (String(document.owner_id) === String(userId)) {
        return {
            status: "allowed",
            document,
            permission: "owner"
        };
    }

    const [permissions] = await db.execute(
        `SELECT permission
         FROM document_permissions
         WHERE document_id = ? AND user_id = ?`,
        [documentId, userId]
    );

    if (permissions.length === 0) {
        return { status: "denied" };
    }

    return {
        status: "allowed",
        document,
        permission: permissions[0].permission
    };
}

// Only the document owner or an admin can manage permissions.
async function canManagePermissions(documentId, user) {
    const [documents] = await db.execute(
        `SELECT id, owner_id
         FROM documents
         WHERE id = ?`,
        [documentId]
    );

    if (documents.length === 0) {
        return { status: "not_found" };
    }

    const document = documents[0];

    if (
        user.role === "admin" ||
        String(document.owner_id) === String(user.id)
    ) {
        return { status: "allowed", document };
    }

    return { status: "denied" };
}

// GET /api/documents/:id
// Owner, read permission, or edit permission can view metadata.


router.post("/upload", handleUpload, async (req, res) => {
    let documentId = null;

    try {
        if (!req.file) {
            return res.status(400).json({
                message: "Please select a file to upload."
            });
        }

        const name = (
            typeof req.body.name === "string" && req.body.name.trim()
                ? req.body.name.trim()
                : path.basename(req.file.originalname, path.extname(req.file.originalname))
        );

        const category =
            typeof req.body.category === "string" && req.body.category.trim()
                ? req.body.category.trim()
                : null;

        if (
            !name ||
            name.length > 255 ||
            (category && category.length > 100)
        ) {
            await fs.promises.unlink(req.file.path).catch(() => {});

            return res.status(400).json({
                message: "Invalid document name or category."
            });
        }

        const storageKey = req.file.filename;

        const [result] = await db.execute(
            `INSERT INTO documents
                (owner_id, name, category, storage_key, mime_type, size_bytes)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                req.user.id,
                name,
                category,
                storageKey,
                req.file.mimetype,
                req.file.size
            ]
        );

        documentId = result.insertId;

        try {
            await writeAuditLog({
                actorUserId: req.user.id,
                documentId,
                action: "document_upload",
                result: "success",
                details: {
                    name,
                    mimeType: req.file.mimetype,
                    sizeBytes: req.file.size
                }
            });
        } catch (auditError) {
            // Don't leave a successful upload without its audit record.
            await db.execute(
                "DELETE FROM documents WHERE id = ?",
                [documentId]
            );

            await fs.promises.unlink(req.file.path).catch(() => {});

            throw auditError;
        }

        return res.status(201).json({
            message: "Document uploaded successfully.",
            document: {
                id: documentId,
                owner_id: req.user.id,
                name,
                category,
                mime_type: req.file.mimetype,
                size_bytes: req.file.size
            }
        });
    } catch (error) {
        console.error("Document upload failed:", error.message);

        if (req.file) {
            await fs.promises.unlink(req.file.path).catch(() => {});
        }

        return res.status(500).json({
            message: "Document upload failed."
        });
    }
});



 // GET document metadata
router.get("/:id", async (req, res) => {
    try {
        const access = await getDocumentAccess(
            req.params.id,
            req.user.id
        );

        if (access.status === "not_found") {
            return res.status(404).json({
                message: "Document not found."
            });
        }

        if (access.status === "denied") {
            await writeAuditLog({
                actorUserId: req.user.id,
                documentId: req.params.id,
                action: "document_read",
                result: "denied",
                details: {
                    reason: "Insufficient document permissions"
                }
            });

            return res.status(403).json({
                message: "You do not have permission to view this document."
            });
        }

        return res.json({
            document: access.document
        });
    } catch (error) {
        console.error("Document read failed:", error.message);

        return res.status(500).json({
            message: "Internal server error."
        });
    }
});

// GET /api/documents/:id/download
router.get("/:id/download", async (req, res) => {
    try {
        const access = await getDocumentAccess(
            req.params.id,
            req.user.id
        );

        if (access.status === "not_found") {
            return res.status(404).json({
                message: "Document not found."
            });
        }

        if (access.status === "denied") {
            await writeAuditLog({
                actorUserId: req.user.id,
                documentId: req.params.id,
                action: "document_download",
                result: "denied",
                details: {
                    reason: "Insufficient document permissions"
                }
            });

            return res.status(403).json({
                message: "You do not have permission to download this document."
            });
        }

        const filename = path.basename(access.document.storage_key);
        const filePath = path.resolve(PRIVATE_DIR, filename);

        if (path.dirname(filePath) !== path.resolve(PRIVATE_DIR)) {
            return res.status(400).json({
                message: "Invalid document storage path."
            });
        }

        try {
            await fs.promises.access(filePath, fs.constants.R_OK);
        } catch {
            return res.status(404).json({
                message: "Stored file not found."
            });
        }

        await writeAuditLog({
            actorUserId: req.user.id,
            documentId: access.document.id,
            action: "document_download",
            result: "success",
            details: {}
        });

        return res.download(filePath, filename, (error) => {
            if (error) {
                console.error("Download delivery failed:", error.message);

                if (!res.headersSent) {
                    res.status(500).json({
                        message: "Download failed."
                    });
                }
            }
        });
    } catch (error) {
        console.error("Document download failed:", error.message);

        if (!res.headersSent) {
            return res.status(500).json({
                message: "Internal server error."
            });
        }
    }
});


// PATCH /api/documents/:id
// Owner or a user with edit permission can update metadata.
router.patch("/:id", async (req, res) => {
    try {
        const { name, category } = req.body;

        if (
            (name !== undefined &&
                (typeof name !== "string" ||
                 !name.trim() ||
                 name.trim().length > 255)) ||
            (category !== undefined &&
                category !== null &&
                (typeof category !== "string" ||
                 category.trim().length > 100))
        ) {
            return res.status(400).json({
                message: "Invalid document name or category."
            });
        }

        if (name === undefined && category === undefined) {
            return res.status(400).json({
                message: "Provide a name or category to update."
            });
        }

        const access = await getDocumentAccess(
            req.params.id,
            req.user.id
        );

        if (access.status === "not_found") {
            return res.status(404).json({
                message: "Document not found."
            });
        }

        if (
            access.status === "denied" ||
            (access.permission !== "owner" &&
            access.permission !== "edit")
        ) {
    await writeAuditLog({
        actorUserId: req.user.id,
        documentId: req.params.id,
        action: "document_edit",
        result: "denied",
        details: {
            reason: "Insufficient document permissions"
        }
    });

    return res.status(403).json({
        message: "You do not have permission to edit this document."
    });
}

        const newName =
            name === undefined ? access.document.name : name.trim();

        const newCategory =
            category === undefined
                ? access.document.category
                : (category === null || !category.trim()
                    ? null
                    : category.trim());

        await db.execute(
            `UPDATE documents
             SET name = ?, category = ?
             WHERE id = ?`,
            [newName, newCategory, req.params.id]
        );

        const updatedAccess = await getDocumentAccess(
            req.params.id,
            req.user.id
        );

        return res.json({
            message: "Document metadata updated successfully.",
            document: updatedAccess.document
        });
    } catch (error) {
        console.error("Document update failed:", error.message);

        return res.status(500).json({
            message: "Internal server error."
        });
    }
});

// POST /api/documents/:id/permissions
// Body: { "userId": 2, "permission": "read" }
// Body: { "userId": 2, "permission": "edit" }
router.post("/:id/permissions", async (req, res) => {
    try {
        const userId = Number(req.body.userId);
        const { permission } = req.body;

        if (
            !Number.isSafeInteger(userId) ||
            userId <= 0 ||
            !["read", "edit"].includes(permission)
        ) {
            return res.status(400).json({
                message: "Provide a valid userId and permission (read or edit)."
            });
        }

        const access = await canManagePermissions(
            req.params.id,
            req.user
        );

        if (access.status === "not_found") {
            return res.status(404).json({
                message: "Document not found."
            });
        }

        if (access.status === "denied") {
            return res.status(403).json({
                message: "Only the document owner or an admin can manage permissions."
            });
        }

        const [users] = await db.execute(
            "SELECT id FROM users WHERE id = ?",
            [userId]
        );

        if (users.length === 0) {
            return res.status(404).json({
                message: "Target user not found."
            });
        }

        // Avoid redundant permission records for the owner.
        if (String(access.document.owner_id) === String(userId)) {
            return res.status(400).json({
                message: "The document owner already has full access."
            });
        }

        // Insert a new permission or update the existing one.
        await db.execute(
            `INSERT INTO document_permissions
                (document_id, user_id, permission, granted_by)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                permission = VALUES(permission),
                granted_by = VALUES(granted_by),
                created_at = CURRENT_TIMESTAMP`,
            [
                access.document.id,
                userId,
                permission,
                req.user.id
            ]
        );

        await writeAuditLog({
            actorUserId: req.user.id,
            documentId: access.document.id,
            action: "permission_grant",
            result: "success",
        details: {
            targetUserId: userId,
            permission
        }
        });

        

        return res.status(200).json({
            message: "Document permission granted successfully.",
            documentId: access.document.id,
            userId,
            permission
        });
    } catch (error) {
        console.error("Permission grant failed:", error.message);

        return res.status(500).json({
            message: "Internal server error."
        });
    }
});

// DELETE /api/documents/:id/permissions/:userId
router.delete("/:id/permissions/:userId", async (req, res) => {
    try {
        const userId = Number(req.params.userId);

        if (!Number.isSafeInteger(userId) || userId <= 0) {
            return res.status(400).json({
                message: "Invalid user ID."
            });
        }

        const access = await canManagePermissions(
            req.params.id,
            req.user
        );

        if (access.status === "not_found") {
            return res.status(404).json({
                message: "Document not found."
            });
        }

        if (access.status === "denied") {
            return res.status(403).json({
                message: "Only the document owner or an admin can manage permissions."
            });
        }

        const [result] = await db.execute(
            `DELETE FROM document_permissions
             WHERE document_id = ? AND user_id = ?`,
            [access.document.id, userId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                message: "Permission record not found."
            });
        }

        await writeAuditLog({
            actorUserId: req.user.id,
            documentId: access.document.id,
            action: "permission_revoke",
            result: "success",
        details: {
            targetUserId: userId
    }
});

        return res.json({
            message: "Document permission revoked successfully.",
            documentId: access.document.id,
            userId
        });
    } catch (error) {
        console.error("Permission revocation failed:", error.message);

        return res.status(500).json({
            message: "Internal server error."
        });
    }
});

module.exports = router;
