export interface IdentifyPayload {
    email?: string | null;
    phoneNumber?: string | null;
}

export interface ReconciliationResult {
    contact: {
        primaryContatctId: number;
        emails: string[];
        phoneNumbers: string[];
        secondaryContactIds: number[];
    };
}
