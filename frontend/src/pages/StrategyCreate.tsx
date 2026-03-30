import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useCreateStrategy } from '@/api';
import type { FeeSourceType, DistributionMode, KeyLimitReset, CreateStrategyPayload } from '@/api/types';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

const SOURCES: FeeSourceType[] = ['CLAIMABLE_POSITIONS', 'PARTNER_FEES'];
const DISTRIBUTIONS: DistributionMode[] = [
  'OWNER_ONLY',
  'TOP_N_HOLDERS',
  'EQUAL_SPLIT',
  'WEIGHTED_BY_HOLDINGS',
  'CUSTOM_LIST',
];
const RESET_OPTIONS: { value: string; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

interface FormErrors {
  ownerWallet?: string;
  [key: string]: string | undefined;
}

export default function StrategyCreate() {
  useDocumentTitle('New Strategy — PinkBrain Router');
  const navigate = useNavigate();
  const createStrategy = useCreateStrategy();

  const [form, setForm] = useState<CreateStrategyPayload>({
    ownerWallet: '',
    source: 'CLAIMABLE_POSITIONS',
    distributionToken: '',
    distribution: 'OWNER_ONLY',
    distributionTopN: 0,
    keyConfig: {
      defaultLimitUsd: 50,
      limitReset: 'monthly',
      expiryDays: 30,
    },
    creditPoolReservePct: 10,
    exclusionList: [],
    schedule: '',
    minClaimThreshold: 0,
  });

  const [exclusionText, setExclusionText] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});

  function validate(): FormErrors {
    const errs: FormErrors = {};
    if (!form.ownerWallet?.trim()) {
      errs.ownerWallet = 'Owner wallet address is required';
    }
    return errs;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    const payload: CreateStrategyPayload = {
      ...form,
      exclusionList: exclusionText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    };

    createStrategy.mutate(payload, {
      onSuccess: (strategy) => {
        navigate(`/strategies/${strategy.strategyId}`);
      },
    });
  }

  function setField<K extends keyof CreateStrategyPayload>(key: K, value: CreateStrategyPayload[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  }

  function setKeyField<K extends keyof NonNullable<CreateStrategyPayload['keyConfig']>>(
    key: K,
    value: NonNullable<CreateStrategyPayload['keyConfig']>[K],
  ) {
    setForm((prev) => ({
      ...prev,
      keyConfig: { ...prev.keyConfig!, [key]: value },
    }));
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-xl font-bold text-text-primary">Create Strategy</h1>

      {createStrategy.isError && (
        <div className="mb-6 rounded-lg border border-red-500/30 bg-surface p-4">
          <p className="text-sm text-red-400">
            {(createStrategy.error as Error)?.message ?? 'Failed to create strategy'}
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Owner Wallet */}
        <FieldGroup label="Owner Wallet *" error={errors.ownerWallet}>
          <input
            type="text"
            value={form.ownerWallet ?? ''}
            onChange={(e) => setField('ownerWallet', e.target.value)}
            placeholder="e.g. 7xKp...abc"
            className={inputClass(!!errors.ownerWallet)}
          />
        </FieldGroup>

        {/* Source */}
        <FieldGroup label="Source">
          <select
            value={form.source ?? 'CLAIMABLE_POSITIONS'}
            onChange={(e) => setField('source', e.target.value as FeeSourceType)}
            className={selectClass}
          >
            {SOURCES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </FieldGroup>

        {/* Distribution Mode */}
        <FieldGroup label="Distribution Mode">
          <select
            value={form.distribution ?? 'OWNER_ONLY'}
            onChange={(e) => setField('distribution', e.target.value as DistributionMode)}
            className={selectClass}
          >
            {DISTRIBUTIONS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </FieldGroup>

        {/* Distribution Token */}
        <FieldGroup label="Distribution Token">
          <input
            type="text"
            value={form.distributionToken ?? ''}
            onChange={(e) => setField('distributionToken', e.target.value)}
            placeholder="e.g. USDC"
            className={inputClass()}
          />
        </FieldGroup>

        {/* Distribution Top N */}
        <FieldGroup label="Distribution Top N">
          <input
            type="number"
            min={0}
            value={form.distributionTopN ?? 0}
            onChange={(e) => setField('distributionTopN', Number(e.target.value))}
            className={inputClass()}
          />
        </FieldGroup>

        {/* Key Config */}
        <fieldset className="rounded-lg border border-gray-800 bg-surface p-4">
          <legend className="px-2 text-sm font-medium text-text-secondary">Key Configuration</legend>
          <div className="mt-3 space-y-4">
            <FieldGroup label="Default Limit (USD)">
              <input
                type="number"
                min={0}
                step={0.01}
                value={form.keyConfig?.defaultLimitUsd ?? 50}
                onChange={(e) => setKeyField('defaultLimitUsd', Number(e.target.value))}
                className={inputClass()}
              />
            </FieldGroup>
            <FieldGroup label="Limit Reset">
              <select
                value={String(form.keyConfig?.limitReset ?? 'monthly')}
                onChange={(e) => setKeyField('limitReset', e.target.value as KeyLimitReset)}
                className={selectClass}
              >
                {RESET_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </FieldGroup>
            <FieldGroup label="Expiry Days">
              <input
                type="number"
                min={1}
                value={form.keyConfig?.expiryDays ?? 30}
                onChange={(e) => setKeyField('expiryDays', Number(e.target.value))}
                className={inputClass()}
              />
            </FieldGroup>
          </div>
        </fieldset>

        {/* Credit Pool Reserve */}
        <FieldGroup label={`Credit Pool Reserve: ${form.creditPoolReservePct ?? 0}%`}>
          <input
            type="range"
            min={0}
            max={50}
            value={form.creditPoolReservePct ?? 0}
            onChange={(e) => setField('creditPoolReservePct', Number(e.target.value))}
            className="w-full accent-neon-green"
          />
          <div className="mt-1 flex justify-between text-xs text-text-muted">
            <span>0%</span>
            <span>50%</span>
          </div>
        </FieldGroup>

        {/* Exclusion List */}
        <FieldGroup label="Exclusion List">
          <textarea
            value={exclusionText}
            onChange={(e) => setExclusionText(e.target.value)}
            placeholder="Comma-separated wallet addresses"
            rows={3}
            className={inputClass()}
          />
        </FieldGroup>

        {/* Schedule */}
        <FieldGroup label="Schedule (cron)">
          <input
            type="text"
            value={form.schedule ?? ''}
            onChange={(e) => setField('schedule', e.target.value)}
            placeholder="e.g. 0 0 * * *"
            className={inputClass()}
          />
        </FieldGroup>

        {/* Min Claim Threshold */}
        <FieldGroup label="Min Claim Threshold">
          <input
            type="number"
            min={0}
            step={0.001}
            value={form.minClaimThreshold ?? 0}
            onChange={(e) => setField('minClaimThreshold', Number(e.target.value))}
            className={inputClass()}
          />
        </FieldGroup>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={createStrategy.isPending}
            className="rounded bg-neon-green px-6 py-2 text-sm font-semibold text-gray-950 transition hover:brightness-110 disabled:opacity-50"
          >
            {createStrategy.isPending ? 'Creating...' : 'Create Strategy'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/strategies')}
            className="rounded border border-gray-700 px-4 py-2 text-sm text-text-secondary transition hover:bg-surface-raised"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function FieldGroup({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-text-secondary">{label}</label>
      {children}
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}

const inputClass = (hasError = false) =>
  `w-full rounded border bg-gray-900 px-3 py-2 text-sm font-mono text-text-primary placeholder-text-muted focus:outline-none ${
    hasError ? 'border-red-500 focus:border-red-400' : 'border-gray-700 focus:border-neon-green'
  }`;

const selectClass =
  'w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm font-mono text-text-primary focus:border-neon-green focus:outline-none';
