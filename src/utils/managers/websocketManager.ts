import WebSocket from "ws";
import { EventEmitter } from "events";

// Connection states
export enum ConnectionState {
    DISCONNECTED = "disconnected",
    CONNECTING = "connecting",
    CONNECTED = "connected",
    RECONNECTING = "reconnecting",
    ERROR = "error"
}

export interface WebSocketManagerOptions {
    url: string;
    maxRetries?: number;
    initialBackoff?: number;
    maxBackoff?: number;
    debug?: boolean;
}

export interface WebSocketRequest {
    id?: string;
    method: string;
    params?: any;
}

export class WebSocketManager extends EventEmitter {
    private ws: WebSocket | null = null;
    private state: ConnectionState = ConnectionState.DISCONNECTED;
    private retryCount = 0;
    private backoffTime: number;
    private maxBackoff: number;
    private maxRetries: number;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private url: string;
    private debug: boolean;

    constructor(options: WebSocketManagerOptions) {
        super();
        this.url = options.url;
        this.maxRetries = options.maxRetries || 5;
        this.backoffTime = options.initialBackoff || 1000;
        this.maxBackoff = options.maxBackoff || 30000;
        this.debug = options.debug || false;
    }

    // Get current connection state
    public getState(): ConnectionState {
        return this.state;
    }

    // Connect to WebSocket server
    public connect(): void {
        if (this.state === ConnectionState.CONNECTING || this.state === ConnectionState.CONNECTED) {
            this.log("Already connecting or connected", "warn");
            return;
        }

        this.setState(ConnectionState.CONNECTING);
        this.log(`Connecting to ${this.url}...`);

        try {
            this.ws = new WebSocket(this.url);
            this.setupEventListeners();
        } catch (error) {
            this.handleError(error as Error);
        }
    }

    // Send data through the WebSocket
    public send(data: WebSocketRequest | string): boolean {
        if (this.state !== ConnectionState.CONNECTED || !this.ws) {
            this.log("Cannot send data: WebSocket not connected", "error");
            return false;
        }

        try {
            const message = typeof data === 'string' ? data : JSON.stringify(data);
            this.ws.send(message);
            this.log(`Sent: ${message}`);
            return true;
        } catch (error) {
            this.log(`Failed to send data: ${error}`, "error");
            return false;
        }
    }

    // Disconnect WebSocket
    public disconnect(): void {
        this.log("Disconnecting WebSocket...");
        this.cleanUp();

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        this.setState(ConnectionState.DISCONNECTED);
        this.retryCount = 0;
    }

    // Set up WebSocket event listeners
    private setupEventListeners(): void {
        if (!this.ws) return;

        this.ws.on('open', () => {
            this.log("WebSocket connected successfully");
            this.setState(ConnectionState.CONNECTED);
            this.retryCount = 0;
            this.emit('connected');
        });

        this.ws.on('message', (data: WebSocket.Data) => {
            try {
                const message = data.toString();
                this.log(`Received: ${message}`);

                let parsedData;
                try {
                    parsedData = JSON.parse(message);
                } catch {
                    parsedData = message;
                }

                this.emit('message', parsedData);
            } catch (error) {
                this.log(`Error processing message: ${error}`, "error");
            }
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
            const reasonString = reason.toString();
            this.log(`WebSocket closed with code ${code}: ${reasonString}`);
            this.ws = null;

            if (this.state !== ConnectionState.DISCONNECTED) {
                this.setState(ConnectionState.RECONNECTING);
                this.emit('disconnected', { code, reason: reasonString });
                this.attemptReconnect();
            }
        });

        this.ws.on('error', (error: Error) => {
            this.handleError(error);
        });
    }

    // Handle WebSocket errors
    private handleError(error: Error): void {
        this.log(`WebSocket error: ${error.message}`, "error");
        this.setState(ConnectionState.ERROR);
        this.emit('error', error);

        if (this.state !== ConnectionState.DISCONNECTED) {
            this.attemptReconnect();
        }
    }

    // Attempt to reconnect with exponential backoff
    private attemptReconnect(): void {
        if (this.retryCount >= this.maxRetries) {
            this.log(`Maximum retry attempts (${this.maxRetries}) reached. Giving up.`, "error");
            this.setState(ConnectionState.DISCONNECTED);
            this.emit("max_retries_reached");
            return;
        }

        this.retryCount++;
        const delay = Math.min(this.backoffTime * Math.pow(2, this.retryCount - 1), this.maxBackoff);

        this.log(`Attempting reconnect ${this.retryCount}/${this.maxRetries} in ${delay}ms...`);

        this.reconnectTimer = setTimeout(() => {
            this.connect();
        }, delay);
    }

    // Set connection state and emit state change event
    private setState(newState: ConnectionState): void {
        if (this.state !== newState) {
            const oldState = this.state;
            this.state = newState;
            this.log(`State changed: ${oldState} -> ${newState}`);
            this.emit('state_change', { from: oldState, to: newState });
        }
    }

    // Logging utility
    private log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
        if (this.debug) {
            const timestamp = new Date().toISOString();
            console[level](`[WebSocketManager] ${timestamp}: ${message}`);
        }
    }

    // Clean up resources
    private cleanUp(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
}