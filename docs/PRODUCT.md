# Web3 Hunter — Product Requirements Document

Status: Draft v0.1
Owner: Product & Engineering

---

## 1. Vision

Every meaningful career opportunity in Web3 emits signals long before it becomes a public job listing: a funding round closes, a protocol ships a new mainnet, a grant is awarded, a security incident triggers a hiring spree, a founding engineer stars a repo and starts reviewing PRs at 2am.

By the time a role is posted on a job board, the best candidates have often already found it through their network. The rest compete in a pool of hundreds of applicants against a listing that says almost nothing about whether the company, the team, or the work is actually a fit.

**Web3 Hunter's vision is to give every Web3 engineer the same information advantage as a well-connected insider** — by continuously reading the public signals the ecosystem already produces, and turning them into a small number of high-conviction, well-explained opportunities, before those opportunities are common knowledge.

We are not building a better job board. We are building the intelligence layer that sits upstream of one.

---

## 2. Mission

Turn public, fragmented, high-noise Web3 ecosystem activity into a private, low-noise, high-signal feed of opportunities and relationships — and do the outreach legwork so engineers spend their time on work that matters, not on research and cold-email drafting.

Concretely, we do this by:

1. **Collecting** signals continuously from company career pages, ATS platforms (Greenhouse, Ashby, Lever, etc.), funding/deal trackers, ecosystem grant programs, hackathon results, GitHub org activity, engineering blogs, protocol/mainnet launches, and relevant RSS/news sources.
2. **Correlating** those signals per company and per role to infer hiring likelihood and team growth trajectory ahead of any public posting.
3. **Scoring** the resulting opportunities against a user's specific skills, on-chain/OSS track record, and stated preferences.
4. **Explaining** every recommendation in plain language, citing the underlying signals, so trust is earned rather than assumed.
5. **Activating** the opportunity — surfacing the right contact (founder, EM, hiring lead) and drafting personalized, factual outreach the user can send in minutes, not hours.
6. **Tracking** the relationship over time like a lightweight CRM, so a "not now" from three months ago becomes a warm follow-up today.

---

## 3. Problem Statement

Web3 hiring is unusually information-asymmetric compared to traditional tech hiring:

- **Signal is scattered.** A company's hiring intent is spread across its careers page, its Greenhouse board, its Twitter/X account, its Mirror blog, its GitHub org, its most recent funding announcement, and Discord — no single source tells the full story.
- **Job boards show intent too late.** By the time a role is posted publicly, the company has often already been sourcing candidates through its network for weeks.
- **Listings are low-context.** A generic job description rarely conveys whether a team is well-funded, growing, technically credible, or a good stylistic fit for a given engineer.
- **Web3-specific signals are ignored by generalist tools.** Protocol launches, grant awards, hackathon wins, and on-chain/GitHub activity are strong hiring-intent signals in this industry specifically, and no mainstream job platform models them.
- **Outreach is a bottleneck, not a skill gap.** Engineers often know which companies they'd want to work for, but researching the right contact and writing a credible, non-generic first message is a research task most engineers deprioritize — so the opportunity goes cold.
- **Relationships decay silently.** A promising conversation that stalls has no home. There is no system tracking "reconnect when they raise their Series A" or "this EM said check back after the Q3 audit."

The net effect: engineers either miss high-quality opportunities entirely, or find them too late and compete in a crowded, low-context applicant pool.

---

## 4. Target Users

### Primary
- **Smart Contract Engineers** — Solidity/Vyper/Move/Cairo developers evaluating protocols by technical rigor and audit history.
- **Protocol Engineers** — core/infra engineers working on L1/L2 clients, consensus, or protocol-level tooling.
- **Security Researchers / Auditors** — engineers tracking which protocols are pre- and post-audit, and which teams are building a security function.
- **DevRel Engineers** — technical communicators evaluating developer ecosystem health and community traction.
- **Blockchain Backend Engineers** — engineers building indexers, node infra, off-chain services, and integrations.

### Secondary
- **AI Engineers working in Web3** — engineers at the intersection of ML/agents and on-chain systems (an emerging and fast-growing segment).
- **Full-stack Web3 Developers** — engineers building dApp frontends and full-stack product surfaces on top of protocols.

All target users share a trait: they are individual contributors with scarce time, technically capable of self-assessing fit, and structurally underserved by keyword-matching job boards.

---

## 5. User Personas

### Persona 1 — "Dara," Senior Smart Contract Engineer
- **Background:** 4 years in DeFi, previously audited at a boutique security firm, now building at a mid-size protocol.
- **Goal:** Wants to move to a team with strong technical culture and a security-first mindset, ideally pre-Series B for equity upside.
- **Frustrations:** Job boards surface postings with no signal on team quality. Doesn't have time to manually track 40 protocols' Twitter/GitHub/Mirror accounts.
- **How Web3 Hunter helps:** Surfaces protocols that just passed an audit and are visibly scaling their eng team, ranked by relevance to Dara's Solidity + security background, with a drafted note to the EM referencing the specific audit.

### Persona 2 — "Kwame," Protocol Infra Engineer, Passive Candidate
- **Background:** Happy in current role, not actively job-hunting, but open to the right opportunity.
- **Goal:** Doesn't want to browse job boards. Wants to be alerted only when something is a genuinely strong fit.
- **Frustrations:** Recruiter spam with zero relevance. Doesn't want another inbox to manage.
- **How Web3 Hunter helps:** A weekly digest of 2-3 high-conviction matches only, each with a clear "why now" explanation (e.g., "raised $40M Series A 3 weeks ago, opened 2 infra roles, no public posting yet").

### Persona 3 — "Priya," New Grad breaking into Web3
- **Background:** Strong GitHub portfolio and hackathon wins, no professional Web3 experience yet.
- **Goal:** Wants to find teams actively hiring junior/early-career engineers and understand how to stand out.
- **Frustrations:** Most "junior-friendly" signals (hackathon sponsors hiring, grant recipients scaling) are invisible unless you already know where to look.
- **How Web3 Hunter helps:** Surfaces hackathon-winning teams and newly-funded grant recipients that are early-stage and more likely to hire for potential over pedigree; helps identify a warm entry point (e.g., a maintainer whose PR Priya could meaningfully contribute to first).

### Persona 4 — "Marcus," DevRel Engineer targeting L1/L2 ecosystems
- **Background:** Strong public communicator, evaluates opportunities based on ecosystem momentum and community health, not just company financials.
- **Goal:** Wants to join a protocol at an inflection point — post-mainnet-launch, pre-mainstream-attention.
- **Frustrations:** Ecosystem momentum is qualitative and hard to track across dozens of chains simultaneously.
- **How Web3 Hunter helps:** Correlates protocol launch signals, GitHub contributor growth, and grant program activity into an ecosystem-momentum view, flagging DevRel-relevant openings before they're widely known.

---

## 6. User Journey

1. **Discovery** — User finds Web3 Hunter via word of mouth, a technical community (e.g., a Discord, a newsletter), or organic search.
2. **Onboarding** — User connects signals about themselves: skills, chains/languages, GitHub handle, prior companies, and preferences (company stage, remote/on-site, compensation expectations, deal-breakers). No resume upload required as the primary input — GitHub and stated preferences do the work.
3. **Calibration** — Platform surfaces an initial batch of opportunities; user gives lightweight feedback (interested / not relevant / already know this company) that refines future scoring.
4. **Daily/weekly engagement** — User receives a small, curated set of new or updated opportunities, each with an explanation of the underlying signals and a confidence/urgency indicator.
5. **Evaluation** — User reviews an opportunity's detail view: company snapshot, funding/momentum timeline, relevant open or inferred roles, and matched skills.
6. **Activation** — User requests (or the platform proactively drafts) a personalized outreach message to the right contact, grounded in real, cited signals — not generic flattery.
7. **Relationship tracking** — User logs outcomes (sent, replied, interviewing, passed, "revisit later") which the CRM layer tracks over time, including reminders tied to future signals (e.g., "revisit after their token launch").
8. **Outcome** — User lands an interview or role through a channel that would have taken days of manual research to construct — or, at minimum, has a maintained, living map of the companies worth watching.

---

## 7. Core Features

### 7.1 Signal Aggregation Engine
Continuous ingestion from career pages, ATS providers (Greenhouse, Ashby, Lever, etc.), funding/deal announcements, grant program registries, hackathon results, GitHub org/repo activity, engineering blogs, protocol launch trackers, and curated RSS/news sources.

### 7.2 Company Radar
A living profile per company/protocol: funding history, team growth trajectory, engineering blog activity, GitHub health, audit status, and inferred hiring likelihood — updated as new signals arrive.

### 7.3 Opportunity Scoring & Matching
Per-user relevance scoring that weighs skill match, chain/language match, company stage preference, and signal strength/recency. Every score is explainable, not a black box.

### 7.4 Explainability Layer
Every surfaced opportunity and every score is accompanied by a plain-language "why this, why now," citing the specific signals that drove it.

### 7.5 Contact Intelligence
Identification of the most relevant human to reach out to for a given opportunity (founder, engineering manager, hiring lead) based on public information.

### 7.6 AI-Generated Outreach
Drafted, personalized outreach messages grounded in real signals about the company and role — never generic templates — with the user always in control before anything is sent.

### 7.7 Opportunity CRM
Lightweight relationship tracking per company/contact: status, notes, and signal-triggered reminders (e.g., follow up when the company raises again, ships a major release, or posts a matching role).

### 7.8 Digests & Alerts
Configurable cadence (real-time, daily, weekly) for new high-conviction matches, avoiding notification fatigue by design.

### 7.9 Watchlists
User-curated lists of companies/protocols to track closely regardless of algorithmic score, with the full signal history surfaced automatically.

---

## 8. Non-Goals

Web3 Hunter explicitly will **not** become:

- **LinkedIn** — we are not a professional social network or a place to broadcast content.
- **Indeed** — we are not a comprehensive, high-volume job listing aggregator; volume is not the goal.
- **A generic ATS** — we do not manage a company's hiring pipeline or candidate workflow.
- **A resume builder** — resumes are not the primary artifact of the product.
- **A freelancing marketplace** — we are not matching short-term gig work or bids.
- **A social network** — no feeds, follows, likes, or public profiles as a core mechanic.

Staying disciplined about these non-goals is a product principle in itself: every feature request should be tested against whether it pulls the product toward being a job board or social network, and rejected if so.

---

## 9. Product Principles

- **Discover opportunities, not just jobs.** A hiring signal is valuable before it becomes a listing — that pre-listing window is the product's core value.
- **Aggregate signals, not listings.** We synthesize raw ecosystem activity into insight; we do not simply mirror other job boards.
- **Explain every recommendation.** Trust is the product's core asset. A score or match with no visible reasoning is not shippable.
- **Save users hours of research every day.** Every feature should be justified by time saved, not just information surfaced.
- **Generate personalized outreach using AI.** Outreach quality compounds the value of discovery — a great match with no path to a human contact is only half the product.
- **Help users build long-term relationships with companies.** Hiring is not always immediate; the platform should have memory so timing works in the user's favor.
- **Prioritize quality over quantity.** A handful of well-explained, high-conviction opportunities beats an exhaustive, low-context list. When in doubt, surface less.

---

## 10. Success Metrics

### North Star Metric
**Weekly Active High-Conviction Matches Acted On** — the number of surfaced opportunities per active user per week that result in a user action (save, outreach sent, or CRM status update). This ties directly to the core value proposition: are we producing opportunities good enough to act on, not just to read.

### Supporting Metrics

**Signal & Matching Quality**
- Signal-to-listing lead time (median days between a signal being detected and the corresponding role becoming public, where measurable).
- Match relevance rate (% of surfaced opportunities marked "relevant" or better by users).
- False-positive rate on hiring-likelihood predictions.

**Activation & Engagement**
- Time-to-first-relevant-match for a new user.
- Weekly/monthly active users and retention curves.
- Outreach messages generated vs. sent (a proxy for perceived quality of the draft).

**Outcome Metrics**
- Reply rate on AI-assisted outreach.
- Interviews initiated per active user per quarter.
- Self-reported offers/placements attributable to the platform.

**Product Discipline**
- Digest open/action rate (guards against notification fatigue — a declining rate signals we are surfacing too much, too often, or too low-signal).
- Unsubscribe/churn reasons, specifically watched for signs of feature creep toward job-board or social-network territory.

---

## 11. Future Vision

- **Bi-directional signal network:** as more engineers log outcomes (replies, interviews, offers), the platform's hiring-likelihood and fit models improve for everyone — a data moat built on outcomes, not just public signals.
- **Team/organization view:** allow engineering leaders and recruiters at high-integrity companies to understand their own visibility and signal strength to the exact population of engineers they want to reach — without becoming an inbound ATS.
- **Ecosystem-level intelligence:** aggregate, anonymized views of where engineering talent and hiring momentum are concentrating across chains and sectors (e.g., "L2 infra hiring is up 40% quarter-over-quarter") as a category-defining research product.
- **Deeper on-chain signal integration:** incorporate on-chain activity (protocol usage growth, treasury health, governance activity) as an additional, harder-to-game hiring-intent signal.
- **Warm-intro graph:** surface not just "who to contact" but "who in your network already has a relationship with this company," turning cold outreach into warm introductions over time.
- **Career trajectory modeling:** longitudinal guidance — not just "what's open now" but "what path gets you from where you are to the role you want in 18 months," grounded in real market signal rather than generic career advice.

The long-term bet is that the same signal-aggregation engine that powers individual opportunity discovery becomes the definitive, real-time map of where the Web3 engineering talent market is moving — valuable to engineers first, and to the ecosystem as a whole over time.
