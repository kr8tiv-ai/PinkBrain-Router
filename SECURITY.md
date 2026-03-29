# Security Policy

PinkBrain Router handles Solana private keys, OpenRouter management credentials, and automated financial transactions. Security is a first-class concern at every layer.

## Reporting Vulnerabilities

If you discover a security vulnerability, **do not open a public issue**. Instead:

1. Email **security@kr8tiv.ai** with a description of the vulnerability
2. Include steps to reproduce if possible
3. We will acknowledge receipt within 48 hours
4. We will provide a fix timeline within 7 days

## Architecture Security Model

### Signer Isolation

PinkBrain Router supports two signer modes, both designed to keep private keys away from the application runtime:

| Mode | How It Works | Risk Profile |
|------|-------------|--------------|
| **Bags Agent** (recommended) | JWT-authenticated remote signer via Bags.fm infrastructure. Private key never touches the app server. | Lowest — key custody delegated to Bags platform |
| **Direct Key** | Base58 or JSON array private key loaded from environment variable. | Higher — key exists in process memory at runtime |

**Production recommendation**: Always use Bags Agent mode. The direct key option exists only for local development and testing.

```bash
# Bags Agent setup (recommended)
npm run agent -- auth init --username <username>
npm run agent -- auth login
npm run agent -- wallet export --token <jwt> --wallet <address> --env
```

### Credential Management

| Credential | Storage | Exposure |
|---|---|---|
| `SIGNER_PRIVATE_KEY` | Environment variable only | Never logged, never persisted to DB |
| `OPENROUTER_MANAGEMENT_KEY` | Environment variable only | Never in client-side code, never in git |
| `BAGS_API_KEY` | Environment variable only | Server-side only |
| `HELIUS_API_KEY` | Environment variable only | Server-side only |
| `API_AUTH_TOKEN` | Environment variable only | Required on all API routes via Bearer header |
| OpenRouter user keys | Shown once at creation, only hash stored | Hash in DB, plaintext never persisted |

### Runtime Safety Controls

| Control | What It Does | Default |
|---|---|---|
| **Kill Switch** (`EXECUTION_KILL_SWITCH`) | Immediately halts all pipeline execution | `false` |
| **Dry Run** (`DRY_RUN`) | Runs full pipeline without submitting transactions | `false` |
| **Daily Run Cap** (`MAX_DAILY_RUNS`) | Max pipeline executions per strategy per UTC day | `4` |
| **Claim Cap** (`MAX_CLAIMABLE_SOL_PER_RUN`) | Max SOL claimable in a single run | `100` |
| **Key Spending Limit** (`MAX_KEY_LIMIT_USD`) | Max per-user OpenRouter key limit | `500` |
| **Pool Reserve** (`CREDIT_POOL_RESERVE_PCT`) | % of credit pool held in reserve to prevent over-allocation | `10%` |

### Transaction Security

- All Solana transactions use **Helius priority fees** for reliable landing
- Swap transactions enforce **configurable slippage** (default: 50 bps, max: 1000 bps)
- Every phase transition is logged to an **immutable audit trail** with tx signatures
- Failed phases checkpoint and resume — no double-spending on retry

### API Authentication

All CreditBrain REST endpoints require `Authorization: Bearer <API_AUTH_TOKEN>`. There is no public/unauthenticated API surface.

### OpenRouter Key Security

- User API keys are displayed **exactly once** at provisioning — only the key hash is stored
- Keys have per-key spending limits that cap maximum exposure
- Key rotation is supported (delete + re-provision)
- Keys can be disabled instantly if compromised
- The Management API key (admin) is isolated from inference keys (user)

## What We Don't Do

- We **never** store private keys in the database
- We **never** log secret values (keys, JWTs, tokens)
- We **never** expose credentials in client-side code or API responses
- We **never** commit `.env` files (enforced by `.gitignore`)
- We **never** use `NEXT_PUBLIC_*` prefixed variables for secrets

## Dependency Policy

- All dependencies are pinned with `package-lock.json`
- No unnecessary runtime dependencies — minimal attack surface
- Solana interactions use official `@solana/web3.js` and `@solana/spl-token`
- Bags interactions use official `@bagsfm/bags-sdk`

## Supported Versions

| Version | Supported |
|---------|-----------|
| main branch | Yes |
| < 1.0 | Best effort |
