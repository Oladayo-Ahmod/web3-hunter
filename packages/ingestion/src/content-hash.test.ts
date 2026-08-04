import { describe, expect, it } from "vitest";
import { hashContent } from "./content-hash";

describe("hashContent", () => {
  it("produces the same hash regardless of object key order", () => {
    const a = hashContent({ title: "Engineer", location: "Remote" });
    const b = hashContent({ location: "Remote", title: "Engineer" });

    expect(a).toBe(b);
  });

  it("produces a different hash when content differs", () => {
    const a = hashContent({ title: "Engineer" });
    const b = hashContent({ title: "Senior Engineer" });

    expect(a).not.toBe(b);
  });

  it("produces the same hash for nested objects and arrays regardless of key order", () => {
    const a = hashContent({ job: { title: "Engineer", tags: ["solidity", "rust"] } });
    const b = hashContent({ job: { tags: ["solidity", "rust"], title: "Engineer" } });

    expect(a).toBe(b);
  });

  it("is sensitive to array order", () => {
    const a = hashContent({ tags: ["solidity", "rust"] });
    const b = hashContent({ tags: ["rust", "solidity"] });

    expect(a).not.toBe(b);
  });
});
