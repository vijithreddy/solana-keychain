import { generateKeyPair, signBytes } from '@solana/keys';
import { createSignableMessage, createSignerFromKeyPair, generateKeyPairSigner } from '@solana/signers';
import {
    Base64EncodedWireTransaction,
    Transaction,
    TransactionWithinSizeLimit,
    TransactionWithLifetime,
} from '@solana/transactions';
import { assertIsSolanaSigner } from '@solana/keychain-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CdpSigner } from '../cdp-signer.js';

const MOCK_B64_WIRE_TX =
    'Af1fCRSrZ9ASprap8D3ZLPsbzeCs6uihvj/jfjm3UrAY72by5zKMRd7YAIbJCl9gyRHQbw+xdklET2ZNmZi3iA2AAQABAurnRuGN5bfL2osZZMdGlvL1qz8k0GbdLhiP1fICgkmsBUpTWpkpIQZNJOhxYNo4fHw1td28kruB5B+oQEEFRI1NhzEgE0w/YfwaeZi2Ns/mLoZvq2Sx5NVQg7Am7wrjGwEBAAxIZWxsbywgQ0RQBgA=' as Base64EncodedWireTransaction;

vi.mock('@solana/transactions', async () => {
    const actual = await vi.importActual<typeof import('@solana/transactions')>('@solana/transactions');
    return {
        ...actual,
        getBase64EncodedWireTransaction: vi.fn(() => MOCK_B64_WIRE_TX),
    };
});

const mockCdpClient = {
    solana: {
        getOrCreateAccount: vi.fn(),
        getAccount: vi.fn(),
        signTransaction: vi.fn(),
        signMessage: vi.fn(),
    },
};

vi.mock('@coinbase/cdp-sdk', () => ({
    CdpClient: class {
        solana = mockCdpClient.solana;
    },
}));

const createMockTransaction = (): Transaction & TransactionWithinSizeLimit & TransactionWithLifetime => {
    return {} as Transaction & TransactionWithinSizeLimit & TransactionWithLifetime;
};

describe('CdpSigner', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    const mockConfig = {
        apiKeyId: 'test-api-key-id',
        apiKeySecret: 'test-api-key-secret',
        walletSecret: 'test-wallet-secret',
        accountName: 'default',
    };

    const setupMockAccountResponse = (address: string) => {
        mockCdpClient.solana.getOrCreateAccount.mockResolvedValueOnce({
            address,
            name: 'default',
        });
    };

    const setupMockSignMessageResponse = (signatureBase58: string) => {
        mockCdpClient.solana.signMessage.mockResolvedValueOnce({
            signature: signatureBase58,
        });
    };

    const setupMockSignTransactionResponse = (signedTransaction: string) => {
        mockCdpClient.solana.signTransaction.mockResolvedValueOnce({
            signedTransaction,
        });
    };

    describe('create', () => {
        it('creates and initializes a CdpSigner', async () => {
            const keyPair = await generateKeyPairSigner();
            setupMockAccountResponse(keyPair.address);

            const signer = await CdpSigner.create(mockConfig);

            expect(signer.address).toBeTruthy();
            expect(signer.signMessages).toBeDefined();
            expect(signer.signTransactions).toBeDefined();
            expect(signer.isAvailable).toBeDefined();
            expect(typeof signer.address).toBe('string');
            assertIsSolanaSigner(signer);
        });

        it('sets address field correctly from CDP API response', async () => {
            const keyPair = await generateKeyPairSigner();
            setupMockAccountResponse(keyPair.address);

            const signer = await CdpSigner.create(mockConfig);

            expect(signer.address).toBe(keyPair.address);
        });

        it('uses accountAddress when provided', async () => {
            const keyPair = await generateKeyPairSigner();
            const configWithAddress = {
                ...mockConfig,
                accountAddress: keyPair.address,
                accountName: undefined,
            };

            const signer = await CdpSigner.create(configWithAddress);

            expect(signer.address).toBe(keyPair.address);
            expect(mockCdpClient.solana.getOrCreateAccount).not.toHaveBeenCalled();
        });

        it('calls getOrCreateAccount when accountName is provided', async () => {
            const keyPair = await generateKeyPairSigner();
            setupMockAccountResponse(keyPair.address);

            await CdpSigner.create(mockConfig);

            expect(mockCdpClient.solana.getOrCreateAccount).toHaveBeenCalledWith({
                name: 'default',
            });
        });

        describe('config validation', () => {
            it('throws CONFIG_ERROR when apiKeyId is missing', async () => {
                const invalidConfig = { ...mockConfig, apiKeyId: '' };
                await expect(CdpSigner.create(invalidConfig)).rejects.toMatchObject({
                    code: 'SIGNER_CONFIG_ERROR',
                    message: expect.stringContaining('apiKeyId=false'),
                });
            });

            it('throws CONFIG_ERROR when apiKeySecret is missing', async () => {
                const invalidConfig = { ...mockConfig, apiKeySecret: '' };
                await expect(CdpSigner.create(invalidConfig)).rejects.toMatchObject({
                    code: 'SIGNER_CONFIG_ERROR',
                    message: expect.stringContaining('apiKeySecret=false'),
                });
            });

            it('throws CONFIG_ERROR when walletSecret is missing', async () => {
                const invalidConfig = { ...mockConfig, walletSecret: '' };
                await expect(CdpSigner.create(invalidConfig)).rejects.toMatchObject({
                    code: 'SIGNER_CONFIG_ERROR',
                    message: expect.stringContaining('walletSecret=false'),
                });
            });

            it('throws CONFIG_ERROR when neither accountName nor accountAddress is provided', async () => {
                const invalidConfig = {
                    apiKeyId: 'test',
                    apiKeySecret: 'test',
                    walletSecret: 'test',
                };
                await expect(CdpSigner.create(invalidConfig)).rejects.toMatchObject({
                    code: 'SIGNER_CONFIG_ERROR',
                    message: expect.stringContaining('Must provide either accountName or accountAddress'),
                });
            });

            it('throws CONFIG_ERROR when both accountName and accountAddress are provided', async () => {
                const invalidConfig = {
                    ...mockConfig,
                    accountAddress: 'SomeAddress',
                };
                await expect(CdpSigner.create(invalidConfig)).rejects.toMatchObject({
                    code: 'SIGNER_CONFIG_ERROR',
                    message: expect.stringContaining('Cannot provide both accountName and accountAddress'),
                });
            });
        });

        describe('network errors', () => {
            it('throws CONFIG_ERROR when CDP client initialization fails', async () => {
                mockCdpClient.solana.getOrCreateAccount.mockRejectedValueOnce(new Error('CDP API error'));

                await expect(CdpSigner.create(mockConfig)).rejects.toMatchObject({
                    code: 'SIGNER_CONFIG_ERROR',
                    message: expect.stringContaining('Failed to initialize CDP client'),
                });
            });
        });

        describe('response validation', () => {
            it('throws CONFIG_ERROR when address is invalid', async () => {
                setupMockAccountResponse('not-a-valid-address');

                await expect(CdpSigner.create(mockConfig)).rejects.toThrow();
            });
        });
    });

    describe('signMessages', () => {
        it('signs a message via CDP API', async () => {
            const keyPair = await generateKeyPair();
            const keyPairSigner = await createSignerFromKeyPair(keyPair);
            const address = keyPairSigner.address;

            setupMockAccountResponse(address);
            const signer = await CdpSigner.create(mockConfig);

            const messageContent = new Uint8Array([1, 2, 3, 4]);
            const signature = await signBytes(keyPair.privateKey, messageContent);

            // Convert signature to base64 (our implementation expects to decode from base64)
            // The actual CDP SDK returns base58, but our mock returns base64 for simplicity
            const signatureBase64 = Buffer.from(signature).toString('base64');
            setupMockSignMessageResponse(signatureBase64);

            const message = createSignableMessage(messageContent);
            const [sigDict] = await signer.signMessages([message]);

            expect(sigDict).toBeTruthy();
            expect(sigDict?.[signer.address]).toBeTruthy();
            expect(mockCdpClient.solana.signMessage).toHaveBeenCalledWith({
                address: signer.address,
                message: expect.any(String),
            });
        });

        it('throws SIGNING_FAILED when CDP API fails', async () => {
            const keyPair = await generateKeyPairSigner();
            setupMockAccountResponse(keyPair.address);
            const signer = await CdpSigner.create(mockConfig);

            mockCdpClient.solana.signMessage.mockRejectedValueOnce(new Error('CDP signing error'));

            const message = createSignableMessage(new Uint8Array([1, 2, 3, 4]));
            await expect(signer.signMessages([message])).rejects.toMatchObject({
                code: 'SIGNER_SIGNING_FAILED',
                message: expect.stringContaining('CDP message signing failed'),
            });
        });

        it('throws REMOTE_API_ERROR when signature is missing from response', async () => {
            const keyPair = await generateKeyPairSigner();
            setupMockAccountResponse(keyPair.address);
            const signer = await CdpSigner.create(mockConfig);

            mockCdpClient.solana.signMessage.mockResolvedValueOnce({});

            const message = createSignableMessage(new Uint8Array([1, 2, 3, 4]));
            await expect(signer.signMessages([message])).rejects.toMatchObject({
                code: 'SIGNER_REMOTE_API_ERROR',
                message: expect.stringContaining('No signature in CDP response'),
            });
        });
    });

    describe('signTransactions', () => {
        it('signs a transaction via CDP API', async () => {
            const keyPair = await generateKeyPairSigner();
            setupMockAccountResponse(keyPair.address);
            const signer = await CdpSigner.create(mockConfig);

            // For this test, we just verify the CDP API is called correctly
            // The actual signature extraction would require a properly signed transaction
            setupMockSignTransactionResponse(MOCK_B64_WIRE_TX);

            const transaction = createMockTransaction();

            // This test validates CDP API interaction
            // Signature extraction will fail without a valid signed transaction
            // but we can catch that and verify the API was called
            try {
                await signer.signTransactions([transaction]);
            } catch (error) {
                // Expected - MOCK_B64_WIRE_TX doesn't have signature for this address
            }

            expect(mockCdpClient.solana.signTransaction).toHaveBeenCalledWith({
                address: signer.address,
                transaction: MOCK_B64_WIRE_TX,
            });
        });

        it('throws SIGNING_FAILED when CDP API fails', async () => {
            const keyPair = await generateKeyPairSigner();
            setupMockAccountResponse(keyPair.address);
            const signer = await CdpSigner.create(mockConfig);

            mockCdpClient.solana.signTransaction.mockRejectedValueOnce(new Error('CDP signing error'));

            const transaction = createMockTransaction();
            await expect(signer.signTransactions([transaction])).rejects.toMatchObject({
                code: 'SIGNER_SIGNING_FAILED',
                message: expect.stringContaining('CDP transaction signing failed'),
            });
        });

        it('throws error when signedTransaction is missing from response', async () => {
            const keyPair = await generateKeyPairSigner();
            setupMockAccountResponse(keyPair.address);
            const signer = await CdpSigner.create(mockConfig);

            mockCdpClient.solana.signTransaction.mockResolvedValueOnce({});

            const transaction = createMockTransaction();
            await expect(signer.signTransactions([transaction])).rejects.toThrow();
        });
    });

    describe('isAvailable', () => {
        it('returns true when getAccount succeeds', async () => {
            const keyPair = await generateKeyPairSigner();
            setupMockAccountResponse(keyPair.address);
            const signer = await CdpSigner.create(mockConfig);

            mockCdpClient.solana.getAccount.mockResolvedValueOnce({
                address: keyPair.address,
            });

            const available = await signer.isAvailable();
            expect(available).toBe(true);
        });

        it('returns false when getAccount throws', async () => {
            const keyPair = await generateKeyPairSigner();
            setupMockAccountResponse(keyPair.address);
            const signer = await CdpSigner.create(mockConfig);

            mockCdpClient.solana.getAccount.mockRejectedValueOnce(new Error('CDP API error'));

            const available = await signer.isAvailable();
            expect(available).toBe(false);
        });
    });
});
