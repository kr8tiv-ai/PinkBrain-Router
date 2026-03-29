# Contributing to PinkBrain Router

Thanks for your interest in contributing to PinkBrain Router. This project is in active development for the Bags.fm App Store.

## Getting Started

1. Fork the repo
2. Clone your fork:
   ```bash
   git clone https://github.com/<your-username>/PinkBrain-Router.git
   cd PinkBrain-Router
   ```
3. Install dependencies:
   ```bash
   cd backend
   npm install
   ```
4. Copy and configure environment:
   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```
5. Create a feature branch:
   ```bash
   git checkout -b feature/your-feature
   ```

## Development Workflow

### Branch Naming

| Prefix | Use |
|--------|-----|
| `feature/` | New functionality |
| `fix/` | Bug fixes |
| `docs/` | Documentation changes |
| `refactor/` | Code restructuring |
| `test/` | Test additions |

### Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add key rotation endpoint
fix: handle Helius RPC timeout during claim phase
docs: update API reference with /pool endpoint
refactor: extract CreditPoolService from KeyManager
test: add unit tests for allocation calculator
```

### Pull Requests

1. Push your branch to your fork
2. Open a PR against `main`
3. Fill out the PR template
4. Ensure all checks pass
5. Request a review

### Code Style

- TypeScript strict mode
- Zod for all runtime validation
- Pino for structured logging (no `console.log`)
- Fastify for HTTP (no Express patterns)
- All environment variables validated at startup

## What to Work On

Check the [issues](https://github.com/kr8tiv-ai/PinkBrain-Router/issues) for open tasks. Good first issues are tagged with `good first issue`.

### Areas That Need Help

- **OpenRouter client testing** — Edge cases in key provisioning
- **Distribution algorithms** — Weighted allocation optimizations
- **Dashboard UI** — React components for strategy management
- **Documentation** — API examples, deployment guides

## Security

If you discover a security issue, **do not open a public issue**. See [SECURITY.md](./SECURITY.md) for reporting instructions.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
