# PinkBrain Router

**Bags App Store — OpenRouter Credit Engine**

PinkBrain Router is the second application in the [PinkBrain](https://github.com/kr8tiv-ai/PinkBrain-lp) family, built for the [Bags.fm App Store](https://bags.fm) ecosystem. While [PinkBrain LP](https://github.com/kr8tiv-ai/PinkBrain-lp) converts idle Bags.fm fees into permanently locked Meteora liquidity, **PinkBrain Router** converts those same fees into [OpenRouter](https://openrouter.ai) API credits — giving token holders frictionless access to 300+ AI models (Claude, GPT-4, Gemini, Llama, Mistral, DeepSeek, and more).

## What We're Building

A fully automated pipeline that turns DeFi fees into AI infrastructure:

```
Bags.fm fees accrue → Claim fees → Swap SOL to USDC → Fund OpenRouter credit pool → Provision per-user API keys
```

Every token holder gets their own OpenRouter API key with auto-topped spending limits — paid for by the trading fees their token already generates. No subscriptions, no credit cards, no fragmented billing across AI providers.

### The PinkBrain Ecosystem on Bags

| App | What It Does | Status |
|-----|-------------|--------|
| [PinkBrain LP](https://github.com/kr8tiv-ai/PinkBrain-lp) | Fees → Permanently locked Meteora liquidity | Phase 3 Complete |
| **PinkBrain Router** (this repo) | Fees → OpenRouter API credits + per-user keys | In Development |

## Key Features

- **Automated fee claiming** from Bags.fm fee vaults
- **SOL-to-USDC conversion** via Bags trade API (ecosystem compliant)
- **Per-user API key provisioning** via OpenRouter Management API
- **300+ AI model access** through a single OpenAI-compatible endpoint
- **Usage tracking** with daily/weekly/monthly granularity per key
- **Distribution modes** — owner-only, top-N holders, equal split, or custom
- **Safety controls** — dry-run mode, kill switch, daily run caps, spending limits

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js 20+, TypeScript, Fastify, SQLite/PostgreSQL |
| Blockchain | Solana, Bags SDK, Helius RPC + DAS API |
| AI Gateway | OpenRouter Management API, @openrouter/sdk |
| Frontend | React 19, Vite, Tailwind CSS, TanStack React Query |

## Documentation

- [**PRD.md**](./PRD.md) — Full product requirements document (1,200+ lines)

## Quick Links

| Resource | Link |
|----------|------|
| OpenRouter Docs | [openrouter.ai/docs](https://openrouter.ai/docs) |
| OpenRouter Management API | [Key provisioning docs](https://openrouter.ai/docs/features/provisioning-api-keys) |
| OpenRouter TypeScript SDK | [github.com/OpenRouterTeam/typescript-sdk](https://github.com/OpenRouterTeam/typescript-sdk) |
| Bags.fm Platform | [bags.fm](https://bags.fm) |
| PinkBrain LP (sister app) | [github.com/kr8tiv-ai/PinkBrain-lp](https://github.com/kr8tiv-ai/PinkBrain-lp) |

---

## How to Push Updates

This repo lives at **https://github.com/kr8tiv-ai/PinkBrain-Router**

### First-time setup (after cloning)

```bash
git clone https://github.com/kr8tiv-ai/PinkBrain-Router.git
cd PinkBrain-Router
```

### Pushing changes

```bash
# 1. Stage your changes
git add .

# 2. Commit with a descriptive message
git commit -m "feat: description of what changed"

# 3. Push to main
git push origin main
```

### If working from the local Desktop folder

```bash
cd ~/Desktop/"PinkBrain Router git"

# Remote is already configured. Just:
git add .
git commit -m "feat: your changes"
git push origin main
```

### For AI agents working in this repo

The git remote is pre-configured:
```
origin → https://github.com/kr8tiv-ai/PinkBrain-Router.git
```

Standard workflow:
```bash
git status                          # Check what changed
git add <files>                     # Stage specific files (or git add . for all)
git commit -m "type: description"   # Commit (use feat/fix/docs/chore prefixes)
git push origin main                # Push to GitHub
```

Branch workflow (for larger features):
```bash
git checkout -b feature/your-feature
# ... make changes ...
git add .
git commit -m "feat: your feature"
git push -u origin feature/your-feature
# Then create a PR on GitHub
```

---

## License

MIT
