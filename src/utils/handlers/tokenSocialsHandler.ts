import axios from "axios";

export interface TokenSocials {
    twitter: string | null;
    telegram: string | null;
    website: string | null;
    description: string | null;
    image: string | null;
}

const FETCH_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 64 * 1024;

/**
 * Fetch a pump.fun token's off-chain metadata JSON and extract social handles.
 * Returns null on any HTTP / parse failure (the callers treat "no socials" as normal).
 */
export async function fetchSocials(uri: string): Promise<TokenSocials | null> {
    if (!uri || !/^https?:\/\//i.test(uri)) return null;

    try {
        const res = await axios.get(uri, {
            timeout: FETCH_TIMEOUT_MS,
            responseType: "json",
            maxContentLength: MAX_RESPONSE_BYTES,
            validateStatus: (s) => s >= 200 && s < 300,
        });
        const data: any = res.data;
        if (!data || typeof data !== "object") return null;

        return {
            twitter: typeof data.twitter === "string" ? data.twitter : null,
            telegram: typeof data.telegram === "string" ? data.telegram : null,
            website: typeof data.website === "string" ? data.website : null,
            description: typeof data.description === "string" ? data.description.slice(0, 500) : null,
            image: typeof data.image === "string" ? data.image : null,
        };
    } catch {
        return null;
    }
}

// Tiny bounded concurrency helper so a burst of creations doesn't open 200 sockets at once.
let inFlight = 0;
const queue: Array<() => void> = [];
const MAX_CONCURRENT = 8;

export async function fetchSocialsQueued(uri: string): Promise<TokenSocials | null> {
    await new Promise<void>((resolve) => {
        if (inFlight < MAX_CONCURRENT) { inFlight++; resolve(); }
        else queue.push(() => { inFlight++; resolve(); });
    });
    try {
        return await fetchSocials(uri);
    } finally {
        inFlight--;
        const next = queue.shift();
        if (next) next();
    }
}
