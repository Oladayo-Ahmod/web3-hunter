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

Copy the example env file into **both** locations it's needed — each reads its own copy from its own working directory, not the repo root:

```bash
cp .env.example apps/web/.env    # read by `pnpm dev` and every `pnpm --filter @web3-hunter/web <script>`
cp .env.example packages/db/.env # read by `pnpm db:generate` / `pnpm db:migrate`
```

Fill in real values in both files. A repo-root `.env` is not read by anything — Turborepo's `globalDependencies: [".env"]` only uses it as a cache-hash input, not an environment source, so don't rely on one existing at the root.

### Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string |
| `BETTER_AUTH_SECRET` | Yes | ≥ 32 characters — generate one with `openssl rand -base64 32`, don't leave the placeholder unchanged |
| `BETTER_AUTH_URL` | Yes | Base URL Better Auth uses for callback/redirect URLs |
| `NEXT_PUBLIC_APP_URL` | Yes | The app's own public URL |
| `AI_PROVIDER` | No | `openai`, `anthropic`, or `mock`. Unset disables the AI Enrichment Layer entirely — every AI-dependent route degrades to "unavailable" rather than erroring |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | No | Only used when `AI_PROVIDER=openai` |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | No | Only used when `AI_PROVIDER=anthropic` |
| `GITHUB_TOKEN` | No | Raises the GitHub Collector's rate limit from 60/hour (unauthenticated) to 5,000/hour. No scopes required — only public repository data is read |
| `CRON_SECRET` | No | Required only to use any `/api/cron/*` route (see "Automating the pipeline" below). Unset means those routes always respond `503` |

If you don't have a Supabase project yet, start a local Postgres instead:

```bash
docker compose up -d db
```

and point `DATABASE_URL` in both `apps/web/.env` and `packages/db/.env` at `postgresql://postgres:postgres@localhost:5432/web3_hunter`.

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

`pnpm dev` starts an app with an empty Opportunity Feed — nothing runs automatically, there is no scheduler anywhere in this system. Seed the Skill taxonomy once, then run each pipeline stage by hand, in this order. Every script below reads `apps/web/.env` automatically (via `tsx --env-file`) — no manual `export` needed, as long as that file exists:

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

### Tracked companies

`collect:greenhouse` and `collect:github` only ingest data for the companies explicitly listed in source — there is no watchlist UI or database-driven configuration yet:

- `apps/web/lib/collectors/tracked-companies.ts` — Greenhouse board tokens (`TRACKED_GREENHOUSE_COMPANIES`), currently ConsenSys, Coinbase, and Paradigm.
- `apps/web/lib/collectors/tracked-github-orgs.ts` — GitHub organizations (`TRACKED_GITHUB_ORGS`), the same three companies' orgs. `companySlug` is deliberately shared with the Greenhouse list so both sources resolve to the same Company row via `company_source_identity`.

To track a different or additional company, add an entry to the relevant file (both, if it has data from both sources) and re-run the corresponding `collect:*` command — no other code changes are required.

### Automating the pipeline

Running the 7 commands above by hand every time isn't required. There is still no scheduler inside this codebase — nothing here decides *when* to run; every route below only responds to a request an external scheduler chooses to send. This project uses an external scheduler, [cron-job.org](https://cron-job.org), rather than Vercel Cron, so the same setup works whether the app is deployed on Vercel, Docker, or anywhere else.

**Recommended: one cron job per stage**, each independently schedulable, so a slow or rate-limited stage never delays the others and no single request risks a host's execution-time cap:

| Endpoint | Same as |
|---|---|
| `GET/POST /api/cron/collect-greenhouse` | `collect:greenhouse` |
| `GET/POST /api/cron/collect-github` | `collect:github` |
| `GET/POST /api/cron/scoring` | `score:companies` |
| `GET/POST /api/cron/classification` | `classify:opportunities` |
| `GET/POST /api/cron/technology` | `detect:technology` |
| `GET/POST /api/cron/matching` | `match:users` |
| `GET/POST /api/cron/decision` | `decide:recommendations` |

Each returns `{ ok, stage, results }` — `200` on full success, `207` if any individual entity within that stage failed (the rest still ran, per-entity isolation as always), `401` on a missing/incorrect bearer token, `503` if `CRON_SECRET` isn't configured.

`GET /api/cron/pipeline` also still exists, running all 7 stages (`seed:skills` excepted — it's a one-time step, not a recurring one) in dependency order in a single request. Useful for a manual "run everything now" trigger (a fresh deploy, a backfill); not recommended as the regular schedule, for the reasons above.

**Setup (per endpoint you want scheduled):**
1. Set `CRON_SECRET` (generate one with `openssl rand -base64 32`) alongside your other env vars, wherever the app is deployed — one secret authorizes every `/api/cron/*` route.
2. In cron-job.org, create a job per endpoint:
   - URL: `https://<your-deployment>/api/cron/<stage>`
   - Method: `GET` or `POST` — both work
   - Header: `Authorization: Bearer <your CRON_SECRET>`
   - Schedule: your choice. Respect dependency order across jobs — e.g. Collectors before Scoring, Scoring before Classification/Matching, Matching before Decision — Technology only depends on `collect-github`, independently of the others.

Two things worth knowing before turning this on:
- **GitHub rate limits.** Without `GITHUB_TOKEN` set, frequent automated runs of `collect-github` will exhaust the unauthenticated 60-requests/hour limit quickly — either set `GITHUB_TOKEN`, or schedule that one endpoint less frequently than the others.
- **Execution time limits.** A cold run against a large backlog can take a while, especially the two Collectors (live network calls). Each per-stage route declares `maxDuration = 120` (the combined route: `300`), but your host still enforces its own ceiling regardless — e.g. Vercel's Hobby plan caps at 60 seconds; Pro allows configuring higher.

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
