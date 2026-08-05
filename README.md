# Web3 Hunter

AI-powered opportunity intelligence platform for Web3 engineers. See [docs/PRODUCT.md](docs/PRODUCT.md) for the full product vision.

## Documentation

The `docs/` directory is the source of truth for how this project is built, in the order it should be read:

1. [PRODUCT.md](docs/PRODUCT.md) — vision, personas, core features
2. [ARCHITECTURE.md](docs/ARCHITECTURE.md) — event-driven system architecture
3. [DOMAIN_MODEL.md](docs/DOMAIN_MODEL.md) — the business language every part of the codebase shares
4. [EVENT_MODEL.md](docs/EVENT_MODEL.md) — every event in the system and how it flows
5. [DATABASE.md](docs/DATABASE.md) — persistence architecture
6. [ROADMAP.md](docs/ROADMAP.md) — milestones, in build order

## Stack

- [Turborepo](https://turborepo.com) + [pnpm workspaces](https://pnpm.io/workspaces) monorepo
- [Next.js 15](https://nextjs.org) (App Router) + [Tailwind CSS](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com)
- [Drizzle ORM](https://orm.drizzle.team) on [Supabase](https://supabase.com) Postgres
- [Better Auth](https://www.better-auth.com)
- TypeScript in strict mode throughout

## Project structure

```text
apps/
  web/            Next.js app — frontend + backend API surface

packages/
  db/             System of record: schema, migrations, typed data access
  events/         Canonical event contracts + event-bus abstraction
  collectors/     Source-specific ingestion adapters
  scoring/        Scoring Engine: event correlation into Opportunities
  decision/       Decision Engine: deterministic business decisions
  ai/             AI Layer: enrichment, summarization, content generation
  notifications/  Decision delivery: channel mechanics and send tracking
  shared/         Cross-cutting, domain-agnostic utilities
  ui/             Presentation-only component library (shadcn/ui)
```

See [docs/ARCHITECTURE.md §3](docs/ARCHITECTURE.md#3-monorepo-structure) for the ownership and dependency-direction rules behind this layout — `pnpm lint` enforces them mechanically via `scripts/check-boundaries.mjs`, not just by documentation.

## Getting started

### Prerequisites

- Node.js >= 20
- [pnpm](https://pnpm.io) 10
- A [Supabase](https://supabase.com) project (for `DATABASE_URL`), or Docker for a local Postgres instance

**On Windows, work inside WSL, not from a Windows shell against the `\\wsl.localhost\...` path.** pnpm's native install step is incompatible with that network-drive-style path (Windows can't report volume info for it, which crashes pnpm's copy-on-write file linking) and, separately, `pnpm`'s script runner shells out through `cmd.exe`, which refuses to set a UNC path as its working directory. Both are avoided entirely by opening the project from inside WSL (`wsl`, then `cd` to the repo — or use VS Code's "Remote - WSL" extension) and running every command — `pnpm install`, `pnpm dev`, `pnpm build`, etc. — from there. macOS and Linux are unaffected.

### Setup

```bash
pnpm install
```

Copy the example env file into **both** locations it's needed — Next.js only reads `.env` from `apps/web/`, its own working directory when `pnpm dev` runs, while the `db:generate`/`db:migrate` commands below run from the repo root and read the root `.env`:

```bash
cp .env.example apps/web/.env   # read by `pnpm dev`
cp .env.example .env            # read by `pnpm db:generate` / `pnpm db:migrate`
```

Fill in real values in both files.

If you don't have a Supabase project yet, start a local Postgres instead:

```bash
docker compose up -d db
```

and point `DATABASE_URL` in both `.env` files at `postgresql://postgres:postgres@localhost:5432/web3_hunter`.

Apply the database schema:

```bash
pnpm db:generate   # generates SQL migrations from packages/db/src/schema
pnpm db:migrate    # applies them
```

Run the app:

```bash
pnpm dev
```

Visit `http://localhost:3000` and `http://localhost:3000/health` to confirm the app and database are both reachable.

### Populating data

`pnpm dev` starts an app with an empty Opportunity Feed — nothing runs automatically, there is no scheduler anywhere in this system. Seed the Skill taxonomy once, then run each pipeline stage by hand, in this order:

```bash
pnpm --filter @web3-hunter/web seed:skills              # once — seeds the Skill taxonomy

pnpm --filter @web3-hunter/web collect:greenhouse        # ingest job postings
pnpm --filter @web3-hunter/web collect:github            # ingest repository data

pnpm --filter @web3-hunter/web score:companies           # detect Signals, score Opportunities
pnpm --filter @web3-hunter/web classify:opportunities    # tag Opportunities with Skills
pnpm --filter @web3-hunter/web detect:technology         # tag Companies' Technology Profile
                                                           # (depends only on collect:github — order-
                                                           #  independent of the two commands above)

pnpm --filter @web3-hunter/web match:users                # match every existing User Profile against current Opportunities
pnpm --filter @web3-hunter/web decide:recommendations     # regenerate every existing User's Recommendations
```

Signing up and saving a Profile at `/profile` runs Matching and Decision automatically, but only for that one User, against whatever Opportunities exist at that moment. Re-run `match:users` and `decide:recommendations` to bring already-registered Users' Recommendations up to date with newly collected or reclassified data.

### Common commands

| Command | Description |
|---|---|
| `pnpm dev` | Run the app in development mode |
| `pnpm build` | Build every package and app |
| `pnpm lint` | Lint every package (includes architectural boundary checks) |
| `pnpm typecheck` | Typecheck every package |
| `pnpm test` | Run all tests |
| `pnpm format` | Format the repo with Prettier |
| `pnpm db:generate` | Generate a new migration from schema changes |
| `pnpm db:migrate` | Apply pending migrations |

## Status

The full deterministic pipeline is implemented and working end-to-end — Collectors, Scoring, Classification, Technology Detection, Matching, and Decision — along with the AI Enrichment Layer and Pipeline Run Observability. See [docs/ROADMAP.md](docs/ROADMAP.md) for how this was originally sequenced; note that document predates Pipeline Run Observability and isn't maintained as a live status tracker. Of the ATS sources it names, Greenhouse is the only one currently wired to a runnable collector command — Lever and Ashby collector logic exists in `packages/collectors`, but has no tracked-company configuration or `collect:*` script yet.
