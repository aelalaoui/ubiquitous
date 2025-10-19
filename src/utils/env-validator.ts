import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

export interface EnvConfig {
    HELIUS_HTTPS_URI: string;
    HELIUS_WSS_URI: string;
    SNIPEROO_API_KEY?: string;
    SNIPEROO_PUBKEY?: string;
    NODE_ENV?: string;
}

export function validateEnv(): EnvConfig {
    const requiredEnvVars = [
        'HELIUS_HTTPS_URI',
        'HELIUS_WSS_URI'
    ];

    const missingVars: string[] = [];

    // Check for required environment variables
    for (const envVar of requiredEnvVars) {
        if (!process.env[envVar]) {
            missingVars.push(envVar);
        }
    }

    if (missingVars.length > 0) {
        throw new Error(
            `Missing required environment variables: ${missingVars.join(', ')}\n` +
            'Please create a .env file with the following variables:\n' +
            'HELIUS_HTTPS_URI=your_helius_rpc_url\n' +
            'HELIUS_WSS_URI=your_helius_websocket_url\n' +
            'SNIPEROO_API_KEY=your_sniperoo_api_key (optional)\n' +
            'SNIPEROO_PUBKEY=your_sniperoo_public_key (optional)'
        );
    }

    // Validate RPC URL format
    const rpcUrl = process.env.HELIUS_HTTPS_URI!;
    if (!rpcUrl.startsWith('http://') && !rpcUrl.startsWith('https://')) {
        throw new Error('HELIUS_HTTPS_URI must start with http:// or https://');
    }

    // Validate WebSocket URL format
    const wsUrl = process.env.HELIUS_WSS_URI!;
    if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) {
        throw new Error('HELIUS_WSS_URI must start with ws:// or wss://');
    }

    console.log('✅ Environment variables validated successfully');
    console.log(`📡 Helius RPC URL: ${rpcUrl}`);
    console.log(`🔗 Helius WebSocket URL: ${wsUrl}`);

    if (process.env.SNIPEROO_API_KEY) {
        console.log('🎯 Sniperoo API key loaded');
    }

    if (process.env.SNIPEROO_PUBKEY) {
        console.log('🔑 Sniperoo public key loaded');
    }

    return {
        HELIUS_HTTPS_URI: rpcUrl,
        HELIUS_WSS_URI: wsUrl,
        SNIPEROO_API_KEY: process.env.SNIPEROO_API_KEY,
        SNIPEROO_PUBKEY: process.env.SNIPEROO_PUBKEY,
        NODE_ENV: process.env.NODE_ENV || 'development'
    };
}
