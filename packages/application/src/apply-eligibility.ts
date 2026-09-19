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
  "threat analyst",
  "investigations analyst",
  "investigator",
  "investigations",
  "sanctions",
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

/**
 * Machine-readable companion to `reason` (Milestone 24, governing
 * directive Part 5 — "the canonical gate must produce an explainable
 * ELIGIBLE/INELIGIBLE result with reason codes"). Purely additive: every
 * existing consumer reads only `.eligible`, so this field changes no
 * existing behavior — it exists for future UI/debug surfaces (e.g. an
 * admin view explaining *why* a posting was excluded) and for this
 * gate's own tests to assert against something more stable than prose.
 *
 * Deliberately a closed, small vocabulary rather than one code per
 * phrase — the exact positive/negative *phrase* that matched is still
 * available in `reason`; the code exists to bucket that phrase into one
 * of the categories the governing directive named.
 */
export type ApplyEligibilityReasonCode =
  | "ELIGIBLE_PROTOCOL_ENGINEERING"
  | "ELIGIBLE_SMART_CONTRACT_SECURITY"
  | "ELIGIBLE_BLOCKCHAIN_INFRASTRUCTURE"
  | "ELIGIBLE_ZK"
  | "ELIGIBLE_DEFI_ENGINEERING"
  | "REJECT_NON_TECHNICAL"
  | "REJECT_CORPORATE_SECURITY"
  | "REJECT_FINANCE"
  | "REJECT_OPERATIONS"
  | "REJECT_GENERIC_DATA"
  | "REJECT_GENERIC_PRODUCT";

export interface ApplyEligibilityResult {
  eligible: boolean;
  reason: string;
  reasonCode: ApplyEligibilityReasonCode;
}

/**
 * Per-phrase reason codes for `HARD_NEGATIVE_TITLE_PHRASES`. A lookup
 * table rather than restructuring that array into groups — the array
 * itself stays the single source of truth for *matching*, unchanged and
 * low-risk; this table only classifies a phrase *after* it has already
 * matched, for reporting. A phrase missing here falls back to
 * `REJECT_NON_TECHNICAL` (see `reasonCodeForNegativePhrase` below), so a
 * future phrase added to the match list without a corresponding entry
 * here degrades to a reasonable default instead of a runtime error.
 */
const NEGATIVE_PHRASE_REASON_CODES: Partial<Record<string, ApplyEligibilityReasonCode>> = {
  // Corporate/IT security and corporate IT — the family this gate was
  // originally built to exclude (Milestone 20).
  "cloud security": "REJECT_CORPORATE_SECURITY",
  "corporate security": "REJECT_CORPORATE_SECURITY",
  "it security": "REJECT_CORPORATE_SECURITY",
  "information security": "REJECT_CORPORATE_SECURITY",
  "security operations": "REJECT_CORPORATE_SECURITY",
  "soc analyst": "REJECT_CORPORATE_SECURITY",
  "identity and access management": "REJECT_CORPORATE_SECURITY",
  "endpoint security": "REJECT_CORPORATE_SECURITY",
  "network security": "REJECT_CORPORATE_SECURITY",
  "physical security": "REJECT_CORPORATE_SECURITY",
  "detection and response": "REJECT_CORPORATE_SECURITY",
  devsecops: "REJECT_CORPORATE_SECURITY",
  "governance, risk": "REJECT_CORPORATE_SECURITY",
  "grc analyst": "REJECT_CORPORATE_SECURITY",
  "threat analyst": "REJECT_CORPORATE_SECURITY",
  "investigations analyst": "REJECT_CORPORATE_SECURITY",
  investigator: "REJECT_CORPORATE_SECURITY",
  investigations: "REJECT_CORPORATE_SECURITY",
  sanctions: "REJECT_CORPORATE_SECURITY",
  "it department": "REJECT_CORPORATE_SECURITY",
  "it manager": "REJECT_CORPORATE_SECURITY",
  "it & platform": "REJECT_CORPORATE_SECURITY",
  "help desk": "REJECT_CORPORATE_SECURITY",
  "desktop support": "REJECT_CORPORATE_SECURITY",
  // Finance/accounting/treasury.
  accounting: "REJECT_FINANCE",
  accountant: "REJECT_FINANCE",
  controller: "REJECT_FINANCE",
  finance: "REJECT_FINANCE",
  treasury: "REJECT_FINANCE",
  "capital market": "REJECT_FINANCE",
  "capital markets": "REJECT_FINANCE",
  "risk control": "REJECT_FINANCE",
  "fp&a": "REJECT_FINANCE",
  // Operations/legal/compliance/back-office.
  operations: "REJECT_OPERATIONS",
  onboarding: "REJECT_OPERATIONS",
  "supply specialist": "REJECT_OPERATIONS",
  "supply operations": "REJECT_OPERATIONS",
  "customer support": "REJECT_OPERATIONS",
  "customer success": "REJECT_OPERATIONS",
  compliance: "REJECT_OPERATIONS",
  aml: "REJECT_OPERATIONS",
  counsel: "REJECT_OPERATIONS",
  legal: "REJECT_OPERATIONS",
  paralegal: "REJECT_OPERATIONS",
  // Data-adjacent roles with no protocol/security engineering signal.
  "data analyst": "REJECT_GENERIC_DATA",
  "data insights": "REJECT_GENERIC_DATA",
  "data engineer": "REJECT_GENERIC_DATA",
  "data scientist": "REJECT_GENERIC_DATA",
  "data strategy": "REJECT_GENERIC_DATA",
  // Generic product/design/QA/frontend/mobile — real engineering work,
  // just outside this profile's target (protocol/security engineering).
  qa: "REJECT_GENERIC_PRODUCT",
  "quality assurance": "REJECT_GENERIC_PRODUCT",
  sdet: "REJECT_GENERIC_PRODUCT",
  "product manager": "REJECT_GENERIC_PRODUCT",
  "product lead": "REJECT_GENERIC_PRODUCT",
  "product designer": "REJECT_GENERIC_PRODUCT",
  "product analytics": "REJECT_GENERIC_PRODUCT",
  designer: "REJECT_GENERIC_PRODUCT",
  "project manager": "REJECT_GENERIC_PRODUCT",
  "content manager": "REJECT_GENERIC_PRODUCT",
  "content project": "REJECT_GENERIC_PRODUCT",
  frontend: "REJECT_GENERIC_PRODUCT",
  "front-end": "REJECT_GENERIC_PRODUCT",
  "front end": "REJECT_GENERIC_PRODUCT",
  mobile: "REJECT_GENERIC_PRODUCT",
  "react native": "REJECT_GENERIC_PRODUCT",
  "design engineer": "REJECT_GENERIC_PRODUCT",
  // Everything else non-technical: sales/marketing/BD/recruiting/HR, and
  // an engineering title in a stack outside this profile entirely.
  "java backend": "REJECT_NON_TECHNICAL",
  ".net backend": "REJECT_NON_TECHNICAL",
  brand: "REJECT_NON_TECHNICAL",
  kol: "REJECT_NON_TECHNICAL",
  marketing: "REJECT_NON_TECHNICAL",
  "business development": "REJECT_NON_TECHNICAL",
  "account executive": "REJECT_NON_TECHNICAL",
  sales: "REJECT_NON_TECHNICAL",
  "listing manager": "REJECT_NON_TECHNICAL",
  growth: "REJECT_NON_TECHNICAL",
  partnerships: "REJECT_NON_TECHNICAL",
  recruiter: "REJECT_NON_TECHNICAL",
  "talent network": "REJECT_NON_TECHNICAL",
  "talent community": "REJECT_NON_TECHNICAL",
  "head of talent": "REJECT_NON_TECHNICAL",
  "human resources": "REJECT_NON_TECHNICAL",
  "go-to-market": "REJECT_NON_TECHNICAL",
  "go to market": "REJECT_NON_TECHNICAL",
};

function reasonCodeForNegativePhrase(phrase: string): ApplyEligibilityReasonCode {
  return NEGATIVE_PHRASE_REASON_CODES[phrase] ?? "REJECT_NON_TECHNICAL";
}

/**
 * Per-phrase reason codes for `STRONG_TITLE_PHRASES` and
 * `DESCRIPTION_CONFIRMATION_PHRASES` — same lookup-table approach as the
 * negative side, and a missing phrase falls back to the most general
 * positive bucket, `ELIGIBLE_PROTOCOL_ENGINEERING`.
 */
const POSITIVE_PHRASE_REASON_CODES: Partial<Record<string, ApplyEligibilityReasonCode>> = {
  "smart contract": "ELIGIBLE_PROTOCOL_ENGINEERING",
  solidity: "ELIGIBLE_PROTOCOL_ENGINEERING",
  "protocol engineer": "ELIGIBLE_PROTOCOL_ENGINEERING",
  "protocol developer": "ELIGIBLE_PROTOCOL_ENGINEERING",
  "protocol infrastructure": "ELIGIBLE_PROTOCOL_ENGINEERING",
  web3: "ELIGIBLE_PROTOCOL_ENGINEERING",
  "protocol security": "ELIGIBLE_SMART_CONTRACT_SECURITY",
  "blockchain security": "ELIGIBLE_SMART_CONTRACT_SECURITY",
  "smart contract auditor": "ELIGIBLE_SMART_CONTRACT_SECURITY",
  "smart contract security": "ELIGIBLE_SMART_CONTRACT_SECURITY",
  "zero-knowledge": "ELIGIBLE_ZK",
  "zero knowledge": "ELIGIBLE_ZK",
  "zk engineer": "ELIGIBLE_ZK",
  "zk researcher": "ELIGIBLE_ZK",
  "zk-rollup": "ELIGIBLE_ZK",
  "cryptography engineer": "ELIGIBLE_ZK",
  "cryptographic engineer": "ELIGIBLE_ZK",
  defi: "ELIGIBLE_DEFI_ENGINEERING",
  "defi protocol": "ELIGIBLE_DEFI_ENGINEERING",
  blockchain: "ELIGIBLE_BLOCKCHAIN_INFRASTRUCTURE",
  evm: "ELIGIBLE_BLOCKCHAIN_INFRASTRUCTURE",
  ethereum: "ELIGIBLE_BLOCKCHAIN_INFRASTRUCTURE",
  "on-chain": "ELIGIBLE_BLOCKCHAIN_INFRASTRUCTURE",
  onchain: "ELIGIBLE_BLOCKCHAIN_INFRASTRUCTURE",
  "layer 2": "ELIGIBLE_BLOCKCHAIN_INFRASTRUCTURE",
  layer2: "ELIGIBLE_BLOCKCHAIN_INFRASTRUCTURE",
  rollup: "ELIGIBLE_BLOCKCHAIN_INFRASTRUCTURE",
  "account abstraction": "ELIGIBLE_BLOCKCHAIN_INFRASTRUCTURE",
  "cross-chain": "ELIGIBLE_BLOCKCHAIN_INFRASTRUCTURE",
  "cross chain": "ELIGIBLE_BLOCKCHAIN_INFRASTRUCTURE",
  "bridge engineer": "ELIGIBLE_BLOCKCHAIN_INFRASTRUCTURE",
  "oracle engineer": "ELIGIBLE_BLOCKCHAIN_INFRASTRUCTURE",
  "mev engineer": "ELIGIBLE_BLOCKCHAIN_INFRASTRUCTURE",
  "mev researcher": "ELIGIBLE_BLOCKCHAIN_INFRASTRUCTURE",
  restaking: "ELIGIBLE_BLOCKCHAIN_INFRASTRUCTURE",
  "wallet engineer": "ELIGIBLE_BLOCKCHAIN_INFRASTRUCTURE",
  "node engineer": "ELIGIBLE_BLOCKCHAIN_INFRASTRUCTURE",
  "client engineer": "ELIGIBLE_BLOCKCHAIN_INFRASTRUCTURE",
  "crypto protocol": "ELIGIBLE_BLOCKCHAIN_INFRASTRUCTURE",
  "blockchain protocol": "ELIGIBLE_BLOCKCHAIN_INFRASTRUCTURE",
  "web3 protocol": "ELIGIBLE_BLOCKCHAIN_INFRASTRUCTURE",
  "consensus protocol": "ELIGIBLE_BLOCKCHAIN_INFRASTRUCTURE",
  "peer-to-peer networking": "ELIGIBLE_BLOCKCHAIN_INFRASTRUCTURE",
  "node client": "ELIGIBLE_BLOCKCHAIN_INFRASTRUCTURE",
  "wallet infrastructure": "ELIGIBLE_BLOCKCHAIN_INFRASTRUCTURE",
  "node fleet": "ELIGIBLE_BLOCKCHAIN_INFRASTRUCTURE",
  "blockchain indexer": "ELIGIBLE_BLOCKCHAIN_INFRASTRUCTURE",
};

function reasonCodeForPositivePhrase(phrase: string): ApplyEligibilityReasonCode {
  return POSITIVE_PHRASE_REASON_CODES[phrase] ?? "ELIGIBLE_PROTOCOL_ENGINEERING";
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
  const negativeMatch = HARD_NEGATIVE_TITLE_PHRASES.find((phrase) => matchesPhrase(title, phrase));
  if (negativeMatch) {
    return {
      eligible: false,
      reason: "Title reads as a non-Web3-engineering role family",
      reasonCode: reasonCodeForNegativePhrase(negativeMatch),
    };
  }

  const strongMatch = STRONG_TITLE_PHRASES.find((phrase) => matchesPhrase(title, phrase));
  if (strongMatch) {
    return {
      eligible: true,
      reason: "Title names Web3/blockchain-specific work",
      reasonCode: reasonCodeForPositivePhrase(strongMatch),
    };
  }

  if (description) {
    const matched = DESCRIPTION_CONFIRMATION_PHRASES.find((phrase) =>
      matchesPhrase(description, phrase),
    );
    if (matched) {
      return {
        eligible: true,
        reason: `Generic title, but description confirms Web3 protocol work ("${matched}")`,
        reasonCode: reasonCodeForPositivePhrase(matched),
      };
    }
  }

  return {
    eligible: false,
    reason: "No Web3/blockchain-specific evidence in title or description",
    reasonCode: "REJECT_NON_TECHNICAL",
  };
}

/**
 * Bump when `checkApplyEligibility`'s *logic* changes in a way editing a
 * phrase list would not already reveal (for example a new decision step).
 * Phrase-list and reason-code edits change `ELIGIBILITY_GATE_FINGERPRINT`
 * on their own.
 */
const GATE_LOGIC_REVISION = 1;

function fnv1a32(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * Identifies the gate's rules. Persisted alongside each stored verdict
 * (`job_eligibility.gate_fingerprint`), so editing any phrase list or
 * reason-code mapping makes every stored verdict stale and re-evaluated
 * automatically — nothing to remember to bump. Not a security hash: two
 * independent 32-bit FNV-1a passes are plenty to notice an edit.
 */
export const ELIGIBILITY_GATE_FINGERPRINT = (() => {
  const rules = JSON.stringify([
    GATE_LOGIC_REVISION,
    HARD_NEGATIVE_TITLE_PHRASES,
    STRONG_TITLE_PHRASES,
    DESCRIPTION_CONFIRMATION_PHRASES,
    NEGATIVE_PHRASE_REASON_CODES,
    POSITIVE_PHRASE_REASON_CODES,
  ]);
  const hex = (value: number) => value.toString(16).padStart(8, "0");
  return `${hex(fnv1a32(rules, 0x811c9dc5))}${hex(fnv1a32(rules, 0x9747b28c))}`;
})();
