/**
 * Notification utility functions
 */

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
