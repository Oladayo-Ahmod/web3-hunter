/**
 * The Job eligibility gate (Milestone 20, generalized to `/jobs` itself
 * in Milestone 22) — a deterministic pass/fail filter, separate from
 * `job-relevance.ts`'s scoring, shared by the Today Digest's "Apply"
 * section (`daily-digest-service.ts`) and the Job Feed's default view
 * (`job-query-service.ts`). One gate, not two conflicting ones — the
 * governing Milestone 22 directive's explicit instruction. This is a
 * gate, not a score: `computeJobRelevance` still ranks whatever clears
 * this gate, unchanged.
 *
 * WHY THIS EXISTS: a real production audit (Milestone 20) of the live
 * Apply 20 found roughly half the results were not genuinely Web3-
 * engineering work — the Target Role scoring model's dominant positive
 * signal (a title-keyword match) isn't, by itself, evidence of Web3-
 * specific work, because two of `job-relevance.ts`'s `TARGET_ROLES`
 * entries use bare, generic phrases: `security-researcher`'s "security
 * engineer" and `web3-backend-engineer`'s "backend engineer"/"backend
 * developer". Real examples that scored 45-53 (a "high match" range)
 * despite being ordinary corporate roles: BitGo/Figure "Application
 * Security Engineer" (OWASP/vulnerability-management/NIST-CSF work,
 * zero blockchain-specific responsibilities) and Near Foundation "Senior
 * Security Engineer" (internally titled "Senior IT Security Engineer").
 * Being posted by an otherwise-curated Web3 Company does not make a role
 * Web3-specific — a negative role signal must be able to override a
 * Company's Web3 identity (governing directive, Part 1).
 *
 * Also found: many Apply slots were filled by jobs with NO role signal
 * at all — QA, Data Analyst, Operations Lead, Product Counsel, FP&A —
 * that only appeared because unrelated Skill overlap gave them a
 * positive (but low) score. This gate excludes those outright rather
 * than ranking them low, since "low but present" still crowded out
 * genuinely relevant jobs within a fixed 20-slot list.
 */

function matchesPhrase(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(haystack);
}

/**
 * If a title contains one of these, the job is never Apply-eligible —
 * regardless of company, relevance score, or description content. Each
 * entry is a role *family*, not a keyword: a "Cloud Security Engineer"
 * at a Web3 protocol is still a cloud security engineer, and a negative
 * role signal overrides the Company's Web3 identity (governing
 * directive, Part 1).
 */
const HARD_NEGATIVE_TITLE_PHRASES = [
  // Enterprise/corporate/IT security — the specific gap this module
  // exists to close (Milestone 20 audit: Near Foundation "Senior [IT]
  // Security Engineer").
  "cloud security",
  "corporate security",
  "it security",
  "information security",
  "security operations",
  "soc analyst",
  "identity and access management",
  "endpoint security",
  "network security",
  "physical security",
  "detection and response",
  "devsecops",
  "governance, risk",
  "grc analyst",
  "java backend",
  ".net backend",
  // Role families outside the target profile entirely (mirrors
  // job-relevance.ts's INCOMPATIBLE_ROLE_FAMILIES/NEGATIVE_TITLE_KEYWORDS,
  // re-asserted here since this gate runs independently of that scorer).
  "frontend",
  "front-end",
  "front end",
  "mobile",
  "react native",
  "design engineer",
  "brand",
  "kol",
  "product manager",
  "product lead",
  "product designer",
  "product analytics",
  "designer",
  "project manager",
  "content manager",
  "content project",
  "marketing",
  "business development",
  "account executive",
  "sales",
  "listing manager",
  "growth",
  "partnerships",
  "supply specialist",
  "supply operations",
  "recruiter",
  "talent network",
  "talent community",
  "head of talent",
  "human resources",
  "customer support",
  "customer success",
  "compliance",
  "aml",
  "accounting",
  "accountant",
  "controller",
  "finance",
  "treasury",
  "capital market",
  "capital markets",
  "risk control",
  "fp&a",
  "counsel",
  "legal",
  "paralegal",
  "operations",
  "onboarding",
  "data analyst",
  "data insights",
  "data engineer",
  "data scientist",
  "data strategy",
  "qa",
  "quality assurance",
  "sdet",
  "go-to-market",
  "go to market",
  "it department",
  "it manager",
  "it & platform",
  "help desk",
  "desktop support",
];

/**
 * If a title contains one of these, the role is unambiguously
 * Web3/blockchain-specific — sufficient on its own, no description
 * check needed. A deliberate superset of `job-relevance.ts`'s
 * `TARGET_ROLES` keywords, minus that vocabulary's two provably-too-
 * generic entries (bare "security engineer"; bare "backend engineer"/
 * "backend developer") — those fall through to description-gated
 * confirmation below instead.
 */
const STRONG_TITLE_PHRASES = [
  "smart contract",
  "solidity",
  "blockchain",
  "protocol engineer",
  "protocol developer",
  "protocol security",
  "protocol infrastructure",
  "web3",
  "defi",
  "evm",
  "ethereum",
  "on-chain",
  "onchain",
  "layer 2",
  "layer2",
  "rollup",
  "zero-knowledge",
  "zero knowledge",
  "zk engineer",
  "zk researcher",
  "cryptography engineer",
  "cryptographic engineer",
  "account abstraction",
  "cross-chain",
  "cross chain",
  "bridge engineer",
  "oracle engineer",
  "mev engineer",
  "mev researcher",
  "restaking",
  "wallet engineer",
  "node engineer",
  "client engineer",
  "blockchain security",
  "smart contract auditor",
  "crypto protocol",
];

/**
 * Description-level confirmation for a title that didn't clear
 * `STRONG_TITLE_PHRASES` on its own (governing directive, Part 2 —
 * "Senior Software Engineer" whose description is EVM/Solidity/on-chain
 * should still qualify). Deliberately NARROWER than the title list, and
 * deliberately excludes bare "blockchain"/"web3"/"crypto"/"defi":
 * verified against real data that every curated Company's boilerplate
 * "About Us" paragraph uses those words regardless of the actual role
 * (real example: Figure's Application Security Engineer posting opens
 * with "transforming capital markets through blockchain" — marketing
 * copy, not evidence the *role* is Web3-specific). Requires an
 * unambiguously technical phrase instead.
 */
const DESCRIPTION_CONFIRMATION_PHRASES = [
  "smart contract",
  "solidity",
  "evm",
  "on-chain",
  "onchain",
  "blockchain protocol",
  "web3 protocol",
  "defi protocol",
  "layer 2",
  "layer2",
  "rollup",
  "zero-knowledge",
  "zero knowledge",
  "zk-rollup",
  "consensus protocol",
  "peer-to-peer networking",
  "node client",
  "wallet infrastructure",
  "account abstraction",
  "cross-chain",
  "protocol security",
  "smart contract security",
  // Genuine blockchain infrastructure/SRE work (Milestone 20 audit:
  // Somnia's Senior Infrastructure Engineer — "the L1 and node fleet,
  // RPC and indexing layers" — is real validator/node operations, not
  // generic cloud SRE, even though the rest of its description reads
  // like standard SRE vocabulary).
  "node fleet",
  "blockchain indexer",
];

export interface ApplyEligibilityResult {
  eligible: boolean;
  reason: string;
}

/**
 * The Apply eligibility gate. Title first (cheap, usually decisive);
 * falls through to description only when the title itself is genuinely
 * ambiguous (e.g. "Senior Software Engineer," "Backend Engineer," a bare
 * "Security Engineer"). Absence of a positive match is the default —
 * this gate requires opt-in evidence of Web3-specific work, not an
 * opt-out list of everything that might be irrelevant, which is what
 * makes it precision-favoring per the governing directive's "I would
 * rather see 8 genuinely excellent jobs than 20 where 10 are irrelevant."
 */
export function checkApplyEligibility(
  title: string,
  description: string | null,
): ApplyEligibilityResult {
  if (HARD_NEGATIVE_TITLE_PHRASES.some((phrase) => matchesPhrase(title, phrase))) {
    return { eligible: false, reason: "Title reads as a non-Web3-engineering role family" };
  }

  if (STRONG_TITLE_PHRASES.some((phrase) => matchesPhrase(title, phrase))) {
    return { eligible: true, reason: "Title names Web3/blockchain-specific work" };
  }

  if (description) {
    const matched = DESCRIPTION_CONFIRMATION_PHRASES.find((phrase) =>
      matchesPhrase(description, phrase),
    );
    if (matched) {
      return {
        eligible: true,
        reason: `Generic title, but description confirms Web3 protocol work ("${matched}")`,
      };
    }
  }

  return {
    eligible: false,
    reason: "No Web3/blockchain-specific evidence in title or description",
  };
}
