# Dusk — Intent Architecture

## What This Project Is

A constraint satisfaction system for spec-driven AI development. Three layers:
1. **Constraint language** — Blocks (canonical patterns) + Intents (project compositions) express architectural intent as structured, composable, machine-verifiable constraints
2. **Solver** — AI agents receive constraints via lifecycle hooks and produce conforming code
3. **Verifier** — Multi-agent evaluation checks implementations against the full constraint set

The core problem: specs are subjective, don't compose, and aren't verifiable. This system solves all three.

RFCs: `docs/rfcs/001-mvp-rfc/` (proposal v5 + roadmap v4)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (strict, ES2022, ESM) |
| Monorepo | pnpm workspaces + Turborepo |
| API | Express + tRPC v11 + Zod |
| Database | PostgreSQL 16 via Drizzle ORM (+ SQLite for embedded stores) |
| Web | React 19 + Vite 6 + Tailwind CSS 4 + React Router 7 |
| Auth | Auth0 (web: @auth0/auth0-react, mobile: expo-auth-session PKCE, API: jose JWKS) |
| Mobile | Expo 54 + React Native + Expo Router v6 |
| Real-time | tRPC WebSocket subscriptions + PostgreSQL LISTEN/NOTIFY |
| Jobs | pg-boss |
| Logging | pino + pino-http |
| Testing | Vitest (colocated, mock-first) |
| Validation | Zod everywhere (source of truth for types) |
| Deploy | Self-hosted k3s, Docker, GitHub Actions CI/CD |

## Engineering Philosophy

- **Simple over complex** — Fowler + Hickey mindset. Three similar lines > premature abstraction.
- **Build for RIGHT** — not for convenience, cost, or resource constraints. Land the plane.
- **Spec-driven ALWAYS** — every feature starts from a spec via OpenSpec (`openspec/`)
- **Test-driven where possible** — Vitest, London School TDD (mock-first) for new code
- **Honest over flattering** — no blended metrics, no silent overrides, no vanity numbers
- **No silent behavior** — surface conflicts, truncations, staleness explicitly

## Monorepo Structure

```
dusk/
├── packages/
│   ├── api/              # Express + tRPC server (EXISTING — production-ready)
│   │                     # Also hosts: registry API, block search, vetting routes
│   ├── web/              # React 19 SPA (EXISTING — production-ready)
│   │                     # Also hosts: authoring UI, adherence dashboard, drift views
│   ├── shared/           # Zod schemas + inferred types (EXISTING — pure leaf)
│   ├── hooks/            # tRPC React Query hooks + real-time sync (EXISTING)
│   ├── mobile/           # Expo app (EXISTING)
│   │
│   ├── core/
│   │   ├── schema/       # Types, validators, enums — Zod schemas for Block, Intent, Constraint,
│   │   │                 # SourceMap, CompositionAudit, Verdict, etc. Pure leaf like shared.
│   │   ├── parser/       # Read/write .block.yaml, intent.yaml, source-map.json, audit.json
│   │   └── graph/        # Intent graph traversal, cycle detection, scope resolution
│   │
│   ├── engine/
│   │   ├── composition/  # Blocks + intents → manifest/facets (token budgets, audit logging)
│   │   ├── embeddings/   # Vector embedding + cosine similarity for constraints
│   │   └── source-map/   # PostToolUse linking pipeline (annotation → LLM → deps → path → vector)
│   │
│   ├── delivery/
│   │   ├── mcp-server/   # MCP tools for agent consumption (4 tools)
│   │   └── hooks/        # Hook generators for Claude Code, Cursor, etc.
│   │
│   ├── verification/
│   │   ├── triage/       # Fast single-agent pre-filter
│   │   ├── evaluator/    # Multi-agent evaluation + discourse (model diversity)
│   │   ├── adherence/    # SQLite verdict state + rollup (mechanical/semantic separated)
│   │   └── protocol/     # Bounded evaluation loop (finding set locks round 1)
│   │
│   ├── blocks/           # Canonical block library (.block.yaml files) — own package
│   ├── fixtures/         # Evaluation fixtures (todo-intents, todo-baseline, seeded-benchmark)
│   └── cli/              # Developer-facing CLI (ia init, validate, compose, verify, serve, etc.)
│
├── docs/rfcs/            # RFCs — source of truth for system design
├── openspec/             # OpenSpec workflow artifacts
├── .praxis/              # Feature guides (24+ docs on established patterns)
├── scripts/              # init.sh, create-auth0-app.sh, build-device.sh
├── .github/workflows/    # CI + deploy (api, web, infra, mobile)
├── .k8s/                 # Kubernetes manifests (api, web, postgres)
└── envs/                 # Environment templates
```

**Platform distribution:** The RFC proposes separate `packages/platform/` (registry, authoring, dashboard). Instead, these capabilities live in the **existing** packages following established patterns:
- Registry API routes, block search/vetting → `packages/api` (new routers + services)
- Authoring UI, adherence dashboard, drift visualization → `packages/web` (new views + components)
- Shared types for platform features → `packages/shared` (new Zod schemas)

## Existing Package Dependency Graph

```
shared  ──→  api
shared  ·⊦→  hooks  ──→  web
api     ·⊦→  hooks  ──→  mobile
shared  ──→  mobile

──→  = runtime dependency
·⊦→  = type-only devDependency
```

`api` exports `AppRouter` types via `@dusk/api/client` subpath. `hooks` imports from this for tRPC typing.

## Key Data Entities

| Entity | Format | Lifecycle | Location |
|--------|--------|-----------|----------|
| Block | .block.yaml | Human-authored, registry-stored | `packages/blocks/canonical/` |
| Intent | intent.yaml | Human-authored, version-controlled | `.ia/intents/<name>/` |
| Source Map | source-map.json | AI-maintained, version-controlled | `.ia/intents/<name>/` |
| Composition Audit | audit.json | AI-maintained, version-controlled | `.ia/intents/<name>/` |
| Adherence State | state.db (SQLite) | System-maintained, gitignored | `.ia/adherence/` |
| Reverse Index | reverse-index.json | Derived, gitignored | `.ia/cache/` |

## Constraint Model

- **Obligation levels:** `must` (defect) > `should` (warning) > `may` (option)
- **Verifiability classes:** `mechanical` (pattern-matching, high accuracy) vs `semantic` (architectural reasoning, lower/variable accuracy)
- Adherence reporting ALWAYS separates mechanical and semantic — never blend them
- Composition distinguishes `additive` decisions (recoverable) from `destructive` decisions (data-loss risk) with different confidence thresholds (0.7 vs 0.9 default)

## Build Sequence (Sprints)

1. **Schema + First Blocks** — data model, Zod validators, parser, first 6 canonical blocks, CLI scaffolding
2. **Intents + Graph + Fixtures** — 4 todo intents, graph traversal, cycle detection, fixture scaffolding
3. **Composition Engine** — manifest/facet output, embeddings, black-box test suite
4. **MCP Server + Hooks** — context delivery, source-map pipeline, lifecycle hooks, dogfooding
5. **Verification Core + Benchmark** — triage, multi-agent eval, adherence, seeded-violation benchmark
6. **Bounded Protocol + Full Loop** — convergence guarantees, stop hook live, comparison report
7. **Real-World Validation** — 2+ weeks on production codebase
8. **Ecosystem** — registry routes in api, authoring/dashboard views in web, incremental expansion

## Behavioral Rules (Always Enforced)

- Do what has been asked; nothing more, nothing less
- NEVER create files unless they're absolutely necessary for achieving your goal
- ALWAYS prefer editing an existing file to creating a new one
- NEVER proactively create documentation files (*.md) or README files unless explicitly requested
- NEVER save working files, text/mds, or tests to the root folder
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files

## Code Standards (from .praxis/features/coding-guidelines.md)

- **Functional first** — functions > classes. Classes only for long-lived mutable state with lifecycle (connect/close).
- **Zod schemas = source of truth** — define shape once in Zod, derive TS type via `z.infer`. Never duplicate.
- **Named exports only** — no default exports (except Expo Router route files).
- **`type` over `interface`** — use `type` for everything.
- **Result objects internally** — fallible functions return `{ success, error }`. TRPCError at procedure boundaries.
- **Factory functions over classes** — closures for config-holding objects.
- **Config via injection** — only `env.ts` reads `process.env`. Everything else uses `getEnv()`.
- **One concept per file** — files under 500 lines. Extract at 3+ repetitions.
- **Colocated tests** — `user.ts` + `user.test.ts` side by side.
- **Import order** — node builtins → external → internal packages → relative. Blank lines between groups.
- **Naming** — camelCase files (PascalCase React components), UPPER_SNAKE_CASE constants, `is`/`has`/`can` booleans.

## Package Conventions (from .praxis/features/adding-packages.md)

- `"type": "module"` — all packages use ESM
- `"private": true` — monorepo packages aren't published to npm
- `workspace:*` for internal deps
- `exports` field required for importable packages
- `composite: true` in tsconfig for library packages imported by others
- Barrel exports in `src/index.ts` — consumers import from package name, never internal paths
- `vitest.config.ts` with colocated `*.test.ts` files
- Turbo handles build ordering via `^build` — no manual ordering needed

## Build & Test

```bash
# Build all packages
pnpm build           # turbo build — shared first, then dependents

# Test all packages
pnpm test            # turbo test

# Type check
pnpm typecheck       # turbo typecheck

# Dev (all packages, watch mode)
pnpm dev

# Database
pnpm db:generate     # Generate Drizzle migrations
pnpm db:migrate      # Run migrations
pnpm db:studio       # Drizzle Studio
pnpm db:seed         # Seed data (idempotent: admin, alice, bob)

# Docker (local Postgres)
pnpm docker:up       # Start Postgres container
pnpm docker:init     # Start + generate + migrate
pnpm docker:reset    # Destroy volume + restart
```

- ALWAYS run tests after making code changes
- ALWAYS verify build succeeds before committing
- ALWAYS verify typecheck passes

## File Organization

- NEVER save to root folder — use the directories below
- Use `/packages` for all source code (monorepo packages)
- Use colocated `*.test.ts` files for tests (next to source)
- Use `/docs` for documentation and markdown files
- Use `/scripts` for utility scripts
- Use `/openspec` for OpenSpec workflow artifacts
- Use `/.praxis` for feature guides (existing — read before building)

## Security Rules

- NEVER hardcode API keys, secrets, or credentials in source files
- NEVER commit .env files or any file containing secrets
- Always validate user input at system boundaries (Zod)
- Always sanitize file paths to prevent directory traversal
