import { describe, expect, it } from "vitest";
import {
  normalizeEmploymentType,
  normalizeWorkplaceType,
  stripHtmlToPlainText,
} from "./job-field-normalization";

describe("normalizeEmploymentType", () => {
  it("maps Ashby's PascalCase vocabulary", () => {
    expect(normalizeEmploymentType("FullTime")).toBe("full-time");
    expect(normalizeEmploymentType("PartTime")).toBe("part-time");
    expect(normalizeEmploymentType("Contract")).toBe("contract");
    expect(normalizeEmploymentType("Intern")).toBe("internship"); // abbreviated form, substring-matched
  });

  it("maps Lever's hyphenated vocabulary", () => {
    expect(normalizeEmploymentType("Full-time")).toBe("full-time");
    expect(normalizeEmploymentType("Part-time")).toBe("part-time");
  });

  it("returns null for missing or unrecognized values, never a guess", () => {
    expect(normalizeEmploymentType(null)).toBeNull();
    expect(normalizeEmploymentType(undefined)).toBeNull();
    expect(normalizeEmploymentType("Freelance")).toBeNull();
  });
});

describe("normalizeWorkplaceType", () => {
  it("maps common spellings case-insensitively", () => {
    expect(normalizeWorkplaceType("Remote")).toBe("remote");
    expect(normalizeWorkplaceType("onsite")).toBe("onsite");
    expect(normalizeWorkplaceType("Hybrid")).toBe("hybrid");
    expect(normalizeWorkplaceType("OnSite")).toBe("onsite");
  });

  it("returns null for missing or unrecognized values", () => {
    expect(normalizeWorkplaceType(null)).toBeNull();
    expect(normalizeWorkplaceType(undefined)).toBeNull();
    expect(normalizeWorkplaceType("Mars")).toBeNull();
  });
});

describe("stripHtmlToPlainText", () => {
  it("decodes Greenhouse's HTML-encoded content and strips tags", () => {
    const input =
      "&lt;div class=&quot;content-intro&quot;&gt;&lt;h3&gt;About us&lt;/h3&gt;&lt;/div&gt;";
    expect(stripHtmlToPlainText(input)).toBe("About us");
  });

  it("collapses repeated whitespace left behind by stripped tags", () => {
    const input = "&lt;p&gt;First paragraph.&lt;/p&gt;&lt;p&gt;Second paragraph.&lt;/p&gt;";
    expect(stripHtmlToPlainText(input)).toBe("First paragraph. Second paragraph.");
  });
});
