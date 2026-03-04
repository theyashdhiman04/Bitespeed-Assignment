import request from "supertest";
import { app } from "../src/app";
import {
    getConnection,
    setupDatabase,
    teardownDatabase,
} from "../src/database/connection";

/* ------------------------------------------------------------------ */
/*  Test helpers                                                       */
/* ------------------------------------------------------------------ */

async function seedContact(data: {
    email: string | null;
    phoneNumber: string | null;
    linkPrecedence: string;
    linkedId?: number | null;
    createdAt?: string;
}): Promise<number> {
    const db = await getConnection();
    const result = await db.run(
        `INSERT INTO Contact (email, phoneNumber, linkedId, linkPrecedence, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)`,
        [
            data.email,
            data.phoneNumber,
            data.linkedId ?? null,
            data.linkPrecedence,
            data.createdAt ?? null,
        ]
    );
    return result.lastID as number;
}

/* ------------------------------------------------------------------ */
/*  Lifecycle hooks                                                    */
/* ------------------------------------------------------------------ */

beforeAll(async () => {
    await setupDatabase();
});

beforeEach(async () => {
    const db = await getConnection();
    await db.exec("DELETE FROM Contact;");
    await db.exec("DELETE FROM sqlite_sequence WHERE name='Contact';");
});

afterAll(async () => {
    await teardownDatabase();
});

/* ------------------------------------------------------------------ */
/*  Test suite                                                         */
/* ------------------------------------------------------------------ */

describe("POST /identify", () => {
    it("creates a brand-new primary contact when no match exists", async () => {
        const res = await request(app).post("/identify").send({
            email: "new@fluxkart.com",
            phoneNumber: "111111",
        });

        expect(res.status).toBe(200);
        expect(res.body.contact.primaryContatctId).toBeDefined();
        expect(res.body.contact.emails).toEqual(["new@fluxkart.com"]);
        expect(res.body.contact.phoneNumbers).toEqual(["111111"]);
        expect(res.body.contact.secondaryContactIds).toEqual([]);
    });

    it("creates a secondary contact when a partial match carries new info", async () => {
        const primaryId = await seedContact({
            email: "lorraine@hillvalley.edu",
            phoneNumber: "123456",
            linkPrecedence: "primary",
        });

        const res = await request(app).post("/identify").send({
            email: "mcfly@hillvalley.edu",
            phoneNumber: "123456",
        });

        expect(res.status).toBe(200);
        expect(res.body.contact.primaryContatctId).toBe(primaryId);
        expect(res.body.contact.emails).toEqual([
            "lorraine@hillvalley.edu",
            "mcfly@hillvalley.edu",
        ]);
        expect(res.body.contact.phoneNumbers).toEqual(["123456"]);
        expect(res.body.contact.secondaryContactIds.length).toBe(1);
    });

    it("merges two primaries and demotes the newer one to secondary", async () => {
        const olderId = await seedContact({
            email: "george@hillvalley.edu",
            phoneNumber: "919191",
            linkPrecedence: "primary",
            createdAt: "2023-04-11 00:00:00",
        });

        const newerId = await seedContact({
            email: "biffsucks@hillvalley.edu",
            phoneNumber: "717171",
            linkPrecedence: "primary",
            createdAt: "2023-04-21 05:30:00",
        });

        const res = await request(app).post("/identify").send({
            email: "george@hillvalley.edu",
            phoneNumber: "717171",
        });

        expect(res.status).toBe(200);
        expect(res.body.contact.primaryContatctId).toBe(olderId);
        expect(res.body.contact.secondaryContactIds).toContain(newerId);
        expect(res.body.contact.emails).toEqual([
            "george@hillvalley.edu",
            "biffsucks@hillvalley.edu",
        ]);
        expect(res.body.contact.phoneNumbers).toEqual(["919191", "717171"]);
    });

    it("returns the consolidated cluster when only phoneNumber is given", async () => {
        const primaryId = await seedContact({
            email: "lorraine@hillvalley.edu",
            phoneNumber: "123456",
            linkPrecedence: "primary",
        });

        await seedContact({
            email: "mcfly@hillvalley.edu",
            phoneNumber: "123456",
            linkPrecedence: "secondary",
            linkedId: primaryId,
        });

        const res = await request(app).post("/identify").send({
            email: null,
            phoneNumber: "123456",
        });

        expect(res.status).toBe(200);
        expect(res.body.contact.primaryContatctId).toBe(primaryId);
        expect(res.body.contact.emails).toEqual([
            "lorraine@hillvalley.edu",
            "mcfly@hillvalley.edu",
        ]);
        expect(res.body.contact.phoneNumbers).toEqual(["123456"]);
    });

    it("returns the consolidated cluster when only email is given", async () => {
        const primaryId = await seedContact({
            email: "lorraine@hillvalley.edu",
            phoneNumber: "123456",
            linkPrecedence: "primary",
        });

        await seedContact({
            email: "lorraine@hillvalley.edu",
            phoneNumber: "654321",
            linkPrecedence: "secondary",
            linkedId: primaryId,
        });

        const res = await request(app).post("/identify").send({
            email: "lorraine@hillvalley.edu",
            phoneNumber: null,
        });

        expect(res.status).toBe(200);
        expect(res.body.contact.primaryContatctId).toBe(primaryId);
        expect(res.body.contact.emails).toEqual(["lorraine@hillvalley.edu"]);
        expect(res.body.contact.phoneNumbers).toEqual(["123456", "654321"]);
    });

    it("responds with 400 when the body is empty", async () => {
        const res = await request(app).post("/identify").send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toBeDefined();
    });

    it("responds with 400 when both email and phoneNumber are null", async () => {
        const res = await request(app).post("/identify").send({
            email: null,
            phoneNumber: null,
        });
        expect(res.status).toBe(400);
        expect(res.body.error).toBeDefined();
    });
});
