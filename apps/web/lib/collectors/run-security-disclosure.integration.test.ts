import { getDb, schema } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  runSecurityDisclosureCollector,
  type SecurityDisclosureCollectorTarget,
} from "./run-security-disclosure";

interface MockState {
  securityTxt?: { status: number; body?: string };
  communityProfile?: { status: number; body?: unknown };
}

const mocks = new Map<string, MockState>();

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);

      if (url.includes("/.well-known/security.txt")) {
        const origin = new URL(url).origin;
        const state = mocks.get(origin)?.securityTxt;
        if (!state) {
          return { ok: false, status: 404, statusText: "Not Found" } as Response;
        }
        if (state.status === 404) {
          return { ok: false, status: 404, statusText: "Not Found" } as Response;
        }
        if (state.status >= 400) {
          return { ok: false, status: state.status, statusText: "Error" } as Response;
        }
        return {
          ok: true,
          status: 200,
          text: async () => state.body ?? "",
        } as Response;
      }

      if (url.includes("/community/profile")) {
        const repoPath = url.split("/repos/")[1]?.split("/community/profile")[0];
        const state = repoPath ? mocks.get(`repo:${repoPath}`)?.communityProfile : undefined;
        if (!state) {
          return { ok: false, status: 404, statusText: "Not Found" } as Response;
        }
        return {
          ok: state.status < 400,
          status: state.status,
          statusText: state.status < 400 ? "OK" : "Error",
          json: async () => state.body,
        } as Response;
      }

      throw new Error(`Unexpected fetch URL in test: ${url}`);
    }),
  );
}

describe("runSecurityDisclosureCollector (integration)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mocks.clear();
  });

  it("publishes a found security.txt and a found GitHub security policy for a target with both", async () => {
    const securityTargetId = randomUUID();
    mocks.set("https://acme.xyz", {
      securityTxt: {
        status: 200,
        body: "Contact: mailto:security@acme.xyz\nExpires: 2027-01-01T00:00:00.000Z",
      },
    });
    mocks.set("repo:acme/contracts", {
      communityProfile: {
        status: 200,
        body: {
          files: {
            security_policy: {
              html_url: "https://github.com/acme/contracts/blob/main/SECURITY.md",
            },
          },
        },
      },
    });
    stubFetch();

    const target: SecurityDisclosureCollectorTarget = {
      securityTargetId,
      websiteUrl: "https://acme.xyz",
      repositoryUrl: "https://github.com/acme/contracts",
    };

    const result = await runSecurityDisclosureCollector([target]);

    expect(result.skippedNoCandidateRoute).toBe(0);
    expect(result.checks).toHaveLength(2);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ routeType: "security-txt", status: "published" }),
        expect.objectContaining({ routeType: "github-security-policy", status: "published" }),
      ]),
    );

    const events = await getDb()
      .select()
      .from(schema.event)
      .where(eq(schema.event.relatedEntityId, securityTargetId));
    expect(events).toHaveLength(2);

    const [collectorRow] = await getDb()
      .select()
      .from(schema.collector)
      .where(eq(schema.collector.slug, "security-disclosure"));
    expect(collectorRow?.status).toBe("active");
  });

  it("records a clean 404 as found: false, never fabricating a contact", async () => {
    const securityTargetId = randomUUID();
    mocks.set("https://noroute.xyz", { securityTxt: { status: 404 } });
    stubFetch();

    const target: SecurityDisclosureCollectorTarget = {
      securityTargetId,
      websiteUrl: "https://noroute.xyz",
      repositoryUrl: null,
    };

    const result = await runSecurityDisclosureCollector([target]);

    expect(result.checks).toEqual([
      expect.objectContaining({ routeType: "security-txt", status: "published" }),
    ]);

    const [event] = await getDb()
      .select()
      .from(schema.event)
      .where(eq(schema.event.relatedEntityId, securityTargetId));
    expect(event?.metadata).toMatchObject({ found: false, contacts: [] });
  });

  it("skips a target with neither a websiteUrl nor a GitHub repositoryUrl, without error", async () => {
    stubFetch();

    const target: SecurityDisclosureCollectorTarget = {
      securityTargetId: randomUUID(),
      websiteUrl: null,
      repositoryUrl: "https://gitlab.com/acme/contracts",
    };

    const result = await runSecurityDisclosureCollector([target]);

    expect(result.skippedNoCandidateRoute).toBe(1);
    expect(result.checks).toHaveLength(0);
  });

  it("records a per-target fetch failure without aborting the run for other targets", async () => {
    const brokenId = randomUUID();
    const okId = randomUUID();
    mocks.set("https://broken.xyz", { securityTxt: { status: 503 } });
    mocks.set("https://ok.xyz", { securityTxt: { status: 200, body: "Contact: mailto:a@ok.xyz" } });
    stubFetch();

    const targets: SecurityDisclosureCollectorTarget[] = [
      { securityTargetId: brokenId, websiteUrl: "https://broken.xyz", repositoryUrl: null },
      { securityTargetId: okId, websiteUrl: "https://ok.xyz", repositoryUrl: null },
    ];

    const result = await runSecurityDisclosureCollector(targets);

    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ securityTargetId: brokenId, status: "error" }),
        expect.objectContaining({ securityTargetId: okId, status: "published" }),
      ]),
    );

    const [collectorRow] = await getDb()
      .select()
      .from(schema.collector)
      .where(eq(schema.collector.slug, "security-disclosure"));
    expect(collectorRow?.status).toBe("degraded");
    expect(collectorRow?.lastErrorMessage).toMatch(/503/);
  });

  it("publishes nothing new on a re-run with unchanged content (idempotent)", async () => {
    const securityTargetId = randomUUID();
    mocks.set("https://idempotent.xyz", {
      securityTxt: { status: 200, body: "Contact: mailto:a@idempotent.xyz" },
    });
    stubFetch();

    const target: SecurityDisclosureCollectorTarget = {
      securityTargetId,
      websiteUrl: "https://idempotent.xyz",
      repositoryUrl: null,
    };

    await runSecurityDisclosureCollector([target]);
    const second = await runSecurityDisclosureCollector([target]);

    expect(second.checks).toEqual([
      expect.objectContaining({ routeType: "security-txt", status: "skipped" }),
    ]);

    const events = await getDb()
      .select()
      .from(schema.event)
      .where(eq(schema.event.relatedEntityId, securityTargetId));
    expect(events).toHaveLength(1);
  });

  it("publishes an Updated event, never duplicating the Recorded one, when content genuinely changes", async () => {
    const securityTargetId = randomUUID();
    mocks.set("https://changes.xyz", { securityTxt: { status: 404 } });
    stubFetch();

    const target: SecurityDisclosureCollectorTarget = {
      securityTargetId,
      websiteUrl: "https://changes.xyz",
      repositoryUrl: null,
    };

    await runSecurityDisclosureCollector([target]);

    mocks.set("https://changes.xyz", {
      securityTxt: { status: 200, body: "Contact: mailto:security@changes.xyz" },
    });
    const second = await runSecurityDisclosureCollector([target]);

    expect(second.checks).toEqual([
      expect.objectContaining({ routeType: "security-txt", status: "published" }),
    ]);

    const events = await getDb()
      .select()
      .from(schema.event)
      .where(eq(schema.event.relatedEntityId, securityTargetId));
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.type).sort()).toEqual([
      "SecurityDisclosureRouteRecorded",
      "SecurityDisclosureRouteUpdated",
    ]);
  });
});
