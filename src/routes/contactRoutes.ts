import { Router } from "express";
import { z } from "zod";
import { reconcileContact } from "../services/reconciler";

const requestSchema = z
    .object({
        email: z.string().trim().min(1).optional().nullable(),
        phoneNumber: z.union([z.string(), z.number()]).optional().nullable(),
    })
    .refine((data) => Boolean(data.email ?? data.phoneNumber), {
        message: "At least one of email or phoneNumber must be provided",
    });

export const contactRouter = Router();

contactRouter.post("/identify", async (req, res) => {
    const result = requestSchema.safeParse(req.body);

    if (!result.success) {
        return res
            .status(400)
            .json({ error: result.error.issues[0]?.message ?? "Invalid request" });
    }

    try {
        const payload = {
            email: result.data.email ?? null,
            phoneNumber: result.data.phoneNumber?.toString() ?? null,
        };

        const response = await reconcileContact(payload);
        return res.status(200).json(response);
    } catch (err) {
        return res.status(500).json({
            error: err instanceof Error ? err.message : "Internal server error",
        });
    }
});
