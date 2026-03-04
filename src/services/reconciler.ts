import type { IdentifyPayload, ReconciliationResult } from "../models/types";
import { getConnection } from "../database/connection";

/* ------------------------------------------------------------------ */
/*  Internal types                                                     */
/* ------------------------------------------------------------------ */

interface NormalizedInput {
    email: string | null;
    phoneNumber: string | null;
}

interface ContactRow {
    id: number;
    phoneNumber: string | null;
    email: string | null;
    linkedId: number | null;
    linkPrecedence: string;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
}

const LINK_PRIMARY = "primary";
const LINK_SECONDARY = "secondary";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function sanitizeInput(raw: IdentifyPayload): NormalizedInput {
    const email = raw.email?.trim().toLowerCase() ?? null;
    const phone = raw.phoneNumber?.toString().trim() ?? null;

    return {
        email: email && email.length > 0 ? email : null,
        phoneNumber: phone && phone.length > 0 ? phone : null,
    };
}

function deduplicatePreserveOrder(
    values: Array<string | null | undefined>
): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const v of values) {
        if (!v || seen.has(v)) continue;
        seen.add(v);
        result.push(v);
    }

    return result;
}

/* ------------------------------------------------------------------ */
/*  Database queries                                                   */
/* ------------------------------------------------------------------ */

async function findMatchingContacts(
    email: string | null,
    phone: string | null
): Promise<ContactRow[]> {
    if (!email && !phone) return [];

    const db = await getConnection();
    const conditions: string[] = [];
    const params: string[] = [];

    if (email) {
        conditions.push("email = ?");
        params.push(email);
    }
    if (phone) {
        conditions.push("phoneNumber = ?");
        params.push(phone);
    }

    return db.all<ContactRow[]>(
        `SELECT * FROM Contact WHERE deletedAt IS NULL AND (${conditions.join(" OR ")})`,
        params
    );
}

async function expandCluster(
    ids: number[],
    emails: string[],
    phones: string[]
): Promise<ContactRow[]> {
    const db = await getConnection();
    const conditions: string[] = [];
    const params: Array<number | string> = [];

    if (ids.length > 0) {
        const ph = ids.map(() => "?").join(",");
        conditions.push(`id IN (${ph})`);
        params.push(...ids);
        conditions.push(`linkedId IN (${ph})`);
        params.push(...ids);
    }

    if (emails.length > 0) {
        const ph = emails.map(() => "?").join(",");
        conditions.push(`email IN (${ph})`);
        params.push(...emails);
    }

    if (phones.length > 0) {
        const ph = phones.map(() => "?").join(",");
        conditions.push(`phoneNumber IN (${ph})`);
        params.push(...phones);
    }

    if (conditions.length === 0) return [];

    return db.all<ContactRow[]>(
        `SELECT * FROM Contact WHERE deletedAt IS NULL AND (${conditions.join(" OR ")})`,
        params
    );
}

async function resolveContactCluster(
    seed: ContactRow[]
): Promise<ContactRow[]> {
    const contactMap = new Map<number, ContactRow>();
    let frontier = [...seed];

    while (frontier.length > 0) {
        for (const c of frontier) contactMap.set(c.id, c);

        const allIds = new Set<number>();
        const allEmails = new Set<string>();
        const allPhones = new Set<string>();

        for (const c of contactMap.values()) {
            allIds.add(c.id);
            if (c.linkedId) allIds.add(c.linkedId);
            if (c.email) allEmails.add(c.email);
            if (c.phoneNumber) allPhones.add(c.phoneNumber);
        }

        const found = await expandCluster(
            Array.from(allIds),
            Array.from(allEmails),
            Array.from(allPhones)
        );

        const fresh = found.filter((c) => !contactMap.has(c.id));
        if (fresh.length === 0) break;

        frontier = fresh;
    }

    return Array.from(contactMap.values());
}

/* ------------------------------------------------------------------ */
/*  Mutations                                                          */
/* ------------------------------------------------------------------ */

function determinePrimaryContact(contacts: ContactRow[]): ContactRow {
    const sorted = contacts.slice().sort((a, b) => {
        const delta =
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        return delta !== 0 ? delta : a.id - b.id;
    });

    const primary = sorted[0];
    if (!primary) throw new Error("Cannot select primary from empty list");
    return primary;
}

async function consolidateLinks(
    primaryId: number,
    contacts: ContactRow[]
): Promise<void> {
    const stale = contacts
        .filter((c) => c.id !== primaryId)
        .filter(
            (c) =>
                c.linkPrecedence !== LINK_SECONDARY || c.linkedId !== primaryId
        );

    if (stale.length === 0) return;

    const db = await getConnection();
    await db.exec("BEGIN");

    try {
        for (const c of stale) {
            await db.run(
                "UPDATE Contact SET linkPrecedence = ?, linkedId = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?",
                [LINK_SECONDARY, primaryId, c.id]
            );
        }
        await db.exec("COMMIT");
    } catch (err) {
        await db.exec("ROLLBACK");
        throw err;
    }
}

async function insertContact(data: {
    email: string | null;
    phoneNumber: string | null;
    linkPrecedence: string;
    linkedId?: number | null;
}): Promise<number> {
    const db = await getConnection();

    const result = await db.run(
        `INSERT INTO Contact (email, phoneNumber, linkedId, linkPrecedence, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [data.email, data.phoneNumber, data.linkedId ?? null, data.linkPrecedence]
    );

    return result.lastID as number;
}

async function fetchClusterByPrimary(
    primaryId: number
): Promise<ContactRow[]> {
    const db = await getConnection();
    return db.all<ContactRow[]>(
        `SELECT * FROM Contact
     WHERE deletedAt IS NULL AND (id = ? OR linkedId = ?)
     ORDER BY datetime(createdAt) ASC, id ASC`,
        [primaryId, primaryId]
    );
}

/* ------------------------------------------------------------------ */
/*  Response builder                                                   */
/* ------------------------------------------------------------------ */

async function formatResponse(
    primaryId: number
): Promise<ReconciliationResult> {
    const cluster = await fetchClusterByPrimary(primaryId);

    const primary = cluster.find((c) => c.id === primaryId);
    if (!primary) throw new Error("Primary contact missing from cluster");

    const emails = deduplicatePreserveOrder([
        primary.email,
        ...cluster.map((c) => c.email),
    ]);
    const phoneNumbers = deduplicatePreserveOrder([
        primary.phoneNumber,
        ...cluster.map((c) => c.phoneNumber),
    ]);
    const secondaryContactIds = cluster
        .filter((c) => c.id !== primaryId)
        .map((c) => c.id)
        .sort((a, b) => a - b);

    return {
        contact: {
            primaryContatctId: primaryId,
            emails,
            phoneNumbers,
            secondaryContactIds,
        },
    };
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export async function reconcileContact(
    input: IdentifyPayload
): Promise<ReconciliationResult> {
    const clean = sanitizeInput(input);

    if (!clean.email && !clean.phoneNumber) {
        throw new Error("At least one of email or phoneNumber is required");
    }

    // 1. Look for contacts that share the email or phone.
    const matches = await findMatchingContacts(clean.email, clean.phoneNumber);

    // 2. No existing contact ⇒ create a fresh primary.
    if (matches.length === 0) {
        const id = await insertContact({
            email: clean.email,
            phoneNumber: clean.phoneNumber,
            linkPrecedence: LINK_PRIMARY,
        });

        return {
            contact: {
                primaryContatctId: id,
                emails: clean.email ? [clean.email] : [],
                phoneNumbers: clean.phoneNumber ? [clean.phoneNumber] : [],
                secondaryContactIds: [],
            },
        };
    }

    // 3. Resolve the full connected cluster (transitive).
    let cluster = await resolveContactCluster(matches);
    const primary = determinePrimaryContact(cluster);

    // 4. Re-point every contact in the cluster to the canonical primary.
    await consolidateLinks(primary.id, cluster);

    // 5. Refresh the cluster after link updates.
    cluster = await fetchClusterByPrimary(primary.id);

    // 6. If the request carries information not yet in the cluster, add a secondary.
    const emailPresent =
        !clean.email || cluster.some((c) => c.email === clean.email);
    const phonePresent =
        !clean.phoneNumber ||
        cluster.some((c) => c.phoneNumber === clean.phoneNumber);

    if (!emailPresent || !phonePresent) {
        await insertContact({
            email: clean.email,
            phoneNumber: clean.phoneNumber,
            linkPrecedence: LINK_SECONDARY,
            linkedId: primary.id,
        });
    }

    return formatResponse(primary.id);
}
