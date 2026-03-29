<p align="center">
  <img src="https://img.shields.io/badge/PinkBrain-Router-ff69b4?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJ3aGl0ZSI+PHBhdGggZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bS0xIDE3LjkzYy0zLjk1LS40OS03LTMuODUtNy03LjkzIDAtLjYyLjA4LTEuMjEuMjEtMS43OUw5IDEzdjFjMCAxLjEuOSAyIDIgMnYxLjkzem02LjktMi41NGMtLjI2LS44MS0xLTEuMzktMS45LTEuMzloLTFWMTNjMC0uNTUtLjQ1LTEtMS0xSDh2LTJoMmMuNTUgMCAxLS40NSAxLTFWN2gyYzEuMSAwIDItLjkgMi0ydi0uNDFjMi45MyAxLjE5IDUgNC4wNiA1IDcuNDEgMCAxLjY1LS41IDMuMTktMS4zNSA0LjQ5eiIvPjwvc3ZnPg==&logoColor=white" alt="PinkBrain Router" />
</p>

<h1 align="center">PinkBrain Router</h1>

<p align="center">
  <strong>Turn DeFi fees into AI superpowers.</strong><br/>
  A <a href="https://bags.fm">Bags.fm</a> App Store engine that converts accrued platform fees into <a href="https://openrouter.ai">OpenRouter</a> API credits &mdash; giving token holders frictionless access to 300+ AI models.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-in%20development-yellow?style=flat-square" />
  <img src="https://img.shields.io/badge/platform-Bags.fm%20App%20Store-blueviolet?style=flat-square" />
  <img src="https://img.shields.io/badge/chain-Solana-9945FF?style=flat-square&logo=solana&logoColor=white" />
  <img src="https://img.shields.io/badge/AI%20gateway-OpenRouter-10A37F?style=flat-square" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" />
</p>

---

## What is PinkBrain Router?

Every token project on [Bags.fm](https://bags.fm) generates trading fees. Today those fees sit idle or are manually claimed. **PinkBrain Router** creates a fully automated pipeline that turns those idle DeFi fees into AI infrastructure for your community:

```
Bags.fm fees accrue  -->  Claim fees  -->  Swap SOL to USDC  -->  Fund OpenRouter credit pool  -->  Provision per-user API keys
```

Every qualifying token holder gets their own **OpenRouter API key** with auto-topped spending limits &mdash; paid for by the trading fees the token already generates. No subscriptions. No credit cards. No fragmented billing across AI providers.

One key. 300+ models. Claude, GPT-4, Gemini, Llama, Mistral, DeepSeek, and more.

---

## The PinkBrain Ecosystem on Bags

PinkBrain Router is the second application in the PinkBrain family:

| App | What It Does | Status |
|-----|-------------|--------|
| [**PinkBrain LP**](https://github.com/kr8tiv-ai/PinkBrain-lp) | Fees &rarr; Permanently locked Meteora liquidity | Phase 3 Complete |
| **PinkBrain Router** *(this repo)* | Fees &rarr; OpenRouter API credits + per-user keys | In Development |

Both apps share the same input (Bags.fm platform fees) but serve different purposes &mdash; LP locks liquidity, Router distributes AI access.

---

## How It Works

### The Fee-to-Credits Compounding Loop

```
                        CREDITBRAIN ENGINE
   ┌──────────────────────────────────────────────────┐
   │                                                  │
   │   1. CLAIM ── Bags.fm fees hit SOL threshold     │
   │       |                                          │
   │   2. SWAP ─── SOL --> USDC via Bags trade API    │
   │       |                                          │
   │   3. ALLOCATE ─ Calculate per-user splits        │
   │       |                                          │
   │   4. PROVISION ─ Create/top-up OpenRouter keys   │
   │       |                                          │
   │   5. REPEAT ── Next cycle auto-tops limits       │
   │                                                  │
   └──────────────────────────────────────────────────┘
```

The entire pipeline is a **4-phase state machine** with checkpointing &mdash; if any phase fails, it resumes from the last successful checkpoint. Every phase transition is logged in an immutable audit trail.

### Distribution Modes

| Mode | Description |
|------|-------------|
| **Owner Only** | All credits go to the token creator |
| **Top N Holders** | Credits distributed to top N holders by balance |
| **Equal Split** | Equal allocation across all qualifying holders |
| **Weighted** | Proportional to token holdings |
| **Custom List** | Manual wallet-to-allocation mapping |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     PINKBRAIN ROUTER                        │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                  REST API (Fastify)                    │  │
│  │  /strategies  /runs  /keys  /usage  /pool  /health    │  │
│  └─────────────────────┬─────────────────────────────────┘  │
│                        │                                    │
│     ┌──────────────────┼──────────────────┐                 │
│     │                  │                  │                  │
│  ┌──▼──────┐    ┌──────▼──────┐    ┌──────▼──────┐         │
│  │Scheduler│    │   Engine    │    │Key Manager  │         │
│  │(cron)   │    │(state mach.)│    │(OpenRouter) │         │
│  └─────────┘    └─────────────┘    └─────────────┘         │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              EXTERNAL INTEGRATIONS                     │  │
│  │  Bags SDK  ·  Helius RPC/DAS  ·  OpenRouter  ·  SQLite│  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              React Dashboard (Vite)                    │  │
│  │  Strategies  ·  Key Manager  ·  Usage Stats  ·  Pool  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         |                  |                  |
         v                  v                  v
   ┌──────────┐     ┌──────────────┐    ┌──────────────┐
   │ Solana   │     │  Bags.fm     │    │ OpenRouter   │
   │ Mainnet  │     │  Platform    │    │ AI Gateway   │
   │          │     │              │    │              │
   │ Fee      │     │ Trade API    │    │ 300+ models  │
   │ vaults   │     │ Fee vaults   │    │ Key mgmt     │
   │ SPL      │     │ App Store    │    │ Usage track  │
   └──────────┘     └──────────────┘    └──────────────┘
```

---

## Key Features

- **Automated fee claiming** from Bags.fm fee vaults with configurable SOL thresholds
- **SOL-to-USDC conversion** via Bags trade API (ecosystem-compliant swaps)
- **Per-user API key provisioning** via OpenRouter Management API
- **300+ AI model access** through a single OpenAI-compatible endpoint
- **Usage tracking** with daily, weekly, and monthly granularity per key
- **Flexible distribution** &mdash; owner-only, top-N holders, equal split, weighted, or custom
- **Safety controls** &mdash; dry-run mode, kill switch, daily run caps, spending limits
- **Checkpointed state machine** &mdash; resumes from last successful phase on failure
- **Immutable audit trail** &mdash; every operation logged with tx signatures

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Node.js 20+, TypeScript, Fastify, SQLite (PostgreSQL-ready) |
| **Blockchain** | Solana, Bags SDK, Helius RPC + DAS API |
| **AI Gateway** | OpenRouter Management API, `@openrouter/sdk` |
| **Frontend** | React 19, Vite, Tailwind CSS, TanStack React Query |
| **Scheduling** | node-cron with configurable intervals |
| **Validation** | Zod schemas for config + API payloads |

---

## Getting Started

### Prerequisites

- Node.js 20+
- A [Bags.fm](https://bags.fm) developer account + API key
- A [Helius](https://helius.dev) API key
- An [OpenRouter](https://openrouter.ai) Management API key
- A Solana wallet with signing authority over your fee vaults

### Setup

```bash
# Clone the repo
git clone https://github.com/kr8tiv-ai/PinkBrain-Router.git
cd PinkBrain-Router

# Install backend dependencies
cd backend
npm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys and configuration

# Run in development
npm run dev
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BAGS_API_KEY` | Yes | Bags.fm developer API key |
| `HELIUS_API_KEY` | Yes | Helius RPC + DAS API key |
| `OPENROUTER_MANAGEMENT_KEY` | Yes | OpenRouter Management API key |
| `API_AUTH_TOKEN` | Yes | Bearer token for CreditBrain API routes |
| `FEE_THRESHOLD_SOL` | No | Min SOL before claiming (default: 5) |
| `DEFAULT_KEY_LIMIT_USD` | No | Per-user API key spending limit (default: $10) |
| `DISTRIBUTION_MODE` | No | `OWNER_ONLY` / `TOP_N_HOLDERS` / `EQUAL_SPLIT` / `WEIGHTED` / `CUSTOM_LIST` |
| `DRY_RUN` | No | Set `true` to simulate without executing (default: false) |
| `EXECUTION_KILL_SWITCH` | No | Emergency pause all operations (default: false) |

See [`.env.example`](./backend/.env.example) for the full list.

---

## Roadmap

| Phase | Focus | Status |
|-------|-------|--------|
| **Phase 1** | Foundation &mdash; SDK integrations, DB schema, client wrappers | In Progress |
| **Phase 2** | Core Engine &mdash; 4-phase state machine with checkpointing | Planned |
| **Phase 3** | REST API + Dashboard &mdash; Strategy management, key viewer, usage charts | Planned |
| **Phase 4** | Hardening &mdash; Security review, key rotation, PostgreSQL migration, launch | Planned |

---

## Documentation

- [**PRD.md**](./PRD.md) &mdash; Full product requirements document (1,200+ lines covering architecture, data models, API specs, security, and more)

---

## Quick Links

| Resource | Link |
|----------|------|
| PinkBrain LP (sister app) | [github.com/kr8tiv-ai/PinkBrain-lp](https://github.com/kr8tiv-ai/PinkBrain-lp) |
| Bags.fm Platform | [bags.fm](https://bags.fm) |
| OpenRouter Docs | [openrouter.ai/docs](https://openrouter.ai/docs) |
| OpenRouter Key Provisioning | [Provisioning API docs](https://openrouter.ai/docs/features/provisioning-api-keys) |
| OpenRouter TypeScript SDK | [github.com/OpenRouterTeam/typescript-sdk](https://github.com/OpenRouterTeam/typescript-sdk) |
| Helius | [helius.dev](https://helius.dev) |

---

## Contributing

This project is in active development for the Bags.fm App Store hackathon. Contributions, ideas, and feedback are welcome.

```bash
# Create a feature branch
git checkout -b feature/your-feature

# Make changes, then push
git add .
git commit -m "feat: your feature"
git push -u origin feature/your-feature

# Open a PR on GitHub
```

---

## License

MIT

---

<p align="center">
  Built by <a href="https://github.com/kr8tiv-ai">kr8tiv.ai</a> for the <a href="https://bags.fm">Bags.fm</a> ecosystem
</p>
