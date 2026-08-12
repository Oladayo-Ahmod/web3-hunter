# Milestone 14 — Discovery Quality Review & Proposal

**Status:** audit and design only. Nothing in this document has been implemented — no code, no schema, no deployment. Every number below is a real query against production or a real computation over the actual candidate-pool file, run while writing this document; nothing here is projected or assumed. **Implementation does not start until this design is approved.**

This picks up immediately after Milestone 13 (`MILESTONE_13_DISCOVERY_AND_RELEVANCE_REVIEW.md`), which is closed — this is a new milestone, not a reopening of that one.

---

## A. Current-state audit

Verified live against production at the time of writing:

| Metric | Value |
|---|---|
| Curated companies | 37 |
| Discovered companies (non-rejected) | 26 |
| Rejected companies (all-time) | 7 |
| Total non-rejected companies | 63 |
| Discovery probes, all-time | 3,953 (across 1,142 distinct candidates) |
| Candidates probed so far, of the pool | 1,142 / 22,545 (5.1%) |
| Open jobs (rejected companies excluded, all freshness) | 709 |
| Open jobs currently live in `/api/jobs` (stale excluded) | 437 |
| Discovered companies by ATS | Ashby 15, Lever 7, Greenhouse 4 |

Discovery architecture, unchanged since Milestone 13 and re-confirmed by reading the current code: `apps/web/lib/collectors/discover-companies.ts` probes a supplied candidate list against Greenhouse/Lever/Ashby, resolves hits via `resolveDiscoveredCompany` (exact canonical-domain match → exact normalized-name match → create), attaches source identities, and records every probe outcome (`hit`/`miss`/`error`) in `company_discovery_probe`. The existing Greenhouse/Lever/Ashby collectors (`packages/collectors`) are untouched and unaware discovery exists — they only ever see rows in `company_source_identity`, curated or discovered alike. `job-query-service.ts`'s `open_jobs` CTE filters `discovery_status != 'rejected'` once, centrally.

---

## B. Production metrics (the ones you asked for, computed for real)

| Metric | Value | Note |
|---|---|---|
| Unique companies discovered (net, non-rejected) | 26 | 6 from batch 1 + 20 from batch 2 |
| Jobs added by discovery | 165 open (709 total incl. stale) | vs. 544 open from curated |
| Jobs per discovered company | 6.3 avg (median 2) | Heavily skewed — see §C |
| Discovery hit rate (hit / probe) | 41 / 3,953 = 1.0% | Across all probes ever made |
| Discovery hit rate, batch 2 only | 26 / 3,000 = 0.87% | Candidate-level: 26/1,000 = 2.6% |
| False-positive rate (wrong-company / ever-created) | 5 / 33 = 15.2% | See §E for the exact breakdown |
| Rejected-company rate (all rejections / ever-created) | 7 / 33 = 21.2% | Includes 2 duplicate-conflict auto-rejects, not just wrong-company |
| % of live feed from curated companies | 366 / 437 = 83.8% | Live, stale-excluded, from the real `/api/jobs` |
| % of live feed from discovered companies | 71 / 437 = 16.2% | |
| % of live feed from each ATS (discovered only) | Ashby ~78% of discovered jobs, Lever ~21%, Greenhouse <1% | Concentration flagged in §F |
| % of jobs with a valid employer application URL | 1,154 / 1,154 = 100% | Checked against every `JobPosted`/`JobUpdated` event ever recorded, not just open ones |
| % of discovered companies with zero currently-open jobs | 6 / 26 = 23.1% | See §H |
| % of discovered jobs that survive relevance scoring as high/medium | 1 / 165 = 0.6% | vs. curated's 28/544 = 5.1% — see §G, this is the headline finding |
| % of discovered jobs that are "high" tier specifically | 0 / 165 = 0.0% | vs. curated's 11/544 = 2.0% |
| Probe cost per net-useful company | 3,953 / 26 = 152 probes | Real cost of the strategy so far |
| Incremental useful (high/medium) jobs per 1,000 candidates probed | Batch 2: 1 / 1,000 | The number that matters most for §I/§J |

---

## C. Discovery yield analysis

Batch 1 (150 candidates, small sample): 15 hits, 8 created, 6 net-useful after 2 false positives found.
Batch 2 (1,000 candidates): 26 hits, 23 created, 20 net-useful after 3 false positives found.

Per-candidate hit rate fell from batch 1's ~5.3% (wide error bars on 150 candidates) to batch 2's real, larger-sample 2.6%. This is the expected shape of a ranked pool — the top of a repo-count ranking is denser with real, ATS-having organizations than the middle.

**Concentration**: jobs are not evenly spread across the 26 discovered companies. Three companies — `mentoprotocol` (29), `omninetwork` (26), `parallelfinance` (19) — account for 74 of 165 discovered-company jobs (45%). The next tier (`moonpay` 15, `maplelabs` 14, `arcadiafinance` 13) brings the top 6 to 116/165 (70%). The remaining 20 companies split 49 jobs. This isn't a bug — some companies are simply hiring more — but it means "26 discovered companies" overstates how broad the actual job supply is; in practice, discovery so far has really been "a handful of companies with active hiring, plus a long tail of 1-3-job companies."

---

## D. Candidate-ranking analysis

The composite ranking (repo count primary, category-keyword tiebreak) was checked against batch 2's real 26 hits. Only 7 of 26 hit candidate names (27%) actually contained one of the tiebreak keywords (`protocol`, `defi`, `security`, `wallet`, `infra`, `zk`, `exchange`, `devtool`) — real hits like `phantom`, `moonpay`, `tenderly`, `base`, `sorare`, `oplabs` matched on repo count alone, not the keyword signal. **The keyword tiebreak, matched against the GitHub org name string, has weak correlation with actual hit likelihood** — most real crypto companies don't spell their category into their org name. This isn't disqualifying (repo count alone is still the dominant, working signal), but it means the tiebreak isn't earning its complexity yet, and shouldn't be trusted to do more work in a future batch than it's shown it can do in this one.

Repo-count boundaries, computed directly from the real 22,545-candidate file:

| Rank range | repoCount range | Status |
|---|---|---|
| 1–150 | 1,186 → 121 | Probed (batch 1) |
| 151–1,150 | 120 → 21 | Probed (batch 2) |
| 1,151–22,545 | 21 → 3 | **Not yet probed** |

Every candidate with repoCount > 20 has already been probed. The entire remaining pool sits at or below the exact point where yield was already declining.

---

## E. False-positive analysis

Every company the discovery pipeline has ever created, broken down by outcome:

| Outcome | Count | % of 33 ever-created |
|---|---|---|
| Genuinely correct, still discovered | 26 | 78.8% |
| Duplicate-conflict, correctly auto-rejected | 2 (`compound-finance`, `uniswap`) | 6.1% |
| Wrong-company, manually found and rejected | 5 (`unlock-protocol`, `switchboard-xyz`, `base`, `keep-network`, `anima-protocol`) | 15.2% |

The wrong-company false positives, broken down **by platform and by whether the Greenhouse `company_name` cross-check existed yet**:

| Platform | Ever-created | Wrong-company FPs | FP rate |
|---|---|---|---|
| Greenhouse, before the cross-check existed | 1 | 1 (`unlock-protocol`) | 100% (n=1) |
| Greenhouse, after the cross-check shipped | 4 | 0 | **0%** — the fix is real, not just theoretical |
| Lever (no structured field, ever) | 7 | 0 | 0% (small sample — not proof of safety, just no failure observed yet) |
| Ashby (no structured field, ever) | 19 | 4 | **21.1%** |

This is the same structural gap Milestone 13 named and never closed: Ashby and Lever expose no field equivalent to Greenhouse's `company_name` to cross-check a candidate against. Ashby's 21.1% observed rate, on real batch-2 data, is the honest number — it did not improve with scale, exactly as predicted. Lever's 0% is not evidence the same gap doesn't exist there; it's a small sample (7) that hasn't happened to fail yet.

**No undetected duplicate companies were found.** A normalized-name collision check across all 63 non-rejected companies found zero stem collisions — the existing exact-match-only resolution hierarchy has not produced a false negative (an undetected duplicate) at this scale.

---

## F. ATS/source-distribution analysis

| Platform | Curated companies | Discovered companies | Discovered jobs |
|---|---|---|---|
| Greenhouse | 9 | 4 | 1 |
| Lever | 10 | 7 | 35 |
| Ashby | 20 | 15 | 129 |

Ashby dominates discovery output: 15/26 discovered companies (58%) and 129/165 discovered jobs (78%). This tracks Ashby also being the platform where most hits land in the underlying candidate pool (crypto-native startups skew toward Ashby as an ATS choice) — not an artifact of the probing code favoring one platform. It is, however, also the platform carrying 100% of the *currently unmitigated* false-positive risk (§E), so growing it further without addressing that gap compounds the one weakness that's actually been measured, not just theorized.

No corrective action is proposed here yet (§I/§J) — this is a metric to keep watching, not a problem with an obvious fix. Artificially capping Ashby's share to "balance" the platforms would optimize for a vanity distribution, not for useful jobs, and the milestone brief explicitly asks not to do that.

---

## G. Relevance-quality analysis — the headline finding

Computed by running the real, shipped `computeJobRelevance` function against the real production job pool and the real saved profile (13 skills, 8 target roles: smart-contract-security-engineer, smart-contract-auditor, protocol-engineer, blockchain-engineer, blockchain-security-engineer, solidity-engineer, security-researcher, web3-backend-engineer; seniority junior/mid/senior; no remote/location preference set).

| Segment | n | avg score | high | medium | high+medium % |
|---|---|---|---|---|---|
| Curated | 544 | 5.3 | 11 (2.0%) | 17 (3.1%) | **5.1%** |
| Discovered | 165 | 1.6 | 0 (0.0%) | 1 (0.6%) | **0.6%** |
| Discovered / Greenhouse | 1 | 8.0 | 0 | 0 | 0% |
| Discovered / Lever | 35 | 3.8 | 0 | 1 | 2.9% |
| Discovered / Ashby | 129 | 1.0 | 0 | 0 | 0% |

**Answering your direct question**: discovered companies are, right now, producing jobs that are about 8x less likely to be a genuine high/medium match for this profile than curated companies (0.6% vs. 5.1%). Discovery has added *volume*, not *proportionally useful volume* — this is a real, evidenced finding, not a guess.

**But roughly half of that gap looks like a scoring-model artifact, not a true absence of relevant roles.** Inspecting every discovered-company job with an engineer/security/audit/protocol-sounding title (43 jobs) surfaced concrete, real title-matching gaps in `TARGET_ROLES`/`INCOMPATIBLE_ROLE_FAMILIES` (`packages/application/src/job-relevance.ts`):

- `"Smart Contract Engineer"` (Paxos Labs) scores **0** — doesn't match `solidity-engineer`'s keywords (`"solidity engineer"`, `"solidity developer"`) or `protocol-engineer`'s (`"protocol engineer"`), despite being squarely adjacent to two of this profile's eight target roles.
- `"Lead Security Engineer"` (Paxos Labs) scores 8 (low tier) — `security-researcher`'s only keyword is the exact phrase `"security researcher"`; `"security engineer"` isn't recognized at all, on any target role.
- `"Senior Infrastructure Security Engineer"` (Matter Labs) — same gap, same result.

These are real jobs, at real companies, that a Solidity/Security engineer would reasonably want to see, being scored as if they were irrelevant — not because the job is a bad match, but because the keyword list that decides "role match" doesn't recognize common real-world title phrasing. This is exactly the kind of gap Milestone 13 Phase A fixed for `frontend`/`marketing`/etc. incompatible families; it hasn't yet been fixed for the *positive* side (recognizing more of the titles that genuinely are target roles).

**Per your explicit instruction, no scoring change is made in this document.** This is reported as evidence for §J's recommendation, not implemented.

The other half of the gap looks genuine, not an artifact: discovered companies post plenty of real Ops/Product/Sales/Support/Marketing/Growth roles (`"Customer Success Manager"`, `"Sales & GTM Leadership Coach"`, `"Product Expert, Customer Support"`, `"Growth Engineer"`) that are correctly scored low — these companies are general DeFi/crypto businesses, not security- or infra-focused the way the 37 hand-picked curated companies are. That's a structural property of *how* candidates are ranked (GitHub activity, a proxy for "is a software company," not "hires for security/protocol roles"), not a bug anywhere in the pipeline.

---

## H. Zero-open-job companies

6 of 26 discovered companies (`symmetryinvestments`, `lagrangelabs`, `apexprotocol`, `anzenfinance`, `uniswapfoundation`, `zircuitlabs`) currently have zero open postings. This is a real, expected, low-cost state — hiring is cyclical, and these companies remain correctly wired into the existing collector rotation, so a future posting will surface automatically with zero additional work. The marginal cost of carrying a zero-job company is one extra API call per collector run (already well within `FETCH_CONCURRENCY`), not a growing liability. No corrective mechanism is proposed for this milestone.

---

## I. Options for the next milestone, with tradeoffs

**Option 1 — Scale probing further (e.g. the next 1,000–2,000 candidates).**
- *Pro*: Cheap, proven mechanism, no new design risk.
- *Con*: The remaining pool's repo-count signal is strictly weaker than what's already been probed (§D) — expect hit rate to keep falling, not recover. And §G shows the last batch's yield of *useful* jobs was extremely thin even where hits landed. Scaling volume without first knowing whether the relevance model can even see the useful jobs correctly risks measuring the wrong thing.

**Option 2 — Fix the relevance-model precision gaps found in §G, then re-measure the existing 26 companies before deciding on more probing.**
- *Pro*: Cheap (a handful of keyword-list entries, unit-testable, no schema change), directly evidenced (not speculative), and it answers the actual open question — "is discovery adding useful jobs" — with a materially less-biased measurement. If discovered-company relevance is still ~1% after this fix, that's a strong, trustworthy signal to stop scaling; if it recovers to something closer to curated's 5%, that changes the batch-3 decision entirely.
- *Con*: Doesn't add any new companies or jobs by itself. Requires touching `job-relevance.ts`, which Milestone 13 Phase A deliberately stabilized — any change needs the same rigor (real-data regression tests) that phase used.

**Option 3 — Mitigate the Ashby/Lever false-positive gap directly (e.g. a lightweight description-text cross-check: does the job description mention the candidate's known domain/website).**
- *Pro*: Addresses §E's one clearly-unsolved structural gap, which has now produced real false positives twice (batch 1 and batch 2), at a consistent ~20% rate on Ashby specifically.
- *Con*: No structured field exists to check against (that's the whole problem) — a text-based heuristic is inherently weaker than Greenhouse's exact-field check and would need its own false-positive/false-negative evaluation before being trusted. Real design work, not a quick fix.

**Option 4 — Company career-page crawling as a new discovery source.**
- *Pro*: Would eventually reach companies with no ATS presence at all.
- *Con*: This is not a next-milestone-sized task — no natural "list of sites to crawl" exists without already having the company list this whole effort exists to build, plus per-site HTML parsing, robots.txt compliance, and URL-correctness verification per site. Milestone 13 §2 already classified an equivalent idea ("Google Jobs' own crawl") as **REJECT for this milestone, revisit only as its own, later, explicitly-scoped project** — nothing here changes that conclusion.

**Option 5 — Do nothing; declare discovery "done" at 26 companies.**
- *Pro*: Zero risk.
- *Con*: Leaves real, cheap, already-identified relevance-model gaps (§G) unfixed, and abandons a mechanism that, once §G is addressed, may turn out to still have real (if modest) marginal value.

---

## J. Recommended next milestone

**Do Option 2 first, standalone. Do not scale probing in this milestone.** This is the direct answer to "if scaling would mostly add noise, say so" — on the evidence in §C/§D/§G, scaling from 1,150 to 10,000 candidates right now would mean probing an even-weaker-signal population with a relevance model that's already shown it undercounts the useful jobs the *current* discovered companies produce. That's optimizing for job count, which you explicitly said not to do.

Concretely, Milestone 14 should be:

1. **Fix the two concrete `job-relevance.ts` gaps found in §G** (exact keyword additions to be proposed and reviewed in the implementation PR, not decided unilaterally here — this needs the same care Phase A used, including new regression tests using these exact real titles).
2. **Re-run this document's §G measurement against the same 26 discovered companies** after the fix ships, and report the real before/after numbers.
3. **Formalize the §B/§G measurement as a repeatable script** kept in the repo (not a throwaway), so every future discovery batch gets this same yield/quality report without re-deriving it from scratch.
4. **Make the batch-3 sizing decision after step 2, using the re-measured number** — not in this document. If post-fix discovered-relevance is still near 1%, the honest recommendation at that point will likely be to stop probing and consider Option 3 or pause discovery entirely; if it recovers materially, a bounded batch (not 10,000) would be the next honest ask, sized off *that* evidence.

This order — fix measurement, then decide on scale — is the whole point of your brief: it refuses to scale probing until we can actually tell whether scaling would help.

---

## K. Exact implementation phases (for the parts approved to proceed)

**Phase 1 — Relevance precision fix** (small, additive, testable):
- Add title-keyword recognition for the two gaps found in §G to `TARGET_ROLES`/related role definitions in `packages/application/src/job-relevance.ts`.
- New unit tests in `job-relevance.test.ts` using the exact real titles found in §G (`"Smart Contract Engineer"`, `"Lead Security Engineer"`, `"Senior Infrastructure Security Engineer"`), the same "real production data as the regression test" discipline Phase A used.
- No change to weights, thresholds, or any other scoring component.

**Phase 2 — Formalized yield/quality measurement script**:
- A permanent (not `_`-prefixed throwaway) script under `apps/web/scripts/` that reproduces §B/§G's numbers on demand — curated vs. discovered relevance-tier breakdown, per-platform breakdown, per-company job counts, zero-job-company count.
- No schema change — reads existing `event`/`company`/`company_discovery_probe` data exactly as this audit did.

**Phase 3 — Re-measurement and batch-3 decision** (gated on Phase 1 shipping):
- Run the Phase 2 script against production post-fix.
- Produce a short addendum to this document with the real before/after numbers and a specific, evidence-based batch-3 recommendation (size, or explicitly "pause").
- No candidate probing happens in this phase — it's measurement only.

Explicitly **not** in scope for Milestone 14: aggregator adapters, AI/LLM matching, collector modification, a new large probing batch, schema changes, career-page crawling.

---

## L. Definition of done

- `job-relevance.ts`'s two identified gaps are fixed and covered by regression tests using the real titles that motivated them.
- The full existing `job-relevance.test.ts` suite (including every Phase A ordering/regression test) still passes — no change to any other job's score.
- The formalized measurement script exists, runs cleanly against production, and its output matches this document's manually-computed numbers when re-run before any relevance change (a self-check that the script is correct before trusting its post-fix numbers).
- A short, real, addendum reports the post-fix §G numbers and a specific batch-3 recommendation — not a restatement of this document's "it depends."
- All standard gates pass (typecheck, lint/boundaries, full test suite, production build) before anything is deployed.

## M. Tests and production verification required

- Unit: new `job-relevance.test.ts` cases for the exact titles in §G, plus confirmation that previously-correct scores (e.g. the Phase A Coinbase regression test) are unaffected.
- Production verification: re-run this document's exact §G query against production after deploy, confirm the specific three example jobs (`"Smart Contract Engineer"` @ Paxos Labs, `"Lead Security Engineer"` @ Paxos Labs, `"Senior Infrastructure Security Engineer"` @ Matter Labs) now score as high/medium rather than low, and confirm curated-company scores are unchanged (a regression check, the same discipline §22.9 of the Milestone 13 doc used).
- No collector run, no discovery probe run, no job classification run is needed for Phase 1/2/3 — this milestone (as scoped) touches scoring and measurement only, not ingestion.

## N. Rollback strategy

- The relevance-model change is a pure function of `(title) -> keywords`, covered by tests, with no schema or data migration — reverting is a single code revert, no data cleanup required (the same low-risk shape Phase A's own change had).
- The measurement script is read-only against production — it cannot itself cause any production incident; "rollback" is simply not running it again.
- If Phase 3's re-measurement shows no meaningful improvement, the rollback is informational, not code: the recommendation becomes "pause discovery probing," not "revert the fix" — the fix is correct regardless of what it reveals about discovery's yield.

---

## O. Phase 1–3 results — the actual fix, and the real re-measurement

Approved and executed. `packages/application/src/job-relevance.ts` gained two keyword additions:

- `solidity-engineer` now also recognizes `"smart contract engineer"`/`"smart contract developer"`.
- `security-researcher` now also recognizes plain `"security engineer"` (deliberately not folded into the narrower `smart-contract-security-engineer`/`blockchain-security-engineer` roles — a bare "Security Engineer" title doesn't claim that specificity).

No weight, threshold, or role-mismatch mechanic changed. 4 new regression tests were added using the exact real titles found in §G, plus a test confirming generic Frontend/Backend/DevOps titles still can't reach "high" purely from skill overlap. All 31 tests in `job-relevance.test.ts` (27 existing + 4 new) pass, including every Phase A ordering/regression assertion, unmodified.

A new permanent script, `apps/web/scripts/measure-discovery-relevance.ts`, reproduces this document's §B/§G measurement on demand against real production data — this is what produced every number below.

**Before vs. after, the real production job pool (709 open jobs, same pool both times — no discovery, no new ingestion happened between measurements):**

| Segment | n | Before: high+medium | After: high+medium | Change |
|---|---|---|---|---|
| Curated | 544 | 11 high + 17 medium = **5.1%** | 13 high + 26 medium = **7.2%** | +2.1pp |
| Discovered | 165 | 0 high + 1 medium = **0.6%** | 0 high + 4 medium = **2.4%** | +1.8pp |
| Discovered/Greenhouse | 1 | 0.0% | 0.0% | unchanged |
| Discovered/Lever | 35 | 2.9% | 2.9% | unchanged |
| Discovered/Ashby | 129 | 0.0% | 2.3% | +2.3pp |

**The exact three evidenced false negatives, verified against real production data (not just the unit test):**

| Title | Company | Before | After |
|---|---|---|---|
| "Smart Contract Engineer" | Paxos Labs (discovered) | low, score 0 | **medium, score 45** |
| "Lead Security Engineer" | Paxos Labs (discovered) | low, score 8 | **medium, score 53** |
| "Senior Infrastructure Security Engineer" | Matter Labs (discovered) | low, score 8 | **medium, score 53** |

All three moved exactly as predicted. The discovered-company medium count went from 1 → 4 — precisely +3, matching these three fixes with no unexplained extra movement.

**Regression check, real production data**: the exact real Coinbase job that triggered Milestone 13 Phase A (`"Senior Software Engineer, Frontend (Coinbase Advisor - Agentic Trading)"`) still scores **low (3)** — unchanged. The role gate is intact.

**Checked for incorrect upward moves**: every curated-company job that newly matches the expanded keywords (14 jobs, queried directly) was inspected. All 14 are genuine security/protocol-adjacent roles at already-vetted Web3 security/infra companies — `"Blockchain Security Engineer"` @ CertiK, `"Web3 Security Engineer"` @ Sky Mavis, `"Information Security Engineer"` @ Fireblocks, `"Senior Smart Contract Engineer"` @ Uniswap Labs, etc. **No unintended over-match was found.** (One near-miss worth naming: `"Member of Technical Staff, Security Engineering"` @ Anchorage Digital stayed low — "Security Engineering" doesn't contain the exact "Security Engineer" phrase, which is correct, conservative behavior, not a gap this fix claims to close.)

## P. Phase 4 — the scaling decision, based on the corrected numbers

**Recommendation: C — do not scale broad, repo-count-ranked ATS discovery further.** The evidence, not the old projections:

- The fix roughly **quadrupled** discovered-company relevance (0.6% → 2.4%) and confirmed the earlier 8x gap was partly a real measurement bug — but a **substantial, real gap remains**: discovered companies still produce useful (high+medium) jobs at **less than a third the rate of curated companies** (2.4% vs. 7.2%), and **zero** discovered-company jobs have ever reached "high" tier, across all 165 of them, even after the fix. This is no longer a measurement artifact — it's the corrected number.
- The curated rate improved *more* in absolute terms than the discovered rate (+2.1pp vs. +1.8pp) — the fix helped the hand-picked companies at least as much as the discovered ones, which is the opposite of what you'd want if the plan were "discovery just needed better scoring to catch up."
- In absolute terms, batch 2's entire yield — 20 net-new companies, 165 jobs — produced exactly **4 medium-tier jobs and 0 high-tier jobs** for this profile, even measured correctly. That is a very small return for 1,000 probes (§B's "probe cost" metric: 152 probes per net-useful *company*, not per net-useful *job* — the per-useful-job cost is far higher).
- This tracks §G's original explanation, now confirmed rather than merely suspected: the repo-count ranking that drives ATS discovery selects for "is an active software organization," which has no correlation with "hires for security/protocol/audit roles specifically." Curated companies were hand-picked *because* security/audit/infra is their business; discovered companies are a random cross-section of crypto software companies generally, most of whose job volume (correctly) scores low regardless of title-matching precision.

**What would change this recommendation**: not more probes against the same repo-count-ranked candidate list — the evidence here says that specific lever is close to exhausted of value. If more useful companies are wanted, the higher-leverage path demonstrated by this data is the same one that produced the 37 curated companies' 7.2% rate: identifying companies *because* they're security/audit/protocol-focused (a targeting signal ATS discovery's GitHub-repo-count ranking structurally cannot see), not probing further down an activity-ranked list. That's a curation decision, not a discovery-batch-size decision, and is out of scope here per your explicit "no new discovery batch" instruction — noted as the honest answer to "what would make Option B worth reconsidering," not a fourth option snuck in as a recommendation.

---

*Phases 1–4 complete. No discovery batch was run. No company was probed, discovered, or ingested. This document's recommendation is C; no further discovery scaling is planned pending your decision.*
