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
7. [adr/](docs/adr/) — architectural decisions made after the original roadmap, each with its own context and consequences

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

`pnpm dev` starts an app with an empty Opportunity Feed — nothing runs automatically, there is no scheduler anywhere in this system. Seed the Skill taxonomy and the curated company directory once each, then run each pipeline stage by hand, in this order. Every script below reads `apps/web/.env` automatically (via `tsx --env-file`) — no manual `export` needed, as long as that file exists:

```bash
pnpm --filter @web3-hunter/web seed:skills               # once — seeds the Skill taxonomy
pnpm --filter @web3-hunter/web seed:companies             # once, and after any directory change — see "Tracked companies" below

pnpm --filter @web3-hunter/web collect:greenhouse         # ingest job postings
pnpm --filter @web3-hunter/web collect:lever              # ingest job postings
pnpm --filter @web3-hunter/web collect:ashby              # ingest job postings
pnpm --filter @web3-hunter/web collect:github              # ingest repository data

pnpm --filter @web3-hunter/web score:companies            # detect Signals, score Opportunities
pnpm --filter @web3-hunter/web classify:opportunities     # tag Opportunities with Skills
pnpm --filter @web3-hunter/web detect:technology          # tag Companies' Technology Profile
                                                             # (depends only on collect:github — order-
                                                             #  independent of the other collectors)

pnpm --filter @web3-hunter/web match:users                 # match every existing User Profile against current Opportunities
pnpm --filter @web3-hunter/web decide:recommendations      # regenerate every existing User's Recommendations
```

Signing up and saving a Profile at `/profile` runs Matching and Decision automatically, but only for that one User, against whatever Opportunities exist at that moment. Re-run `match:users` and `decide:recommendations` to bring already-registered Users' Recommendations up to date with newly collected or reclassified data.

### Tracked companies

Every collector (`collect:greenhouse`, `collect:lever`, `collect:ashby`, `collect:github`) reads its tracked companies from the database, not a hardcoded list — resolved via `company_source_identity`, populated from a curated, git-committed directory: one JSON file per company under `apps/web/data/companies/`.

To add or update a company:

1. Add or edit its file at `apps/web/data/companies/<slug>.json` — profile fields (website, careers page, logo, ecosystem category, tags, etc., all optional) plus a `sources` array declaring which Collector(s) track it and their board token/site/org login:

   ```json
   {
     "companySlug": "acme",
     "companyName": "Acme",
     "websiteUrl": "https://acme.example",
     "careersPageUrl": "https://acme.example/careers",
     "category": "infrastructure",
     "tags": ["ethereum"],
     "sources": [
       { "collectorSlug": "greenhouse", "sourceIdentifier": "acme" },
       { "collectorSlug": "github", "sourceIdentifier": "acme-labs" }
     ]
   }
   ```

2. Load it into the database:

   ```bash
   pnpm --filter @web3-hunter/web seed:companies
   ```

3. Run the relevant `collect:*` command (or wait for its next scheduled run).

Adding a company on an already-supported source (Greenhouse, Lever, Ashby, GitHub) is a data change, never a code change — that's the whole point of this mechanism. Supporting a new ATS provider entirely is still a real engineering task.

### Automating the pipeline

Running the commands above by hand every time isn't required. There is still no scheduler inside this codebase — nothing here decides *when* to run; everything below only runs in response to a request or trigger an external scheduler chooses to send.

**Recommended (production): two scheduled GitHub Actions workflows**, split by how freshness-critical each stage is — not one workflow running everything on one schedule. This split (Milestone 24) replaced an earlier single-workflow design after production evidence showed why: real GitHub Actions runs found Greenhouse completing while Lever/Ashby sat stale for days despite all three being `continue-on-error: true` *steps* in the same job — step-level isolation wasn't enough to survive a runner-level hang. Splitting each Collector into its own **job** (a separate runner each) is the fix; see each workflow file's own comments for the full reasoning.

**[`.github/workflows/job-ingestion.yml`](.github/workflows/job-ingestion.yml) — the CORE path, every 12 hours.** The only thing that makes `/jobs` fresh: the three ATS Collectors plus Job classification, each its own job so one crashing or hanging never blocks the others:

`collect-greenhouse` + `collect-lever` + `collect-ashby` (parallel, independent runners) → `classify-jobs` (runs regardless of which Collectors above succeeded, via `needs` + `if: always()`)

`classify-jobs` also stores each new or changed job's **eligibility verdict** (`job_eligibility`, computed by the same `checkApplyEligibility` gate). `/jobs`, `/today` and `/outreach` read that verdict instead of downloading every job's description to re-run the gate on each request — the change that cut those pages' database reads by roughly 70–99% after the Supabase egress quota was exhausted (12.35 GB used against 5 GB in about three weeks). The pages also refresh any missing verdict themselves, so a failed `classify-jobs` run never hides new jobs. **Apply migration `0022` (`pnpm db:migrate`) before deploying this code**: those three pages query the new `job_eligibility` table.

Real measured durations, each job's `timeout-minutes` set with headroom above them: Lever 5m31s, Greenhouse 24m35s, Ashby 23m40s, Job classification 11m46s over ~1,500 open postings against the current curated directory (~500 companies) — all well past any Vercel serverless function's execution ceiling (Hobby: 60s hard cap; Pro: 300s standard), which is why GitHub Actions (no such ceiling; up to 6h on the free tier) remains the recommendation over the `/api/cron/*` routes below for the recurring schedule.

**[`.github/workflows/enrichment.yml`](.github/workflows/enrichment.yml) — everything else, once daily.** GitHub repository collection and the Company-level Scoring/Classification/Technology/Matching/Decision pipelines — none of which make job data fresher, so none of which need the 6h cadence:

`collect:github` → `score:companies` → `classify:opportunities` → `detect:technology` → `match:users` → `decide:recommendations` → prune old `pipeline_run` history

Each step has `continue-on-error: true` and this entire workflow is a separate file from `job-ingestion.yml`, not just a separate job within it — a slowdown or failure here can never affect the core job feed. GitHub collection in particular moved here (not just to a slower cadence) because it contributes to Technology Detection only — zero rows read by `/jobs`, `/today`, or `/outreach` — so it has no business sharing a schedule, or a failure blast radius, with the data that actually needs to be fresh every few hours.

**Setup (both workflows):**

1. In your GitHub repo, go to **Settings → Secrets and variables → Actions** and add one repository secret: `DATABASE_URL` (the same value as `apps/web/.env`). Nothing else to add — the `GITHUB_TOKEN` reference in `enrichment.yml` is the token GitHub automatically provides to every workflow run, not a secret you create.
2. That's it. Each workflow fires on its own schedule automatically, or trigger either manually anytime from the repo's **Actions** tab → pick the workflow → **Run workflow** (also works as your manual test — watch the per-job logs there).
3. **Repo Settings → Actions → General → Workflow permissions** must have at least one runner available ("There are no runners configured" means GitHub-hosted runners are disabled for this repo/org — enable them, or self-host a runner, before either schedule can fire).

**Data freshness is observable at `GET /api/health`** (Milestone 24) — alongside the original database-connectivity check, the response's `pipeline` field reports `jobsLastRefreshedAt` (the most recent `JobPosted`/`JobUpdated` Event in the database, read directly rather than trusted from any one Collector's self-report) and, per Collector, `status`/`lastRunAt`/`consecutiveFailures`/`isStale`. A stale `github` Collector is expected and harmless if GitHub enrichment is left disabled; a stale `greenhouse`/`lever`/`ashby` is the signal worth alerting on.

**The `/api/cron/*` HTTP routes remain fully functional and unchanged in behavior** (auth included) — they're just no longer the recommended path for the *recurring* schedule, for the timing reason above. They're still useful for:

- A manual "run one stage now" trigger via `curl` (see below).
- A deployment with no serverless execution-time ceiling at all (Docker/self-hosted) — see the [cron-job.org](https://cron-job.org) setup this project used before this milestone.

| Endpoint | Same as |
|---|---|
| `GET/POST /api/cron/collect-greenhouse` | `collect:greenhouse` |
| `GET/POST /api/cron/collect-lever` | `collect:lever` |
| `GET/POST /api/cron/collect-ashby` | `collect:ashby` |
| `GET/POST /api/cron/collect-github` | `collect:github` |
| `GET/POST /api/cron/scoring` | `score:companies` |
| `GET/POST /api/cron/classification` | `classify:opportunities` |
| `GET/POST /api/cron/job-classification` | `classify:jobs` |
| `GET/POST /api/cron/technology` | `detect:technology` |
| `GET/POST /api/cron/matching` | `match:users` |
| `GET/POST /api/cron/decision` | `decide:recommendations` |

Each returns `{ ok, stage, results }` — `200` on full success, `207` if any individual entity within that stage failed (the rest still ran, per-entity isolation as always), `401` on a missing/incorrect bearer token, `503` if `CRON_SECRET` isn't configured. `GET/POST /api/cron/pipeline` still runs all 9 above in one request too, but is even more likely to be truncated than any single stage — see its own doc comment.

**Manually testing any endpoint** (requires `CRON_SECRET` set wherever the app is deployed):

```bash
curl -i -X POST "https://<your-deployment>/api/cron/collect-greenhouse" \
  -H "Authorization: Bearer <your CRON_SECRET>"
```

**If you still want cron-job.org instead of (or alongside) GitHub Actions** — e.g. for a non-Vercel deployment — set `CRON_SECRET` (generate one with `openssl rand -base64 32`) alongside your other env vars, then in cron-job.org create one job per endpoint:

- URL: `https://<your-deployment>/api/cron/<stage>`
- Method: `GET` or `POST` — both work
- Header: `Authorization: Bearer <your CRON_SECRET>`
- Schedule: mirror the two-workflow split above — `collect-greenhouse`/`collect-lever`/`collect-ashby` then `job-classification` every 12h (the CORE, freshness-critical path); `collect-github` → `scoring` → `classification`/`technology` → `matching` → `decision` once daily (the SECONDARY path — none of it affects job freshness). Job data volume at this scale is trivial for GitHub's API either way, but `collect-github` still needs a valid `GITHUB_TOKEN` — an invalid or missing one fails every run outright, not just faster rate-limiting.

**Company/contact/funding research is intentionally not part of this recurring pipeline.** The curated company directory (`apps/web/data/companies/`) is hand-verified data, updated by editing/adding JSON files and re-running `seed:companies` as a deliberate, one-time action — never a scheduled job. See "Tracked companies" above.

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

The full deterministic pipeline is implemented and working end-to-end — Collectors (Greenhouse, Lever, Ashby, and GitHub, all four wired to runnable commands), Scoring, Classification, Technology Detection, Matching, and Decision — along with the AI Enrichment Layer, Pipeline Run Observability, and a curated, data-driven company directory (see "Tracked companies" above) that scales to new companies on an already-supported source without any code change. See [docs/ROADMAP.md](docs/ROADMAP.md) for how this was originally sequenced; note that document predates several of the milestones above and isn't maintained as a live status tracker. See [docs/adr/](docs/adr/) for architectural decisions made since, including a correctness fix to how the Ingestion Pipeline attributes Raw Records for Collectors tracking more than one company.
