```
  ____  _       _    ____            _         ____             _            
 |  _ \(_)_ __ | | _| __ ) _ __ __ _(_)_ __   |  _ \ ___  _   _| |_ ___ _ __ 
 | |_) | | '_ \| |/ /  _ \| '__/ _` | | '_ \  | |_) / _ \| | | | __/ _ \ '__|
 |  __/| | | | |   <| |_) | | | (_| | | | | | |  _ < (_) | |_| | ||  __/ |   
 |_|   |_|_| |_|_|\_\____/|_|  \__,_|_|_| |_| |_| \_\___/ \__,_|\__\___|_|   
```

<p align="center">
  <strong>Turn DeFi fees into AI superpowers.</strong>
</p>

<p align="center">
  <code>Solana</code> &middot; <code>TypeScript</code> &middot; <code>Fastify</code> &middot; <code>React 19</code> &middot; <code>Docker</code> &middot; <code>300+ AI Models</code>
</p>

---

**Status:** Complete | **Chain:** Solana Mainnet | **AI Gateway:** OpenRouter | **License:** MIT
**Org:** [kr8tiv-ai](https://github.com/kr8tiv-ai) | **Ecosystem:** [$BRAIN](https://pinkyandthebrain.fun) | **Platform:** [Bags.fm](https://bags.fm) App Store

---

## What is PinkBrain Router?

Every token on [Bags.fm](https://bags.fm) generates trading fees. Most of those fees sit idle. **PinkBrain Router** changes that -- it pipes idle DeFi revenue directly into AI infrastructure, giving your community frictionless access to 300+ models through a single API key.

No subscriptions. No credit cards. No juggling billing across providers.

One key. Every model. Funded by fees your token already generates.

```
  Bags.fm fees     SOL to USDC      Bridge to        Fund OpenRouter     Provision
    accrue    -->    swap       -->    Base      -->    credit pool   -->  per-user keys
                  (Jito MEV                           (Coinbase             (auto
                  protected)                           Charge)            top-up)
```

Part of the **$BRAIN** ecosystem on [pinkyandthebrain.fun](https://pinkyandthebrain.fun).

---

## Architecture

```
 PINKBRAIN ROUTER
 ================

 ┌─────────────────────────────────────────────────────────────────────┐
 │                                                                     │
 │   ┌───────────────────────────────────────────────────────────┐     │
 │   │                    REST API  (Fastify)                    │     │
 │   │                                                           │     │
 │   │   /strategies    /runs    /keys    /usage    /pool        │     │
 │   │   /stats         /health                                  │     │
 │   └──────────┬──────────────────┬──────────────┬──────────────┘     │
 │              │                  │              │                     │
 │   ┌──────────▼───┐   ┌─────────▼────┐  ┌──────▼──────────┐        │
 │   │  Scheduler   │   │   Engine     │  │  Key Manager    │        │
 │   │  (node-cron) │   │  (7-phase    │  │  (OpenRouter    │        │
 │   │              │   │   state      │  │   Management    │        │
 │   │  Configurable│   │   machine)   │  │   API)          │        │
 │   │  intervals   │   │              │  │                 │        │
 │   └──────────────┘   │  Checkpoint  │  │  Per-user keys  │        │
 │                      │  + Resume    │  │  Auto top-up    │        │
 │                      └──────────────┘  └─────────────────┘        │
 │                                                                     │
 │   ┌───────────────────────────────────────────────────────────┐     │
 │   │               External Integrations                       │     │
 │   │                                                           │     │
 │   │   Bags SDK  ·  Helius RPC/DAS  ·  Circle CCTP Bridge     │     │
 │   │   Coinbase Charge  ·  OpenRouter  ·  Jito Bundles        │     │
 │   └───────────────────────────────────────────────────────────┘     │
 │                                                                     │
 │   ┌───────────────────────────────────────────────────────────┐     │
 │   │                Dashboard  (React 19 + Vite)               │     │
 │   │                                                           │     │
 │   │   Strategies  ·  Runs  ·  Key Manager  ·  Usage Charts   │     │
 │   │   Credit Pool  ·  Health  ·  Stats  ·  Wallet Connect    │     │
 │   └───────────────────────────────────────────────────────────┘     │
 │                                                                     │
 │   ┌───────────────────────────────────────────────────────────┐     │
 │   │                     Data Layer                            │     │
 │   │   SQLite (10 migrations)  ·  Immutable audit trail        │     │
 │   └───────────────────────────────────────────────────────────┘     │
 └─────────────────────────────────────────────────────────────────────┘
          |                    |                    |
          v                    v                    v
    ┌───────────┐       ┌────────────┐       ┌────────────┐
    │  Solana   │       │  Bags.fm   │       │ OpenRouter │
    │  Mainnet  │       │  Platform  │       │ AI Gateway │
    │           │       │            │       │            │
    │ Fee vaults│       │ Trade API  │       │ 300+ models│
    │ SPL/SOL   │       │ App Store  │       │ Key mgmt   │
    │ Jito MEV  │       │ Agent API  │       │ Usage API  │
    └───────────┘       └────────────┘       └────────────┘
```

---

## The Engine: 7-Phase Pipeline

PinkBrain Router operates as a **checkpointed state machine**. If any phase fails, it resumes from the last successful checkpoint on the next cycle. Every phase transition is logged in an immutable audit trail.

| Phase | Operation | Detail |
|:-----:|-----------|--------|
| **1** | **Claim** | Collect accrued Bags.fm fees once SOL threshold is met |
| **2** | **Swap** | Convert SOL to USDC via Bags trade API with Jito MEV protection |
| **3** | **Bridge** | Move USDC from Solana to Base via Circle CCTP |
| **4** | **Fund** | Purchase OpenRouter credits via Coinbase Charge on EVM |
| **5** | **Allocate** | Calculate per-user credit splits based on distribution mode |
| **6** | **Provision** | Create or top-up OpenRouter API keys for each qualifying holder |
| **7** | **Repeat** | Next scheduled cycle auto-tops all limits |

---

## Features

**Fee Automation**
- Automated claiming from Bags.fm fee vaults with configurable SOL thresholds
- SOL-to-USDC conversion via ecosystem-compliant Bags trade API
- Jito bundle submission for MEV-protected swaps (anti-sandwich)

**Cross-Chain Bridge**
- Circle CCTP bridge from Solana USDC to Base USDC
- EVM execution via viem for OpenRouter credit purchases

**AI Access**
- 300+ model access: Claude, GPT-4, Gemini, Llama, Mistral, DeepSeek, and more
- Per-user API key provisioning via OpenRouter Management API
- Usage tracking with daily, weekly, and monthly granularity
- Auto top-up spending limits on each engine cycle

**Distribution Modes**

| Mode | Description |
|------|-------------|
| Owner Only | All credits to the token creator |
| Top N Holders | Credits to top N holders by balance |
| Equal Split | Equal allocation across qualifying holders |
| Weighted | Proportional to token holdings |
| Custom List | Manual wallet-to-allocation mapping |

**Safety & Reliability**
- Dry-run mode for simulation without execution
- Kill switch for emergency pause
- Daily run caps and per-route rate limiting
- Circuit breaker pattern on external calls
- Checkpointed state machine with automatic resume
- Immutable audit trail with transaction signatures

**Deployment**
- Multi-stage Docker builds with health-check-gated startup
- Docker Compose orchestration (backend + frontend)
- Persistent data volumes for SQLite

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Node.js 22, TypeScript, Fastify, SQLite |
| **Frontend** | React 19, Vite, Tailwind CSS, TanStack Query, Recharts |
| **Wallet** | Solana Wallet Adapter (Phantom, Solflare, etc.) |
| **Blockchain** | Solana (web3.js), Bags SDK, Helius RPC + DAS API |
| **Cross-chain** | Circle CCTP (Solana to Base), viem |
| **AI Gateway** | OpenRouter Management API |
| **Payments** | Coinbase Charge (EVM) |
| **MEV Protection** | Jito block engine bundle submission |
| **Scheduling** | node-cron with configurable intervals |
| **Validation** | Zod schemas for config + API payloads |
| **Deployment** | Docker multi-stage, Docker Compose |

---

## Getting Started

### Prerequisites

- Node.js 20+
- A [Bags.fm](https://bags.fm) developer account + API key
- A [Helius](https://helius.dev) API key
- An [OpenRouter](https://openrouter.ai) Management API key
- A Solana wallet with signing authority over your fee vaults

### Quick Start

```bash
# Clone
git clone https://github.com/kr8tiv-ai/PinkBrain-Router.git
cd PinkBrain-Router

# Backend
cd backend
npm install
cp .env.example .env
# Fill in your API keys and signer credentials
npm run dev

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

### Docker Deployment

```bash
# Copy and configure environment
cp .env.example .env

# Build and launch both services
docker compose up --build -d

# Verify health
docker compose ps
docker compose logs -f
```

The frontend starts on port **80** and waits for the backend health check on port **3001** before accepting traffic.

---

## Environment Variables

| Variable | Required | Description |
|----------|:--------:|-------------|
| `BAGS_API_KEY` | Yes | Bags.fm developer API key |
| `HELIUS_API_KEY` | Yes | Helius RPC + DAS API key |
| `OPENROUTER_MANAGEMENT_KEY` | Yes | OpenRouter Management API key |
| `API_AUTH_TOKEN` | Yes | Bearer token for PinkBrain API routes |
| `SIGNER_PRIVATE_KEY` | Yes | Solana signer (base58 or JSON array) |
| `EVM_PRIVATE_KEY` | Yes | EVM signer for CCTP bridge transactions |
| `FEE_THRESHOLD_SOL` | No | Min SOL before claiming (default: `5`) |
| `DEFAULT_KEY_LIMIT_USD` | No | Per-user spending limit (default: `$10`) |
| `DISTRIBUTION_MODE` | No | `OWNER_ONLY` / `TOP_N_HOLDERS` / `EQUAL_SPLIT` / `WEIGHTED` / `CUSTOM_LIST` |
| `CRON_EXPRESSION` | No | Engine schedule (default: `0 */6 * * *`) |
| `MAX_DAILY_RUNS` | No | Daily run cap (default: `4`) |
| `DRY_RUN` | No | Simulate without executing (default: `false`) |
| `EXECUTION_KILL_SWITCH` | No | Emergency pause (default: `false`) |

See [`.env.example`](./.env.example) for the full list.

---

## API Reference

All endpoints require `Authorization: Bearer <API_AUTH_TOKEN>`.

### Strategies

```
GET    /api/strategies          List all strategies
POST   /api/strategies          Create new strategy
GET    /api/strategies/:id      Get strategy details
PATCH  /api/strategies/:id      Update strategy config
POST   /api/strategies/:id/enable    Enable strategy
POST   /api/strategies/:id/disable   Disable strategy
```

### Runs

```
GET    /api/runs                List runs (filterable by strategy)
POST   /api/runs                Trigger manual run
GET    /api/runs/:id            Get run details + phase log
POST   /api/runs/:id/resume     Resume failed run from checkpoint
```

### Keys

```
GET    /api/keys                List all provisioned user keys
GET    /api/keys/:wallet        Get key details for a wallet
POST   /api/keys/:wallet/rotate Rotate a user's API key
DELETE /api/keys/:wallet        Revoke and delete a user's key
GET    /api/keys/:wallet/usage  Usage breakdown (daily/weekly/monthly)
```

### Credit Pool & Stats

```
GET    /api/pool                Pool balance, allocated, remaining
GET    /api/pool/history        Funding + allocation history
GET    /api/stats               Aggregate stats (SOL claimed, USD converted, keys provisioned)
GET    /api/health              Dependency health check (Bags, Helius, OpenRouter, DB)
```

---

## The PinkBrain Ecosystem

PinkBrain Router is the second application in the **$BRAIN** family on Bags.fm:

| App | Pipeline | Status |
|-----|----------|--------|
| [**PinkBrain LP**](https://github.com/kr8tiv-ai/PinkBrain-lp) | Fees --> Permanently locked Meteora liquidity | Complete |
| **PinkBrain Router** *(this repo)* | Fees --> OpenRouter API credits + per-user keys | Complete |

Both apps share the same input (Bags.fm platform fees) but serve different purposes. LP locks liquidity. Router distributes AI access.

---

## Roadmap

| Phase | Focus | Status |
|:-----:|-------|:------:|
| 1 | Foundation -- SDK integrations, DB schema, client wrappers | Done |
| 2 | Core Engine -- 7-phase state machine, CCTP bridge, EVM funding | Done |
| 3 | REST API + Dashboard -- Strategy management, key viewer, usage charts | Done |
| 4 | Hardening -- Security review, CI/CD, Docker deployment | Done |

---

## Links

| | |
|---|---|
| **$BRAIN** | [pinkyandthebrain.fun](https://pinkyandthebrain.fun) |
| **PinkBrain LP** | [github.com/kr8tiv-ai/PinkBrain-lp](https://github.com/kr8tiv-ai/PinkBrain-lp) |
| **Bags.fm** | [bags.fm](https://bags.fm) |
| **OpenRouter** | [openrouter.ai](https://openrouter.ai) |
| **Helius** | [helius.dev](https://helius.dev) |
| **Circle CCTP** | [circle.com/cross-chain-transfer-protocol](https://www.circle.com/cross-chain-transfer-protocol) |

---

## Contributing

```bash
git checkout -b feature/your-feature
# make changes
git add .
git commit -m "feat: your feature"
git push -u origin feature/your-feature
# open a PR on GitHub
```

---

## License

MIT

---

<p align="center">
  Built by <a href="https://github.com/kr8tiv-ai">kr8tiv.ai</a> for the <a href="https://bags.fm">Bags.fm</a> ecosystem<br/>
  <sub>Fees in. Intelligence out. That's the <strong>$BRAIN</strong>.</sub>
</p>
