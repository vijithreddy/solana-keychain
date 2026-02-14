/**
 * CDP SDK configuration types
 */

/**
 * Configuration for creating a CdpSigner
 */
export interface CdpSignerConfig {
    /** CDP API key ID */
    apiKeyId: string;
    /** CDP API key secret */
    apiKeySecret: string;
    /** CDP wallet seed/secret for authentication */
    walletSecret: string;
    /** Optional: Solana account name (e.g., "default") - use this OR accountAddress */
    accountName?: string;
    /** Optional: Solana account address - use this OR accountName */
    accountAddress?: string;
    /** Optional delay in ms between concurrent signing requests to avoid rate limits (default: 0) */
    requestDelayMs?: number;
}
