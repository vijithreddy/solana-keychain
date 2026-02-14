import { SignerTestConfig, TestScenario } from '@solana/keychain-test-utils';
import { CdpSigner } from '../cdp-signer.js';

const SIGNER_TYPE = 'cdp';
const REQUIRED_ENV_VARS = ['CDP_API_KEY_ID', 'CDP_API_KEY_SECRET', 'CDP_WALLET_SECRET'];

async function createCdpSigner(): Promise<CdpSigner> {
    return await CdpSigner.create({
        apiKeyId: process.env.CDP_API_KEY_ID!,
        apiKeySecret: process.env.CDP_API_KEY_SECRET!,
        walletSecret: process.env.CDP_WALLET_SECRET!,
        accountName: process.env.CDP_SOLANA_ACCOUNT_NAME,
        accountAddress: process.env.CDP_SOLANA_ACCOUNT_ADDRESS,
    });
}

const CONFIG: SignerTestConfig<CdpSigner> = {
    signerType: SIGNER_TYPE,
    requiredEnvVars: REQUIRED_ENV_VARS,
    createSigner: createCdpSigner,
};

export async function getConfig(scenarios: TestScenario[]): Promise<SignerTestConfig<CdpSigner>> {
    return {
        ...CONFIG,
        testScenarios: scenarios,
    };
}
