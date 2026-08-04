import type { Database } from "../client";
import { skill } from "../schema";

/**
 * The Skill taxonomy's initial curated set (docs/DOMAIN_MODEL.md §Skill:
 * "a taxonomy concept, not free text"). Deliberately small and Web3-
 * engineering-specific rather than exhaustive — per
 * docs/DOMAIN_MODEL.md's Future Extension Points, the taxonomy is
 * expected to grow; this is a first, defensible starting set, not a
 * finished vocabulary.
 */
export const SKILL_TAXONOMY: ReadonlyArray<{ slug: string; name: string }> = [
  { slug: "solidity", name: "Solidity" },
  { slug: "rust", name: "Rust" },
  { slug: "move", name: "Move" },
  { slug: "cairo", name: "Cairo" },
  { slug: "golang", name: "Go" },
  { slug: "typescript", name: "TypeScript" },
  { slug: "python", name: "Python" },
  { slug: "zero-knowledge-proofs", name: "Zero-Knowledge Proofs" },
  { slug: "smart-contract-security", name: "Smart Contract Security" },
  { slug: "evm", name: "EVM" },
  { slug: "solana", name: "Solana" },
  { slug: "foundry", name: "Foundry" },
  { slug: "hardhat", name: "Hardhat" },
  { slug: "the-graph", name: "The Graph" },
  { slug: "cryptography", name: "Cryptography" },
  { slug: "distributed-systems", name: "Distributed Systems" },
  { slug: "backend-engineering", name: "Backend Engineering" },
  { slug: "frontend-engineering", name: "Frontend Engineering" },
  { slug: "devops-infrastructure", name: "DevOps / Infrastructure" },
  { slug: "protocol-design", name: "Protocol Design" },
];

/**
 * Idempotently inserts the initial Skill taxonomy — safe to call on every
 * deploy, since it's keyed on `slug` and never overwrites an existing
 * Skill (a Skill, once referenced by a User Profile or an Opportunity, is
 * never silently redefined).
 */
export async function seedSkillTaxonomy(db: Database): Promise<void> {
  await db
    .insert(skill)
    .values([...SKILL_TAXONOMY])
    .onConflictDoNothing({ target: skill.slug });
}
