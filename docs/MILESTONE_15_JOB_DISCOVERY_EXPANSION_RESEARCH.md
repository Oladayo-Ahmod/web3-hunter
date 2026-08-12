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

Stopping here per your instruction. Nothing in this document has been implemented — no candidates probed, no adapters built, no schema touched.
