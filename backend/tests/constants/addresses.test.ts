import { describe, it, expect } from 'vitest';
import {
  WRAPPED_SOL_MINT,
  SOLANA_USDC_MINT,
  BASE_USDC,
  LAMPORTS_PER_SOL,
  CCTP_V2_BASE_TOKEN_MESSENGER,
  CCTP_V2_BASE_MESSAGE_TRANSMITTER,
  CCTP_V2_BASE_TOKEN_MINTER,
  SOLANA_PROTOCOL_ADDRESSES,
} from '../../src/constants/addresses.js';

describe('Canonical address constants', () => {
  // ── Wrapped SOL mint ─────────────────────────────────────────────────────

  describe('WRAPPED_SOL_MINT', () => {
    it('has exactly 43 characters', () => {
      // Source: Solana SPL Token — base58-encoded 32-byte Ed25519 pubkey
      expect(WRAPPED_SOL_MINT.length).toBe(43);
    });

    it('starts with "So" and ends with "12"', () => {
      // Source: Solana SPL Token — known prefix/suffix for wrapped SOL
      expect(WRAPPED_SOL_MINT.startsWith('So')).toBe(true);
      expect(WRAPPED_SOL_MINT.endsWith('12')).toBe(true);
    });

    it('contains exactly 40 "1" characters', () => {
      // Source: Solana SPL Token — the canonical wrapped SOL mint has 40 consecutive '1's
      const onesCount = WRAPPED_SOL_MINT.split('').filter((c) => c === '1').length;
      expect(onesCount).toBe(40);
    });

    it('matches the full canonical value', () => {
      // Source: Solana SPL Token Program specification
      // @see https://spl.solana.com/token
      expect(WRAPPED_SOL_MINT).toBe('So11111111111111111111111111111111111111112');
    });
  });

  // ── USDC mints ──────────────────────────────────────────────────────────

  describe('SOLANA_USDC_MINT', () => {
    it('matches the canonical Solana USDC mint', () => {
      // Source: Circle USDC on Solana — official mint address
      // @see https://www.circle.com/en/usdc-on-solana
      expect(SOLANA_USDC_MINT).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    });

    it('is 44 characters (base58 pubkey)', () => {
      expect(SOLANA_USDC_MINT.length).toBe(44);
    });
  });

  describe('BASE_USDC', () => {
    it('matches the canonical Base USDC address', () => {
      // Source: Circle USDC on Base — official contract address
      // @see https://www.circle.com/en/usdc-on-base
      expect(BASE_USDC).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    });

    it('is a valid Ethereum address (42 chars, starts with 0x)', () => {
      expect(BASE_USDC.length).toBe(42);
      expect(BASE_USDC.startsWith('0x')).toBe(true);
    });
  });

  // ── Unit conversion ──────────────────────────────────────────────────────

  describe('LAMPORTS_PER_SOL', () => {
    it('equals 1 billion', () => {
      // Source: Solana runtime specification
      // @see https://docs.solana.com/developing/programming-model/accounts
      expect(LAMPORTS_PER_SOL).toBe(1_000_000_000);
    });
  });

  // ── CCTP V2 Base contracts ──────────────────────────────────────────────

  describe('CCTP V2 Base addresses', () => {
    const cctpContracts = [
      {
        name: 'TOKEN_MESSENGER',
        value: CCTP_V2_BASE_TOKEN_MESSENGER,
        canonical: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
      },
      {
        name: 'MESSAGE_TRANSMITTER',
        value: CCTP_V2_BASE_MESSAGE_TRANSMITTER,
        canonical: '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64',
      },
      {
        name: 'TOKEN_MINTER',
        value: CCTP_V2_BASE_TOKEN_MINTER,
        canonical: '0xfd78EE919681417d192449715b2594ab58f5D002',
      },
    ];

    // Source: Circle CCTP V2 contract addresses — Base mainnet
    // @see https://developers.circle.com/cctp/reference/base-mainnet

    it.each(cctpContracts)('$name matches its canonical value', ({ value, canonical }) => {
      expect(value).toBe(canonical);
    });

    it.each(cctpContracts)('$name is a valid Ethereum address (42 chars, 0x prefix)', ({ value, name }) => {
      expect(value.length).toBe(42);
      expect(value.startsWith('0x')).toBe(true);
    });
  });

  // ── Solana protocol addresses ────────────────────────────────────────────

  describe('SOLANA_PROTOCOL_ADDRESSES', () => {
    const expectedAddresses = [
      '11111111111111111111111111111111',                   // System Program
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',       // Token Program
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',      // Associated Token Program
      'SysvarRent111111111111111111111111111111111',           // Rent Sysvar
      '1nc1nerator11111111111111111111111111111111',          // Incinerator
      'So11111111111111111111111111111111111111112',          // Wrapped SOL mint
    ];

    // Source: Solana program deployments — genesis and bootstrap addresses
    // @see https://docs.solana.com/developing/runtime-facilities/programs

    it('contains all 6 expected protocol addresses', () => {
      for (const addr of expectedAddresses) {
        expect(SOLANA_PROTOCOL_ADDRESSES.has(addr)).toBe(true);
      }
    });

    it('has exactly 6 entries', () => {
      expect(SOLANA_PROTOCOL_ADDRESSES.size).toBe(6);
    });

    it('includes the canonical Wrapped SOL mint', () => {
      // Ensure WRAPPED_SOL_MINT from constants is the same object in the Set
      expect(SOLANA_PROTOCOL_ADDRESSES.has(WRAPPED_SOL_MINT)).toBe(true);
    });
  });
});
