import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

const TOKEN_KEY = 'pinkbrain_auth_token';
const WALLET_KEY = 'pinkbrain_wallet_address';

interface AuthContextValue {
  /** Bearer token for API authentication */
  token: string | null;
  setToken: (token: string | null) => void;
  /** Connected Solana wallet address (base58) */
  walletAddress: string | null;
  setWalletAddress: (address: string | null) => void;
  /** Whether the user is authenticated (has token) */
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  token: null,
  setToken: () => {},
  walletAddress: null,
  setWalletAddress: () => {},
  isAuthenticated: false,
});

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (_e) {
    return null;
  }
}

function safeSetItem(key: string, value: string | null): void {
  try {
    if (value) {
      localStorage.setItem(key, value);
    } else {
      localStorage.removeItem(key);
    }
  } catch (_e) {
    // localStorage unavailable (private browsing, etc.)
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => safeGetItem(TOKEN_KEY));
  const [walletAddress, setWalletState] = useState<string | null>(() => safeGetItem(WALLET_KEY));

  const setToken = useCallback((value: string | null) => {
    safeSetItem(TOKEN_KEY, value);
    setTokenState(value);
  }, []);

  const setWalletAddress = useCallback((value: string | null) => {
    safeSetItem(WALLET_KEY, value);
    setWalletState(value);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        token,
        setToken,
        walletAddress,
        setWalletAddress,
        isAuthenticated: !!token,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
