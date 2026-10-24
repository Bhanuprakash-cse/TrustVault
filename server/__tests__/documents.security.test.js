
const request = require("supertest");
const app = require("../app");
const db = require("../db");
const fs = require("fs");
const path = require("path");
const os = require("os");

describe("TrustVault document authorization", () => {
    let viewerToken;
    let adminToken;

        const PRIVATE_DIR = path.join(
        __dirname,
        "..",
        "private_uploads"
    );

    const temporaryFiles = [];

    async function createTemporaryFile(name, content) {
        const filePath = path.join(os.tmpdir(), name);

        await fs.promises.writeFile(filePath, content);
        temporaryFiles.push(filePath);

        return filePath;
    }
    beforeAll(async () => {
        const viewerLogin = await request(app)
            .post("/api/auth/login")
            .send({
                email: "viewer2@example.com",
                password: "TestPass456!"
            });

        expect(viewerLogin.statusCode).toBe(200);
        viewerToken = viewerLogin.body.token;

        const adminEmail = process.env.TEST_ADMIN_EMAIL;
        const adminPassword = process.env.TEST_ADMIN_PASSWORD;

        if (!adminEmail || !adminPassword) {
            throw new Error(
                "Set TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD before running tests."
            );
        }

        const adminLogin = await request(app)
            .post("/api/auth/login")
            .send({
                email: adminEmail,
                password: adminPassword
            });

        expect(adminLogin.statusCode).toBe(200);
        expect(adminLogin.body.user.role).toBe("admin");

        adminToken = adminLogin.body.token;
    });

    test("unauthorized user cannot read another user's document", async () => {
        const response = await request(app)
            .get("/api/documents/2")
            .set("Authorization", `Bearer ${viewerToken}`);

        expect(response.statusCode).toBe(403);
    });

    test("unauthorized user cannot download another user's document", async () => {
        const response = await request(app)
            .get("/api/documents/2/download")
            .set("Authorization", `Bearer ${viewerToken}`);

        expect(response.statusCode).toBe(403);
    });

    test("unauthenticated users cannot access admin audit logs", async () => {
        const response = await request(app)
            .get("/api/admin/audit-logs");

        expect(response.statusCode).toBe(401);
    });

    test("viewer cannot access admin audit logs", async () => {
        const response = await request(app)
            .get("/api/admin/audit-logs")
            .set("Authorization", `Bearer ${viewerToken}`);

        expect(response.statusCode).toBe(403);
    });

    test("admin can access audit logs", async () => {
        const response = await request(app)
            .get("/api/admin/audit-logs")
            .set("Authorization", `Bearer ${adminToken}`);

        expect(response.statusCode).toBe(200);
        expect(response.body.message).toBe(
            "Audit activity retrieved successfully."
        );
        expect(response.body.logs).toBeInstanceOf(Array);
        expect(response.body.count).toBe(response.body.logs.length);
    });


    test("rejects a text file disguised as a PDF", async () => {
        const filePath = await createTemporaryFile(
            `fake-${Date.now()}.pdf`,
            "This is not a real PDF file."
        );

        const response = await request(app)
            .post("/api/documents/upload")
            .set("Authorization", `Bearer ${adminToken}`)
            .attach("file", filePath)
            .field("name", "Fake PDF test");

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe(
            "File contents do not match the allowed file type."
        );
    });

    test("rejects an invalid PNG file", async () => {
        const filePath = await createTemporaryFile(
            `fake-${Date.now()}.png`,
            "This is not a real PNG file."
        );

        const response = await request(app)
            .post("/api/documents/upload")
            .set("Authorization", `Bearer ${adminToken}`)
            .attach("file", filePath, {
                filename: "fake.png",
                contentType: "image/png"
            });

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe(
            "File contents do not match the allowed file type."
        );
    });

    test("accepts a valid UTF-8 text file", async () => {
        const filePath = await createTemporaryFile(
            `valid-${Date.now()}.txt`,
            "TrustVault security test: valid UTF-8 text."
        );

        const response = await request(app)
            .post("/api/documents/upload")
            .set("Authorization", `Bearer ${adminToken}`)
            .attach("file", filePath, {
                filename: "valid.txt",
                contentType: "text/plain"
            })
            .field("name", "Automated upload test");

        expect(response.statusCode).toBe(201);
        expect(response.body.document.mime_type).toBe("text/plain");

        const documentId = response.body.document.id;

        // Remove the test document and its stored file.
        const [rows] = await db.execute(
            "SELECT storage_key FROM documents WHERE id = ?",
            [documentId]
        );

        if (rows.length > 0) {
            await db.execute(
                "DELETE FROM audit_logs WHERE document_id = ?",
                [documentId]
            );

            await db.execute(
                "DELETE FROM documents WHERE id = ?",
                [documentId]
            );

            await fs.promises.unlink(
                path.join(PRIVATE_DIR, rows[0].storage_key)
            ).catch(() => {});
        }
    });

    afterEach(async () => {
        for (const filePath of temporaryFiles.splice(0)) {
            await fs.promises.unlink(filePath).catch(() => {});
        }
    });



test("admin failed download of a missing stored file is audited", async () => {
    const response = await request(app)
        .get("/api/admin/documents/1/download")
        .set("Authorization", `Bearer ${adminToken}`);

    expect(response.statusCode).toBe(404);
    expect(response.body.message).toBe("Stored file not found.");

    const [logs] = await db.execute(
        `SELECT result, details
         FROM audit_logs
         WHERE actor_user_id = (
             SELECT id FROM users WHERE email = ?
         )
         AND document_id = 1
         AND action = 'admin_document_download'
         ORDER BY id DESC
         LIMIT 1`,
        [process.env.TEST_ADMIN_EMAIL]
    );

    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].result).toBe("denied");

    const details = typeof logs[0].details === "string"
        ? JSON.parse(logs[0].details)
        : logs[0].details;

    expect(details.reason).toBe("Stored file not found");
});


    test("admin can filter denied document downloads", async () => {
        const response = await request(app)
            .get(
                "/api/admin/audit-logs?action=document_download&result=denied&limit=10"
            )
            .set("Authorization", `Bearer ${adminToken}`);

        expect(response.statusCode).toBe(200);
        expect(response.body.filters).toEqual({
            action: "document_download",
            result: "denied",
            limit: 10
        });

        expect(response.body.logs.length).toBeLessThanOrEqual(10);

        for (const log of response.body.logs) {
            expect(log.action).toBe("document_download");
            expect(log.result).toBe("denied");
        }
    });

    test("invalid limit is rejected", async () => {
        const response = await request(app)
            .get("/api/admin/audit-logs?limit=abc")
            .set("Authorization", `Bearer ${adminToken}`);

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe(
            "Limit must be a positive integer."
        );
    });

    test("invalid result filter is rejected", async () => {
        const response = await request(app)
            .get("/api/admin/audit-logs?result=unknown")
            .set("Authorization", `Bearer ${adminToken}`);

        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe(
            "Result must be success or denied."
        );
    });

    afterAll(async () => {
        await db.end();
    });

        describe("Document permission management", () => {
        const documentId = 5;
        const targetUserId = 2;

        afterEach(async () => {
            // Keep this test document's permission state clean.
            await db.execute(
                `DELETE FROM document_permissions
                 WHERE document_id = ? AND user_id = ?`,
                [documentId, targetUserId]
            );
        });

        test("admin can grant read permission to a viewer", async () => {
            const response = await request(app)
                .post(`/api/documents/${documentId}/permissions`)
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    userId: targetUserId,
                    permission: "read"
                });

            expect(response.statusCode).toBe(200);
            expect(response.body.permission).toBe("read");

            const [rows] = await db.execute(
                `SELECT permission FROM document_permissions
                 WHERE document_id = ? AND user_id = ?`,
                [documentId, targetUserId]
            );

            expect(rows).toHaveLength(1);
            expect(rows[0].permission).toBe("read");
        });

        test("admin can update read permission to edit", async () => {
            await db.execute(
                `INSERT INTO document_permissions
                    (document_id, user_id, permission, granted_by)
                 VALUES (?, ?, 'read', ?)
                 ON DUPLICATE KEY UPDATE permission = 'read'`,
                [documentId, targetUserId, 3]
            );

            const response = await request(app)
                .post(`/api/documents/${documentId}/permissions`)
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    userId: targetUserId,
                    permission: "edit"
                });

            expect(response.statusCode).toBe(200);
            expect(response.body.permission).toBe("edit");
        });

        test("admin can revoke a viewer's permission", async () => {
            await db.execute(
                `INSERT INTO document_permissions
                    (document_id, user_id, permission, granted_by)
                 VALUES (?, ?, 'read', ?)
                 ON DUPLICATE KEY UPDATE permission = 'read'`,
                [documentId, targetUserId, 3]
            );

            const response = await request(app)
                .delete(
                    `/api/documents/${documentId}/permissions/${targetUserId}`
                )
                .set("Authorization", `Bearer ${adminToken}`);

            expect(response.statusCode).toBe(200);

            const [rows] = await db.execute(
                `SELECT id FROM document_permissions
                 WHERE document_id = ? AND user_id = ?`,
                [documentId, targetUserId]
            );

            expect(rows).toHaveLength(0);
        });

        test("viewer cannot grant permissions", async () => {
            const response = await request(app)
                .post(`/api/documents/${documentId}/permissions`)
                .set("Authorization", `Bearer ${viewerToken}`)
                .send({
                    userId: targetUserId,
                    permission: "read"
                });

            expect(response.statusCode).toBe(403);
        });

        test("admin cannot grant document permission to another admin", async () => {
            const response = await request(app)
                .post(`/api/documents/${documentId}/permissions`)
                .set("Authorization", `Bearer ${adminToken}`)
                .send({
                    userId: 3,
                    permission: "read"
                });

            expect(response.statusCode).toBe(400);
        });
    });
});
