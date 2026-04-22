import express, { Request, Response, NextFunction, Express } from "express";
import path from "path";
import { config } from "../config";
import { registerApi } from "./api";
import { registerSse } from "./sse";

function authRequired(): boolean {
    if (process.env.DASHBOARD_AUTH_ENABLED === "true") return true;
    if (process.env.DASHBOARD_AUTH_ENABLED === "false") return false;
    if (config.dashboard.auth_required) return true;
    return process.env.NODE_ENV === "production";
}

function basicAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (!authRequired()) { next(); return; }

    const user = process.env.DASHBOARD_USER;
    const pass = process.env.DASHBOARD_PASSWORD;
    if (!user || !pass) {
        res.status(503).send("Dashboard auth required but DASHBOARD_USER / DASHBOARD_PASSWORD not set");
        return;
    }

    const header = req.headers.authorization;
    if (!header?.startsWith("Basic ")) {
        res.setHeader("WWW-Authenticate", 'Basic realm="ubiquitous dashboard"');
        res.status(401).send("Authentication required");
        return;
    }

    let decoded: string;
    try {
        decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    } catch {
        res.status(400).send("Malformed Authorization header");
        return;
    }

    const sep = decoded.indexOf(":");
    const providedUser = sep === -1 ? decoded : decoded.slice(0, sep);
    const providedPass = sep === -1 ? "" : decoded.slice(sep + 1);

    if (providedUser !== user || providedPass !== pass) {
        res.setHeader("WWW-Authenticate", 'Basic realm="ubiquitous dashboard"');
        res.status(401).send("Invalid credentials");
        return;
    }

    next();
}

export function buildApp(): Express {
    const app = express();
    app.disable("x-powered-by");
    app.use(basicAuthMiddleware);

    // SSE must be registered before `express.json()` would consume the request body —
    // SSE has no body anyway but routes with res streaming are kept separate for clarity.
    registerSse(app);
    app.use(express.json());
    registerApi(app);

    // Static frontend. `public/` lives at the repo root so the same path resolves
    // both in dev (ts-node, cwd = repo root) and in prod (node dist/index.js, cwd = repo root).
    const staticDir = path.resolve(process.cwd(), "public");
    app.use(express.static(staticDir));

    // Fallback: any unmatched GET to the root falls back to index.html (single-page shell).
    app.get("/", (_req, res) => {
        res.sendFile(path.join(staticDir, "index.html"));
    });

    return app;
}

export async function startDashboard(port: number): Promise<void> {
    const app = buildApp();
    await new Promise<void>((resolve, reject) => {
        const server = app.listen(port, () => {
            console.log(`📊 [Dashboard] listening on http://localhost:${port}` +
                (authRequired() ? " (basic auth enabled)" : ""));
            resolve();
        });
        server.on("error", reject);
    });
}
