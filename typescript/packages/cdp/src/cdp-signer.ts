import { CdpClient } from '@coinbase/cdp-sdk';
import { Address, assertIsAddress, address as solanaAddress } from '@solana/addresses';
import { getBase58Encoder, getBase64Encoder, getUtf8Decoder } from '@solana/codecs-strings';
import {
    createSignatureDictionary,
    extractSignatureFromWireTransaction,
    SignerError,
    SignerErrorCode,
    SolanaSigner,
    throwSignerError,
} from '@solana/keychain-core';
import { SignatureBytes } from '@solana/keys';
import { SignableMessage, SignatureDictionary } from '@solana/signers';
import {
    Base64EncodedWireTransaction,
    getBase64EncodedWireTransaction,
    Transaction,
    TransactionWithinSizeLimit,
    TransactionWithLifetime,
} from '@solana/transactions';

import type { CdpSignerConfig } from './types.js';

/**
 * Coinbase Developer Platform (CDP) based signer for Solana transactions
 *
 * Note: Must initialize with create() to set up CDP client and fetch the account address
 */
export class CdpSigner<TAddress extends string = string> implements SolanaSigner<TAddress> {
    readonly address!: Address<TAddress>;
    private readonly cdp: CdpClient;
    private readonly accountAddress: string;
    private readonly requestDelayMs: number;

    private constructor(config: CdpSignerConfig, cdp: CdpClient, accountAddress: string, address: Address<TAddress>) {
        this.cdp = cdp;
        this.accountAddress = accountAddress;
        this.requestDelayMs = config.requestDelayMs ?? 0;
        this.validateRequestDelayMs(this.requestDelayMs);

        // Set readonly address field
        Object.defineProperty(this, 'address', {
            configurable: false,
            enumerable: true,
            value: address,
            writable: false,
        });
    }

    /**
     * Create and initialize a CdpSigner
     * Initializes CDP client and fetches the Solana account address
     */
    static async create<TAddress extends string = string>(config: CdpSignerConfig): Promise<CdpSigner<TAddress>> {
        // Validate configuration
        const hasApiKeyId = !!config.apiKeyId;
        const hasApiKeySecret = !!config.apiKeySecret;
        const hasWalletSecret = !!config.walletSecret;

        if (!hasApiKeyId || !hasApiKeySecret) {
            throwSignerError(SignerErrorCode.CONFIG_ERROR, {
                message: `Missing required CDP API credentials. Present: apiKeyId=${hasApiKeyId}, apiKeySecret=${hasApiKeySecret}`,
            });
        }

        if (!hasWalletSecret) {
            throwSignerError(SignerErrorCode.CONFIG_ERROR, {
                message: `Missing required walletSecret. Present: walletSecret=${hasWalletSecret}`,
            });
        }

        if (!config.accountName && !config.accountAddress) {
            throwSignerError(SignerErrorCode.CONFIG_ERROR, {
                message: 'Must provide either accountName or accountAddress',
            });
        }

        if (config.accountName && config.accountAddress) {
            throwSignerError(SignerErrorCode.CONFIG_ERROR, {
                message: 'Cannot provide both accountName and accountAddress, choose one',
            });
        }

        try {
            // Initialize CDP client
            const cdp = new CdpClient({
                apiKeyId: config.apiKeyId,
                apiKeySecret: config.apiKeySecret,
                walletSecret: config.walletSecret,
            });

            // Resolve Solana address
            let accountAddress: string;

            if (config.accountAddress) {
                // Use provided address directly
                accountAddress = config.accountAddress;
            } else {
                // Get or create account by name
                const account = await cdp.solana.getOrCreateAccount({
                    name: config.accountName!,
                });
                accountAddress = account.address;
            }

            // Validate it's a valid Solana address
            assertIsAddress(accountAddress);
            const address = solanaAddress(accountAddress) as Address<TAddress>;

            return new CdpSigner<TAddress>(config, cdp, accountAddress, address);
        } catch (error) {
            if (error instanceof SignerError) {
                throw error; // Re-throw SignerError
            }
            throwSignerError(SignerErrorCode.CONFIG_ERROR, {
                cause: error,
                message: `Failed to initialize CDP client: ${error instanceof Error ? error.message : String(error)}`,
            });
        }
    }

    private validateRequestDelayMs(requestDelayMs: number): void {
        if (requestDelayMs < 0) {
            throwSignerError(SignerErrorCode.CONFIG_ERROR, {
                message: 'requestDelayMs must not be negative',
            });
        }
        if (requestDelayMs > 3000) {
            console.warn(
                'requestDelayMs is greater than 3000ms, this may result in blockhash expiration errors for signing messages/transactions',
            );
        }
    }

    /**
     * Add delay between concurrent requests
     */
    private async delay(index: number): Promise<void> {
        if (this.requestDelayMs > 0 && index > 0) {
            await new Promise(resolve => setTimeout(resolve, index * this.requestDelayMs));
        }
    }

    /**
     * Sign a single transaction using CDP Solana API
     */
    private async signTransaction(
        transaction: Transaction & TransactionWithinSizeLimit & TransactionWithLifetime,
    ): Promise<Base64EncodedWireTransaction> {
        try {
            // Convert transaction to base64
            const base64WireTransaction = getBase64EncodedWireTransaction(transaction);

            // Sign using CDP Solana API
            const { signedTransaction } = await this.cdp.solana.signTransaction({
                address: this.accountAddress,
                transaction: base64WireTransaction,
            });

            if (!signedTransaction) {
                throwSignerError(SignerErrorCode.REMOTE_API_ERROR, {
                    message: 'No signed transaction in CDP response',
                });
            }

            return signedTransaction as Base64EncodedWireTransaction;
        } catch (error) {
            throwSignerError(SignerErrorCode.SIGNING_FAILED, {
                cause: error,
                message: `CDP transaction signing failed: ${error instanceof Error ? error.message : String(error)}`,
            });
        }
    }

    /**
     * Sign a single message using CDP Solana API
     */
    private async signMessage(message: SignableMessage): Promise<SignatureBytes> {
        try {
            // Convert message bytes to UTF-8 string for CDP
            const utf8Decoder = getUtf8Decoder();
            const messageString = utf8Decoder.decode(message.content);

            // Sign using CDP Solana API
            const { signature: signatureBase58 } = await this.cdp.solana.signMessage({
                address: this.accountAddress,
                message: messageString,
            });

            if (!signatureBase58) {
                throwSignerError(SignerErrorCode.REMOTE_API_ERROR, {
                    message: 'No signature in CDP response',
                });
            }

            // Convert base58 signature to bytes
            // CDP returns base58-encoded signature, we need to decode to 64-byte SignatureBytes
            // Try base58 first (most likely), fallback to base64 if needed
            let signatureBytes: Uint8Array;
            try {
                const base58Encoder = getBase58Encoder();
                signatureBytes = new Uint8Array(base58Encoder.encode(signatureBase58));
            } catch {
                // Fallback: try base64 if base58 fails
                const base64Encoder = getBase64Encoder();
                signatureBytes = new Uint8Array(base64Encoder.encode(signatureBase58));
            }

            // Validate signature is 64 bytes
            if (signatureBytes.length !== 64) {
                throwSignerError(SignerErrorCode.SIGNING_FAILED, {
                    message: `Invalid signature length: expected 64 bytes, got ${signatureBytes.length}`,
                });
            }

            return signatureBytes as SignatureBytes;
        } catch (error) {
            if (error instanceof SignerError) {
                throw error; // Re-throw SignerError
            }
            throwSignerError(SignerErrorCode.SIGNING_FAILED, {
                cause: error,
                message: `CDP message signing failed: ${error instanceof Error ? error.message : String(error)}`,
            });
        }
    }

    /**
     * Sign multiple messages using CDP API
     */
    async signMessages(messages: readonly SignableMessage[]): Promise<readonly SignatureDictionary[]> {
        return await Promise.all(
            messages.map(async (message, index) => {
                await this.delay(index);
                const signatureBytes = await this.signMessage(message);
                return createSignatureDictionary({
                    signature: signatureBytes,
                    signerAddress: this.address,
                });
            }),
        );
    }

    /**
     * Sign multiple transactions using CDP API
     */
    async signTransactions(
        transactions: readonly (Transaction & TransactionWithinSizeLimit & TransactionWithLifetime)[],
    ): Promise<readonly SignatureDictionary[]> {
        return await Promise.all(
            transactions.map(async (transaction, index) => {
                await this.delay(index);
                const signedTx = await this.signTransaction(transaction);
                return extractSignatureFromWireTransaction({
                    base64WireTransaction: signedTx,
                    signerAddress: this.address,
                });
            }),
        );
    }

    /**
     * Check if the CDP signer is available
     */
    async isAvailable(): Promise<boolean> {
        try {
            // Check if CDP client is accessible by getting account info
            const account = await this.cdp.solana.getAccount({
                address: this.accountAddress,
            });
            return !!account && !!account.address;
        } catch {
            return false;
        }
    }
}
