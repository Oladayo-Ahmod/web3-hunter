# Milestone 13 — Discovery & Relevance Review (revised)

**Status:** diagnosis and design only. Nothing in this document has been implemented. Every claim about a source's behavior below is a live check made while writing this revision, not documentation I took on faith — where a check failed or was inconclusive, that's stated as such rather than assumed away. **Implementation does not start until this design is approved.**

This revision supersedes the first pass of this document. It keeps everything that was already verified (source distribution, URL integrity, the exact false-positive mechanism) and substantially expands the discovery-source evaluation and the relevance model per your follow-up review.

---

## 1. Current architecture diagnosis

**Discovery**, verified live against production:

| Collector | Companies tracked | Distinct jobs ever posted | Currently-open, non-stale jobs |
|---|---|---|---|
| Greenhouse | 9 | 291 | 280 |
| Lever | 10 | 120 | 118 |
| Ashby | 20 | 150 | 146 |
| GitHub | 31 | 0 (technology detection only, not a job source) | 0 |

37 companies, 100% of the 544 open jobs. No code path exists anywhere that creates a `company` row from a discovered job — `company.discoveryStatus` was designed once (original Milestone 13 doc) and never built. The directory isn't under-populated; it's structurally the only channel.

**Relevance**, traced to one exact real job: *"Senior Software Engineer, Frontend (Coinbase Advisor - Agentic Trading)"* has exactly one classified skill, `frontend-engineering`. Your real profile (13 skills) includes it. `skillFit = 1/1 = 1.0 → 70/70 points`, alone enough to cross the "high match" threshold — role match was never checked because it never needed to be. Root cause: skill fit is scored as a fraction of the job's own (often single) tagged skill, entirely independent of role intent, and role match is a flat `+20` bonus, not a gate.

**Seniority**, checked precisely against the current code (`job-relevance.ts`): `SENIOR_TITLE_KEYWORDS = ["senior", "sr.", "staff", "principal", "lead"]`, `JUNIOR_TIT LE_KEYWORDS = ["junior", "jr.", "entry-level", "entry level", "intern"]`. **"Manager" and "Director" are in neither list** — a title like "Director of Engineering" gets `inferSeniorityFromTitle() === null` today, i.e. *no seniority signal at all*, not a mismatch penalty. This is a real, verified gap, not speculation.

**URL integrity**, re-confirmed: all 561 tracked job states have a valid `https?://` `absoluteUrl`; 0 missing, 0 malformed. `job-detail-view.tsx`'s "Apply Now" already uses it correctly. The actual gap is presentation: `JobCard` in the feed links to the internal `/jobs/{compositeId}` route as its only click target, so a user never sees the real external URL until one extra click — legitimate UX debt, not corrupted data.

**Opportunity/Recommendation duplication**, re-confirmed: 77 total `opportunity` rows, one company alone has 14; 27 `recommendation` rows. `listCurrentCompanySignals` was designed in the original Milestone 13 doc and never built.

---

## 2. Source evaluation — live-checked, not assumed

Every row below reflects an actual HTTP request made while writing this document.

| Source | Public access | API | ToS / concerns | Web3 relevance (observed) | Volume (observed) | Apply URL | Difficulty | **Classification** |
|---|---|---|---|---|---|---|---|---|
| **Greenhouse** | Yes (in use) | Public, unauthenticated, per-board | None | High — this is why it's already the backbone | 280 open, 9 companies | Direct, source-native | Done | **USE** (existing) |
| **Lever** | Yes (in use) | Public, unauthenticated, per-board | None | High | 118 open, 10 companies | Direct | Done | **USE** (existing) |
| **Ashby** | Yes (in use) | Public, unauthenticated, per-board | None | High | 146 open, 20 companies | Direct | Done | **USE** (existing) |
| **ATS ecosystem discovery** (new Greenhouse/Lever/Ashby *boards* we don't yet know about) | **No enumeration mechanism exists.** Checked live: no `sitemap.xml` on any of the three (Greenhouse redirects to a 404 SPA shell; Lever 404s outright; Ashby's `sitemap.xml` path serves its generic app shell, not a data file). None of the three platforms publish a customer directory. | N/A — there is no "list all boards" API on any of them | N/A | High potential, unverified volume | Scales only with how many candidate company names/slugs are supplied and probed | Same as above once a board is found | Medium — **not a new collector, a candidate-list + probe strategy** (§3) | **USE**, but as a *strategy*, not a source with its own API |
| **RemoteOK** | Yes, public, unauthenticated (`GET remoteok.com/api`, `remote-crypto-jobs.json`) | Yes | Attribution required ("link back or we'll suspend API access") — satisfiable | **Low observed signal.** Default feed: 1/100 recent listings crypto-relevant. Dedicated crypto-tag feed (62 listings) manually inspected: mostly non-technical roles (Procurement Manager, Graphic Designer, CFO Controller) carrying "crypto" among 30-40 unrelated tags — broad self-tagging, not curation. Zero genuine Solidity/blockchain-engineering roles in the sample. | 62 crypto-tagged, ~0 genuinely relevant engineering roles found | Present in feed, real | Low | **INVESTIGATE**, low priority — technically trivial, empirically thin |
| **Web3.career** | **Not self-serve.** `GET /api/v1` redirects to a contact/lead form (`POST`, CSRF-protected), not a key-based API. No RSS, no unauthenticated JSON path. | Unknown — gated | Requires a business inquiry, possibly paid; I did not submit the form | Presumably high (Web3-native positioning) but unverified | Unknown | Unknown | High — business step, not engineering | **DEFER** — your decision whether to pursue outreach |
| **Jobicy** | Yes, public, unauthenticated, supports `?tag=crypto` | Yes | "Please credit Jobicy... all application buttons redirect to the original job URL" (their own stated terms) | **Best signal found this round.** Crypto tag sample: Binance, OKX, Kraken, ConsenSys, MLabs, Sumsub — real companies, several genuinely relevant roles ("Staff Security Architect" @ Kraken, "Distributed Systems Engineer" @ MLabs, "Client Full-Stack Engineer" @ Binance) | 20 returned per page for the crypto tag (total not yet paginated-through) | **Unresolved**: the JSON API only exposes Jobicy's own `jobicy.com/jobs/...` URL, no distinct "original source URL" field, despite their terms claiming apply buttons redirect to it. Their job-detail HTML page returned `403` on a direct fetch (bot protection), so I could not verify the redirect target programmatically. | Medium — promising, but apply-URL provenance needs resolving before use, given your hard URL-correctness requirement | **INVESTIGATE** — most promising new aggregator found, blocked only on one open verification question |
| **Remotive** | Yes, public, unauthenticated, supports `?search=` | Yes | Response includes an embedded legal notice requiring review before use | Not yet filtered/inspected for relevance | 276KB response for a crypto search — unfiltered | Unverified | Low-medium | **INVESTIGATE** — accessible, not yet quality-assessed |
| **Himalayas** | Yes, public, unauthenticated | Yes | Unverified terms | General board — 99,846 total jobs, unfiltered for crypto/web3 | Huge total, crypto-relevant fraction unknown | Unverified | Low-medium | **INVESTIGATE** — needs a relevance-yield check like Jobicy got |
| **Arbeitnow** | Yes, public, unauthenticated | Yes | Unverified, generally permissive | Sample job was an unrelated Berlin price-comparison role — general European job board, no Web3 signal expected | Unverified | Present, real URLs observed | Low | **INVESTIGATE**, low priority |
| **CryptoJobsList** | **Blocked.** Homepage itself returned `403` (Cloudflare bot protection) on a plain request. | Unknown | Unknown | Presumably high (crypto-native) but unreachable this way | Unknown | Unknown | High — inaccessible without a headless browser, which is a materially different (and more fragile/ToS-risky) engineering commitment | **DEFER/REJECT** — not pursued further without a specific reason to invest in browser automation |
| **Wellfound / AngelList** | No public jobs API; known to prohibit automated scraping in its ToS | N/A | Explicitly against terms | High potential, inaccessible legitimately | N/A | N/A | N/A | **REJECT** |
| **Adzuna** | Registration-gated (`app_id`/`app_key`); anonymous request returned no usable response | Yes, after signup | Standard developer terms, presumably fine once registered | General aggregator, would need crypto filtering (unverified yield) | Unverified | Unverified | Medium — a signup decision, not pure engineering | **DEFER** — needs you to decide on registering |
| **Jooble** | Registration-gated (`403` on anonymous access, known to require a publisher ID) | Yes, after signup | Standard | General aggregator | Unverified | Unverified | Medium | **DEFER** — same as Adzuna |
| **Google Jobs / search-indexed jobs** | No public "Google Jobs" API exists — it's Google's own aggregation of `schema.org/JobPosting` markup on *other* companies' career pages, not a source with an endpoint | N/A | Scraping Google Search results violates their ToS; the legitimate version of this idea is *our own* crawler reading `JobPosting` structured data directly off individual company career pages — a fundamentally different, much larger project (a general-purpose web crawler with per-site parsing, robots.txt compliance, and no natural "list of sites to crawl" without already having the company list this whole effort is trying to build) | High long-term potential, wrong shape for "add a source" | N/A | N/A | Very high | **REJECT for this milestone** — revisit only as its own, later, explicitly-scoped project |
| **Electric Capital "Crypto Ecosystems"** (`github.com/electric-capital/crypto-ecosystems`) | Yes — public GitHub repo, existence verified live | Not a jobs API — a structured, actively-maintained **mapping of thousands of real crypto orgs to their GitHub repos/websites** | Public repo, standard GitHub terms | Not a job source itself — a **candidate-list generator** for the ATS-discovery strategy in §3 | Thousands of orgs (not yet pulled/counted) | N/A | Medium — data processing, not job ingestion | **USE** — as the input to §3's probing strategy, not as a source with its own collector |

**Honest bottom line, unchanged in spirit from the first pass:** there is no single aggregator that hands you broad, high-quality Web3 engineering supply for free today. Jobicy is the one genuinely promising new lead this round, blocked on one concrete, checkable question (§3/§13). The highest-confidence path to real breadth remains widening *which companies* feed the three collectors that already work correctly.

---

## 3. ATS discovery strategy

No enumeration API exists on any ATS (§2), so this is a **candidate-generation + probe** pipeline, not a new collector type — it reuses `packages/collectors`' existing Greenhouse/Lever/Ashby fetch logic completely unchanged, and reuses exactly the technique already proven live in Milestone 12 (32 companies added, 100% real, zero fabricated board tokens).

```
Candidate name/domain list (Electric Capital repo, or any other
curated crypto-company list you supply)
        ↓
normalize (strip Inc./Ltd., lowercase, common slug transforms)
        ↓
probe candidate slug against Greenhouse/Lever/Ashby's public
per-board endpoints, concurrently, bounded (same pattern as
run-collector.ts's fetch phase)
        ↓
confirmed hit (real HTTP 200 + parseable job list)
        ↓
company resolution (§5) — new "discovered" company + source identity
        ↓
existing collector runs unchanged, produces jobs exactly as today
```

This is genuinely additive: zero changes to `packages/collectors`' fetch/normalize code, zero changes to the ingestion pipeline. The only new code is the candidate-list ingestion + probing script (a batch job, not a Collector) and the company-resolution step in §5.

**Volume expectation, stated honestly:** this scales with the size and quality of the candidate list, not with engineering effort — the Electric Capital repo alone plausibly contains thousands of candidate names, but the *hit rate* against Greenhouse/Lever/Ashby specifically was ~45% in the Milestone 12 sample (32 hits from ~71 well-known-company candidates) and will likely be lower against a long-tail list of smaller, less digitally-mature projects. Real numbers get reported after a real run (§18), not promised in advance.

---

## 4. Company discovery model (schema, §5 in your numbering)

Extending `company`, not duplicating it:

```sql
ALTER TABLE company ADD COLUMN discovery_status text NOT NULL DEFAULT 'discovered';
-- pgEnum 'company_discovery_status': 'curated' | 'discovered' | 'verified' | 'rejected'
UPDATE company SET discovery_status = 'curated';  -- all 37 existing rows, same migration

ALTER TABLE company ADD COLUMN discovery_source text;        -- e.g. 'ats-probe', 'directory-json', 'jobicy'
ALTER TABLE company ADD COLUMN discovered_at timestamptz;     -- null for the 37 curated rows
ALTER TABLE company ADD COLUMN last_verified_at timestamptz;  -- last time its board/API responded successfully
```

This answers exactly your six questions:
- *Where did we discover this company?* → `discoverySource`.
- *Why do we trust this company?* → `discoveryStatus`: `curated` (you or I manually verified it) vs. `discovered` (a probe found it, unreviewed) vs. `verified` (a discovered company that's since been confirmed legitimate — the promotion path, not a new entity) vs. `rejected` (a probe hit that turned out to be noise/wrong company — kept, not deleted, so it's never re-probed).
- *Which jobs belong to it?* → unchanged, still `company_source_identity` → the existing job-derivation query.
- *Is its ATS board still valid?* → `lastVerifiedAt`, updated every successful collector run (reuses `collector`'s own health-tracking pattern, just at company grain).

No new entity type. Four columns, all nullable/defaulted, zero backfill risk.

---

## 5. Company resolution hierarchy (conservative, per your explicit instruction)

In strict priority order, first match wins, **no fuzzy string matching at any tier**:

1. **Exact `company_source_identity` match** — `(collectorId, sourceIdentifier)` already resolves, as today.
2. **Exact canonical domain match** — if a candidate's careers-page/website domain exactly matches an existing `company.websiteUrl`'s domain (stripped of `www.`/protocol, nothing fuzzier), resolve to that company.
3. **Exact normalized name match** — lowercase, strip `Inc.`/`Ltd.`/`LLC`/whitespace variance only (a fixed, small transform list, not similarity scoring) against `company.name`.
4. **No match at any tier → new `company` row**, `discoveryStatus: 'discovered'`.

Two different real companies that happen to share a near-identical name (your "Acme Labs" / "Acme Protocol" example) fall through all three tiers as *no match* and correctly become two separate rows — false negatives (missed merges) are accepted; false positives (wrong merges) are structurally impossible under this hierarchy, exactly as instructed.

---

## 6. Source provenance

Every discovered job must answer "where did this come from." Two levels already partially exist and get extended, not duplicated:

- **Company-level**: `discoverySource`/`discoveredAt` (§4).
- **Job-level**: `raw_record` already carries `collectorId` + `sourceIdentifier` + `fetchedAt` for every job — this is already full provenance for ATS-sourced jobs, no change needed. For a future non-ATS aggregator (Jobicy, etc.), the same `raw_record` shape applies unchanged: `collectorId` becomes that aggregator's own Collector row (e.g. `slug: 'jobicy'`), `sourceIdentifier` becomes whatever the aggregator uses as its own stable per-listing key. No new table.

---

## 7. Deduplication strategy

Real, observed evidence this matters: Jobicy's crypto-tag sample already included **Kraken and ConsenSys** — both already in the curated 37. Any aggregator source will re-surface jobs from companies already tracked via ATS collectors.

Deterministic identity, checked in this priority order (never relying on title alone, per your explicit instruction):

1. **Canonical application URL match** (normalized: strip tracking query params, trailing slash) — the strongest signal, when the aggregator actually exposes the true source URL.
2. **`(sourceATS, sourceJobId)` match** — if an aggregator's own listing embeds the same underlying Greenhouse/Lever/Ashby job ID (some do, in the URL or a field), that's as strong as #1.
3. **`(companyId, normalizedTitle, location)` match within a 14-day window** — the fallback for aggregators (like Jobicy, currently) that don't expose a checkable source URL. Company resolution (§5) must already have succeeded for this tier to apply at all.

On a match, **the earlier-seen (curated ATS) record always wins** and the aggregator duplicate is discarded, never the reverse — protects against an aggregator's own re-hosted URL silently replacing a better, first-party application URL, which you named as an explicit failure mode to avoid.

---

## 8. Role taxonomy

```ts
const ROLE_FAMILIES = {
  SMART_CONTRACT_SECURITY: { keywords: ["smart contract security", "smart contract audit", "smart contract auditor"] },
  BLOCKCHAIN_SECURITY:     { keywords: ["blockchain security", "security researcher", "vulnerability research", "penetration test"] },
  SMART_CONTRACT_ENGINEERING: { keywords: ["solidity engineer", "solidity developer", "smart contract engineer", "smart contract developer"] },
  PROTOCOL_ENGINEERING:    { keywords: ["protocol engineer", "protocol design", "core protocol", "consensus engineer"] },
  BLOCKCHAIN_ENGINEERING:  { keywords: ["blockchain engineer"] },
  WEB3_BACKEND:            { keywords: ["backend engineer", "backend developer", "infrastructure engineer", "platform engineer"] },
  WEB3_FRONTEND:           { keywords: ["frontend", "front-end", "front end", "ui engineer", "react developer"] },
  DEVREL:                  { keywords: ["developer relations", "devrel", "developer advocate"] },
  PRODUCT:                 { keywords: ["product manager", "product designer", "product owner"] },
  MARKETING:               { keywords: ["marketing"] },
  BD:                      { keywords: ["business development"] },
  SALES:                   { keywords: ["account executive", "sales director", "sales manager"] },
  DESIGN:                  { keywords: ["graphic designer", "brand designer", "ux designer"] },
  OPERATIONS:              { keywords: ["operations manager", " ops "] },
  COMPLIANCE:              { keywords: ["compliance", "aml", "legal"] },
  FINANCE:                 { keywords: ["accounting", "controller", "cfo", "finance manager"] },
} as const;

const ROLE_COMPATIBILITY: Record<string, readonly string[]> = {
  SMART_CONTRACT_SECURITY:  ["SMART_CONTRACT_SECURITY", "BLOCKCHAIN_SECURITY"],
  BLOCKCHAIN_SECURITY:      ["BLOCKCHAIN_SECURITY", "SMART_CONTRACT_SECURITY"],
  SMART_CONTRACT_ENGINEERING: ["SMART_CONTRACT_ENGINEERING", "PROTOCOL_ENGINEERING", "SMART_CONTRACT_SECURITY"],
  PROTOCOL_ENGINEERING:     ["PROTOCOL_ENGINEERING", "SMART_CONTRACT_ENGINEERING", "WEB3_BACKEND"],
  BLOCKCHAIN_ENGINEERING:   ["BLOCKCHAIN_ENGINEERING", "PROTOCOL_ENGINEERING", "WEB3_BACKEND"],
  WEB3_BACKEND:             ["WEB3_BACKEND", "PROTOCOL_ENGINEERING", "BLOCKCHAIN_ENGINEERING"],
  // ... one entry per target role slug in TARGET_ROLES (job-relevance.ts) — a
  // straight extension of that already-existing map, not a parallel system.
};
```

Same determinism level and unit-testability as the existing `SKILL_KEYWORDS`/`TARGET_ROLES` — a lookup table plus word-boundary matching (already fixed to be safe, see the earlier fix to this exact matching primitive), not NLP, not AI.

A job gets **zero or one** dominant family (first keyword match by priority order — engineering/security families checked before generic ones, so e.g. "Security Engineer, Frontend Platform" resolves to the more specific signal, not whichever family happens first in an unordered list). No match → `roleFamily: null`, excluded from the compatibility gate exactly like an unknown `workplaceType` today — never silently treated as "generic," per Phase 2's already-proven discipline.

---

## 9. Relevance algorithm (revised scoring model)

Your instruction is explicit: role compatibility must **dominate**, not bonus. Restructured `computeJobRelevance`:

```
Stage 1 — Role compatibility gate (evaluated first, largest weight):
  job has roleFamily AND user has targetRoleSlugs configured:
    - roleFamily in ANY target role's compatible set (§8)
        -> +45 (dominant positive signal)
    - roleFamily NOT in any compatible set
        -> -35 (strong penalty — not a full exclusion; a 95%-irrelevant
           job still appears in the feed, ranked low, per Milestone 13's
           "rank, don't shrink" principle)
  job has no roleFamily, OR user has no target roles:
    -> excluded from this component entirely (unknown ≠ mismatch,
       the same rule every other optional signal already follows)

Stage 2 — Skill fit (RESCALED down from 70 to 30 max):
  Same proportional-to-matched-skills mechanic as today, just capped
  low enough that skill overlap alone can never manufacture a "high"
  score on a role-incompatible job — the literal fix for the traced bug.

Stage 3 — Seniority compatibility (NEW: full compatibility matrix,
  not just a binary mismatch penalty):
  target = junior:  junior +8, mid +4, senior -10, staff/principal -15,
                     manager/director -20 (NEW: previously unclassified,
                     now an explicit signal)
  target = mid:     junior 0, mid +8, senior -5, staff -10, manager/director -15
  target = senior:  junior -10, mid 0, senior +8, staff +8, manager/director -10
  (table is data, not branching logic — one lookup, unit-tested per cell)
  Title states no level at all -> excluded, unchanged from today.

Stage 4 — Location/workplace compatibility (NEW model, §10):
  up to +10 satisfied / down to -10 conflicting / excluded if either
  side is unknown, same discipline as today's simpler remote-only check.

Stage 5 — Negative keyword penalty (unchanged, -35, independent evidence).
```

Every stage keeps its own signed breakdown line, in your exact requested format:

```
Match: 87%
Role compatibility       +45   "Smart Contract Security Engineer" — direct target-role match
Skill fit                +25   Solidity, Smart Contract Security
Seniority compatibility  +8    Mid-level — compatible with your preference
Location compatibility   +5    Remote — compatible
Workplace preference     +4
```

```
Match: 12%
Role compatibility       -35   Frontend role — no overlap with your target roles (security/protocol/backend)
Skill fit                +25   Frontend Engineering, TypeScript
Seniority compatibility  +5
Location compatibility   +0
```

`tierForScore`'s thresholds get re-tuned against the new max possible score (Stage 1 alone can now swing ±45 vs. skill fit's new ±30 ceiling) and re-validated against every ordering constraint in §17 as literal, checked test cases — not just plausible-sounding weights.

---

## 10. Seniority model

Covered in §9/Stage 3 above — the concrete addition is a **named compatibility matrix** (5 title-buckets × 3 preference-levels = 15 explicit, tested values), replacing today's binary "matches preference or -10" rule and closing the real, verified "Manager/Director currently gets no signal at all" gap from §1.

## 11. Location model

`locationConstraint` (free text today, unused in scoring) needs a small, deterministic parse, not a geocoding service:

```ts
type LocationScope =
  | { kind: "worldwide" }
  | { kind: "region"; region: string }       // "EMEA", "LATAM", etc. — a small fixed vocabulary
  | { kind: "country"; country: string }     // ISO country name/code, fixed vocabulary
  | { kind: "unspecified" };                  // today's actual empty state
```

Compared against a job's `workplaceType` + `locationName` (already-captured free text, e.g. `"Remote - USA"`, `"EMEA, LATAM, Canada, Europe"` — the Jobicy sample above shows this shape is common and parseable via keyword containment against the same fixed region/country vocabulary, not fuzzy geo-matching). `locationConstraint: "unspecified"` (today's real, actual value) excludes this component from scoring entirely, same discipline as every other optional signal. This is intentionally the smallest version that produces real signal — full geocoding/radius search is explicitly out of scope unless real usage shows keyword matching insufficient.

## 12. Negative evidence

Already partially covered by Stage 1's `-35` role-incompatibility penalty and the existing `-35` negative-keyword penalty (§9). No separate mechanism needed — "negative evidence" in this design isn't a new component, it's the existing components allowed to go negative and dominate, which the rescaling in §9 is what actually makes true (today, a -35 penalty can still be swamped by a +70 skill-fit score; after rescaling, a +30 skill-fit ceiling cannot outrun a -35+-35 double penalty).

## 13. Application URL model

- **Internal identity**: `/jobs/{companyId}:{externalId}` — unchanged, stays an internal route, never presented as if it were an application destination.
- **External application URL**: `job.absoluteUrl` — already correct and 100% populated for every ATS-sourced job (§1). For a future aggregator source, `absoluteUrl` must be populated from **the aggregator's own claimed original-source URL**, not the aggregator's own hosted page — this is exactly Jobicy's unresolved open question in §2: their terms claim their own "apply" buttons redirect to the original URL, but their JSON API doesn't expose that URL as a distinct field, and I could not verify the redirect target programmatically (their job-detail HTML page returned `403`). **This must be resolved with a manual, logged-in browser check before Jobicy is implemented as a source** — not assumed either way.
- **UI**: `JobCard` gains a second, explicit "Apply ↗" affordance directly on the feed card (not just the detail page) — one click to the real external URL from the feed, addressing the presentation gap in §1 without touching the already-correct underlying data.
- **Regression test** (new): asserts, against real ingested data, every open job's `absoluteUrl` is `^https?://`, and never equal to or containing this application's own `/jobs/` route.

---

## 14. Database changes (consolidated)

```sql
-- Company discovery (§4)
ALTER TABLE company ADD COLUMN discovery_status text NOT NULL DEFAULT 'discovered';
ALTER TABLE company ADD COLUMN discovery_source text;
ALTER TABLE company ADD COLUMN discovered_at timestamptz;
ALTER TABLE company ADD COLUMN last_verified_at timestamptz;
UPDATE company SET discovery_status = 'curated';  -- backfills all 37 existing rows

-- Role classification (job granularity, mirrors job_skill's exact shape)
CREATE TABLE job_role (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES company(id),
  external_id text NOT NULL,
  role_family text NOT NULL,
  confidence double precision NOT NULL,
  reasoning text NOT NULL,
  source_event_ids uuid[] NOT NULL,
  detected_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, external_id)
);
CREATE INDEX job_role_company_external_idx ON job_role (company_id, external_id);

-- User Profile: location parsing needs no new column - locationConstraint
-- already exists as free text (Milestone 13 Phase 2); §11's parser reads
-- it at query time, doesn't require a new structured column yet.
```

Every change is additive. No column removed or retyped anywhere in this document.

## 15. Migration strategy

Identical discipline to every migration this project has shipped: new nullable/defaulted columns, one new table, zero backfill risk beyond the trivial `UPDATE ... discovery_status = 'curated'` for 37 rows. No existing Event is ever rewritten. Fully reversible (every `ADD COLUMN`/`CREATE TABLE` has a trivial inverse).

## 16. Implementation phases

Your suggested breakdown, kept, with what each phase actually touches:

- **Phase A — Relevance correctness**: §8 (role taxonomy) + §9 (rescaled scoring) + §10 (seniority matrix) + §11 (location model) — all within `packages/application`/`packages/classification`, no schema change except `job_role`.
- **Phase B — Application URL correctness**: §13's regression test + `JobCard`'s second CTA. Small, fast, largely already-correct data.
- **Phase C — ATS company discovery**: §3's candidate-generation + probe pipeline + §4/§5's schema and resolution logic. The highest-leverage phase for actual breadth.
- **Phase D — Additional job sources**: Jobicy first (pending §13's apply-URL verification), then Remotive/Himalayas only after a real relevance-yield check each, matching Jobicy's — not implemented speculatively.
- **Phase E — Discovery quality + deduplication**: §7's dedup pipeline, plus the metrics in §17 wired into a real read model (not a one-off script), mirroring Collector Health's existing "storage + read API, no dashboard" precedent.

## 17. Test strategy

- Unit tests for every new pure function: role-family classification (boundary cases per family, including the "more specific family wins" ordering rule), seniority matrix (all 15 cells), location parsing (region/country/worldwide/unspecified), rescaled score composition (the exact ordering constraints from your §22 become literal `expect(...).toBeGreaterThan(...)` test cases, not just prose).
- Integration tests for the ATS-discovery probe pipeline and company resolution hierarchy (§5) — specifically a test proving two similarly-named companies never merge.
- URL regression test (§13).
- All new/changed code covered before any production run, matching this project's existing discipline.

## 18. Production verification plan

Real numbers, before and after, exactly as requested:

```
Before (today, confirmed):
  37 companies, 100% curated
  561 jobs (544 open, non-stale)
  0 discovered companies

After each phase, re-measured (not asserted):
  Total companies / curated / discovered
  Jobs from curated vs. discovered companies (%)
  Source distribution (collector -> job count)
  Top 20 companies by job count (checked explicitly against your
    concern: if it's still dominated by Coinbase/Anchorage/CertiK/
    Fireblocks after Phase C, that's reported as a miss, not softened)
  New companies discovered / week (once running on a schedule)
  Duplicate rate measured (matches found / total aggregator jobs ingested)
```

Manual click-through (§13 of your prompt): 3 real jobs per active source, opened by hand, application page confirmed genuine — done and reported honestly, including any failures, before that source is considered production-ready.

## 19. Quantitative acceptance criteria

**Discovery:**
- More than 37 companies represented.
- At least one legitimate non-curated company discovered automatically end-to-end (probe → resolve → job appears in `/jobs`).
- No single company or source accounts for the overwhelming majority of the feed (a specific, checked number, not a vibe — e.g. no source >60% once discovery is live).
- Every actionable job still has a valid, verified external URL — including any new aggregator source.

**Relevance**, your exact ordering, adopted as literal test assertions against real data:
```
Smart Contract Security Engineer  -> high
Blockchain Security Engineer      -> high
Solidity Engineer                 -> high
Protocol Engineer                 -> high or medium
Web3 Backend Engineer             -> high or medium
Frontend Engineer                 -> low
Marketing Manager                 -> very low
Business Development              -> very low
Engineering Manager                -> low or very low
Senior Staff Frontend Engineer     -> low
```
This is directly checkable against the real Coinbase frontend example from §1 — the actual regression case that started this review.

## 20. Risks / rejected approaches

- **Fuzzy company-name matching** — rejected outright per your explicit instruction; §5's hierarchy is deliberately exact-match-only, accepting missed merges over false merges.
- **Scraping Wellfound/AngelList, CryptoJobsList (bot-blocked), or Google Search results** — rejected; ToS-prohibited or practically blocked, not worth building around.
- **A general-purpose company-career-page crawler (the "real" Google-Jobs-equivalent)** — the highest long-term-potential idea surfaced this round, explicitly deferred as its own future project: it has no natural bounded scope (which sites, how often, how to parse arbitrary HTML/JSON-LD reliably) and doesn't fit "add a source" — flagged, not built.
- **Using Jobicy before its apply-URL question is resolved** — rejected for this milestone; shipping a source whose application destination can't be verified would violate the URL-correctness requirement this entire review exists to fix.
- **AI/LLM-based role or relevance classification** — not proposed anywhere in this document, per your standing instruction; every new classifier here is a keyword table plus word-boundary matching, same determinism level as everything already shipped.

---

## Summary — the six things you asked for explicitly

**A. What I found:** Discovery is 100%-curated by construction, not under-population — no enumeration mechanism exists on any ATS, and neither Web3.career nor RemoteOK is the free win they're often assumed to be (verified live, not from documentation). The relevance bug is exactly what you diagnosed: skill fit computed independent of role intent, traced to one real job and one real number. URL data is already correct; only its presentation was confusing. Opportunity/Recommendation duplication is real (77 rows, top company has 14).

**B. What I recommend:** Fix relevance first (Phase A) — it's pure logic, no new external dependency, and directly fixes the regression that triggered this review. Then pursue breadth via ATS candidate-discovery (Phase C) before any new aggregator, since it reuses proven, zero-risk infrastructure. Treat Jobicy as the one promising aggregator lead, gated on resolving its apply-URL question by hand first.

**C. Exact schema changes:** §14, all additive — 4 new columns on `company`, one new `job_role` table.

**D. Exact source strategy:** §2's table + §3's candidate-generation/probe pipeline (Electric Capital repo → normalize → probe existing collectors → resolve via §5 → ingest via existing, unchanged pipeline).

**E. The scoring formula:** §9 — role compatibility gate (±45/-35, dominant) → rescaled skill fit (≤30) → seniority matrix (§10) → location model (§11) → unchanged negative-keyword penalty.

**F. Implementation phases:** §16, A through E, each independently shippable and independently verified against real production data per §18 before the next begins.

**G. Measurable definition of done:** §19's literal criteria — specific company/source-diversity numbers, and the exact role-ordering test suite derived from your own real example.

Not starting Phase A until you approve this.
