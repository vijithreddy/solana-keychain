# @solana/keychain-cdp

Coinbase Developer Platform (CDP) based signer for Solana transactions.

## Installation

```bash
pnpm add @solana/keychain-cdp
```

## Usage

```typescript
import { CdpSigner } from '@solana/keychain-cdp';

// Create a CDP signer
const signer = await CdpSigner.create({
    apiKeyId: 'your-cdp-api-key-id',
    apiKeySecret: 'your-cdp-api-key-secret',
    walletSecret: 'your-wallet-seed',
    accountName: 'default', // or use accountAddress instead
});

// Use with @solana/kit
import { pipe, createTransactionMessage, setTransactionMessageFeePayerSigner } from '@solana/kit';

const transaction = pipe(
    createTransactionMessage({ version: 0 }),
    tx => setTransactionMessageFeePayerSigner(signer, tx),
    // ... add instructions
);

const signedTx = await signTransactionMessageWithSigners(transaction);
```

## Configuration

- `apiKeyId` (string, required): CDP API key ID
- `apiKeySecret` (string, required): CDP API key secret
- `walletSecret` (string, required): CDP wallet seed for authentication
- `accountName` (string, optional): Solana account name (e.g., "default")
- `accountAddress` (string, optional): Solana account address (use instead of accountName)
- `requestDelayMs` (number, optional): Delay in milliseconds between concurrent signing requests (default: 0)

Note: Provide either `accountName` OR `accountAddress`, not both.

## Example

See `typescript/examples/test-signer.ts` for a complete example with environment variables.

## License

MIT
