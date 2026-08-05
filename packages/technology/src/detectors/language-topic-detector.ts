import { z } from "zod";
import { registerTechnologyDetector } from "../registry";
import type {
  RecentCompanyEvent,
  SkillTaxonomyEntry,
  TechnologyDetectionCandidate,
  TechnologyDetector,
} from "../types";

// The canonical Event Type names the GitHub Collector registers (see
// packages/collectors/src/repository-events.ts) — deliberately referenced
// as plain strings, not imported: packages/technology never depends on
// packages/collectors, the same convention packages/scoring's detectors
// and packages/classification's classifiers use for their own source
// event types.
const REPOSITORY_DISCOVERED = "RepositoryDiscovered";
const REPOSITORY_UPDATED = "RepositoryUpdated";

/**
 * The subset of a Repository Event's metadata this detector needs.
 * Validated defensively (`safeParse`, not `parse`) so the detector simply
 * declines to fire — rather than throwing — if a future VCS source's
 * event doesn't happen to carry these fields.
 */
const repositoryEvidenceSchema = z
  .object({
    fullName: z.string(),
    language: z.string().nullable(),
    topics: z.array(z.string()),
  })
  .passthrough();

// A first, defensible confidence for an exact language/topic alias match —
// not a calibrated model, the same "v1" spirit as every other detector's
// confidence in this system.
const TECHNOLOGY_MATCH_CONFIDENCE = 0.6;

/**
 * A repository's primary-language name, as GitHub reports it, to the
 * Skill taxonomy slug it evidences. Exact (case-insensitive) match only —
 * no fuzzy matching, no substring heuristics — per Milestone 9's explicit
 * constraint. Not every taxonomy Skill has a corresponding language (e.g.
 * "Zero-Knowledge Proofs" is never a primary language); those are only
 * reachable via `TOPIC_TO_SKILL_SLUG` below. A first, defensible, openly
 * incomplete starting set — the same honest limitation
 * `packages/classification`'s `SKILL_KEYWORDS` already carries.
 */
const LANGUAGE_TO_SKILL_SLUG: Readonly<Record<string, string>> = {
  rust: "rust",
  typescript: "typescript",
  go: "golang",
  python: "python",
  solidity: "solidity",
  cairo: "cairo",
};

/**
 * A repository's GitHub topic tags to the Skill taxonomy slug each
 * evidences. GitHub topics are already discrete, kebab-case tokens (not
 * free text), so exact match is the natural — and only — comparison, not
 * a simplification.
 */
const TOPIC_TO_SKILL_SLUG: Readonly<Record<string, string>> = {
  "zero-knowledge": "zero-knowledge-proofs",
  "zero-knowledge-proofs": "zero-knowledge-proofs",
  zk: "zero-knowledge-proofs",
  evm: "evm",
  solana: "solana",
  foundry: "foundry",
  hardhat: "hardhat",
  "the-graph": "the-graph",
  subgraph: "the-graph",
  cryptography: "cryptography",
  "distributed-systems": "distributed-systems",
  move: "move",
  "move-lang": "move",
};

function findSkill(
  skills: readonly SkillTaxonomyEntry[],
  slug: string,
): SkillTaxonomyEntry | undefined {
  return skills.find((entry) => entry.slug === slug);
}

/**
 * Detects Skills a Company's GitHub activity evidences from a
 * Repository's primary language and topics — deterministic alias lookup
 * only, per Milestone 9's constraint against AI, embeddings, semantic
 * search, and fuzzy matching. Every candidate cites the triggering Event
 * as its sole source, the same provenance discipline every other
 * detector/classifier in this system follows.
 */
export const languageTopicTechnologyDetector: TechnologyDetector = (
  triggeringEvent: RecentCompanyEvent,
  context,
): readonly TechnologyDetectionCandidate[] => {
  if (
    triggeringEvent.type !== REPOSITORY_DISCOVERED &&
    triggeringEvent.type !== REPOSITORY_UPDATED
  ) {
    return [];
  }

  const parsed = repositoryEvidenceSchema.safeParse(triggeringEvent.metadata);
  if (!parsed.success) {
    return [];
  }
  const { fullName, language, topics } = parsed.data;

  const matches: Array<{ slug: string; evidence: string }> = [];
  if (language) {
    const slug = LANGUAGE_TO_SKILL_SLUG[language.toLowerCase()];
    if (slug) {
      matches.push({ slug, evidence: `primary language "${language}"` });
    }
  }
  for (const topic of topics) {
    const slug = TOPIC_TO_SKILL_SLUG[topic.toLowerCase()];
    if (slug) {
      matches.push({ slug, evidence: `topic "${topic}"` });
    }
  }

  const candidates: TechnologyDetectionCandidate[] = [];
  const seenSlugs = new Set<string>();
  for (const match of matches) {
    if (seenSlugs.has(match.slug)) {
      continue;
    }
    const entry = findSkill(context.skills, match.slug);
    if (!entry) {
      continue;
    }
    seenSlugs.add(match.slug);

    candidates.push({
      skillId: entry.id,
      confidence: TECHNOLOGY_MATCH_CONFIDENCE,
      reasoning: `Repository "${fullName}" evidences Skill "${entry.name}" via its ${match.evidence}.`,
      sourceEventIds: [triggeringEvent.id],
    });
  }

  return candidates;
};

registerTechnologyDetector(languageTopicTechnologyDetector);
