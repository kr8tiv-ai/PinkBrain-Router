# PRD: Bags App Store — OpenRouter Credit Engine

> **Codename**: CreditBrain
> **Version**: 1.0.0
> **Date**: 2026-03-28
> **Status**: Draft
> **Modeled After**: [PinkBrain LP](https://github.com/kr8tiv-ai/PinkBrain-lp) (fee → liquidity engine)
> **Target Platform**: [Bags.fm App Store](https://bags.fm)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Product Overview](#3-product-overview)
4. [System Architecture](#4-system-architecture)
5. [Fee Conversion Pipeline — State Machine](#5-fee-conversion-pipeline--state-machine)
6. [OpenRouter Integration Deep-Dive](#6-openrouter-integration-deep-dive)
7. [Bags.fm Platform Integration](#7-bagsfm-platform-integration)
8. [Technical Specifications](#8-technical-specifications)
9. [Data Models](#9-data-models)
10. [API Endpoints](#10-api-endpoints)
11. [Security & Safety](#11-security--safety)
12. [Tech Stack](#12-tech-stack)
13. [Roadmap](#13-roadmap)
14. [Success Metrics](#14-success-metrics)
15. [Reference Documentation](#15-reference-documentation)

---

## 1. Executive Summary

### One-Liner

**CreditBrain** is a Bags.fm App Store application that automatically converts accrued platform fees into OpenRouter API credits, issuing each user a personal AI API key with auto-topped spending limits — turning idle DeFi fees into 300+ AI model access.

### Vision

Every token project on Bags.fm generates trading fees. Today those fees sit idle or are manually claimed. CreditBrain creates a **fee-to-AI-credits compounding loop**: fees accrue → get claimed → convert to USDC → fund an OpenRouter credit pool → provision per-user API keys with spending limits. Users get frictionless access to Claude, GPT-4, Gemini, Llama, and 300+ other AI models — paid for by their own DeFi activity.

### Value Proposition

| Stakeholder | Value |
|---|---|
| **Token holders** | Passive AI infrastructure access funded by fees they already generate |
| **Token creators** | New utility for their token — "hold my token, get AI API access" |
| **Bags.fm ecosystem** | Novel app category driving DAU, MRR, and platform stickiness |
| **Developers** | Pre-funded API keys for building AI-powered tools on Solana |

### How It Compares to PinkBrain LP

| Aspect | PinkBrain LP | CreditBrain |
|---|---|---|
| **Input** | Bags.fm platform fees (SOL) | Bags.fm platform fees (SOL) |
| **Conversion** | SOL → Token pair → Meteora DAMM v2 LP | SOL → USDC → OpenRouter credits |
| **Output** | Permanently locked liquidity + LP fee distribution | Per-user API keys with auto-topped spending limits |
| **Compounding** | LP fees re-compound into more locked LP | Usage tracking → auto-top-up from next fee claim |
| **Distribution** | Owner-only or top-100 holders | Per-user key provisioning with configurable limits |
| **Irreversibility** | Permanent LP lock (on-chain) | Credits consumed (non-reversible by nature) |

---

## 2. Problem Statement

### Idle Fees
Bags.fm token projects generate trading fees continuously. Without automation, these fees:
- Sit unclaimed in fee vaults
- Require manual claiming and management
- Provide no ongoing utility to holders

### Fragmented AI Access
AI API access today is:
- **Expensive** — Individual subscriptions to OpenAI, Anthropic, Google add up
- **Fragmented** — Different keys, billing, and rate limits per provider
- **Inaccessible** — Crypto-native users lack easy on-ramp to AI infrastructure
- **Underutilized** — Most developers don't have budget for multi-model experimentation

### The Gap
No product exists that bridges DeFi fee generation with AI API provisioning. CreditBrain fills this gap by creating a programmatic pipeline from on-chain fees to off-chain AI infrastructure.

---

## 3. Product Overview

### The Fee-to-Credits Compounding Loop

```
┌─────────────────────────────────────────────────────────────────┐
│                    CREDITBRAIN COMPOUNDING LOOP                  │
│                                                                 │
│   Bags.fm fees accrue (configurable SOL threshold)              │
│       ↓                                                         │
│   Claim fees from Bags.fm fee vaults                            │
│       ↓                                                         │
│   Swap SOL → USDC via Bags trade API                            │
│       ↓                                                         │
│   Fund master OpenRouter account (manual/auto top-up)           │
│       ↓                                                         │
│   Provision or top-up per-user API key spending limits           │
│       ↓                                                         │
│   User accesses 300+ AI models via their personal API key       │
│       ↓                                                         │
│   Usage tracked per-key (daily/weekly/monthly)                  │
│       ↓                                                         │
│   Next fee claim cycle → top-up key limits again                │
│       ↓                                                         │
│   (Loop repeats)                                                │
└─────────────────────────────────────────────────────────────────┘
```

### Core Features

1. **Automated Fee Claiming** — Monitor and claim Bags.fm fees when threshold is met
2. **SOL-to-USDC Conversion** — Swap via Bags trade API to maintain ecosystem compliance
3. **Credit Pool Management** — Track master account balance and fund via auto top-up
4. **Per-User Key Provisioning** — Programmatically create OpenRouter API keys with spending limits
5. **Usage Dashboard** — Real-time per-user usage, remaining balance, model breakdown
6. **Auto Top-Up Cycle** — Each fee claim cycle replenishes user key limits
7. **Distribution Modes** — Owner-only, top-N holders, or custom allocation rules
8. **Dry-Run Mode** — Non-destructive execution for testing
9. **Kill Switch** — Emergency pause all operations

### User Flows

**Flow 1: Token Creator Setup**
1. Install CreditBrain from Bags.fm App Store
2. Connect wallet + authorize Bags Agent
3. Configure strategy: fee source, claim threshold, distribution mode
4. Set per-user credit allocation rules (equal split, weighted by holdings, custom)
5. CreditBrain begins automated compounding

**Flow 2: Token Holder Receives API Key**
1. Hold qualifying token (configured by creator)
2. CreditBrain detects holder via Helius DAS API snapshot
3. System provisions OpenRouter API key with spending limit
4. User receives key via dashboard notification or on-chain message
5. User calls `https://openrouter.ai/api/v1/chat/completions` with their key
6. Key auto-tops on each fee claim cycle

**Flow 3: Developer Integration**
1. Receive CreditBrain-provisioned API key
2. Drop into any OpenAI-compatible client (change base URL to `openrouter.ai/api/v1`)
3. Access 300+ models: Claude, GPT-4, Gemini, Llama, Mistral, DeepSeek, etc.
4. Monitor usage via CreditBrain dashboard or OpenRouter activity page

---

## 4. System Architecture

### High-Level Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          CREDITBRAIN SYSTEM                              │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │                     REST API (Fastify)                           │    │
│  │   /api/strategies  /api/runs  /api/keys  /api/usage  /api/stats │    │
│  └──────────────────────────┬───────────────────────────────────────┘    │
│                              │                                           │
│            ┌─────────────────┼──────────────────┐                        │
│            │                 │                  │                         │
│     ┌──────▼──────┐  ┌──────▼───────┐  ┌───────▼───────┐                │
│     │  Scheduler   │  │   Engine     │  │  Key Manager  │                │
│     │ (node-cron)  │  │ (State Mach) │  │ (OpenRouter)  │                │
│     └──────┬──────┘  └──────┬───────┘  └───────┬───────┘                │
│            │                │                   │                         │
│            └────────┬───────┘                   │                         │
│                     │                           │                         │
│  ┌──────────────────┼───────────────────────────┼──────────────────┐     │
│  │                  │                           │                  │     │
│  │  ┌───────────┐  │  ┌──────────────┐  ┌──────▼──────┐  ┌──────┐│     │
│  │  │ Bags      │  │  │ Helius       │  │ OpenRouter  │  │SQLite││     │
│  │  │ Client    │  │  │ Client       │  │ Client      │  │  DB  ││     │
│  │  │           │  │  │              │  │             │  │      ││     │
│  │  │- claim    │  │  │- Priority    │  │- Mgmt API   │  │State ││     │
│  │  │- swap     │  │  │  fees        │  │- Key CRUD   │  │Audit ││     │
│  │  │- trade    │  │  │- DAS API     │  │- Credits    │  │Keys  ││     │
│  │  │- fees     │  │  │- Holders     │  │- Usage      │  │      ││     │
│  │  └───────────┘  │  └──────────────┘  └─────────────┘  └──────┘│     │
│  │                 EXTERNAL INTEGRATIONS                          │     │
│  └───────────────────────────────────────────────────────────────┘     │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │                    React Frontend (Vite)                         │    │
│  │   Dashboard  |  Strategy Config  |  Key Manager  |  Usage Stats │    │
│  └──────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────┘

          │                    │                    │
          ▼                    ▼                    ▼
   ┌─────────────┐    ┌──────────────┐    ┌────────────────┐
   │  Solana      │    │  Bags.fm     │    │  OpenRouter    │
   │  Mainnet     │    │  Platform    │    │  API Gateway   │
   │              │    │              │    │                │
   │  Fee vaults  │    │  Trade API   │    │  300+ models   │
   │  SPL tokens  │    │  Fee vaults  │    │  Key mgmt      │
   │  Tx confirm  │    │  App Store   │    │  Usage track   │
   └─────────────┘    └──────────────┘    └────────────────┘
```

### Service Layer

| Service | Responsibility | Modeled After (PinkBrain LP) |
|---|---|---|
| **StrategyService** | CRUD for credit strategies, persistence | `backend/src/services/StrategyService.ts` |
| **RunService** | Lifecycle management for compounding runs | `backend/src/engine/RunService.ts` |
| **KeyManagerService** | OpenRouter key CRUD, limit management | **NEW** — no PinkBrain equivalent |
| **CreditPoolService** | Track master account balance, fund allocation | **NEW** — replaces MeteoraClient role |
| **AuditService** | Immutable audit trail for every phase transition | `backend/src/engine/AuditService.ts` |
| **ExecutionPolicy** | Runtime guards (dry-run, kill-switch, rate limits) | `backend/src/engine/ExecutionPolicy.ts` |
| **HealthService** | Dependency readiness checks | `backend/src/services/HealthService.ts` |
| **DistributionService** | Holder snapshots + allocation calculation | `backend/src/distribution/` |

---

## 5. Fee Conversion Pipeline — State Machine

### Phase Pipeline (4-Phase State Machine)

```
PENDING
  ↓
CLAIMING ─── Claim Bags.fm fees when SOL threshold met
  ↓
SWAPPING ─── Convert SOL → USDC via Bags trade API
  ↓
ALLOCATING ── Calculate per-user credit allocations
  ↓
PROVISIONING ─ Create/update OpenRouter API keys with new limits
  ↓
COMPLETE
  ↓ (if any phase fails)
FAILED ──── Retry from last successful phase (checkpointed)
```

### Phase Details

#### Phase 1: CLAIMING
- Query Bags.fm API for claimable fee positions
- Check total against configured SOL threshold (default: 5 SOL)
- Generate claim transaction via Bags SDK
- Sign + send via Helius RPC with priority fees
- Confirm on-chain
- **Checkpoint**: Claimed SOL amount + tx signature stored

#### Phase 2: SWAPPING
- Route claimed SOL through Bags trade API (maintains ecosystem compliance)
- Swap SOL → USDC (or configured stablecoin)
- Configurable slippage (default: 50 bps, max: 1000 bps)
- Sign + send swap transaction
- Confirm on-chain
- **Checkpoint**: USDC amount received + tx signature stored

#### Phase 3: ALLOCATING
- Query Helius DAS API for current token holder snapshot
- Filter protocol/burn addresses
- Calculate per-user allocation based on strategy mode:
  - **EQUAL_SPLIT**: Total USDC / number of qualifying holders
  - **WEIGHTED_BY_HOLDINGS**: Proportional to token balance
  - **OWNER_ONLY**: All credits to token creator
  - **TOP_N_HOLDERS**: Top N holders by balance (configurable N)
  - **CUSTOM_LIST**: Manually specified wallet → allocation mapping
- **Checkpoint**: Allocation table stored (wallet → USD amount)

#### Phase 4: PROVISIONING
- For each allocated user:
  - **If no key exists**: Create new OpenRouter API key via Management API
    ```
    POST /api/v1/keys
    { "name": "creditbrain-<wallet>", "limit": <allocation_usd>, "limit_reset": null }
    ```
  - **If key exists**: Update spending limit via Management API
    ```
    PATCH /api/v1/keys/<hash>
    { "limit": <current_limit + allocation_usd> }
    ```
  - Store key hash + provisioned amount in database
- **Checkpoint**: All key operations logged with hashes

### State Machine Transitions

```
┌─────────┐   start   ┌──────────┐  success  ┌──────────┐  success  ┌────────────┐  success  ┌──────────────┐  success  ┌──────────┐
│ PENDING │──────────→│ CLAIMING │─────────→│ SWAPPING │─────────→│ ALLOCATING │─────────→│ PROVISIONING │─────────→│ COMPLETE │
└─────────┘           └────┬─────┘          └────┬─────┘          └─────┬──────┘          └──────┬───────┘          └──────────┘
                           │                     │                      │                        │
                           │ fail                │ fail                 │ fail                   │ fail
                           ▼                     ▼                      ▼                        ▼
                      ┌────────┐            ┌────────┐             ┌────────┐              ┌────────┐
                      │ FAILED │            │ FAILED │             │ FAILED │              │ FAILED │
                      └────────┘            └────────┘             └────────┘              └────────┘
                           │                     │                      │                        │
                           └─────────────────────┴──────────────────────┴────────────────────────┘
                                                          │
                                                     resume from
                                                   last checkpoint
```

---

## 6. OpenRouter Integration Deep-Dive

### 6.1 Management API Keys

CreditBrain requires an **OpenRouter Management API key** — a special administrative credential created through the OpenRouter dashboard that enables programmatic key management but **cannot** be used for inference.

**Setup**:
1. Create account at [openrouter.ai](https://openrouter.ai)
2. Navigate to Settings → Management API Keys
3. Generate a management key
4. Store as `OPENROUTER_MANAGEMENT_KEY` in environment

**Documentation**: [openrouter.ai/docs/guides/overview/auth/management-api-keys](https://openrouter.ai/docs/guides/overview/auth/management-api-keys)

### 6.2 Key CRUD Operations

All operations use base URL `https://openrouter.ai/api/v1` with header `Authorization: Bearer <MANAGEMENT_KEY>`.

#### Create Key (POST /keys)
```json
// Request
{
  "name": "creditbrain-<wallet_address_short>",
  "limit": 25.00,
  "limit_reset": "monthly",
  "include_byok_in_limit": false,
  "expires_at": "2027-01-01T00:00:00Z"
}

// Response (201)
{
  "key": "sk-or-v1-xxxxx",       // ONLY shown once — store securely
  "data": {
    "hash": "abc123def456",
    "name": "creditbrain-7xKq...",
    "disabled": false,
    "limit": 25.00,
    "limit_remaining": 25.00,
    "usage": 0,
    "usage_daily": 0,
    "usage_weekly": 0,
    "usage_monthly": 0,
    "created_at": "2026-03-28T...",
    "updated_at": "2026-03-28T...",
    "expires_at": "2027-01-01T00:00:00Z"
  }
}
```

#### List Keys (GET /keys)
```json
// Response
{
  "data": [
    {
      "hash": "abc123",
      "name": "creditbrain-7xKq...",
      "limit": 25.00,
      "limit_remaining": 18.50,
      "usage": 6.50,
      "usage_daily": 1.20,
      "usage_weekly": 4.30,
      "usage_monthly": 6.50
    }
  ]
}
```

#### Update Key (PATCH /keys/:hash)
```json
// Request — top up spending limit after new fee claim
{
  "limit": 50.00    // Increase from 25 to 50 after new allocation
}
```

#### Delete Key (DELETE /keys/:hash)
Used for key rotation or user removal.

#### Check Key Balance (GET /key)
```json
// With user's API key as Bearer token
// Response
{
  "data": {
    "limit": 50.00,
    "limit_remaining": 32.50,
    "usage": 17.50,
    "usage_daily": 3.20,
    "usage_weekly": 12.00,
    "usage_monthly": 17.50
  }
}
```

**Documentation**: [openrouter.ai/docs/api/api-reference/api-keys/create-keys](https://openrouter.ai/docs/api/api-reference/api-keys/create-keys)

### 6.3 Credit Pool Model

OpenRouter does **not** offer a programmatic credit purchase API. The funding model is:

```
┌──────────────────────────────────────────────────────────┐
│              CREDIT POOL ARCHITECTURE                     │
│                                                          │
│  Master OpenRouter Account                               │
│  ├── Credit Balance: $X,XXX.XX                           │
│  ├── Auto Top-Up: Enabled (threshold: $100)              │
│  ├── Funding: Stripe (card) or Coinbase (USDC)           │
│  │                                                       │
│  ├── Management Key: sk-mgmt-xxxxx                       │
│  │   ├── User Key 1: sk-or-v1-aaa  (limit: $25)         │
│  │   ├── User Key 2: sk-or-v1-bbb  (limit: $50)         │
│  │   ├── User Key 3: sk-or-v1-ccc  (limit: $10)         │
│  │   └── User Key N: sk-or-v1-nnn  (limit: $XX)         │
│  │                                                       │
│  └── All keys draw from shared credit pool               │
└──────────────────────────────────────────────────────────┘
```

**Critical Design Decision**: Since credits cannot be purchased programmatically, CreditBrain operates a **credit pool model**:
1. The USDC from fee swaps is sent to a treasury wallet
2. The operator periodically funds the OpenRouter master account (manual top-up or auto top-up via Stripe)
3. Per-user API keys have spending limits that sum to ≤ total pool balance
4. The `CreditPoolService` tracks the pool balance and prevents over-allocation

**Future Enhancement**: If OpenRouter adds a programmatic purchase API, the pipeline becomes fully automated end-to-end.

### 6.4 Usage Tracking

Per-key usage is tracked by OpenRouter at multiple granularities:

| Metric | Description | API Field |
|---|---|---|
| `usage` | All-time total spend (USD) | `GET /keys/:hash` |
| `usage_daily` | Current UTC day spend | `GET /keys/:hash` |
| `usage_weekly` | Current Mon-Sun week spend | `GET /keys/:hash` |
| `usage_monthly` | Current calendar month spend | `GET /keys/:hash` |
| `limit_remaining` | Credits left before 402 error | `GET /keys/:hash` |

CreditBrain polls usage periodically (configurable interval, default: 15 min) and stores historical data locally for dashboard display.

**Documentation**: [openrouter.ai/docs/api/reference/limits](https://openrouter.ai/docs/api/reference/limits)

### 6.5 OAuth PKCE (Alternative Flow)

For users who prefer to manage their own OpenRouter accounts:

```
1. User clicks "Connect OpenRouter" in CreditBrain dashboard
2. Redirect to: https://openrouter.ai/auth?callback_url=<CALLBACK>&code_challenge=<HASH>&code_challenge_method=S256
3. User authorizes on OpenRouter
4. Redirect back with ?code=AUTH_CODE
5. Exchange: POST /api/v1/auth/keys { "code": "...", "code_verifier": "...", "code_challenge_method": "S256" }
6. Receive user-controlled API key
7. CreditBrain tracks but does not manage this key's limits
```

This shifts billing responsibility to the user. CreditBrain still tracks fee-to-credit conversion ratios for transparency.

**Documentation**: [openrouter.ai/docs/guides/overview/auth/oauth](https://openrouter.ai/docs/guides/overview/auth/oauth)

### 6.6 What Users Get Access To

With their provisioned API key, users can access **300+ models from 60+ providers**:

| Provider | Notable Models |
|---|---|
| **Anthropic** | Claude Opus 4, Claude Sonnet 4, Claude Haiku |
| **OpenAI** | GPT-4o, GPT-4 Turbo, o1, o3 |
| **Google** | Gemini 2.5 Pro, Gemini 2.5 Flash |
| **Meta** | Llama 4 405B, Llama 4 70B |
| **Mistral** | Mistral Large, Codestral |
| **DeepSeek** | DeepSeek V3, DeepSeek R1 |
| **Cohere** | Command R+, Aya |
| **And 50+ more** | Qwen, Nous, Perplexity, etc. |

All via a single OpenAI-compatible endpoint: `POST https://openrouter.ai/api/v1/chat/completions`

**Full model list**: [openrouter.ai/models](https://openrouter.ai/models)

### 6.7 OpenRouter Pricing Impact

- **Credit purchase fee**: 5.5% ($0.80 minimum) via card, 5% via crypto
- **Per-token pricing**: Zero markup — same rates as going direct to providers
- **Effective cost**: For every $100 in USDC converted, users get ~$94.50 in inference credits
- **Free models**: 25+ models with zero per-token cost (rate-limited)

**Documentation**: [openrouter.ai/pricing](https://openrouter.ai/pricing)

---

## 7. Bags.fm Platform Integration

### 7.1 Bags SDK

CreditBrain integrates with Bags.fm via the official SDK:

```
npm install @bagsfm/bags-sdk@^1.3.4
```

**Key SDK Methods**:
- `getClaimablePositions()` — List fee vaults with claimable balances
- `getTotalClaimableSol()` — Aggregate claimable SOL across positions
- `getClaimTransactions()` — Generate claim transaction instructions
- `getTradeQuote(tokenIn, tokenOut, amount)` — Get swap quote via Bags trade API
- `createSwapTransaction(quote)` — Generate swap transaction

### 7.2 Fee Sources

| Source Type | Description |
|---|---|
| `CLAIMABLE_POSITIONS` | From Bags.fm pool fee vaults |
| `PARTNER_FEES` | From custom partner fee vaults |

### 7.3 Bags Agent Authentication

Two authentication models (identical to PinkBrain LP):

**Option 1: Private Key (simpler, less secure)**
```env
SIGNER_PRIVATE_KEY=<base58_or_json_array>
```

**Option 2: Bags Agent (recommended)**
```env
BAGS_AGENT_USERNAME=<username>
BAGS_AGENT_JWT=<jwt_token>
BAGS_AGENT_WALLET_ADDRESS=<wallet_pubkey>
```

CLI helper:
```bash
npm run agent -- auth init --username <username>
npm run agent -- auth login
npm run agent -- wallet export --token <jwt> --wallet <address> --env
```

### 7.4 Bags App Store Listing

CreditBrain must comply with Bags App Store listing requirements:
- App metadata (name, description, icon, screenshots)
- Bags API key integration
- Fee routing through Bags trade API (ecosystem compliance)
- Health endpoint for store monitoring

### 7.5 Bags Hackathon Alignment (Q1 2026, $4M Pool)

Scoring criteria:
- **50%**: On-chain metrics (market cap, trading volume, active traders)
- **50%**: App traction (Monthly Recurring Revenue, Daily Active Users)

CreditBrain drives both:
- **On-chain**: Every fee claim + swap = on-chain transactions + trading volume
- **App traction**: Recurring fee claims = MRR; daily API key usage = DAU

---

## 8. Technical Specifications

### 8.1 Environment Configuration

```env
# === REQUIRED ===
BAGS_API_KEY=<from bags.fm/developers>
HELIUS_API_KEY=<from helius.dev>
OPENROUTER_MANAGEMENT_KEY=<from openrouter.ai dashboard>
API_AUTH_TOKEN=<bearer token for CreditBrain API routes>
SOLANA_NETWORK=mainnet-beta

# === FEE CLAIMING ===
FEE_THRESHOLD_SOL=5                    # Minimum SOL before claim triggers
FEE_SOURCE=CLAIMABLE_POSITIONS         # CLAIMABLE_POSITIONS | PARTNER_FEES
SWAP_SLIPPAGE_BPS=50                   # Slippage tolerance (basis points)

# === OPENROUTER ===
OPENROUTER_MANAGEMENT_KEY=sk-mgmt-xxx  # Management API key (not inference key)
DEFAULT_KEY_LIMIT_USD=10               # Default per-user spending limit
KEY_LIMIT_RESET=monthly                # daily | weekly | monthly | null
KEY_EXPIRY_DAYS=365                    # Days until key expires (0 = never)
CREDIT_POOL_RESERVE_PCT=10            # Reserve % of pool to prevent over-allocation

# === DISTRIBUTION ===
DISTRIBUTION_MODE=TOP_100_HOLDERS      # OWNER_ONLY | TOP_N_HOLDERS | EQUAL_SPLIT | CUSTOM_LIST
DISTRIBUTION_TOP_N=100                 # Number of top holders (if TOP_N_HOLDERS)
DISTRIBUTION_TOKEN_MINT=<spl_token_mint>  # Token to check holdings against

# === SCHEDULING ===
CRON_EXPRESSION="0 */6 * * *"          # Every 6 hours
MIN_CRON_INTERVAL_HOURS=1              # Minimum 1 hour between runs

# === SAFETY ===
DRY_RUN=false                          # Non-destructive test mode
EXECUTION_KILL_SWITCH=false            # Emergency pause
MAX_DAILY_RUNS=4                       # Per-strategy daily limit
MAX_CLAIMABLE_SOL_PER_RUN=100         # Per-run claim cap

# === SIGNER (choose one) ===
SIGNER_PRIVATE_KEY=<base58_or_json>    # Option 1: Direct key
# OR
BAGS_AGENT_USERNAME=<username>         # Option 2: Bags Agent
BAGS_AGENT_JWT=<jwt>
BAGS_AGENT_WALLET_ADDRESS=<pubkey>

# === SERVER ===
PORT=3001
LOG_LEVEL=info                         # debug | info | warn | error
```

### 8.2 Claim Threshold Rationale

Default threshold: **5 SOL** (lower than PinkBrain LP's 7 SOL because there's no LP position creation cost, only swap fees).

Configurable range: 1-100 SOL. Lower thresholds = more frequent claims = more on-chain activity but higher gas costs.

### 8.3 OpenRouter Client Implementation

```typescript
// src/clients/OpenRouterClient.ts

import { z } from 'zod';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

interface CreateKeyParams {
  name: string;
  limit: number | null;
  limitReset: 'daily' | 'weekly' | 'monthly' | null;
  expiresAt: string | null;
}

interface KeyData {
  hash: string;
  name: string;
  disabled: boolean;
  limit: number | null;
  limit_remaining: number | null;
  usage: number;
  usage_daily: number;
  usage_weekly: number;
  usage_monthly: number;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

class OpenRouterClient {
  constructor(private managementKey: string) {}

  async createKey(params: CreateKeyParams): Promise<{ key: string; data: KeyData }> {
    const res = await fetch(`${OPENROUTER_BASE_URL}/keys`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.managementKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: params.name,
        limit: params.limit,
        limit_reset: params.limitReset,
        expires_at: params.expiresAt,
      }),
    });
    if (!res.ok) throw new Error(`Create key failed: ${res.status}`);
    return res.json();
  }

  async updateKeyLimit(hash: string, newLimit: number): Promise<KeyData> {
    const res = await fetch(`${OPENROUTER_BASE_URL}/keys/${hash}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${this.managementKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ limit: newLimit }),
    });
    if (!res.ok) throw new Error(`Update key failed: ${res.status}`);
    return (await res.json()).data;
  }

  async getKey(hash: string): Promise<KeyData> {
    const res = await fetch(`${OPENROUTER_BASE_URL}/keys/${hash}`, {
      headers: { 'Authorization': `Bearer ${this.managementKey}` },
    });
    if (!res.ok) throw new Error(`Get key failed: ${res.status}`);
    return (await res.json()).data;
  }

  async listKeys(): Promise<KeyData[]> {
    const res = await fetch(`${OPENROUTER_BASE_URL}/keys`, {
      headers: { 'Authorization': `Bearer ${this.managementKey}` },
    });
    if (!res.ok) throw new Error(`List keys failed: ${res.status}`);
    return (await res.json()).data;
  }

  async deleteKey(hash: string): Promise<void> {
    const res = await fetch(`${OPENROUTER_BASE_URL}/keys/${hash}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${this.managementKey}` },
    });
    if (!res.ok) throw new Error(`Delete key failed: ${res.status}`);
  }

  async getCredits(): Promise<{ total_credits: number; total_usage: number }> {
    const res = await fetch(`${OPENROUTER_BASE_URL}/credits`, {
      headers: { 'Authorization': `Bearer ${this.managementKey}` },
    });
    if (!res.ok) throw new Error(`Get credits failed: ${res.status}`);
    return (await res.json()).data;
  }
}
```

---

## 9. Data Models

### 9.1 Strategy Table

```sql
CREATE TABLE strategies (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name          TEXT NOT NULL,
  owner_wallet  TEXT NOT NULL,
  token_mint    TEXT NOT NULL,          -- SPL token to track holders against
  fee_source    TEXT NOT NULL DEFAULT 'CLAIMABLE_POSITIONS',
  threshold_sol REAL NOT NULL DEFAULT 5.0,
  slippage_bps  INTEGER NOT NULL DEFAULT 50,
  distribution_mode TEXT NOT NULL DEFAULT 'TOP_100_HOLDERS',
  distribution_top_n INTEGER DEFAULT 100,
  key_limit_usd REAL NOT NULL DEFAULT 10.0,
  key_limit_reset TEXT DEFAULT 'monthly',
  cron_expression TEXT NOT NULL DEFAULT '0 */6 * * *',
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_run_id   TEXT REFERENCES runs(id)
);
```

### 9.2 Runs Table

```sql
CREATE TABLE runs (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  strategy_id   TEXT NOT NULL REFERENCES strategies(id),
  phase         TEXT NOT NULL DEFAULT 'PENDING',
  status        TEXT NOT NULL DEFAULT 'RUNNING',
  claimed_sol   REAL,
  swapped_usdc  REAL,
  allocated_usd REAL,
  keys_provisioned INTEGER DEFAULT 0,
  keys_updated  INTEGER DEFAULT 0,
  error_message TEXT,
  claim_tx      TEXT,              -- Solana tx signature
  swap_tx       TEXT,              -- Solana tx signature
  started_at    TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at  TEXT,
  CONSTRAINT valid_phase CHECK (phase IN ('PENDING','CLAIMING','SWAPPING','ALLOCATING','PROVISIONING','COMPLETE','FAILED')),
  CONSTRAINT valid_status CHECK (status IN ('RUNNING','COMPLETE','FAILED'))
);
```

### 9.3 User Keys Table

```sql
CREATE TABLE user_keys (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  strategy_id     TEXT NOT NULL REFERENCES strategies(id),
  wallet_address  TEXT NOT NULL,
  openrouter_key_hash TEXT NOT NULL UNIQUE,  -- OpenRouter key hash (NOT the key itself)
  current_limit   REAL NOT NULL DEFAULT 0,
  total_allocated REAL NOT NULL DEFAULT 0,    -- Lifetime allocated USD
  total_used      REAL NOT NULL DEFAULT 0,    -- Lifetime used USD (from polling)
  last_synced_at  TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(strategy_id, wallet_address)
);
```

### 9.4 Audit Log Table

```sql
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      TEXT NOT NULL REFERENCES runs(id),
  phase       TEXT NOT NULL,
  action      TEXT NOT NULL,
  details     TEXT,               -- JSON blob
  tx_signature TEXT,              -- Solana tx sig (if applicable)
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 9.5 Allocation Snapshots Table

```sql
CREATE TABLE allocation_snapshots (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  run_id        TEXT NOT NULL REFERENCES runs(id),
  wallet_address TEXT NOT NULL,
  token_balance  REAL NOT NULL,
  weight_pct     REAL NOT NULL,      -- Percentage of total allocation
  allocated_usd  REAL NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## 10. API Endpoints

### 10.1 Strategy Management

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/strategies` | List all strategies |
| `POST` | `/api/strategies` | Create new strategy |
| `GET` | `/api/strategies/:id` | Get strategy details |
| `PATCH` | `/api/strategies/:id` | Update strategy config |
| `DELETE` | `/api/strategies/:id` | Delete strategy |
| `POST` | `/api/strategies/:id/enable` | Enable strategy |
| `POST` | `/api/strategies/:id/disable` | Disable strategy |

### 10.2 Run Management

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/runs` | List runs (filterable by strategy) |
| `POST` | `/api/runs` | Trigger manual run for a strategy |
| `GET` | `/api/runs/:id` | Get run details + phase log |
| `POST` | `/api/runs/:id/resume` | Resume failed run from checkpoint |

### 10.3 Key Management

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/keys` | List all provisioned user keys |
| `GET` | `/api/keys/:wallet` | Get key details for a wallet |
| `POST` | `/api/keys/:wallet/rotate` | Rotate a user's API key |
| `DELETE` | `/api/keys/:wallet` | Revoke and delete a user's key |
| `GET` | `/api/keys/:wallet/usage` | Get usage breakdown for a key |

### 10.4 Credit Pool

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/pool` | Get pool balance, total allocated, remaining |
| `GET` | `/api/pool/history` | Get pool funding + allocation history |

### 10.5 Stats & Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/stats` | Aggregate stats (total claimed, converted, provisioned) |
| `GET` | `/api/health` | Dependency health check (Bags, Helius, OpenRouter, DB) |

### 10.6 Auth

All endpoints require `Authorization: Bearer <API_AUTH_TOKEN>` header. This is the CreditBrain internal auth token, separate from OpenRouter keys.

---

## 11. Security & Safety

### 11.1 Execution Controls (Inherited from PinkBrain LP)

| Control | Description | Default |
|---|---|---|
| `DRY_RUN` | Execute all phases without submitting transactions | `false` |
| `EXECUTION_KILL_SWITCH` | Emergency pause all execution | `false` |
| `MAX_DAILY_RUNS` | Cap runs per strategy per UTC day | `4` |
| `MAX_CLAIMABLE_SOL_PER_RUN` | Maximum SOL claimed per run | `100` |

### 11.2 OpenRouter-Specific Controls

| Control | Description | Default |
|---|---|---|
| `CREDIT_POOL_RESERVE_PCT` | Reserve % to prevent over-allocation | `10%` |
| `MAX_KEY_LIMIT_USD` | Maximum per-key spending limit | `500` |
| `KEY_ROTATION_DAYS` | Automatic key rotation interval | `90` |
| `USAGE_POLL_INTERVAL_MIN` | How often to sync usage data | `15` |

### 11.3 Key Security

- **Management key** stored as environment variable only — never in code or database
- **User API keys** are shown **once** at creation — only the hash is stored
- User keys are delivered via the CreditBrain dashboard over HTTPS
- Key rotation is supported and recommended every 90 days
- Keys can be disabled/deleted immediately if compromised

### 11.4 Audit Trail

Every phase transition is logged immutably:
```json
{
  "run_id": "abc123",
  "phase": "PROVISIONING",
  "action": "KEY_CREATED",
  "details": {
    "wallet": "7xKq...",
    "key_hash": "def456",
    "limit_usd": 25.00
  },
  "created_at": "2026-03-28T12:00:00Z"
}
```

### 11.5 Rate Limiting

| Integration | Limit | Strategy |
|---|---|---|
| Bags.fm API | 1,000 req/hr | Exponential backoff with priority queue |
| OpenRouter Management API | Standard rate limits | Batch key operations, respect 429 responses |
| Helius RPC | Per-plan limits | Priority fees for claim/swap txs |
| CreditBrain API | Configurable | Bearer token auth + optional IP allowlist |

---

## 12. Tech Stack

### 12.1 Full Stack (Mirroring PinkBrain LP)

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| **Runtime** | Node.js | 20+ | Server runtime |
| **Language** | TypeScript | 5.3+ | Type safety |
| **HTTP Framework** | Fastify | 5.1+ | REST API server |
| **Database** | SQLite (better-sqlite3) | — | Hackathon; PostgreSQL for prod |
| **Scheduling** | node-cron | 3.0 | Automated run triggers |
| **Logging** | Pino | 8.19 | Structured logging |
| **Validation** | Zod | 3.24+ | Schema validation |
| **CLI** | Commander | 12.0 | Strategy/run management CLI |
| **Frontend** | React + Vite | 19 / 6 | Dashboard SPA |
| **Router** | React Router | 7.1 | Frontend routing |
| **State** | TanStack React Query | 5.62 | Server state management |
| **Styling** | Tailwind CSS | 3.4 | UI styling |
| **Icons** | Lucide React | 0.468 | Icon library |
| **Testing** | Vitest | 1.3 | Unit + integration tests |
| **Linting** | ESLint | 8.57 | Code quality |

### 12.2 Blockchain Dependencies

| Package | Version | Purpose |
|---|---|---|
| `@bagsfm/bags-sdk` | ^1.3.4 | Bags.fm fee claiming + swap API |
| `@solana/web3.js` | ^1.95.0 | Solana RPC communication |
| `@solana/spl-token` | ^0.3.9 | SPL token transfers |

### 12.3 OpenRouter Dependencies

| Package | Version | Purpose |
|---|---|---|
| `@openrouter/sdk` | ^0.10.2 | TypeScript SDK (optional — can use raw fetch) |
| `@openrouter/ai-sdk-provider` | ^2.3.3 | Vercel AI SDK integration (if frontend AI features needed) |

**SDK GitHub**: [github.com/OpenRouterTeam/typescript-sdk](https://github.com/OpenRouterTeam/typescript-sdk)
**SDK npm**: [@openrouter/sdk](https://www.npmjs.com/package/@openrouter/sdk)

### 12.4 Helius Integration

| Package | Purpose |
|---|---|
| Helius JSON-RPC | Priority fee estimation, transaction confirmation |
| Helius DAS API | Token holder snapshots for distribution |

---

## 13. Roadmap

### Phase 1: Foundation & SDK Integration (Week 1-2)

**Goal**: Establish all external client integrations and basic project structure.

| Task | Description |
|---|---|
| 1.1 | Project scaffolding (monorepo, TypeScript, Fastify, SQLite) |
| 1.2 | `BagsClient` — Fee claiming + swap via Bags SDK |
| 1.3 | `HeliusClient` — RPC, priority fees, DAS holder snapshots |
| 1.4 | `OpenRouterClient` — Management API key CRUD, credits check |
| 1.5 | Database schema migrations (strategies, runs, user_keys, audit_log) |
| 1.6 | Environment config + validation (Zod schemas) |
| 1.7 | Smoke tests for all external dependencies |

### Phase 2: Core Engine & State Machine (Week 2-3)

**Goal**: Implement the 4-phase fee-to-credits pipeline with checkpointing.

| Task | Description |
|---|---|
| 2.1 | State machine implementation (PENDING → CLAIMING → SWAPPING → ALLOCATING → PROVISIONING → COMPLETE) |
| 2.2 | Phase executors: claim, swap, allocate, provision |
| 2.3 | `CreditPoolService` — Track master balance, prevent over-allocation |
| 2.4 | `KeyManagerService` — Provision, update, rotate, revoke keys |
| 2.5 | `DistributionService` — Holder snapshots + allocation calculation |
| 2.6 | `AuditService` — Immutable phase transition logging |
| 2.7 | `ExecutionPolicy` — Dry-run, kill-switch, rate limits |
| 2.8 | Scheduler (node-cron) with configurable intervals |
| 2.9 | CLI for strategy/run management |

### Phase 3: REST API & Frontend (Week 3-4)

**Goal**: Build dashboard for strategy management, key viewing, and usage monitoring.

| Task | Description |
|---|---|
| 3.1 | Fastify routes: strategies, runs, keys, pool, stats, health |
| 3.2 | React dashboard: strategy list, create, detail views |
| 3.3 | Key management UI: view provisioned keys, usage charts, rotate |
| 3.4 | Credit pool dashboard: balance, allocation history, runway estimate |
| 3.5 | Real-time usage polling + display |
| 3.6 | Bags App Store listing integration |

### Phase 4: Hardening & Launch (Week 4-5)

**Goal**: Production readiness, security review, and hackathon submission.

| Task | Description |
|---|---|
| 4.1 | Error recovery: retry logic, partial-run resumption |
| 4.2 | Key rotation automation |
| 4.3 | Security review: key storage, auth flows, input validation |
| 4.4 | Observability: structured logging, health endpoint, alerts |
| 4.5 | PostgreSQL migration path (for production scale) |
| 4.6 | Load testing: concurrent key provisioning, usage polling |
| 4.7 | Documentation: runbook, API docs, user guide |
| 4.8 | Hackathon submission materials |

---

## 14. Success Metrics

### 14.1 Bags Hackathon KPIs (50/50 Split)

**On-Chain Metrics (50%)**:
| Metric | Target | How CreditBrain Drives It |
|---|---|---|
| Trading Volume | ↑ | Every fee claim + SOL→USDC swap = on-chain trades |
| Active Traders | ↑ | Each strategy owner = active trader |
| Market Cap | ↑ | Utility drives token demand |

**App Traction (50%)**:
| Metric | Target | How CreditBrain Drives It |
|---|---|---|
| Monthly Recurring Revenue | ↑ | Recurring fee claims generate revenue |
| Daily Active Users | ↑ | Users checking API key usage / making API calls |

### 14.2 Product KPIs

| Metric | Target (30 days) |
|---|---|
| Strategies created | 50+ |
| API keys provisioned | 500+ |
| Total SOL claimed | 1,000+ |
| Total USD converted to credits | $10,000+ |
| API calls made via provisioned keys | 100,000+ |
| Unique daily API key users | 100+ |

### 14.3 Health KPIs

| Metric | Target |
|---|---|
| Pipeline success rate | >95% |
| Key provisioning latency | <5s per key |
| Usage sync freshness | <15 min delay |
| Zero security incidents | 0 key leaks, 0 unauthorized access |

---

## 15. Reference Documentation

### 15.1 OpenRouter — Official Documentation

| Resource | URL |
|---|---|
| Main Docs | [openrouter.ai/docs](https://openrouter.ai/docs) |
| Quickstart Guide | [openrouter.ai/docs/quickstart](https://openrouter.ai/docs/quickstart) |
| API Reference | [openrouter.ai/docs/api/reference/overview](https://openrouter.ai/docs/api/reference/overview) |
| Authentication | [openrouter.ai/docs/api/reference/authentication](https://openrouter.ai/docs/api/reference/authentication) |
| Management API Keys | [openrouter.ai/docs/guides/overview/auth/management-api-keys](https://openrouter.ai/docs/guides/overview/auth/management-api-keys) |
| Create API Keys | [openrouter.ai/docs/api/api-reference/api-keys/create-keys](https://openrouter.ai/docs/api/api-reference/api-keys/create-keys) |
| Credits API | [openrouter.ai/docs/api/api-reference/credits/get-credits](https://openrouter.ai/docs/api/api-reference/credits/get-credits) |
| OAuth PKCE Flow | [openrouter.ai/docs/guides/overview/auth/oauth](https://openrouter.ai/docs/guides/overview/auth/oauth) |
| BYOK (Bring Your Own Key) | [openrouter.ai/docs/guides/overview/auth/byok](https://openrouter.ai/docs/guides/overview/auth/byok) |
| Provisioning API Keys | [openrouter.ai/docs/features/provisioning-api-keys](https://openrouter.ai/docs/features/provisioning-api-keys) |
| Rate Limits | [openrouter.ai/docs/api/reference/limits](https://openrouter.ai/docs/api/reference/limits) |
| Pricing | [openrouter.ai/pricing](https://openrouter.ai/pricing) |
| Enterprise | [openrouter.ai/enterprise](https://openrouter.ai/enterprise) |
| FAQ | [openrouter.ai/docs/faq](https://openrouter.ai/docs/faq) |
| Models List | [openrouter.ai/models](https://openrouter.ai/models) |
| OpenAPI Spec (YAML) | [openrouter.ai/openapi.yaml](https://openrouter.ai/openapi.yaml) |
| OpenAPI Spec (JSON) | [openrouter.ai/openapi.json](https://openrouter.ai/openapi.json) |
| Announcements | [openrouter.ai/announcements](https://openrouter.ai/announcements) |
| Frameworks & Integrations | [openrouter.ai/docs/guides/community/frameworks-and-integrations-overview](https://openrouter.ai/docs/guides/community/frameworks-and-integrations-overview) |

### 15.2 OpenRouter — GitHub Repositories

| Repository | URL | Description |
|---|---|---|
| **TypeScript SDK** | [github.com/OpenRouterTeam/typescript-sdk](https://github.com/OpenRouterTeam/typescript-sdk) | Official TS/JS SDK (npm: `@openrouter/sdk`) |
| **Python SDK** | [github.com/OpenRouterTeam/python-sdk](https://github.com/OpenRouterTeam/python-sdk) | Official Python SDK (pip: `openrouter`) |
| **AI SDK Provider** | [github.com/OpenRouterTeam/ai-sdk-provider](https://github.com/OpenRouterTeam/ai-sdk-provider) | Vercel AI SDK provider |
| **Spawn** | [github.com/OpenRouterTeam/spawn](https://github.com/OpenRouterTeam/spawn) | Launch AI agents on any cloud |
| **Examples** | [github.com/OpenRouterTeam/openrouter-examples](https://github.com/OpenRouterTeam/openrouter-examples) | Tested integration examples |
| **Awesome OpenRouter** | [github.com/OpenRouterTeam/awesome-openrouter](https://github.com/OpenRouterTeam/awesome-openrouter) | Curated app list |
| **Docs** | [github.com/OpenRouterTeam/docs](https://github.com/OpenRouterTeam/docs) | Documentation source |
| **Nanoclaw** | [github.com/OpenRouterTeam/nanoclaw](https://github.com/OpenRouterTeam/nanoclaw) | Personal AI assistant (9K+ stars) |
| **Organization** | [github.com/OpenRouterTeam](https://github.com/OpenRouterTeam) | 38 repositories |

### 15.3 OpenRouter — npm Packages

| Package | URL | Version |
|---|---|---|
| `@openrouter/sdk` | [npmjs.com/package/@openrouter/sdk](https://www.npmjs.com/package/@openrouter/sdk) | ^0.10.2 |
| `@openrouter/ai-sdk-provider` | [npmjs.com/package/@openrouter/ai-sdk-provider](https://www.npmjs.com/package/@openrouter/ai-sdk-provider) | ^2.3.3 |
| `@openrouter/cli` | [npmjs.com/package/@openrouter/cli](https://www.npmjs.com/package/@openrouter/cli) | Latest |

### 15.4 Community Tools

| Tool | URL | Description |
|---|---|---|
| openrouter-key-manager | [github.com/humphd/openrouter-key-manager](https://github.com/humphd/openrouter-key-manager) | Bulk key management CLI |
| openrouter-kit | [github.com/mmeerrkkaa/openrouter-kit](https://github.com/mmeerrkkaa/openrouter-kit) | TS SDK with cost tracking |
| openrouter-mcp | [github.com/th3nolo/openrouter-mcp](https://github.com/th3nolo/openrouter-mcp) | MCP server for Claude Code |
| llm-openrouter | [github.com/simonw/llm-openrouter](https://github.com/simonw/llm-openrouter) | Simon Willison's LLM plugin |
| laravel-openrouter | [github.com/moe-mizrak/laravel-openrouter](https://github.com/moe-mizrak/laravel-openrouter) | Laravel integration |

### 15.5 PinkBrain LP — Reference Implementation

| Resource | URL/Path |
|---|---|
| GitHub Repository | [github.com/kr8tiv-ai/PinkBrain-lp](https://github.com/kr8tiv-ai/PinkBrain-lp) |
| Local Source | `C:\Users\lucid\Desktop\pinkbrain LP git\` |
| PRD Document | `C:\Users\lucid\Desktop\pinkbrain LP git\PRD.md` (50KB) |
| Backend Source | `C:\Users\lucid\Desktop\pinkbrain LP git\backend\src\` |
| Frontend Source | `C:\Users\lucid\Desktop\pinkbrain LP git\frontend\src\` |
| Runbook | `C:\Users\lucid\Desktop\pinkbrain LP git\docs\runbook.md` |
| Project Plan | `C:\Users\lucid\Desktop\pinkbrain LP git\.planning\PROJECT.md` |
| Requirements | `C:\Users\lucid\Desktop\pinkbrain LP git\.planning\REQUIREMENTS.md` |
| Roadmap | `C:\Users\lucid\Desktop\pinkbrain LP git\.planning\ROADMAP.md` |

### 15.6 Bags.fm Platform

| Resource | URL |
|---|---|
| Bags.fm Platform | [bags.fm](https://bags.fm) |
| Bags Developer Portal | [bags.fm/developers](https://bags.fm/developers) |
| Bags SDK (npm) | `@bagsfm/bags-sdk` |
| Bags Hackathon | Q1 2026, $4M funding pool |

### 15.7 Solana Ecosystem

| Resource | URL |
|---|---|
| Solana Web3.js | [github.com/solana-labs/solana-web3.js](https://github.com/solana-labs/solana-web3.js) |
| SPL Token | [github.com/solana-labs/solana-program-library](https://github.com/solana-labs/solana-program-library) |
| Helius RPC | [helius.dev](https://helius.dev) |
| Helius DAS API | [docs.helius.dev/compression-and-das-api](https://docs.helius.dev/compression-and-das-api) |

---

## Appendix A: Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Credit pool model vs per-user accounts | Credit pool | OpenRouter has no per-user account creation API; Management API provisions keys from shared pool |
| Swap target | USDC | Stablecoin minimizes volatility between claim and credit purchase |
| Distribution via key limits vs direct credit transfer | Key limits | OpenRouter Management API supports per-key spending limits natively |
| Database | SQLite (hackathon) → PostgreSQL (prod) | Zero-config for rapid development; migrate for scale |
| Swaps via Bags trade API | Yes | Maintains Bags ecosystem fee compliance (required for App Store) |
| Key delivery | Dashboard only (v1) | Secure HTTPS delivery; push notifications in v2 |
| Usage polling vs webhooks | Polling (15 min) | OpenRouter doesn't offer webhooks for usage; polling is sufficient |

## Appendix B: Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| OpenRouter master account depleted | High | Credit pool reserve (10%), auto top-up enabled, balance alerts |
| Key leaked by user | Medium | Per-key spending limits cap exposure; rotation support |
| Bags API downtime | Medium | Retry logic, exponential backoff, checkpoint resumption |
| SOL price volatility during swap | Low | Fast execution, configurable slippage, USDC target |
| OpenRouter rate limits on Management API | Low | Batch key operations, respect 429, backoff |
| Hackathon deadline pressure | Medium | Phase-gated delivery; MVP at Phase 2, polish at Phase 3-4 |

## Appendix C: Future Enhancements

1. **Programmatic credit purchase** — When/if OpenRouter adds a purchase API, automate end-to-end
2. **Multi-chain support** — Extend beyond Solana to EVM chains with Bags presence
3. **Model allowlisting** — Let strategy creators restrict which AI models users can access
4. **Usage-based tiering** — Higher token holders get access to more expensive models
5. **Referral system** — Users who bring new holders get bonus credits
6. **Webhook notifications** — Alert users when keys are topped up or approaching limits
7. **Mobile app** — API key management and usage monitoring on mobile
8. **On-chain receipts** — Publish credit allocation proofs on Solana for transparency

---

*This PRD will be written to `docs/plans/bags-openrouter-credit-engine-prd.md` upon approval.*
