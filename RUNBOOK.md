# CreditBrain Operational Runbook

## Starting the Server

```bash
# Development (hot reload via tsx)
npm run dev

# Production (compiled JS)
npm run start

# Direct tsx execution
npm run start:server
```

The server listens on the port defined by the `PORT` env var (default `3001`).

## Environment Variables

All variables are validated at startup by a Zod schema. Missing required vars or invalid values cause the process to exit with a detailed error.

### Required — API Keys

| Variable | Description |
|----------|-------------|
| `BAGS_API_KEY` | Bags.fm API key — get one at bags.fm/developers |
| `HELIUS_API_KEY` | Helius RPC API key — get one at helius.dev |
| `OPENROUTER_MANAGEMENT_KEY` | OpenRouter management key — created in the OpenRouter dashboard under Settings → Management API Keys |
| `API_AUTH_TOKEN` | Bearer token for authenticating requests to `/api/*` routes |

### Required — Solana

| Variable | Default | Validation | Description |
|----------|---------|------------|-------------|
| `SOLANA_NETWORK` | `mainnet-beta` | `mainnet-beta` or `devnet` | Solana cluster to connect to |

### Optional — EVM (CCTP Bridge)

| Variable | Default | Validation | Description |
|----------|---------|------------|-------------|
| `EVM_PRIVATE_KEY` | _(none)_ | Optional | EVM private key for CCTP bridge signing |
| `EVM_CHAIN_ID` | `8453` | Any number | Target EVM chain ID (8453 = Base) |

### Optional — Fee Claiming

| Variable | Default | Validation | Description |
|----------|---------|------------|-------------|
| `FEE_THRESHOLD_SOL` | `5` | Min 1, max 100 | Minimum claimable SOL before a run triggers |
| `FEE_SOURCE` | `CLAIMABLE_POSITIONS` | `CLAIMABLE_POSITIONS` or `PARTNER_FEES` | Which fee vaults to claim from |
| `SWAP_SLIPPAGE_BPS` | `50` | Min 0, max 1000 | Swap slippage tolerance in basis points (50 = 0.5%) |

### Optional — Credit Distribution

| Variable | Default | Validation | Description |
|----------|---------|------------|-------------|
| `DEFAULT_KEY_LIMIT_USD` | `10` | Min 1 | Per-key spending limit in USD |
| `KEY_LIMIT_RESET` | `monthly` | `daily`, `weekly`, `monthly`, or null | When per-key usage resets |
| `KEY_EXPIRY_DAYS` | `365` | Min 0 (0 = never) | Days before a provisioned key expires |
| `CREDIT_POOL_RESERVE_PCT` | `10` | Min 0, max 50 | Percentage of pool balance held in reserve |
| `DISTRIBUTION_MODE` | `TOP_N_HOLDERS` | `OWNER_ONLY`, `TOP_N_HOLDERS`, `EQUAL_SPLIT`, `WEIGHTED_BY_HOLDINGS`, `CUSTOM_LIST` | How credits are distributed to holders |
| `DISTRIBUTION_TOP_N` | `100` | Min 1 | Number of top holders when using `TOP_N_HOLDERS` mode |
| `DISTRIBUTION_TOKEN_MINT` | _(none)_ | Optional | SPL token mint address to check holdings against |

### Optional — Scheduling

| Variable | Default | Validation | Description |
|----------|---------|------------|-------------|
| `CRON_EXPRESSION` | `0 */6 * * *` | Any cron expression | How often the pipeline runs automatically |
| `MIN_CRON_INTERVAL_HOURS` | `1` | Min 1 | Minimum hours between automatic runs |

### Optional — Safety Controls

| Variable | Default | Validation | Description |
|----------|---------|------------|-------------|
| `DRY_RUN` | `false` | Boolean | When `true`, the pipeline simulates without submitting on-chain transactions |
| `EXECUTION_KILL_SWITCH` | `false` | Boolean | When `true`, all pipeline runs are blocked at the policy check |
| `MAX_DAILY_RUNS` | `4` | Min 0 | Maximum runs per strategy per UTC day (0 = unlimited) |
| `MAX_CLAIMABLE_SOL_PER_RUN` | `100` | Min 0 | Maximum SOL claimed in a single run |
| `MAX_KEY_LIMIT_USD` | `100` | Min 1, max 10000 | Maximum per-key spending limit |
| `KEY_ROTATION_DAYS` | `90` | Min 1, max 365 | Days between automatic key rotations |
| `USAGE_POLL_INTERVAL_MIN` | `15` | Min 1, max 1440 | How often to poll OpenRouter for usage data |

### Optional — Bags Agent (alternative to EVM private key)

| Variable | Description |
|----------|-------------|
| `BAGS_AGENT_USERNAME` | Bags.fm agent username |
| `BAGS_AGENT_JWT` | Bags.fm agent JWT token |
| `BAGS_AGENT_WALLET_ADDRESS` | Bags.fm agent wallet public key |

### Optional — Server & Database

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server listen port |
| `DATABASE_PATH` | `./data/creditbrain.db` | SQLite database file path |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error` |
| `NODE_ENV` | `development` | `development`, `production`, or `test` |

### Optional — API Overrides

| Variable | Default | Description |
|----------|---------|-------------|
| `BAGS_API_BASE_URL` | `https://public-api-v2.bags.fm/api/v1` | Custom Bags.fm API base URL |
| `HELIUS_RPC_URL` | Auto-built from API key | Helius RPC URL (overrides default) |

## Health Checks

Two endpoints, neither requires authentication:

### Liveness — `GET /health/live`

Always returns `200` if the process is running. Use for container/process health checks.

```json
{
  "status": "ok",
  "timestamp": "2026-03-29T00:00:00.000Z",
  "uptime": 86400
}
```

### Readiness — `GET /health/ready`

Checks database connectivity and OpenRouter API reachability (3s timeout). Returns `503` if any dependency is down.

```json
{
  "status": "degraded",
  "timestamp": "2026-03-29T00:00:00.000Z",
  "uptime": 86400,
  "dependencies": {
    "openrouter": false,
    "database": true
  },
  "responseTimeMs": 3012
}
```

Use the `dependencies` object to determine which integration is failing. The `responseTimeMs` field helps detect slow dependencies before full failure.

## Reading Logs

CreditBrain uses [pino](https://github.com/pinojs/pino) for structured JSON logging. Set `LOG_LEVEL` to control verbosity.

### Log Levels

| Level | When to use |
|-------|-------------|
| `debug` | Detailed phase execution, API request/response bodies |
| `info` | Request access logs, phase transitions, successful completions (default) |
| `warn` | Non-fatal issues (dependency timeouts, retries) |
| `error` | Failures, uncaught exceptions, pipeline errors |

### Access Log Format

Every request to the server produces an access log:

```json
{
  "level": "info",
  "time": 1740547200000,
  "req": { "method": "GET", "url": "/api/strategies", "remoteAddress": "127.0.0.1" },
  "res": { "statusCode": 200 },
  "responseTime": 12.5
}
```

### Error Log Format

Errors include the error message, stack (at debug level), and request context:

```json
{
  "level": "error",
  "time": 1740547200000,
  "msg": "Pipeline run failed",
  "err": { "message": "OpenRouter API returned 429", "type": "Error" },
  "runId": "abc123"
}
```

### Filtering Logs

```bash
# All errors
cat output.log | pino-pretty -l error

# Requests to a specific endpoint
cat output.log | pino-pretty -i '"url":"/api/runs"'

# A specific run
cat output.log | pino-pretty -i '"runId":"abc123"'
```

## Failed Run Recovery

Pipeline runs can fail at any phase. When a failure occurs, the run's state is saved to the database with the failed phase, error code, and error detail. Runs can be resumed from the last successful checkpoint.

### Check Run Status

```bash
# Status of a specific run
npx tsx backend/src/cli.ts status --run <run-id>

# Status of the latest run for a strategy
npx tsx backend/src/cli.ts status --strategy <strategy-id>
```

Output includes the run state, timestamps, error details, and the full phase audit log showing which phases completed and which failed.

### Resume a Failed Run

```bash
npx tsx backend/src/cli.ts run --resume <run-id>
```

The state machine picks up from the last successful phase checkpoint. For example, if a run failed during `PROVISIONING`, `run --resume` skips `CLAIMING`, `SWAPPING`, and `ALLOCATING` and goes directly to `PROVISIONING`.

### Error State in the Database

The `runs` table stores error columns:

| Column | Description |
|--------|-------------|
| `error_code` | Machine-readable error code (e.g. `OPENROUTER_TIMEOUT`, `DB_LOCKED`) |
| `error_detail` | Human-readable error message with context |
| `error_failed_state` | The phase/state where the failure occurred |

Query directly with SQLite:

```bash
sqlite3 ./data/creditbrain.db "SELECT run_id, state, error_code, error_detail FROM runs WHERE state = 'FAILED' ORDER BY started_at DESC LIMIT 10;"
```

## Kill Switch

Set `EXECUTION_KILL_SWITCH=true` to immediately block all pipeline runs at the execution policy check. The run is recorded but never enters the CLAIMING phase.

```bash
# In .env
EXECUTION_KILL_SWITCH=true

# Restart the server (or use a process manager that reloads env)
npm run start
```

Any attempt to start a run (manual or scheduled) logs a policy rejection and exits without modifying on-chain state. This is the emergency stop for production incidents.

To re-enable, set `EXECUTION_KILL_SWITCH=false` and restart.

## Dry Run Mode

Set `DRY_RUN=true` to simulate the full pipeline without submitting any on-chain transactions. The pipeline runs through all phases — claiming, swapping, allocating, provisioning — but skips actual Solana transaction signing and OpenRouter key mutations.

```bash
DRY_RUN=true npm run start
```

Dry run is useful for:
- Validating a new strategy configuration before going live
- Testing that fee claiming and holder snapshots work correctly
- Verifying allocation math without spending real funds

Phase audit logs still record what _would_ have happened, so you can inspect the simulated execution.

## Common Failure Modes

| Scenario | Symptoms | Recovery |
|----------|----------|----------|
| **OpenRouter API unreachable** | `/health/ready` reports `openrouter: false`; runs fail at ALLOCATING or PROVISIONING with 429/5xx errors | Check OPENROUTER_MANAGEMENT_KEY is valid. Verify OpenRouter status page. Retry after cooldown. |
| **Database locked** | SQLite `SQLITE_BUSY` errors in logs; runs fail mid-phase | Wait for the competing process to finish. If persistent, check for long-running queries or multiple server instances. |
| **CCTP bridge timeout** | Run fails at phase after SWAPPING with timeout error; USDC never arrives on target chain | Check EVM_PRIVATE_KEY and EVM_CHAIN_ID. Verify CCTP relayer status. The circuit breaker (3 consecutive failures) will fast-fail until cooldown expires. |
| **Insufficient gas** | Solana transaction fails with `InsufficientFundsForFee`; claim or swap tx rejected | Check the signer wallet has enough SOL for transaction fees. Top up the wallet. |
| **Credit pool exhausted** | `CreditPoolService` reports zero available balance; provisioning skips all key updates | Fund the OpenRouter master account via Stripe or Coinbase. Run `pool-status` to verify. Reduce `DEFAULT_KEY_LIMIT_USD` or `DISTRIBUTION_TOP_N` if allocations exceed pool. |
| **Kill switch active** | Runs exit immediately with policy rejection; logs show `EXECUTION_KILL_SWITCH=true` | Set `EXECUTION_KILL_SWITCH=false` and restart the server. |
| **Invalid configuration** | Server fails to start; error lists Zod validation failures | Fix the env var values listed in the error. Required vars must be non-empty strings. Numeric vars must be within their valid ranges. |
| **Bags.fm API rate limit** | Runs fail at CLAIMING with 429 errors | Bags.fm allows 1,000 req/hr. Reduce `CRON_EXPRESSION` frequency or check for duplicate scheduler instances. |

## CLI Reference

All CLI commands are invoked via:

```bash
npx tsx backend/src/cli.ts <command> [options]
```

### Strategy Management

```bash
# Create a strategy
npx tsx backend/src/cli.ts create-strategy --owner <wallet> [--source <source>] [--distribution <mode>] [--top-n <n>] [--key-limit <usd>] [--reserve <pct>] [--threshold <sol>]

# List all strategies
npx tsx backend/src/cli.ts list-strategies

# Update a strategy
npx tsx backend/src/cli.ts update-strategy --id <strategy-id> [--distribution <mode>] [--top-n <n>] [--key-limit <usd>] [--reserve <pct>] [--threshold <sol>] [--status <status>]

# Delete a strategy
npx tsx backend/src/cli.ts delete-strategy --id <strategy-id>
```

### Run Execution

```bash
# Start a new run
npx tsx backend/src/cli.ts run --strategy <strategy-id>

# Resume a failed run
npx tsx backend/src/cli.ts run --resume <run-id>
```

### Status & Monitoring

```bash
# Run status (by ID or latest for a strategy)
npx tsx backend/src/cli.ts status --run <run-id>
npx tsx backend/src/cli.ts status --strategy <strategy-id>

# Credit pool balance and runway
npx tsx backend/src/cli.ts pool-status

# Dependency health (OpenRouter + database)
npx tsx backend/src/cli.ts health
```

### Key Management

```bash
# List all OpenRouter keys
npx tsx backend/src/cli.ts list-keys

# List keys for a specific strategy
npx tsx backend/src/cli.ts list-keys --strategy <strategy-id>
```
