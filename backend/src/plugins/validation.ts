/**
 * Reusable Fastify JSON Schema fragments for route parameter validation.
 * Solana pubkeys are base58-encoded, 32-44 characters.
 */

/** Solana wallet/pubkey parameter */
export const walletParam = {
  type: 'object' as const,
  required: ['wallet'],
  properties: {
    wallet: {
      type: 'string' as const,
      pattern: '^[1-9A-HJ-NP-Za-km-z]{32,44}$',
      description: 'Base58-encoded Solana public key',
    },
  },
};

/** Generic string ID parameter */
export const idParam = {
  type: 'object' as const,
  required: ['id'],
  properties: {
    id: {
      type: 'string' as const,
      minLength: 1,
      maxLength: 128,
    },
  },
};

/** Hash parameter (OpenRouter key hashes) */
export const hashParam = {
  type: 'object' as const,
  required: ['hash'],
  properties: {
    hash: {
      type: 'string' as const,
      minLength: 1,
      maxLength: 256,
    },
  },
};

/** Strategy ID parameter */
export const strategyIdParam = {
  type: 'object' as const,
  required: ['strategyId'],
  properties: {
    strategyId: {
      type: 'string' as const,
      minLength: 1,
      maxLength: 128,
    },
  },
};
