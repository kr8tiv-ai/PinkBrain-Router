import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/hooks/useAuth';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

export default function TokenInput() {
  useDocumentTitle('Token Input — PinkBrain Router');
  const { setToken } = useAuth();
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

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
        <h1 className="mb-1 text-xl font-bold text-neon-green">PinkBrain Router</h1>
        <p className="mb-6 text-sm text-text-secondary">
          Enter your API auth token to connect to the backend.
        </p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="token-input" className="mb-1 block text-xs font-medium text-text-muted">
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
              error ? 'border-red-500 focus:border-red-400' : 'border-gray-700 focus:border-neon-green'
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
