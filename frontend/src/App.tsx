import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router';
import { useAuth } from '@/hooks/useAuth';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Layout } from '@/components/Layout';
import TokenInput from '@/pages/TokenInput';

const StrategyList = lazy(() => import('@/pages/StrategyList'));
const StrategyCreate = lazy(() => import('@/pages/StrategyCreate'));
const StrategyDetail = lazy(() => import('@/pages/StrategyDetail'));
const RunsPage = lazy(() => import('@/pages/Runs'));
const KeysPage = lazy(() => import('@/pages/Keys'));
const CreditPoolPage = lazy(() => import('@/pages/CreditPool'));
const HealthPage = lazy(() => import('@/pages/Health'));

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  if (!token) {
    return <TokenInput />;
  }
  return <>{children}</>;
}

function PageSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-neon-green border-t-transparent" />
    </div>
  );
}

export default function App() {
  return (
    <RequireAuth>
      <Layout>
        <ErrorBoundary>
          <Suspense fallback={<PageSpinner />}>
            <Routes>
              <Route index element={<Navigate to="/strategies" replace />} />
              <Route path="strategies" element={<StrategyList />} />
              <Route path="strategies/new" element={<StrategyCreate />} />
              <Route path="strategies/:id" element={<StrategyDetail />} />
              <Route path="runs" element={<RunsPage />} />
              <Route path="keys" element={<KeysPage />} />
              <Route path="credit-pool" element={<CreditPoolPage />} />
              <Route path="health" element={<HealthPage />} />
              <Route path="*" element={<Navigate to="/strategies" replace />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </Layout>
    </RequireAuth>
  );
}
