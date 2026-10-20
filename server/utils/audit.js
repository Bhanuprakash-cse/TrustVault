
const db = require("../db");

async function writeAuditLog({
    actorUserId = null,
    documentId = null,
    action,
    result,
    details = {}
}) {
    try {
        await db.execute(
            `INSERT INTO audit_logs
                (actor_user_id, document_id, action, result, details)
             VALUES (?, ?, ?, ?, ?)`,
            [
                actorUserId,
                documentId,
                action,
                result,
                JSON.stringify(details)
            ]
        );
    } catch (error) {
        // Do not silently pretend the audit record was saved.
        console.error("CRITICAL: Audit log write failed:", error.message);
        throw error;
    }
}

module.exports = { writeAuditLog };
