import type { Express, Request, Response } from "express";
import { subscribe, DashboardEvent } from "./events";

const HEARTBEAT_MS = 15_000;

export function registerSse(app: Express): void {
    app.get("/api/stream", (req: Request, res: Response) => {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no"); // disable proxy buffering on Nginx/Railway
        res.flushHeaders();

        // Initial comment so the browser immediately considers the connection open.
        res.write(": connected\n\n");

        const send = (ev: DashboardEvent) => {
            // Guard against writes after close (can happen on fast disconnect).
            if (res.writableEnded || res.destroyed) return;
            res.write(`event: ${ev.type}\n`);
            res.write(`data: ${JSON.stringify(ev.data)}\n\n`);
        };

        const unsubscribe = subscribe(send);

        const heartbeat = setInterval(() => {
            if (res.writableEnded || res.destroyed) { clearInterval(heartbeat); return; }
            res.write(": heartbeat\n\n");
        }, HEARTBEAT_MS);

        const cleanup = () => {
            clearInterval(heartbeat);
            unsubscribe();
        };

        req.on("close", cleanup);
        res.on("close", cleanup);
    });
}
