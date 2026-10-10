import type { CollectorHealthWithFreshnessDTO, PipelineHealthDTO } from "@web3-hunter/application";
import { describe, expect, it } from "vitest";
import { deriveSecurityCollectorFreshness } from "./collector-freshness";

function collector(
  overrides: Partial<CollectorHealthWithFreshnessDTO> & { slug: string },
): CollectorHealthWithFreshnessDTO {
  return {
    id: overrides.id ?? overrides.slug,
    sourceType: "security-intelligence",
    status: "active",
    consecutiveFailures: 0,
    lastRunAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
    lastRunRecordsProcessed: null,
    lastRunRecordsPublished: null,
    lastRunDurationMs: null,
    isStale: false,
    ...overrides,
  };
}

function health(collectors: CollectorHealthWithFreshnessDTO[]): PipelineHealthDTO {
  return { jobsLastRefreshedAt: null, jobsAreStale: false, collectors };
}

describe("deriveSecurityCollectorFreshness", () => {
  it("reports fresh when the collector is active and not stale", () => {
    const result = deriveSecurityCollectorFreshness(
      health([
        collector({
          slug: "defillama",
          status: "active",
          lastRunAt: "2026-01-02T00:00:00Z",
          isStale: false,
        }),
      ]),
      "defillama",
    );
    expect(result).toEqual({
      slug: "defillama",
      state: "fresh",
      lastRunAt: "2026-01-02T00:00:00Z",
      consecutiveFailures: 0,
    });
  });

  it("reports stale for a previously successful run that aged past its threshold, with one collector fresh and the other stale", () => {
    const pipelineHealth = health([
      collector({
        slug: "defillama",
        status: "active",
        lastRunAt: "2026-01-02T00:00:00Z",
        isStale: false,
      }),
      collector({
        slug: "immunefi",
        status: "active",
        lastRunAt: "2026-01-01T00:00:00Z",
        isStale: true,
      }),
    ]);

    expect(deriveSecurityCollectorFreshness(pipelineHealth, "defillama").state).toBe("fresh");
    const immunefi = deriveSecurityCollectorFreshness(pipelineHealth, "immunefi");
    expect(immunefi.state).toBe("stale");
    expect(immunefi.lastRunAt).toBe("2026-01-01T00:00:00Z");
  });

  it("reports never-collected when lastRunAt is null and the collector is not degraded, never substituting the current time", () => {
    const result = deriveSecurityCollectorFreshness(
      health([
        collector({ slug: "immunefi", status: "configured", lastRunAt: null, isStale: true }),
      ]),
      "immunefi",
    );
    expect(result.state).toBe("never-collected");
    expect(result.lastRunAt).toBeNull();
  });

  it("reports failing when status is degraded, even though isStale is also true (degraded takes precedence)", () => {
    const result = deriveSecurityCollectorFreshness(
      health([
        collector({
          slug: "defillama",
          status: "degraded",
          lastRunAt: "2026-01-01T00:00:00Z",
          isStale: true,
          consecutiveFailures: 3,
          lastErrorMessage: "internal: upstream 500 at https://api.llama.fi/protocols",
        }),
      ]),
      "defillama",
    );
    expect(result.state).toBe("failing");
    expect(result.consecutiveFailures).toBe(3);
    // The derived state never carries the raw error text — only the
    // structured state and failure count are meant to reach the page.
    expect(result).not.toHaveProperty("lastErrorMessage");
  });

  it("reports failing when status is degraded even with lastRunAt null (a run that has never once succeeded)", () => {
    const result = deriveSecurityCollectorFreshness(
      health([collector({ slug: "immunefi", status: "degraded", lastRunAt: null, isStale: true })]),
      "immunefi",
    );
    expect(result.state).toBe("failing");
  });

  it("reports unknown when the collector is missing from the health response entirely, never fresh", () => {
    const result = deriveSecurityCollectorFreshness(
      health([
        collector({ slug: "immunefi", status: "active", lastRunAt: "2026-01-01T00:00:00Z" }),
      ]),
      "defillama",
    );
    expect(result.state).toBe("unknown");
    expect(result.lastRunAt).toBeNull();
  });

  it("reports unknown for both collectors when the health fetch itself failed (health is null), never fresh", () => {
    expect(deriveSecurityCollectorFreshness(null, "defillama").state).toBe("unknown");
    expect(deriveSecurityCollectorFreshness(null, "immunefi").state).toBe("unknown");
  });

  it("reports unknown rather than fresh for a status/lastRunAt combination the real collectors never produce", () => {
    const result = deriveSecurityCollectorFreshness(
      health([
        collector({
          slug: "defillama",
          status: "disabled",
          lastRunAt: "2026-01-01T00:00:00Z",
          isStale: false,
        }),
      ]),
      "defillama",
    );
    expect(result.state).toBe("unknown");
  });
});
