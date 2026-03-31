import { useMemo, type ReactNode } from 'react';
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';

// Re-export the wallet hook from the adapter library
export { useWallet } from '@solana/wallet-adapter-react';

// Import wallet adapter CSS
import '@solana/wallet-adapter-react-ui/styles.css';

const SOLANA_RPC_URL =
  import.meta.env.VITE_SOLANA_RPC_URL ?? clusterApiUrl('mainnet-beta');

/**
 * Solana wallet connection provider.
 *
 * Wraps the app with ConnectionProvider → WalletProvider → WalletModalProvider
 * to enable Phantom / Solflare wallet connections.
 *
 * The connected wallet address is used for:
 *  - Auto-filling ownerWallet on strategy creation
 *  - Filtering "My Strategies" by wallet
 *  - Displaying wallet-specific key and usage data
 *
 * API authentication remains token-based (Bearer token).
 */
export function WalletContextProvider({ children }: { children: ReactNode }) {
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );

  return (
    <ConnectionProvider endpoint={SOLANA_RPC_URL}>
      <SolanaWalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}
