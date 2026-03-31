import { Buffer } from 'buffer';

// Polyfill Buffer for @solana/web3.js in the browser
(window as unknown as Record<string, unknown>).Buffer = Buffer;

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './hooks/useAuth.tsx';
import { WalletContextProvider } from './hooks/useWallet.tsx';
import App from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <WalletContextProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </WalletContextProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
