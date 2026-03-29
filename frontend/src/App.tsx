import { Outlet } from 'react-router';
import { useAuth } from './hooks/useAuth.tsx';

export default function App() {
  const { token, setToken } = useAuth();

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <div className="w-full max-w-md rounded-lg border border-gray-800 bg-surface p-8">
          <h1 className="mb-2 text-xl font-bold text-neon-green">PinkBrain Router</h1>
          <p className="mb-6 text-sm text-text-secondary">
            Enter your API auth token to connect to the backend.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              const value = formData.get('token') as string;
              if (value?.trim()) {
                setToken(value.trim());
              }
            }}
          >
            <label htmlFor="token-input" className="mb-1 block text-xs font-medium text-text-muted">
              Auth Token
            </label>
            <input
              id="token-input"
              name="token"
              type="password"
              autoComplete="off"
              placeholder="Bearer token from backend .env"
              className="mb-4 w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm font-mono text-text-primary placeholder-text-muted focus:border-neon-green focus:outline-none"
            />
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

  return (
    <div className="flex min-h-screen flex-col bg-gray-950">
      <header className="border-b border-gray-800 bg-surface px-6 py-3">
        <div className="flex items-center justify-between">
          <h1 className="font-mono text-lg font-bold text-neon-green">PinkBrain</h1>
          <nav className="flex items-center gap-4 text-sm">
            <a href="/" className="text-text-secondary transition hover:text-text-primary">Dashboard</a>
            <button
              type="button"
              onClick={() => setToken(null)}
              className="rounded border border-gray-700 px-3 py-1 text-xs text-text-muted transition hover:border-neon-red hover:text-neon-red"
            >
              Disconnect
            </button>
          </nav>
        </div>
      </header>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
