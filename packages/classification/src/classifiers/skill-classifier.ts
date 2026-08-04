import { z } from "zod";
import { registerSkillClassifier } from "../registry";
import type {
  RecentCompanyEvent,
  SkillClassificationCandidate,
  SkillClassifier,
  SkillTaxonomyEntry,
} from "../types";

// A string literal, not imported from packages/collectors — packages/classification
// never depends on it, the same convention packages/scoring's hiring-detectors uses.
const JOB_POSTED = "JobPosted";

const jobEventMetadataSchema = z
  .object({
    title: z.string(),
    departmentNames: z.array(z.string()).optional().default([]),
  })
  .passthrough();

// A first, defensible confidence for a keyword match — not a calibrated
// model, per the same "v1" spirit as Scoring Engine v1 (docs/ROADMAP.md
// Milestone 3).
const KEYWORD_MATCH_CONFIDENCE = 0.6;

/**
 * Skill-specific keyword aliases, for Skills whose taxonomy name doesn't
 * read naturally as a job-title substring (e.g. "Zero-Knowledge Proofs"
 * rarely appears verbatim in a title, but "ZK" does). Skills not listed
 * here fall back to matching their own name — sufficient for Skills like
 * "Solidity" or "Rust" that already read naturally in a title.
 */
const SKILL_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  "zero-knowledge-proofs": ["zero-knowledge", "zero knowledge", "zk"],
  "smart-contract-security": ["security", "audit", "auditor"],
  "devops-infrastructure": ["devops", "site reliability", "sre", "infrastructure"],
  "the-graph": ["the graph", "subgraph"],
  "backend-engineering": ["backend"],
  "frontend-engineering": ["frontend", "front-end", "front end"],
  "distributed-systems": ["distributed systems"],
  "protocol-design": ["protocol engineer", "protocol design"],
};

function keywordsForSkill(entry: SkillTaxonomyEntry): readonly string[] {
  return SKILL_KEYWORDS[entry.slug] ?? [entry.name.toLowerCase()];
}

/**
 * Extracts Skill tags from a `JobPosted` Event's title and department
 * names via keyword matching against the Skill taxonomy — a first,
 * explainable version, not NLP. Every candidate cites the triggering
 * Event as its sole source, so `opportunity_skill`'s provenance discipline
 * holds even for this simplest possible classifier.
 */
export const skillKeywordClassifier: SkillClassifier = (
  triggeringEvent: RecentCompanyEvent,
  context,
): readonly SkillClassificationCandidate[] => {
  if (triggeringEvent.type !== JOB_POSTED) {
    return [];
  }

  const parsed = jobEventMetadataSchema.safeParse(triggeringEvent.metadata);
  if (!parsed.success) {
    return [];
  }

  const haystack = [parsed.data.title, ...parsed.data.departmentNames].join(" ").toLowerCase();

  const candidates: SkillClassificationCandidate[] = [];
  for (const entry of context.skills) {
    const matched = keywordsForSkill(entry).some((keyword) => haystack.includes(keyword));
    if (!matched) {
      continue;
    }

    candidates.push({
      skillId: entry.id,
      confidence: KEYWORD_MATCH_CONFIDENCE,
      reasoning: `Job posting "${parsed.data.title}" matches Skill "${entry.name}".`,
      sourceEventIds: [triggeringEvent.id],
    });
  }

  return candidates;
};

registerSkillClassifier(skillKeywordClassifier);
