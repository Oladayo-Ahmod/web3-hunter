import { describe, expect, it } from "vitest";
import type { ClassificationContext, RecentCompanyEvent, SkillTaxonomyEntry } from "../types";
import { skillKeywordClassifier } from "./skill-classifier";

const SOLIDITY: SkillTaxonomyEntry = { id: "skill-solidity", slug: "solidity", name: "Solidity" };
const RUST: SkillTaxonomyEntry = { id: "skill-rust", slug: "rust", name: "Rust" };
const ZK: SkillTaxonomyEntry = {
  id: "skill-zk",
  slug: "zero-knowledge-proofs",
  name: "Zero-Knowledge Proofs",
};

const CONTEXT: ClassificationContext = { skills: [SOLIDITY, RUST, ZK] };

function jobPostedEvent(title: string, departmentNames: string[] = []): RecentCompanyEvent {
  return {
    id: "event-1",
    type: "JobPosted",
    occurredAt: new Date("2026-01-01T00:00:00Z"),
    metadata: { title, departmentNames },
  };
}

describe("skillKeywordClassifier", () => {
  it("ignores Events that are not JobPosted", () => {
    const event: RecentCompanyEvent = {
      id: "event-1",
      type: "SomethingElse",
      occurredAt: new Date(),
      metadata: { title: "Solidity Engineer" },
    };
    expect(skillKeywordClassifier(event, CONTEXT)).toEqual([]);
  });

  it("ignores a JobPosted Event whose metadata doesn't match the expected shape", () => {
    const event: RecentCompanyEvent = {
      id: "event-1",
      type: "JobPosted",
      occurredAt: new Date(),
      metadata: { somethingElse: true },
    };
    expect(skillKeywordClassifier(event, CONTEXT)).toEqual([]);
  });

  it("matches a Skill whose name appears in the job title", () => {
    const candidates = skillKeywordClassifier(jobPostedEvent("Senior Solidity Engineer"), CONTEXT);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ skillId: SOLIDITY.id, sourceEventIds: ["event-1"] });
    expect(candidates[0]?.reasoning).toContain("Solidity");
  });

  it("is case-insensitive", () => {
    const candidates = skillKeywordClassifier(jobPostedEvent("SOLIDITY engineer"), CONTEXT);
    expect(candidates).toHaveLength(1);
  });

  it("matches an aliased Skill by its keyword, not just its taxonomy name", () => {
    const candidates = skillKeywordClassifier(jobPostedEvent("ZK Cryptography Engineer"), CONTEXT);
    expect(candidates.map((c) => c.skillId)).toEqual([ZK.id]);
  });

  it("matches multiple Skills from the same posting", () => {
    const candidates = skillKeywordClassifier(
      jobPostedEvent("Rust and Solidity Engineer"),
      CONTEXT,
    );
    expect(candidates.map((c) => c.skillId).sort()).toEqual([RUST.id, SOLIDITY.id].sort());
  });

  it("also considers department names, not just the title", () => {
    const candidates = skillKeywordClassifier(
      jobPostedEvent("Protocol Engineer", ["Rust"]),
      CONTEXT,
    );
    expect(candidates.map((c) => c.skillId)).toEqual([RUST.id]);
  });

  it("returns no candidates when nothing matches", () => {
    expect(skillKeywordClassifier(jobPostedEvent("Head of Marketing"), CONTEXT)).toEqual([]);
  });
});
