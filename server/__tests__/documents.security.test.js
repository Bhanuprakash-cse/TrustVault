
const request = require("supertest");
const app = require("../app");
const db = require("../db");

describe("TrustVault document authorization", () => {
    let viewerToken;
    let adminToken;

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
});
