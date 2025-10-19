import axios from "axios";
import { validateEnv } from "../env-validator";

/**
 * Buys a token using the Sniperoo API
 * @param tokenAddress The token's mint address
 * @param inputAmount Amount of SOL to spend
 * @param returns Boolean indicating if the purchase was successful
 */
export async function buyToken(tokenAddress: string, inputAmount: number, sell: boolean, tp: number, sl: number): Promise<boolean> {
    try {
        const env = validateEnv();

        // Validate inputs
        if (!tokenAddress || typeof tokenAddress !== "string" || tokenAddress.trim() === "") {
            return false;
        }

        if (inputAmount <= 0) {
            return false;
        }

        if (!tp || !sl) {
            sell = false;
        }

        // Prepare request body
        const requestBody = {
            walletAddresses: [env.SNIPEROO_PUBKEY],
            tokenAddress: tokenAddress,
            inputAmount: inputAmount,
            autoSell: {
                enabled: sell,
                strategy: {
                    strategyName: "simple",
                    profitPercentage: tp,
                    stopLossPercentage: sl,
                },
            },
        };

        // Make API request using axios
        const response = await axios.post(
            "https://api.sniperoo.app/trading/buy-token?toastFrontendId=0",
            requestBody,
            {
                headers: {
                    Authorization: `Bearer ${env.SNIPEROO_API_KEY}`,
                    "Content-Type": "application/json",
                },
            }
        );

        // Axios automatically throws an error for non-2xx responses,
        // so if we get here, the request was successful
        return true;
    } catch (error) {
        // Handle axios errors
        if (axios.isAxiosError(error)) {
            console.error(`Sniperoo API error (${error.response?.status || "unknown"}):`, error.response?.data || error.message);
        } else {
            console.error("Unexpected error:", error);
        }
        return false;
    }
}