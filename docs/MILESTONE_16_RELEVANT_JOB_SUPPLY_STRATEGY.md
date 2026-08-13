# Milestone 16 — Relevant Job Supply Strategy

**Status:** analysis and planning only. No code, no schema, no deployment. Every number below is a real query against production or a real live check, run while writing this document. **Implementation does not start until this plan is approved.**

## 0. The objective, restated

The optimization function changes here, explicitly:

> **OLD:** maximize discovered companies / discovered jobs.
> **NEW:** maximize genuinely relevant (high+medium) jobs available to the real user, while preserving employer-URL correctness and an acceptable false-positive rate.

Every option below is scored primarily by its effect on **X = the number of high+medium relevance jobs currently live in production**, not company or job count.

**Real baseline, measured now**: **X = 77** high+medium jobs (15 high, 62 medium) out of 1,531 total open jobs, across 63 non-rejected companies (37 curated, 26 discovered).

---

## A. What already produces relevant jobs — real production pattern

Every company currently contributing ≥1 high/medium job, ranked:

| Company | High+medium jobs | Status | What it is |
|---|---|---|---|
| CertiK | 11 | curated | Dedicated smart-contract security audit firm |
| Polymarket | 9 | discovered (DeFiLlama) | Large prediction-market exchange, big eng org |
| Robinhood | 6 | discovered (DeFiLlama) | Large fintech with a crypto/security org |
| Fireblocks | 5 | curated | Institutional custody/security infra |
| Uniswap Labs | 4 | curated | Core protocol team |
| Ondo Finance | 4 | discovered (DeFiLlama) | RWA/tokenization protocol |
| Gemini | 4 | discovered (DeFiLlama) | Exchange |
| Offchain Labs | 4 | curated | Arbitrum core team |
| OKX, Lightning Network | 3 each | discovered (DeFiLlama) | Exchange; protocol |
| OpenZeppelin | 3 | curated | Dedicated smart-contract security firm |
| Anchorage, Paxos Labs, Morpho Labs, LayerZero, Wormhole, Sky Mavis, Bybit | 1–2 each | mixed | Custody, protocol, infra |

**The pattern is unambiguous and consistent with what the profile targets**: the top producers are either (1) **companies whose entire business is security** (CertiK, OpenZeppelin — together 14 of 77, 18% of all relevant jobs from just 2 companies), (2) **large exchanges/custody firms with dedicated security orgs** (Fireblocks, Anchorage, Paxos, Gemini, OKX, Bybit, Robinhood), or (3) **core protocol teams** (Uniswap Labs, Offchain Labs, LayerZero, Wormhole, Morpho Labs, Ondo Finance). Generic "is a Web3 company" is not the signal — "is a security firm, has a security team, or builds core protocol" is.

**Real, concrete curated-directory error found**: the curated company `cantina` (Ashby) is mapped to **Cantina Labs, a "social AI" company** — completely unrelated to the real Web3 security firm Cantina (cantina.xyz, a smart-contract review marketplace). Confirmed live: its actual job titles are "Machine Learning Engineer, Voice Conversion," "iOS Engineer," "Product Director, Video Products" — zero security content. This has been sitting silently wrong in the curated 37 since before this milestone. A one-line fix (remove the wrong source identity, no new discovery needed).

---

## B. Relevance model — a real, large, quantified recall gap (not speculative)

Directly answering the "look for concrete evidence" instruction: **163 open job titles contain a target-domain word** (`backend`, `blockchain`, `protocol`, `solidity`, `smart contract`, `security`, `audit`/`auditor`) **and 86 of them (52.8%) score low/very-low with zero role-match bonus** — because `job-relevance.ts`'s `TARGET_ROLES` keywords require an *exact adjacent phrase* (`"backend engineer"`, `"blockchain engineer"`), and real job titles very commonly put the qualifier in a different position:

| Real title (verified, currently open) | Company | Current score/tier |
|---|---|---|
| "Senior Software Engineer, Backend" | Robinhood, Coinbase, Phantom, Bubble Protocol | 0–8, low |
| "Lead/Principal Backend Development Engineer" (×8 postings) | Bybit | 8, low |
| "Blockchain Developer" / "Blockchain Expert" | Bybit | 0, low |
| "Senior Staff Software Engineer - Blockchain Platform" | Coinbase | 8, low |
| "Staff Software Engineer, Solana Staking Protocol" | Coinbase | 8, low |
| "Security Operations Engineer" | OKX, Fireblocks | 0–8, low |
| "Member of Technical Staff, Security Engineering" | Anchorage | 8, low |
| "Backend Software Engineer" | Alchemy | 0, low |

This is a **structural** gap, not a handful of missing synonyms (the shape Milestone 14's 3-title fix addressed) — it's that the matcher assumes one specific word order and real titles routinely use several others (`"[Role] Engineer, [Qualifier]"`, `"[Qualifier] Development Engineer"`, `"[Qualifier] Software Engineer"`, `"[Noun] Developer"` instead of `"[Noun] Engineer"`). Every one of these 86 jobs already exists in production, already comes from an already-verified company, already has a correct application URL — recovering even half of them into medium tier would very plausibly be the single largest, cheapest increase to X available anywhere in this document, because it requires **zero new companies, zero new jobs, zero new sources** — only a scoring-function change against data already in hand.

Honest caveat, not smoothed over: not all 86 are real misses — a genuine subset (`"Internal Audit Analytics Associate"`, `"IT Audit Manager"`, `"Compliance Audit Manager"` — traditional corporate/IT audit, correctly excluded) are correctly scored low today and must **stay** low under any fix; a word-order-tolerant matcher must not become a "contains the word audit anywhere" matcher, or precision collapses back into Milestone 13's original bug. A conservative read of the sample: roughly 60–70 of the 86 look like genuine engineering/security misses; the exact number requires the actual fix and re-measurement, not a promise made here.

One additional, smaller, real precision edge case found: `"Solidity Compiler Frontend Engineer"` (CertiK) is penalized as an incompatible "frontend" role — but "frontend" here is compiler terminology (the parsing/lexing stage), not web UI. Rare, low-volume, worth a one-line carve-out, not a priority on its own.

---

## C. Manual curation — real, but not zero-effort

Checked live against the exact companies you'd expect to be disproportionately likely to produce target-role jobs: **Sherlock, Spearbit, Cyfrin, Trail of Bits, Halborn, Quantstamp, EigenLayer, Chainlink Labs, Polygon Labs, Ava Labs, NEAR Foundation.** Blind slug-guessing (the same method used for discovery) found **zero** of these on a first-pass Greenhouse/Lever/Ashby probe. One partial exception, live-confirmed: **Chainlink Labs' real careers page does embed Ashby** (`ashbyhq.com/chainlink-labs` appears in the page), but the standard public posting-API slug for it 404s — meaning their actual internal Ashby job-board identifier differs from the vanity URL, a real, narrow gap the existing probe mechanism can't cross by guessing alone.

This tells us something specific and useful: **manual curation of known-high-value companies is real and low-false-positive-risk** (you're choosing the exact real company, not guessing from an anonymous list — the wrong-identity risk that dominated the DeFiLlama batches structurally cannot happen here) — but it is **not zero-effort "just add the name."** Each one needs a real, individual check of that company's actual careers page to find its true ATS slug, the same one-at-a-time diligence already proven to work (this is exactly how the original 37 were built). Unlike blind discovery, this work is **fully deterministic to plan**: a short, named list, each item independently verifiable, no batch-scale false-positive cleanup afterward.

---

## D/E. New ATS platforms and current coverage — reframed by expected yield, not breadth

Milestone 15 already live-verified Workable and SmartRecruiters as real, URL-correct platforms — but their **Web3 adoption was never confirmed**, only their existence. Reframed correctly per this milestone's objective: **the question isn't "is Workable real," it's "do any of the specific high-value target companies from §C actually use it."** That wasn't checked, and checking it is cheap (a handful of curl requests against named companies, not a new adapter) — the honest sequencing is: finish the §C company-identification pass first, and only if some of those companies turn out to be on Workable/SmartRecruiters (not Greenhouse/Lever/Ashby) does building a 4th/5th adapter get justified by a **named, counted set of real relevant companies**, rather than by the platforms' existence alone. Building an adapter speculatively, before knowing whether it unlocks any specific target company, would violate this milestone's own "measure expected relevant-job yield, not candidate count" instruction.

---

## F. Discovery (Electric Capital, DeFiLlama) — already conclusively tested

Not re-litigated here; already directly evidenced across Milestones 14/15: Electric Capital discovered-job relevance ≈2.4%; DeFiLlama batch 1 ≈4.1%, batch 2 (deeper in the same ranked pool) 0%, with false-positive rate rising from 45.8% to 89.3% at the same depth. Both sources show declining relevance and rising false-positive cost as they go deeper. Correctly not recommending more blind probing of either — this is now well-established, not a new finding.

---

## G. Freshness/completeness — a real operational flag, not yet confirmed

Checked the `collector` table's live health fields: **`greenhouse` and `ashby` both currently show `status: "degraded"`**, with `consecutive_failures: 3` (greenhouse) and `1` (ashby), and their most recent recorded `last_run_at` timestamps correspond exactly to the manual CLI runs performed during Milestone 15's work this week — not to any independent, automated run since. No `vercel.json`/cron config exists in this repository (cron schedules for a Vercel project can be configured outside the repo, in the dashboard), so this can't be fully confirmed from code alone. But the evidence is at least *consistent with* collectors not running on a reliable automated cadence in production right now, which would mean **real, relevant, already-discoverable jobs are being missed simply because nothing is fetching them** — a gap that costs nothing to close (no new source, no new code, just confirming/fixing the schedule) and would show up directly as new jobs, some fraction of them relevant, at zero discovery risk. This needs a direct, one-time check (Vercel dashboard + one or two full clean collector runs) before the next milestone proceeds, not another investigation.

---

## H. Ranked plan

| # | Action | Impact on X | Evidence | Effort | Risk | New code? | Measurable? | Now/Later/Never |
|---|---|---|---|---|---|---|---|---|
| 1 | **Fix the relevance word-order/synonym gap** (§B) | **High** — ~60–70 jobs plausibly recoverable directly into medium/high, from data already in production | Concrete, quantified, real (86/163 titles, real companies, real titles listed above) | Low — a scoring-function change + regression tests, same shape as Milestone 14's fix | Low, if scoped narrowly (word-order tolerance for the *existing* target-role vocabulary only, not new categories); real precision risk if over-broadened (must exclude "Internal/IT/Compliance Audit") | Yes, `job-relevance.ts` only | Yes — exact before/after re-measurement via `measure-discovery-relevance.ts` | **Now** |
| 2 | **Fix the Cantina curated-directory error** (§A) | Small directly (removes noise), but a correctness/trust issue independent of size | Confirmed live: wrong company entirely | Trivial — remove one source identity | None — pure correction | Minimal (data fix, one script) | Yes — confirm 0 jobs from the real Cantina AI company appear after | **Now** |
| 3 | **Verify/fix collector run cadence** (§G) | Unknown but potentially nonzero — any missed jobs from already-known companies are free wins | Suggestive, not fully confirmed (DB health status + timestamps) | Low — a dashboard check plus, if needed, a scheduling fix | Low | Possibly none (config only) | Yes — before/after `last_run_at` and freshness distribution | **Now** |
| 4 | **Manually curate the named high-value companies** (§C: Sherlock, Spearbit, Cyfrin, Trail of Bits, Halborn, Quantstamp, EigenLayer, Chainlink Labs, Polygon Labs, Ava Labs, NEAR, and similar) | Medium — small company count, but each is disproportionately likely to produce security/protocol roles, per §A's own pattern | Partial — companies are real and well-chosen by category; exact ATS/slug for each not yet confirmed | Medium — one-at-a-time real verification, no batch cleanup needed | Very low (deliberately chosen, not guessed) | No new pipeline code — uses the existing curated-company mechanism | Yes — per-company, immediately | **Now**, as a bounded, named list — not another open-ended discovery batch |
| 5 | **Workable/SmartRecruiters adapters** | Unknown until #4 is done | Platforms real (M15); Web3/target-company adoption unconfirmed | Medium (new adapter code) | Low technically, but wasted if no target company is actually on them | Yes | Yes, once a target company is confirmed present | **Later** — gated on #4 finding a real company that needs it |
| 6 | **Further DeFiLlama/Electric Capital probing** | Negative-to-flat, evidenced | Conclusively tested, declining relevance + rising FP rate at depth | — | High (manual verification cost, proven) | — | Already measured | **Not now** |
| 7 | **Career-page crawling / new aggregators** | Unknown, high cost | Already rejected on infra-cost/URL-correctness grounds (M13/M15) | High | High | Yes, large | — | **Not now** |

---

## I. Recommended next milestone

**Milestone 17 — combine #1, #2, #3 first (all "now," all low-risk, all measurable, zero new discovery), then #4 as a bounded, named curation pass.** This is the "smallest robust combination," not "run another batch": it touches the relevance model once (evidence-backed, narrowly scoped), fixes one confirmed data error, confirms/restores collection cadence, and adds a short, deliberately-chosen list of companies with near-zero false-positive risk — no blind probing anywhere in it.

**Measurable target**: increase the real production pool of high+medium jobs **from X = 77** to a target range, not a promise:

- The relevance fix alone (§B) plausibly recovers **~40–70** jobs from data already in hand (conservative-to-optimistic range, to be confirmed by the actual re-measurement, not asserted here).
- The Cantina fix and cadence check are correctness/completeness fixes with plausible small positive contributions, not separately sized.
- The named curation pass (§C) contributes an unknown-but-likely-small absolute count (a handful of companies), weighted toward high relevance given §A's pattern.

**Target: X = 77 → Y ≈ 130–160**, while maintaining 100% employer-URL correctness (unchanged structural guarantee) and not reintroducing the precision regression Milestone 13 Phase A already fixed once. This range will be replaced with the real measured number in the implementation report, exactly as every prior milestone's "ranges, not promises" numbers were.

**Definition of done**: real before/after `measure-discovery-relevance.ts` output; the specific real titles named in §B individually re-verified as now scoring medium/high; the Coinbase-frontend regression (Milestone 13's own canonical test) re-confirmed still low; Cantina's real jobs (if any) re-verified as not-security-relevant and correctly excluded, its AI-company jobs gone from the feed; collector `last_run_at`/`status` confirmed healthy; any newly-curated companies individually verified (identity, real open jobs, correct URLs) before being added.

**Not doing**: any further blind discovery batch, any new ATS adapter (until §H item 5's gate is met), any aggregator or career-page-crawling work, any relevance category broadening beyond the existing 8 target roles.

Stopping here for approval, per your instruction.
