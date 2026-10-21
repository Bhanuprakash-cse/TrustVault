
const request = require("supertest");
const app = require("../app");
const db = require("../db");

describe("TrustVault document authorization", () => {
    let viewerToken;

    beforeAll(async () => {
        const response = await request(app)
            .post("/api/auth/login")
            .send({
                email: "viewer2@example.com",
                password: "TestPass456!"
            });

        expect(response.statusCode).toBe(200);
        expect(response.body.token).toBeDefined();

        viewerToken = response.body.token;
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

    afterAll(async () => {
        await db.end();
    });
});
