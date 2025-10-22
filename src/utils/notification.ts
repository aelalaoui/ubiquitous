/**
 * Notification utility functions
 */

import axios from 'axios';

/**
 * Send a Telegram message
 * @param message The message to send
 * @param botToken The Telegram bot token (optional, falls back to env)
 * @param chatId The chat ID to send to (optional, falls back to env)
 */
export async function sendTelegramMessage(
    message: string,
    botToken?: string,
    chatId?: string
): Promise<boolean> {
    try {
        const token = botToken || process.env.TELEGRAM_BOT_TOKEN;
        const chat = chatId || process.env.TELEGRAM_CHAT_ID;

        if (!token || !chat) {
            console.error('❌ [Telegram] Bot token or chat ID not configured');
            return false;
        }

        const url = `https://api.telegram.org/bot${token}/sendMessage`;

        await axios.post(url, {
            chat_id: chat,
            text: message,
            parse_mode: 'HTML'
        });

        console.log('✅ [Telegram] Message sent successfully');
        return true;
    } catch (error) {
        console.error('❌ [Telegram] Error sending message:', error);
        return false;
    }
}

/**
 * Play a sound notification when a token is successfully purchased
 */
export function playSound(): void {
    try {
        // For Node.js environments, we can use system bell or console beep
        // This is a simple implementation - you can enhance it with actual sound files
        process.stdout.write('\x07'); // ASCII bell character
        console.log('🔔 Sound notification played');
    } catch (error) {
        console.error('Error playing sound:', error);
    }
}
