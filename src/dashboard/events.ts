import { EventEmitter } from "events";
import type { Verdict } from "../tracker/riskDb";

export interface TradeEventPayload {
    mint: string;
    progress: number;
    isBuy: boolean;
    realSol: number;
    realTok: number;
    tradeCount: number;
    timestamp: number;
    name: string | null;
    symbol: string | null;
}

export interface VerdictEventPayload {
    mint: string;
    verdict: Verdict;
    reason: string | null;
}

export interface MigrationEventPayload {
    mint: string;
    verdict: Verdict | "untracked";
    reason: string | null;
    bought: boolean;
    error?: string | null;
}

export interface CreationEventPayload {
    mint: string;
    name: string;
    symbol: string;
    uri: string;
    dev: string;
    bondingCurve: string;
    capturedAt: number;
}

export interface MetadataEventPayload {
    mint: string;
    name: string | null;
    symbol: string | null;
}

export interface SocialsEventPayload {
    mint: string;
    twitter: string | null;
    telegram: string | null;
    website: string | null;
    description: string | null;
    image: string | null;
}

export type DashboardEvent =
    | { type: "trade"; data: TradeEventPayload }
    | { type: "verdict"; data: VerdictEventPayload }
    | { type: "migration"; data: MigrationEventPayload }
    | { type: "creation"; data: CreationEventPayload }
    | { type: "metadata"; data: MetadataEventPayload }
    | { type: "socials"; data: SocialsEventPayload };

// Singleton bus — constructed lazily, unlimited listeners (SSE clients can stack up).
const bus = new EventEmitter();
bus.setMaxListeners(0);

export function emitTrade(p: TradeEventPayload): void {
    bus.emit("event", { type: "trade", data: p });
}

export function emitVerdict(p: VerdictEventPayload): void {
    bus.emit("event", { type: "verdict", data: p });
}

export function emitMigration(p: MigrationEventPayload): void {
    bus.emit("event", { type: "migration", data: p });
}

export function emitCreation(p: CreationEventPayload): void {
    bus.emit("event", { type: "creation", data: p });
}

export function emitMetadata(p: MetadataEventPayload): void {
    bus.emit("event", { type: "metadata", data: p });
}

export function emitSocials(p: SocialsEventPayload): void {
    bus.emit("event", { type: "socials", data: p });
}

export function subscribe(handler: (ev: DashboardEvent) => void): () => void {
    bus.on("event", handler);
    return () => bus.off("event", handler);
}

export function listenerCount(): number {
    return bus.listenerCount("event");
}
