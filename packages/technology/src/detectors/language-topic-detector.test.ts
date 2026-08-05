import { describe, expect, it } from "vitest";
import type { RecentCompanyEvent, SkillTaxonomyEntry, TechnologyDetectionContext } from "../types";
import { languageTopicTechnologyDetector } from "./language-topic-detector";

const RUST: SkillTaxonomyEntry = { id: "skill-rust", slug: "rust", name: "Rust" };
const TYPESCRIPT: SkillTaxonomyEntry = {
  id: "skill-typescript",
  slug: "typescript",
  name: "TypeScript",
};
const ZK: SkillTaxonomyEntry = {
  id: "skill-zk",
  slug: "zero-knowledge-proofs",
  name: "Zero-Knowledge Proofs",
};

const CONTEXT: TechnologyDetectionContext = { skills: [RUST, TYPESCRIPT, ZK] };

function repositoryEvent(
  type: string,
  input: { fullName?: string; language?: string | null; topics?: string[] } = {},
): RecentCompanyEvent {
  return {
    id: "event-1",
    type,
    occurredAt: new Date("2026-01-01T00:00:00Z"),
    metadata: {
      fullName: input.fullName ?? "acme/protocol-node",
      language: "language" in input ? input.language : "Rust",
      topics: input.topics ?? [],
    },
  };
}

describe("languageTopicTechnologyDetector", () => {
  it("ignores Events that are not RepositoryDiscovered/RepositoryUpdated", () => {
    const event: RecentCompanyEvent = {
      id: "event-1",
      type: "JobPosted",
      occurredAt: new Date(),
      metadata: { title: "Rust Engineer" },
    };
    expect(languageTopicTechnologyDetector(event, CONTEXT)).toEqual([]);
  });

  it("ignores an Event whose metadata doesn't match the expected shape", () => {
    const event: RecentCompanyEvent = {
      id: "event-1",
      type: "RepositoryDiscovered",
      occurredAt: new Date(),
      metadata: { somethingElse: true },
    };
    expect(languageTopicTechnologyDetector(event, CONTEXT)).toEqual([]);
  });

  it("matches a Skill via the repository's primary language", () => {
    const candidates = languageTopicTechnologyDetector(
      repositoryEvent("RepositoryDiscovered", { language: "Rust" }),
      CONTEXT,
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ skillId: RUST.id, sourceEventIds: ["event-1"] });
    expect(candidates[0]?.reasoning).toContain("primary language");
  });

  it("is case-insensitive on language", () => {
    const candidates = languageTopicTechnologyDetector(
      repositoryEvent("RepositoryDiscovered", { language: "RUST" }),
      CONTEXT,
    );
    expect(candidates).toHaveLength(1);
  });

  it("matches a Skill via a topic the language alone wouldn't reach", () => {
    const candidates = languageTopicTechnologyDetector(
      repositoryEvent("RepositoryUpdated", { language: "Rust", topics: ["zero-knowledge"] }),
      CONTEXT,
    );
    expect(candidates.map((c) => c.skillId).sort()).toEqual([RUST.id, ZK.id].sort());
  });

  it("does not duplicate a Skill matched by both language and topic", () => {
    const candidates = languageTopicTechnologyDetector(
      repositoryEvent("RepositoryDiscovered", { language: "Rust", topics: ["rust"] }),
      CONTEXT,
    );
    // "rust" isn't a modeled topic alias, so this should stay a single match via language only.
    expect(candidates).toHaveLength(1);
  });

  it("ignores a null language and unmapped topics", () => {
    const candidates = languageTopicTechnologyDetector(
      repositoryEvent("RepositoryDiscovered", { language: null, topics: ["something-unrelated"] }),
      CONTEXT,
    );
    expect(candidates).toEqual([]);
  });

  it("returns no candidates when the language/topic has no taxonomy entry", () => {
    const candidates = languageTopicTechnologyDetector(
      repositoryEvent("RepositoryDiscovered", { language: "COBOL" }),
      CONTEXT,
    );
    expect(candidates).toEqual([]);
  });
});
