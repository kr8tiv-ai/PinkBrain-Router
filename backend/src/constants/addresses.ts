/**
 * Canonical blockchain address constants — single source of truth.
 *
 * Every address here has been verified against its canonical source.
 * See tests/constants/addresses.test.ts for automated verification.
 */

// ── Solana ────────────────────────────────────────────────────────────────────

/**
 * Canonical Wrapped SOL mint address.
 * Source: Solana SPL Token Program specification.
 * @see https://spl.solana.com/token#faq
 *
 * Base58-encoded Ed25519 pubkey: 43 chars, 40 '1' digits.
 * Format: "So" + 40×"1" + "12"
 */
export const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';

/**
 * Solana USDC mint address (native SPL token, not bridged).
 * Source: Circle USDC on Solana — official mint list.
 * @see https://www.circle.com/en/usdc-on-solana
 */
export const SOLANA_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/**
 * Lamports per SOL — fundamental unit conversion.
 * Source: Solana runtime specification.
 * @see https://docs.solana.com/developing/programming-model/accounts#account-data
 */
export const LAMPORTS_PER_SOL = 1_000_000_000;

// ── Base (Ethereum L2) ───────────────────────────────────────────────────────

/**
 * USDC contract address on Base.
 * Source: Circle USDC on Base — official address list.
 * @see https://www.circle.com/en/usdc-on-base
 */
export const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// ── CCTP V2 — Base contracts ────────────────────────────────────────────────
// These are consumed by S02 (CCTP bridge phase replacement via Bridge Kit SDK).
// CctpClient.ts has been removed — addresses here are the authoritative source.

/**
 * CCTP V2 TokenMessenger contract on Base.
 * Source: Circle CCTP V2 contract addresses page.
 * @see https://developers.circle.com/cctp/reference/base-mainnet
 */
export const CCTP_V2_BASE_TOKEN_MESSENGER =
  '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d';

/**
 * CCTP V2 MessageTransmitter contract on Base.
 * Source: Circle CCTP V2 contract addresses page.
 * @see https://developers.circle.com/cctp/reference/base-mainnet
 */
export const CCTP_V2_BASE_MESSAGE_TRANSMITTER =
  '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64';

/**
 * CCTP V2 TokenMinter contract on Base.
 * Source: Circle CCTP V2 contract addresses page.
 * @see https://developers.circle.com/cctp/reference/base-mainnet
 */
export const CCTP_V2_BASE_TOKEN_MINTER =
  '0xfd78EE919681417d192449715b2594ab58f5D002';

// ── Solana well-known protocol addresses ────────────────────────────────────
// Used to filter out non-holder program addresses in Helius DAS queries.
// Source: Solana program deployments (genesis / bootstrap).

/**
 * Set of well-known Solana protocol addresses that should never appear
 * as token holders in distribution analysis.
 * Source: Solana program deployments — genesis and bootstrap addresses.
 * @see https://docs.solana.com/developing/runtime-facilities/programs#well-known-program-ids
 */
export const SOLANA_PROTOCOL_ADDRESSES = new Set<string>([
  '11111111111111111111111111111111',                    // System Program
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',        // Token Program
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',       // Associated Token Program
  'SysvarRent111111111111111111111111111111111',            // Rent Sysvar
  '1nc1nerator11111111111111111111111111111111',           // Incinerator (burn)
  WRAPPED_SOL_MINT,                                        // Wrapped SOL mint (alias entry)
]);
