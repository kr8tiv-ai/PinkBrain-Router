import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

export default function TokenInput() {
  useDocumentTitle('Connect — PinkBrain Router');
  const { setToken, setWalletAddress } = useAuth();
  const { publicKey, connected } = useWallet();
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  // Sync connected wallet address to auth context
  useEffect(() => {
    if (connected && publicKey) {
      setWalletAddress(publicKey.toBase58());
    } else {
      setWalletAddress(null);
    }
  }, [connected, publicKey, setWalletAddress]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      setError('Token is required');
      return;
    }
    setToken(trimmed);
    navigate('/strategies');
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 p-6">
      <div className="w-full max-w-md rounded-lg border border-gray-800 bg-surface p-8">
        <h1 className="mb-1 text-xl font-bold text-neon-green">
          PinkBrain Router
        </h1>
        <p className="mb-6 text-sm text-text-secondary">
          Connect your wallet and enter your API auth token.
        </p>

        {/* ── Wallet Connection ─────────────────────────── */}
        <div className="mb-6">
          <label className="mb-2 block text-xs font-medium text-text-muted">
            Solana Wallet
          </label>
          <div className="flex items-center gap-3">
            <WalletMultiButton
              style={{
                backgroundColor: connected ? '#166534' : '#1f2937',
                borderRadius: '0.375rem',
                fontSize: '0.875rem',
                height: '2.5rem',
                fontFamily: 'inherit',
              }}
            />
            {connected && publicKey && (
              <span className="truncate text-xs font-mono text-neon-green">
                {publicKey.toBase58().slice(0, 4)}...
                {publicKey.toBase58().slice(-4)}
              </span>
            )}
          </div>
          {connected && (
            <p className="mt-1 text-xs text-text-muted">
              Wallet connected. Your address will be used for strategy
              management.
            </p>
          )}
        </div>

        {/* ── Divider ──────────────────────────────────── */}
        <div className="mb-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-gray-800" />
          <span className="text-xs text-text-muted">API Authentication</span>
          <div className="h-px flex-1 bg-gray-800" />
        </div>

        {/* ── Token Input ──────────────────────────────── */}
        <form onSubmit={handleSubmit}>
          <label
            htmlFor="token-input"
            className="mb-1 block text-xs font-medium text-text-muted"
          >
            Auth Token
          </label>
          <input
            id="token-input"
            type="password"
            autoComplete="off"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError('');
            }}
            placeholder="Bearer token from backend .env"
            className={`mb-4 w-full rounded border bg-gray-900 px-3 py-2 text-sm font-mono text-text-primary placeholder-text-muted focus:outline-none ${
              error
                ? 'border-red-500 focus:border-red-400'
                : 'border-gray-700 focus:border-neon-green'
            }`}
          />
          {error && <p className="mb-4 text-xs text-red-400">{error}</p>}
          <button
            type="submit"
            className="w-full rounded bg-neon-green px-4 py-2 text-sm font-semibold text-gray-950 transition hover:brightness-110"
          >
            Connect
          </button>
        </form>
      </div>
    </div>
  );
}
