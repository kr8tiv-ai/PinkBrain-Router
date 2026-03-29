import pino from 'pino';
import { createPublicClient, createWalletClient, http, defineChain, type Address, type Hash } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const logger = pino({ name: 'CctpClient' });

// ─── Circle CCTP Contract Constants ────────────────────────────────

// Solana: USDC mint (mainnet)
const SOLANA_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Base: Circle Token Messenger contract
const BASE_TOKEN_MESSENGER = '0x9f757ed5277b6c24774e8d8d343e1103e84a9ef8' as Address;
const BASE_MESSAGE_TRANSMITTER = '0xC11c81171831E1c145e5e774c8aa40E82d334929' as Address;

// Base: USDC contract
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address;

const CCTP_ABI = [
  // Token Messenger
  {
    inputs: [
      { name: 'mintRecipient', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
      { name: 'destinationDomain', type: 'uint32' },
      { name: 'destinationCaller', type: 'bytes32' },
    ],
    name: 'depositForBurn',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // Message Transmitter (for receiving)
  {
    inputs: [{ name: 'message', type: 'bytes' }],
    name: 'receiveMessage',
    outputs: [{ name: 'success', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // USDC: approve
  {
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // USDC: allowance
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  // USDC: balanceOf
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// Domain IDs per Circle CCTP spec
const DOMAIN_SOLANA = 0;
const DOMAIN_BASE = 6;

export interface CctpBridgeParams {
  amountUsdc: bigint; // USDC amount in smallest units (6 decimals)
  solanaRecipient: string; // 32-byte Solana address
}

export interface BridgeResult {
  txHash: Hash;
  amountUsdc: bigint;
  fromChain: string;
  toChain: string;
  solanaRecipient: string;
}

export class CctpClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly walletClient: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly publicClient: any;
  private readonly walletAddress: Address;
  private readonly chain: ReturnType<typeof defineChain>;

  constructor(config: {
    evmPrivateKey: string;
    evmRpcUrl?: string;
    chainId?: number;
  }) {
    const account = privateKeyToAccount(config.evmPrivateKey as `0x${string}`);
    this.walletAddress = account.address;

    this.chain = defineChain({
      ...base,
      id: config.chainId ?? 8453,
    });

    const rpcUrl = config.evmRpcUrl ?? `${base.rpcUrls.default.http[0]}`;

    this.walletClient = createWalletClient({
      account,
      chain: this.chain,
      transport: http(rpcUrl),
    });

    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(rpcUrl),
    });

    logger.info(
      { address: this.walletAddress, chainId: this.chain.id },
      'CctpClient initialized',
    );
  }

  /**
   * Bridge USDC from Base EVM side to Solana via CCTP depositForBurn.
   * Caller must have USDC balance and approved the Token Messenger.
   */
  async bridgeToSolana(params: CctpBridgeParams): Promise<BridgeResult> {
    logger.info(
      {
        amount: params.amountUsdc.toString(),
        solanaRecipient: params.solanaRecipient,
      },
      'Initiating CCTP bridge from Base to Solana',
    );

    const mintRecipient = this.solanaAddressToBytes32(params.solanaRecipient);
    const destinationCaller = '0x' + '0'.repeat(64) as `0x${string}`;

    // Step 1: Ensure USDC is approved for the Token Messenger
    const currentAllowance = await this.publicClient.readContract({
      address: BASE_USDC,
      abi: CCTP_ABI,
      functionName: 'allowance',
      args: [this.walletAddress, BASE_TOKEN_MESSENGER],
    });

    if (currentAllowance < params.amountUsdc) {
      logger.info({ current: currentAllowance.toString(), required: params.amountUsdc.toString() }, 'Approving USDC for Token Messenger');
      const approveHash = await this.walletClient.writeContract({
        address: BASE_USDC,
        abi: CCTP_ABI,
        functionName: 'approve',
        args: [BASE_TOKEN_MESSENGER, params.amountUsdc],
      });

      await this.publicClient.waitForTransactionReceipt({ hash: approveHash });
      logger.info({ approveHash }, 'USDC approval confirmed');
    }

    // Step 2: depositForBurn — burn USDC on Base, emit message for Solana minting
    const txHash = await this.walletClient.writeContract({
      address: BASE_TOKEN_MESSENGER,
      abi: CCTP_ABI,
      functionName: 'depositForBurn',
      args: [
        mintRecipient,
        params.amountUsdc,
        BigInt(DOMAIN_SOLANA),
        destinationCaller,
      ],
      chain: null,
    });

    logger.info({ txHash, amount: params.amountUsdc.toString() }, 'CCTP depositForBurn submitted');
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status !== 'success') {
      throw new Error(`CCTP depositForBurn transaction failed: ${txHash}`);
    }

    logger.info(
      { txHash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString() },
      'CCTP bridge transaction confirmed',
    );

    return {
      txHash,
      amountUsdc: params.amountUsdc,
      fromChain: `base-${this.chain.id}`,
      toChain: 'solana',
      solanaRecipient: params.solanaRecipient,
    };
  }

  /**
   * Get the USDC balance of the wallet on Base.
   */
  async getUsdcBalance(): Promise<bigint> {
    const balance = await this.publicClient.readContract({
      address: BASE_USDC,
      abi: CCTP_ABI,
      functionName: 'balanceOf',
      args: [this.walletAddress],
    });
    return balance;
  }

  /**
   * Convert a Solana base58 public key to a 32-byte hex for CCTP mintRecipient.
   */
  private solanaAddressToBytes32(solanaAddress: string): `0x${string}` {
    // Convert base58 Solana address to 32 bytes
    // For now we use a simple approach: pad/truncate the decoded bytes
    const bs58 = require('bs58') as typeof import('bs58');
    const bytes = bs58.decode(solanaAddress);

    if (bytes.length !== 32) {
      throw new Error(`Expected 32-byte Solana address, got ${bytes.length} bytes`);
    }

    return `0x${Buffer.from(bytes).toString('hex')}` as `0x${string}`;
  }

  getWalletAddress(): Address {
    return this.walletAddress;
  }

  getChainId(): number {
    return this.chain.id;
  }
}
