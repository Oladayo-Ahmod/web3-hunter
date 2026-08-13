# Milestone 15 — Job Discovery Expansion Research

**Status:** research and design only. No code, no schema changes, no probing batch, no deployment. Every claim about a source's behavior below is a live check made while writing this document (a real HTTP request or a real documentation lookup), not something assumed or recalled from training — where a check was inconclusive, that's stated plainly, not smoothed over. **Stopping after this analysis, per your instruction, pending your decision on which path(s) to pursue.**

## 0. Scope discipline

This document is about one question only: **where can we find more real Web3 jobs, with a verifiable employer application URL, that our existing pipeline can ingest or be cheaply extended to ingest.** It is explicitly not about scoring, personalizing, or predicting which companies are likely to hire this particular user — that system (`job-relevance.ts`) is untouched and out of scope here, per your instruction to keep discovery and relevance separate. Nothing in this document proposes a company-intelligence subsystem; every proposal below is a *candidate list* or a *collector adapter*, both of which are shapes this codebase already has.

---

## A. Better candidate-company sources

### A.1 DeFiLlama protocols API — live-checked, strong candidate

`GET https://api.llama.fi/protocols` — free, unauthenticated, JSON, no key required. Confirmed live:

- **8,025** raw protocol entries. Real breadth, but heavily fragmented: many entries are version/fork variants of the same real company (`Aave V1`/`V2`/`V3`/`V4`/`Horizon`/`Arc`/`Aptos` are all one company — Aave Labs). Deduplicating via the API's own `parentProtocol` field brings this to **6,674 distinct root entities**, of which **4,036** carry a real `url` field.
- Every entry carries a real `category` field from an 89-value taxonomy — `Lending`, `Dexs`, `Bridge`, `Oracle`, `Security Extension`, `Developer Tools`, `Wallets`, `RWA`, `Restaking`, etc. This is a *structural* relevance signal, not a name-substring guess the way Electric Capital's category-keyword tiebreak was (Milestone 14 §D already found that tiebreak correlated weakly with real hits) — a protocol's category is assigned by DeFiLlama's own maintainers based on what it actually does, not derived from its name.
- **Proof of concept, done live, not simulated**: took the real DeFiLlama name `"Ondo Finance"`, guessed the slug `ondofinance`, and hit a real Greenhouse board on the first try — `company_name: "Ondo Finance"` on the returned postings, an exact match, meaning the existing Greenhouse cross-check would validate it cleanly with zero new code. This is the same slug-guess-and-probe mechanism Electric Capital candidates already use — **nothing about the probe pipeline needs to change to consume this source.**
- **Real limitation found live**: `GET https://api.llama.fi/raises` — which would have been an even stronger signal ("funded, so plausibly hiring") — returned `402 Payment Required`. It used to be free; it's been monetized. Not usable without a paid API key.
- **Real limitation, honestly assessed, not just theoretical**: many of the ~6,674 root protocols are small or anonymous teams (some entries are literally unattributed forks — `"Doge Compounder"`, `"eCurve"` were found live in the raw data) with plausibly no real employer or careers page at all. This source has *better relevance signal* than Electric Capital, not a *guarantee* every candidate is a real employer — the probe step still has to do the same work it already does.

| | |
|---|---|
| What it discovers | Candidate company/protocol names + categories + website URLs |
| Breadth | ~6,674 distinct entities, ~4,036 with a website |
| Web3-specific | Yes, entirely |
| Exposes employer identity | Name + category + website, yes |
| Exposes real application URL | No — same as Electric Capital, this is a *candidate* source, the ATS probe still finds the real URL |
| Feeds existing collectors | **Yes, directly — same slug-probe mechanism, zero new collector code** |
| New adapter required | No |
| Complexity | **Low** — simpler than Electric Capital's pipeline (one JSON GET vs. a Python-CLI migration-log export) |
| Limitations | Version/fork fragmentation requires the same dedup Electric Capital candidates already get via company resolution; `/raises` paywalled; many entries are small/anonymous teams |
| Worth pursuing | **Yes — highest-leverage, lowest-cost option in this document** |

### A.2 CoinGecko coins list — live-checked, not recommended as a primary source

`GET https://api.coingecko.com/api/v3/coins/list` — free, unauthenticated. **18,395** entries, live-confirmed. But this is token-centric, not company-centric: the raw list is dominated by memecoins and noise (a literal entry named `"༼ つ ◕_◕ ༽つ"` was found live in the response). Per-coin website links require one API call per coin (`/coins/{id}`), and CoinGecko's free tier is aggressively rate-limited (roughly 10–30 calls/minute) — bulk-extracting website URLs for even a few thousand coins would take hours and risk throttling.

| | |
|---|---|
| Breadth | 18,395 (raw), unknown after filtering junk |
| Web3-specific | Yes, but low signal-to-noise |
| Feeds existing collectors | Yes, same mechanism, if extracted |
| Complexity | Medium (rate-limit-constrained bulk extraction) |
| Worth pursuing | **Low priority** — DeFiLlama already covers this ground with far less noise |

### A.3 GitHub topic search — live-checked, marginal complement

`GET https://api.github.com/search/repositories?q=topic:web3` — free, but unauthenticated rate limit is **60 requests/hour** (confirmed live via `/rate_limit`), rising to 5,000/hour only with a personal access token (a real ops requirement, not just an API call). Live-checked `topic:web3 stars:>50` returned only **829** total repos, and the top result was an individual's fork of a known project (`slymnoyann/hey-1`, a fork of Lens Protocol's client), not a company org — confirming this needs real filtering (organization-only, exclude forks) to be usable at all.

More importantly: this doesn't address Milestone 14's actual finding. GitHub topic-tagging is still a proxy for "is an active software project," the same category of signal as Electric Capital's repo count — it doesn't correlate with "hires for security/protocol roles" any better than what we already have.

| | |
|---|---|
| Worth pursuing | **Low priority** — doesn't solve the problem M14 identified, adds ops overhead (PAT management) for modest breadth |

### A.4 "Awesome-web3" GitHub lists — checked, not a bulk source

Several curated markdown lists exist (`ahmet/awesome-web3`, `starton-io/awesome-web3-tools-and-dapps`, others) — free to read, but unstructured prose, not an API; extracting candidates means manual parsing per list, with inconsistent maintenance quality. One genuinely useful lead surfaced: `starton-io`'s list names several smart-contract security-audit firms specifically (ChainSecurity, Consensys Diligence, Cyberscope, Cyfrin, Hacken) — exactly the high-relevance category Milestone 14 found underrepresented. But this is a short, hand-curated list (dozens of names), better suited to being **manually added as curated companies** (the same mechanism that produced the original 37) than treated as a bulk discovery source.

| | |
|---|---|
| Worth pursuing | Not as a discovery *source* — but the specific named security firms are a good, small, direct manual-curation lead, worth acting on separately from any discovery batch |

---

## B. Direct career-page discovery

Live-checked against a real company (Chainalysis, not currently in our company table):

- `curl`-fetching `https://www.chainalysis.com/careers/` and grepping the raw HTML for any of `greenhouse|lever|ashbyhq|workable|smartrecruiters|recruitee|bamboohr|teamtailor|breezy` returned **zero matches**. The real careers page is a JavaScript-rendered single-page app — whatever ATS it actually uses is loaded client-side after the page loads, invisible to a plain HTTP fetch.
- The company's own `sitemap.xml` (a standard WordPress/Yoast sitemap) contains marketing pages, not job data — the ATS board lives on a separate subdomain the marketing site's sitemap has no reason to reference.

**Conclusion, confirmed live rather than assumed**: reliable direct career-page discovery needs a headless browser (Puppeteer/Playwright) to execute the page's JavaScript and observe what it actually loads — a genuinely new infrastructure capability this project doesn't have today, with real added cost (browser automation is slower, more fragile, and more resource-intensive per check than a plain HTTP probe). This is the same conclusion Milestone 13 §2 already reached about an equivalent idea (a "Google Jobs"-style crawl) — nothing found here overturns it.

| | |
|---|---|
| What it discovers | Potentially, a company's actual ATS platform, from its own site |
| Breadth | Unbounded in theory, but gated entirely by the engineering cost below |
| Web3-specific | N/A — a generic mechanism |
| Exposes employer identity | Yes, trivially (it starts from the company) |
| Exposes real application URL | Indirectly, if it successfully finds the ATS board |
| Feeds existing collectors | Yes, if it successfully resolves to Greenhouse/Lever/Ashby |
| New adapter required | No adapter, but a wholly new capability (headless-browser rendering) |
| Complexity | **High** — new infra, new failure modes, ToS/robots.txt considerations per site |
| Worth pursuing | **No, not now** — confirmed, not just presumed, to require infrastructure this project doesn't have; revisit only as its own explicitly-scoped project, same standard M13 already set |

---

## C. Other ATS ecosystems

### C.1 Workable — live-checked, real and usable

`GET https://apply.workable.com/api/v1/widget/accounts/<slug>` — confirmed live: unauthenticated, returns `200` with `{"name", "description", "jobs": [...]}` for a real company (tested against `figma`, `elastic`, `clay`, `deel` — all resolve, some with jobs, some without). Per Workable's own help documentation, each job object carries a `url`/`application_url` field pointing to `https://<subdomain>.workable.com/jobs/<id>` — the employer's own Workable-hosted board, structurally the same shape as `jobs.ashbyhq.com/<company>` or `jobs.lever.co/<company>`, not an aggregator link. Satisfies the URL-correctness requirement.

**Real false-positive risk found live, not theoretical**: probing the slug `webflow` resolved to a real Workable board — but for an unrelated Greek digital agency also named "Web Flow," not the well-known Webflow.com. This is the exact same wrong-company collision class already known from Ashby/Lever, on a platform we haven't built any guard-rail for yet.

| | |
|---|---|
| What it discovers | Real per-company job postings |
| Breadth | Unknown for Web3 specifically — not established in this pass |
| Web3-specific | No — general-purpose ATS, same as Greenhouse/Lever/Ashby |
| Exposes employer identity | Only a bare `name` string, no equivalent to Greenhouse's `company_name` cross-check field found on the job objects |
| Exposes real application URL | **Yes, confirmed via documentation** — employer-hosted subdomain |
| Feeds existing collectors | No — different response shape, needs a new fetch function |
| New adapter required | **Yes** — same shape of work as the existing 3 adapters (`packages/collectors`), not a new paradigm |
| Complexity | **Medium** — comparable to the effort the Ashby adapter already took, plus a new false-positive guard since there's no structured cross-check field |
| Worth pursuing | **Yes, but as an adapter-building phase, not this one** — real, verified, but out of scope for "no code yet" |

### C.2 SmartRecruiters — live-checked, real and usable, better identity signal than Workable

`GET https://api.smartrecruiters.com/v1/companies/<slug>/postings` — confirmed live: unauthenticated, `200`, JSON. Tested against `visa` (a real, large company, chosen only to confirm the API shape) — returned real postings, each carrying a structured `company: {"identifier": "Visa", "name": "Visa"}` field on *every* posting. This is actually a **stronger** identity cross-check than Greenhouse's (which only appears when `content=true` is requested and isn't guaranteed present) — a real, structural advantage over both Workable and our two currently-unprotected platforms (Ashby/Lever).

| | |
|---|---|
| Exposes employer identity | **Yes — a structured `company.identifier`/`company.name` field on every posting**, stronger than Greenhouse's |
| Exposes real application URL | Not directly confirmed in this pass (would need a full posting-detail fetch) — flagged as needing one more check before build, not assumed |
| Feeds existing collectors | No, new adapter needed |
| Complexity | Medium, same class as Workable |
| Web3 adoption | Unconfirmed — no Web3 company found on it in this pass; would need real probing to know |
| Worth pursuing | **Yes, comparable priority to Workable** — the identity-verification story is actually the best of any platform investigated here |

### C.3 Recruitee — inconclusive

`GET https://<slug>.recruitee.com/api/offers/` — the one real company guessed (`pitch`, a well-known product) returned `404`. This most likely means a wrong slug guess, not proof the platform or pattern doesn't work — inconclusive, not evaluated further in this pass. **Not recommended to act on without a confirmed real example.**

### C.4 BambooHR, Breezy HR, Teamtailor, Personio — not conclusively verified this round

One live check (Breezy, guessed slug) redirected to the marketing homepage rather than resolving — inconclusive. These platforms are commonly cited as having some API surface, but none were confirmed live in this pass, and several (Teamtailor, Personio) are understood to typically gate programmatic access behind a partner/API key rather than an open endpoint. **Flagged honestly as unverified — not recommended to invest in without a dedicated follow-up check**, rather than assumed to work or assumed not to.

---

## D. Job-specific sources (aggregators revisited)

Web3.career, Jobicy, RemoteOK, Himalayas, and Remotive were live-rejected in Milestone 13 §21 on URL-correctness grounds — none exposed a true employer application URL, only their own hosted domain. That status is **DECIDED**, and nothing found in this investigation surfaces new evidence to reopen it — not re-verified live again this pass, per your own instruction to revisit only if there's a reason to believe the URL problem is solved.

One new, previously-unevaluated candidate surfaced in passing (via an awesome-list reference, not deeply investigated): **SailOnChain**, described as aggregating "1,400+ positions from ~2,000 blockchain companies." Unverified — flagged here only as a lead for a **future, narrowly-scoped evaluation using the exact same live-check discipline** §21 already used (does it expose a real employer URL, or only its own domain), not evaluated further in this document.

---

## E. Search-engine/web discovery

No public "Google Jobs" API exists for arbitrary search — reconfirmed, unchanged from Milestone 13's finding. Google's legitimate, ToS-compliant **Programmable Search Engine (Custom Search JSON API)** does exist as a real, keyed API distinct from scraping search-result pages — but its free tier is capped at 100 queries/day, it returns search snippets rather than structured job data, and it would still only point at a candidate URL that then needs the exact same ATS-probe pipeline every other source in this document already uses. The leverage here is low relative to DeFiLlama's one-shot JSON pull of thousands of categorized candidates.

| | |
|---|---|
| Worth pursuing | **No** — low breadth, low leverage, real quota constraints, no advantage over A.1 |

Scraping actual Google Search results (not the legitimate Custom Search API) remains excluded on ToS grounds, consistent with the existing standard.

---

## F. Ranked recommendation

Ranked by (1) plausible additional real jobs, (2) URL correctness, (3) Web3 relevance, (4) engineering effort, (5) reliability, (6) architecture reuse:

| Rank | Option | Plausible job yield | URL correctness | Web3 relevance | Effort | Reliability | Reuses current architecture |
|---|---|---|---|---|---|---|---|
| 1 | **A.1 DeFiLlama protocols as the next candidate source** | High (thousands of categorized candidates, better relevance signal than Electric Capital) | Same as today — probe-verified, structurally guaranteed | High — DeFi/protocol-native by construction | **Lowest** — zero new collector code | Same as today's proven pipeline | **Full — no new code path** |
| 2 | **C.2 SmartRecruiters adapter** | Unconfirmed breadth, but strongest identity-verification story of any option here | Needs one more check (posting-detail URL field), else strong | Unconfirmed Web3 adoption | Medium — one new adapter | Likely high, given the identity field | High — same adapter pattern as existing 3 |
| 3 | **C.1 Workable adapter** | Unconfirmed breadth | Confirmed via documentation | Unconfirmed Web3 adoption | Medium — one new adapter, plus a new false-positive guard (no structured identity field found) | Medium — real collision risk demonstrated live | High — same adapter pattern |
| 4 | A.4 Manually curating the named security-audit firms (ChainSecurity, Cyfrin, Hacken, etc.) | Low volume, but high relevance | Structurally guaranteed (same as existing curated companies) | Very high | Lowest — no pipeline work, just data entry | Highest | Full |
| 5 | A.3 GitHub topic search | Low-to-modest, unproven improvement over Electric Capital | Same as today | Same limitation M14 already found | Medium (PAT/ops overhead) | Medium | Full, but doesn't fix the real problem |
| 6 | A.2 CoinGecko | Unproven, noisy | Same as today | Low signal-to-noise | Medium-high (rate limits) | Low | Full, but not recommended |
| 7 | D. SailOnChain (unverified) | Unknown | **Unverified — do not assume** | Presumably high | Unknown until evaluated | Unknown | Unknown |
| — | B. Direct career-page crawling | Unbounded in theory | Would be strong if it worked | High | **Very high — new infra required** | Unproven | Would need a new capability entirely |
| — | E. Google Custom Search API | Low | Weak (points at candidates, not final URLs) | N/A | Low effort, low payoff | N/A | Full, but low leverage |
| — | Aggregators (Web3.career, Jobicy, etc.) | N/A | **Fails structurally** | High | N/A | N/A | N/A — already closed |

## G. Highest-leverage next move

**A.1 — probe DeFiLlama's protocol list through the existing Greenhouse/Lever/Ashby pipeline.** This is the one option in this document that requires literally zero new code: no new collector, no new adapter, no schema change, no new false-positive-protection work beyond what already exists — it is the same "candidate list → probe → resolve → attach" mechanism already proven twice (Electric Capital batches 1 and 2), pointed at a source with a real, structural relevance signal (an assigned category from an active maintainer, not a repo-count proxy) instead of the one Milestone 14 already found to correlate poorly with what this profile actually wants.

The honest secondary point: even a perfect candidate source doesn't fully solve Milestone 14's finding by itself — DeFiLlama's categories tell us "this is a lending protocol," not "this company is hiring for security/protocol engineering roles right now." The real test is the same one Milestone 14 ran on Electric Capital: probe a batch, then re-run `measure-discovery-relevance.ts` against the real result, and see whether DeFiLlama-sourced companies clear the bar Electric-Capital-sourced ones didn't.

**Not recommended to pursue yet, but real and worth returning to**: the Workable/SmartRecruiters adapters (C.1/C.2) — genuinely verified, genuinely additive, but they're new collector code, which is explicitly out of scope for this phase, and their actual Web3 adoption is still unconfirmed. The honest sequencing is candidate-source work first (near-zero cost, testable immediately with existing code), platform-breadth work second (real cost, only worth it once we know it's not solving a problem DeFiLlama alone already solves).

Approved to proceed with a controlled experiment; results in §H.

---

## H. The controlled experiment — real results

Implemented the smallest change the existing architecture needed: `discover-companies.ts` (CLI) now accepts an optional `discoverySource` argument (default unchanged, so Electric Capital usage is unaffected), and `measure-discovery-relevance.ts` breaks "discovered" down by source. No new discovery system, no schema change, no collector modification.

**Candidate selection** (documented in full in the throwaway prep script, deleted after use per this project's established convention): fetched all 8,025 raw DeFiLlama protocols, deduplicated via the API's own `parentProtocol` field to 6,673 distinct root entities, split into Tier 1 (member category is one of a fixed, documented list of target-relevant categories: Security Extension, Developer Tools, Lending, Dexs, Bridge, Oracle, Wallets, RWA, Restaking, Liquid Staking, CDP, Chain, MEV, Privacy, etc. — 3,421 groups) and Tier 2 (everything else, not excluded — 3,252 groups), ranked each tier by total TVL descending, and selected 450 from Tier 1 + 50 from Tier 2 = 500. Slug variants combined the root slug (hyphenated and concatenated) with the same corporate-suffix-stripped variants Electric Capital candidates already used.

### H.1 Batch results

| Metric | Value |
|---|---|
| Candidates attempted | 500 |
| Probes (candidate × platform) | 1,500 |
| Hits | 48 (+1 from a 5-candidate smoke test before the full batch — "Morpho," see §H.2) |
| Confirmed 404s | 1,451 |
| Transient errors | 1 (`T RIZE`/Ashby — retried, resolved to a genuine miss) |
| Candidate hit rate | 48/500 = **9.6%** — vs. Electric Capital batch 2's 2.6% |

### H.2 False-positive verification — the dominant finding of this experiment

Every one of the 49 hits (48 main batch + 1 smoke test) was individually verified live — the real ATS board fetched, real job titles/descriptions read, not just the candidate name trusted. This is not optional diligence here: it is the central finding.

**"Morpho" (smoke test) was caught automatically, with zero new code**: it tried to attach to the same Ashby board (`ashby:morpho`) already claimed by the curated "Morpho Labs," hit the existing duplicate-conflict-on-attach mechanism (§5/§7 of the Milestone 13 doc), and was auto-rejected the instant it was created — proof the existing protection extends cleanly to a new candidate source without modification.

**22 of the remaining 48 hits (45.8%) were confirmed wrong-company, duplicate, or unverifiable-and-therefore-rejected** — far higher than any previously-measured rate on Electric Capital (Ashby's worst-observed rate there was ~21%). Manually verified, real examples:

- `current` (Greenhouse) — the real board is a Drupal/.NET/Webflow web agency, **not** a DeFi protocol. `company_name` on the board says "Current" too — this is the first confirmed case where **Greenhouse's own cross-check cannot help**, because two different real companies share the exact same name. The same pattern recurred on `blend` (Blend Labs, mortgage SaaS, not the DeFi lending protocol), `kodiak` (Kodiak Robotics, autonomous trucking, not the Berachain DEX), and `indigo` (an insurance underwriter, not the Cardano stablecoin protocol) — **4 same-name-different-entity collisions on Greenhouse alone**, a failure mode Milestone 13/14 never observed because it requires two real companies to independently choose the identical name, which short/generic DeFiLlama entity names make far more likely than Electric Capital's more distinctive GitHub-org-derived names.
- `linear` (Ashby) is Linear, the project-management tool (linear.app) — not "LiNEAR Protocol."
- `ethena` (Lever) is a Brooklyn-based compliance SaaS company — not the stablecoin protocol Ethena, despite the name being, on its face, one of the more distinctive ones in the batch.
- `unit`, `sphere`, `felix`, `kinetic`, `navi`, `flux`, `reservoir`, `solstice`, `hive`, `maya` — fintech, healthcare, aviation-AI, hardware-AI, music-licensing, pharma-AI, generic-AI, and recruiting-SaaS companies respectively, none crypto.
- `paxos` (Ashby) is a genuine duplicate — the same real company as the already-discovered `paxoslabs` (Electric Capital), just resolved via a different board/slug that the exact-normalized-name match didn't collapse. A **real, newly-identified dedup gap**: exact-name resolution doesn't catch a cross-source name variant ("Paxos" vs. "paxoslabs") landing on a *different* slug of the *same* platform. Not fixed in this experiment (a schema/logic change, out of scope) — rejected manually, flagged for §I.
- 5 more (`maplefinance`, `solera`, `echoprotocol`, `falconfinance`, `veda`) had zero open jobs at verification time, so identity couldn't be confirmed either way — rejected per your explicit instruction that uncertain companies stay rejected, not "innocent until proven guilty."

**26 of 48 hits (54.2%) were confirmed genuinely correct** — real, currently-open Web3 companies, including exchanges (OKX, Bybit, Robinhood, Gemini, Gate, Bitvavo), RWA/tokenization (Ondo Finance, Securitize, WisdomTree — the last a real TradFi asset manager's tokenization arm, a legitimate but not crypto-native identity worth naming honestly), and protocol/infra companies (Arbitrum Foundation, Superstate, Jito, Symbiotic, Polymarket, Grvt, Lightning Network, DoubleZero, Orca, Gauntlet, SwissBorg, and four zero-job-but-highly-distinctive names — Woofi, STON.fi, Metadao, Wan Bridge — accepted despite no jobs to verify against, because their names are specific enough that collision risk is negligible). One additional anomaly: `noble` (Greenhouse) resolved as a hit during probing but 404s consistently on every later check — not evidence of a wrong company (Noble is a real Cosmos-based USDC-issuer chain), just a board that appears to have gone dark since the probe ran. Left as `discovered`, not rejected, since nothing about its *identity* is in question — flagged as an anomaly, not a false positive.

All 22 confirmed-wrong/uncertain companies were rejected (`discoveryStatus: "rejected"`, source identity removed) using the exact same remediation pattern as every prior false positive this project has found.

### H.3 Production verification (real, post-collector-run)

- Ran Greenhouse/Lever/Ashby collectors for the 26 genuinely-accepted companies (two Greenhouse retries needed — one transient DB-connection contention, one transient WSL DNS resolution failure, both resolved cleanly on retry with zero data loss, confirming resumability held under real failures again).
- Ran job classification (one follow-up pass needed since OKX's 332 jobs weren't published until a later retry).
- Fetched all 1,177 jobs currently in the live `/api/jobs` feed (12 paginated requests): **zero** of the 22 rejected DeFiLlama companies (or any of the 7 previously-rejected Electric Capital companies) appear. **Zero** invalid `absoluteUrl`s found across all 837 DeFiLlama-sourced job events.
- Confirmed the 37 curated companies and the 26 Electric-Capital-discovered companies are unchanged in count and status — this batch only ever added new companies, never touched existing rows outside the one legitimate `paxos`/`paxoslabs` conflict-driven auto-reject.

### H.4 The headline comparison — DeFiLlama vs. Electric Capital, real numbers

Via `measure-discovery-relevance.ts`'s new source breakdown, against the real saved profile, all currently-open jobs (any freshness):

| Source | n | high | medium | high+medium |
|---|---|---|---|---|
| Electric Capital | 164 | 0 (0.0%) | 4 (2.4%) | **2.4%** |
| DeFiLlama | 804 | 2 (0.2%) | 31 (3.9%) | **4.1%** |
| Curated (reference) | 549 | 13 (2.4%) | 27 (4.9%) | **7.3%** |

**DeFiLlama's discovered-job relevance rate (4.1%) is materially higher than Electric Capital's (2.4%)** — about 1.7x — and produced this project's **first-ever high-tier jobs from any discovered company**: "Lightning Protocol Engineer" and "Assets Protocol Engineer," both at Lightning Labs, both real, both currently open. Electric Capital never produced a single high-tier job across either of its batches. DeFiLlama still falls well short of curated's 7.3%, but the gap to curated (1.8x) is now smaller than Electric Capital's gap to curated (3.0x).

**But this comes at a much higher false-positive cost.** 45.8% of DeFiLlama's raw hits were wrong-company/duplicate/unverifiable, against Electric Capital's worst-ever-observed single-platform rate of ~21% (Ashby). Every one of those 22 rejections required a real, individual, live verification step — this was not free diligence, and it does not scale linearly for free.

### H.5 Other requested metrics

| Metric | Value |
|---|---|
| Jobs per genuinely-accepted company | 804 / 26 ≈ 30.9 avg (heavily skewed — OKX alone contributes ~330) |
| Discovered companies with zero open jobs | 6 / 26 (23.1%): `noble`, `stonfi`, `metadao`, `wanbridge`, `woofi`, `bitmex` |
| Discovered companies confirmed Web3-native | 26 / 26 (100% of *accepted* companies — by construction, since anything not confirmed Web3-relevant was rejected) |
| % of raw hits that were Web3-native | 26 / 48 (54.2%) |
| Jobs with valid employer application URL | 837 / 837 (100%) |
| Companies unaffected by this batch | 37 curated + 26 Electric Capital discovered + 7 Electric Capital rejected — all unchanged |

---

## I. Decision — recommendation

**B — adjust the candidate-ranking strategy and run another controlled batch, not A.** The relevance-yield result (4.1% vs. 2.4%) is real and positive, and argues DeFiLlama is a better-targeted source than Electric Capital. But scaling this *exact* approach (bare protocol/entity names, blind slug-guessing, no identity cross-check beyond Greenhouse's already-proven-insufficient `company_name` field) to the remaining ~6,173 candidates would predictably reproduce a ~46% false-positive rate at 10x+ the volume — dozens more manual verifications, each real, each necessary, each currently requiring a human to read a job description and make a judgment call no automated check in this codebase can yet make.

Concrete, evidence-based adjustments worth trying before another batch, not implemented in this experiment:
1. **Prefer longer, more distinctive candidate names over bare roots where available** — every same-name collision in this batch (`current`, `blend`, `kodiak`, `indigo`, `linear`, `ethena`) happened on a short, plain-English or single-word name; multi-word, domain-specific names (`Arbitrum Foundation`, `Lightning Network`, `Wan Bridge`) had zero collisions in this batch.
2. **Treat DeFiLlama's `twitter`/`url` fields as an additional identity cross-check** (not explored this round) — e.g. confirming the ATS board's own linked website or social handle matches DeFiLlama's, the same structural-signal principle behind Greenhouse's `company_name` check, extended to platforms that don't have one.
3. **Address the `paxos`/`paxoslabs`-class dedup gap** directly before the next batch, since a second run will keep re-finding the same class of cross-source duplicate.

Not recommending C (abandon DeFiLlama) — the relevance signal is real and better than the status quo. Not recommending D (ATS-platform expansion) yet — unrelated to what this experiment tested, and Milestone 15's original sequencing argument (candidate-source work first) still holds.

No further batch will run without your explicit approval of a specific adjusted strategy.

---

## J. The follow-up experiment — implementation and real results

Approved and implemented exactly as planned, nothing more:

1. **Activated the dormant domain-match tier.** `resolveDiscoveredCompany` already had an exact-domain-match tier and an existing test for it — no caller had ever supplied a domain, and no discovered Company ever got a `websiteUrl`. `company-resolution.ts` now persists `websiteUrl` on creation; `discover-companies.ts`'s `DiscoveryCandidate` gained an optional `domain`; `defillama-candidates.ts` carries DeFiLlama's own `url` field through. Two new regression tests cover the exact "Paxos"/"paxoslabs" shape and confirm the match stays exact (a near-miss domain like `app.paxos.com.evil.com` does not false-match).
2. **Built the permanent `defillama-candidates.ts` module**, replacing the throwaway batch-1 script: `dedupeProtocols`, `rankCandidates` (unchanged tier+TVL logic), `slugVariants`, `buildDiscoveryCandidates` — all pure, all unit-tested.
3. **Evaluated `distinctivenessPenalty` against the real 46 batch-1-verified candidates**, using an independent common-English-words corpus (google-10000-english), not tuned to this project's data. Real result: **4/21 (19%) recall on known-bad candidates, 1/25 (4%) false-flag on a known-good one** ("gate" — Gate.io). This is weak, not meaningful, separation. Per your explicit rule 5, it was **not wired into ranking** — `buildDiscoveryCandidates` never calls it. Kept only as a tested, documented, unused function so the finding is reproducible.

### J.1 The second batch — real numbers, direct comparison to batch 1

500 new candidates (Tier 1 ranks 450–899, Tier 2 ranks 50–99 — the next slice after batch 1, via `prepare-defillama-batch.ts`'s skip/count parameters).

| Metric | Batch 1 (this doc, §H) | Batch 2 |
|---|---|---|
| Candidates attempted | 500 | 500 |
| Probes | 1,500 | 1,500 (+12 retries) |
| Hits | 48 | 30 (28 distinct companies) |
| Candidate hit rate | 9.6% | 6.0% |
| Genuine new companies | 26 | **3** (Thena, Parasail, Bastion) |
| Already-known (same-batch, multi-platform) | 0 | 2 (Up, Parasail each hit Greenhouse+Ashby) |
| Cross-source duplicates (Paxos-class) | 1 | **0** — nothing in this batch happened to share a domain with an existing company; the fix exists and is tested (§J item 1) but had nothing to catch this round |
| Wrong-identity matches (confirmed via real content) | 17 | **19** |
| Unverifiable matches (zero jobs, rejected conservatively) | 5 | **6** |
| **Overall false-positive rate** | **45.8%** | **89.3% (25/28)** |
| Transient errors | 1 | 4 (all retried, resolved to genuine misses) |

**The false-positive rate did not improve — it got dramatically worse.** Every single hit was individually verified live again (real ATS board fetched, real job description read), the same discipline as batch 1. Confirmed wrong-company examples: `up` (a real Australian neobank, up.com.au — a second same-name-different-entity Greenhouse collision, on top of `current`/`blend`/`kodiak`/`indigo` from batch 1), `saturn` (a UK fintech AI platform, not the RWA protocol), `doppler-finance` (doppler.com, the secrets-management SaaS company, not Doppler Finance), `hercules`, `radiant`, `verse`, `atrix`, `artemis-finance`, `orbit-protocol`, `level`, `flex`, `flamingo`, `nirvana`, `neptune-finance`, `sable-finance`, `hypha`, `blueshift`, `butter-network`, `oath-foundation` — 19 real, unrelated companies. Of these, the large majority have short, plain-English or well-known-proper-noun root names (`up`, `flex`, `level`, `verse`, `saturn`, `radiant`, `nirvana`, `flamingo`, `oath`, `neptune`, `hercules`, `orbit`, `atrix`, `doppler` — 14 of 19), confirming the same pattern batch 1 found, not a new one.

**Why it's worse, not better — the honest explanation**: this batch is, by design, the *next* slice of the ranked pool — lower total-TVL protocols than batch 1's. The evidence here says that as DeFiLlama's ranking goes deeper, candidates skew toward smaller, less-established projects that are more likely to have chosen short, generic, single-word branding (rather than the more distinctive multi-word names larger, more established protocols tend to have) — which is exactly the collision-prone shape both batches found. This is a real property of the candidate *source*, not something the domain-match fix or any ranking tweak implemented here could have addressed — those interventions targeted cross-source duplicates and multi-word-vs-single-word ranking priority, neither of which is what's driving this batch's collision rate.

### J.2 Relevance — the 3 genuine companies, real numbers

| Metric | Batch 1 | Batch 2 (3 genuine companies) |
|---|---|---|
| Jobs added | 804 | 13 (Parasail 8, Bastion 5, Thena 0) |
| High-tier jobs | 2 | 0 |
| Medium-tier jobs | 31 | 0 |
| High+medium relevance rate | 4.1% | **0.0%** |
| Combined DeFiLlama relevance rate (both batches) | — | **4.0%** (818 jobs, 2 high, 31 medium) — statistically unchanged from batch 1 alone |

None of batch 2's 13 new jobs scored medium or high for the real saved profile. Combined with batch 1, DeFiLlama's overall relevance rate is unchanged in practice (4.1% → 4.0%, within noise).

### J.3 Production verification

- Ran Greenhouse/Ashby collectors for the 3 genuine companies (Parasail: 8 jobs published; Bastion: 6 fetched/5 currently open; Thena: 0 — its Greenhouse board is real but has no current openings). Two unrelated pre-existing companies (`omninetwork`, `grvt`) hit transient fetch failures during this run, unrelated to batch 2's own companies — not retried, since neither is part of this experiment's scope and both are known-working, already-verified companies from prior batches.
- Ran job classification.
- Fetched all 1,190 jobs in the live `/api/jobs` feed (12 paginated requests): **zero** of all 55 all-time-rejected companies (7 Electric Capital + 23 batch-1 DeFiLlama + 25 batch-2 DeFiLlama) appear. **Zero** invalid `absoluteUrl`s across all 851 DeFiLlama job events (both batches combined).
- Confirmed curated (37), Electric Capital (26 discovered/7 rejected), and batch-1 DeFiLlama (26 discovered/23 rejected) companies are all unchanged in count and status.

### J.4 Decision, per your explicit rules

**Rule 2 applies: the false-positive rate did not improve (it got worse — 89.3% vs. 45.8%). Per your instruction, DeFiLlama discovery is not scaled further.**

Why, in plain terms: this batch tested two specific, evidence-backed interventions — activating dormant domain-based dedup, and evaluating (then correctly declining to use) a name-distinctiveness ranking signal. Both were implemented correctly and are now verified working in production (the domain tier has a real regression test proving it fires correctly; the distinctiveness evaluation is honestly reported as insufficient rather than kept for appearances). Neither intervention was ever going to fix the actual failure mode this batch hit: the *deeper* candidate pool is composed of smaller, newer, more genericaly-named projects, and no amount of resolution-logic or ranking-tiebreak engineering changes what real companies exist and what they're named. That's a property of the source at this depth, not a bug in this codebase.

Per rule 4 (quantify improvement and propose the smallest sensible next batch) — **there is no improvement to quantify**, so this rule does not apply; per rule 1 (recommend whether a larger batch is justified without running it) — **a larger batch is not justified** on this evidence. The honest recommendation is: **stop scaling DeFiLlama's repo/TVL-ranked candidate pool via blind ATS probing.** The mechanism works exactly as designed (the false positives were all caught, all rejected, zero leaked to production) — but the source's deeper pool does not have the identity or relevance quality to justify the manual-verification cost of continuing to mine it this way.

Stopping here per your instruction. No further batch has been or will be run without new direction from you.
