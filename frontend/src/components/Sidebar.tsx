import { NavLink, useLocation } from 'react-router';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { truncateId } from '@/lib/format';

const NAV_ITEMS = [
  { to: '/strategies', label: 'Strategies' },
  { to: '/runs', label: 'Runs' },
  { to: '/keys', label: 'Keys' },
  { to: '/credit-pool', label: 'Credit Pool' },
  { to: '/health', label: 'Health' },
  { to: '/stats', label: 'Stats' },
];

export function Sidebar({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { token, setToken } = useAuth();
  const { publicKey, connected } = useWallet();
  const location = useLocation();

  return (
    <>
      {/* Backdrop for mobile */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={onClose}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
          role="button"
          tabIndex={-1}
          aria-label="Close sidebar"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-gray-800 bg-surface transition-transform duration-200 lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
          <span className="font-mono text-lg font-bold text-neon-green">
            PinkBrain
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-muted transition hover:text-text-primary lg:hidden"
            aria-label="Close navigation"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Connection status */}
        <div className="border-b border-gray-800 px-5 py-3 space-y-2">
          {/* Wallet status */}
          {connected && publicKey ? (
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-neon-green" />
              <span className="font-mono text-xs text-neon-green">
                {publicKey.toBase58().slice(0, 4)}...{publicKey.toBase58().slice(-4)}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-gray-600" />
              <span className="text-xs text-text-muted">No wallet</span>
            </div>
          )}
          {/* Token status */}
          {token ? (
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-text-muted">
                Token: {truncateId(token, 6)}
              </span>
              <button
                type="button"
                onClick={() => setToken(null)}
                className="text-xs text-neon-red transition hover:brightness-110"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <span className="text-xs text-text-muted">No token set</span>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 px-3 py-4" role="navigation" aria-label="Main navigation">
          {NAV_ITEMS.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center rounded-md px-3 py-2 text-sm font-medium transition ${
                  isActive
                    ? 'bg-neon-green/10 text-neon-green'
                    : 'text-text-secondary hover:bg-surface-raised hover:text-text-primary'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer with active route breadcrumb */}
        <div className="border-t border-gray-800 px-5 py-3">
          <span className="font-mono text-xs text-text-muted">
            {location.pathname}
          </span>
        </div>
      </aside>
    </>
  );
}
