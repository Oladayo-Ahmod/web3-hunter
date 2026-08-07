import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CompanyDirectoryValidationError, parseCompanyDirectory } from "./company-directory";

describe("parseCompanyDirectory", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "company-directory-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeEntry(filename: string, data: unknown) {
    writeFileSync(join(dir, filename), JSON.stringify(data), "utf8");
  }

  it("parses a valid, minimal entry (only required fields)", () => {
    writeEntry("acme.json", {
      companySlug: "acme",
      companyName: "Acme",
      sources: [],
    });

    const entries = parseCompanyDirectory(dir);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.companySlug).toBe("acme");
  });

  it("parses a fully-populated entry", () => {
    writeEntry("acme.json", {
      companySlug: "acme",
      companyName: "Acme",
      websiteUrl: "https://acme.example",
      careersPageUrl: "https://acme.example/careers",
      documentationUrl: "https://docs.acme.example",
      blogUrl: "https://acme.example/blog",
      twitterUrl: "https://x.com/acme",
      discordUrl: "https://discord.gg/acme",
      linkedinUrl: "https://linkedin.com/company/acme",
      logoUrl: "https://acme.example/logo.png",
      description: "A test company.",
      headquarters: "Remote",
      fundingStage: "Series A",
      category: "defi",
      tags: ["ethereum", "solana"],
      sources: [{ collectorSlug: "greenhouse", sourceIdentifier: "acme" }],
    });

    const [entry] = parseCompanyDirectory(dir);
    expect(entry?.category).toBe("defi");
    expect(entry?.tags).toEqual(["ethereum", "solana"]);
    expect(entry?.sources).toEqual([{ collectorSlug: "greenhouse", sourceIdentifier: "acme" }]);
  });

  it("ignores non-JSON files in the directory", () => {
    writeEntry("acme.json", { companySlug: "acme", companyName: "Acme", sources: [] });
    writeFileSync(join(dir, "README.md"), "not a company entry", "utf8");

    expect(parseCompanyDirectory(dir)).toHaveLength(1);
  });

  it("rejects invalid JSON with the offending filename in the error", () => {
    writeFileSync(join(dir, "broken.json"), "{ not valid json", "utf8");

    expect(() => parseCompanyDirectory(dir)).toThrow(CompanyDirectoryValidationError);
    expect(() => parseCompanyDirectory(dir)).toThrow(/broken\.json/);
  });

  it("rejects a malformed URL", () => {
    writeEntry("acme.json", {
      companySlug: "acme",
      companyName: "Acme",
      websiteUrl: "not-a-url",
      sources: [],
    });

    expect(() => parseCompanyDirectory(dir)).toThrow(CompanyDirectoryValidationError);
  });

  it("rejects an empty companySlug", () => {
    writeEntry("acme.json", { companySlug: "", companyName: "Acme", sources: [] });

    expect(() => parseCompanyDirectory(dir)).toThrow(CompanyDirectoryValidationError);
  });

  it("rejects an invalid category value", () => {
    writeEntry("acme.json", {
      companySlug: "acme",
      companyName: "Acme",
      category: "not-a-real-category",
      sources: [],
    });

    expect(() => parseCompanyDirectory(dir)).toThrow(CompanyDirectoryValidationError);
  });

  it("rejects a sources entry naming an unknown collector slug", () => {
    writeEntry("acme.json", {
      companySlug: "acme",
      companyName: "Acme",
      sources: [{ collectorSlug: "not-a-real-ats", sourceIdentifier: "acme" }],
    });

    expect(() => parseCompanyDirectory(dir)).toThrow(/unknown collector slug/i);
  });

  it("rejects a duplicate companySlug across two files", () => {
    writeEntry("acme-one.json", { companySlug: "acme", companyName: "Acme", sources: [] });
    writeEntry("acme-two.json", { companySlug: "acme", companyName: "Acme Again", sources: [] });

    expect(() => parseCompanyDirectory(dir)).toThrow(/duplicate companyslug/i);
  });
});
