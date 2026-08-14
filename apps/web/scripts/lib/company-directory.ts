import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { KNOWN_COLLECTORS, schema, type CompanyDirectoryEntry } from "@web3-hunter/db";
import { z } from "zod";

/**
 * Reads and validates the curated company directory: one JSON file per
 * company, under `dir`. Filesystem traversal and JSON parsing are
 * deliberately confined to this module and its caller
 * (../seed-companies.ts) — per Milestone 11's Definition of Ready,
 * "Architectural Boundaries": nothing under `apps/web/app/**` imports
 * this module, and `packages/db` never touches a file at all, both
 * specifically to keep this data out of Next.js's build-time file trace
 * (`apps/web/next.config.ts` sets `output: "standalone"`, which enables
 * file-tracing for the deployed bundle).
 *
 * Validation here is structural only — shape and format (well-formed
 * URLs, non-empty required fields, every `sources` entry naming a real
 * Collector slug, no duplicate company slugs within the batch). It
 * deliberately makes no live network requests to confirm a URL resolves
 * or a board token is currently valid — that class of error surfaces
 * later, through Collector Health, once a real Collector run tries it.
 */
export class CompanyDirectoryValidationError extends Error {}

const urlField = z.string().url().nullable().optional();
const textField = z.string().nullable().optional();

const sourceSchema = z.object({
  collectorSlug: z.string().min(1),
  sourceIdentifier: z.string().min(1),
});

const categoryEnumValues = schema.companyCategory.enumValues;
const priorityEnumValues = schema.companyPriority.enumValues;
const contactRoleEnumValues = schema.companyContactRole.enumValues;

const contactSchema = z.object({
  name: z.string().min(1),
  role: z.enum(contactRoleEnumValues),
  profileUrl: z.string().url(),
  notes: textField,
});

const entrySchema = z.object({
  companySlug: z.string().min(1),
  companyName: z.string().min(1),
  websiteUrl: urlField,
  careersPageUrl: urlField,
  documentationUrl: urlField,
  blogUrl: urlField,
  twitterUrl: urlField,
  discordUrl: urlField,
  linkedinUrl: urlField,
  logoUrl: urlField,
  description: textField,
  headquarters: textField,
  fundingStage: textField,
  category: z.enum(categoryEnumValues).nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  priority: z.enum(priorityEnumValues).nullable().optional(),
  contacts: z.array(contactSchema).optional(),
  sources: z.array(sourceSchema),
});

export function parseCompanyDirectory(dir: string): CompanyDirectoryEntry[] {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();

  const entries: CompanyDirectoryEntry[] = [];
  const seenSlugs = new Map<string, string>();

  for (const file of files) {
    const raw = readFileSync(join(dir, file), "utf8");

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (error) {
      throw new CompanyDirectoryValidationError(
        `${file}: invalid JSON — ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const result = entrySchema.safeParse(parsedJson);
    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      throw new CompanyDirectoryValidationError(`${file}: ${issues}`);
    }

    const entry = result.data;

    const previousFile = seenSlugs.get(entry.companySlug);
    if (previousFile) {
      throw new CompanyDirectoryValidationError(
        `Duplicate companySlug "${entry.companySlug}" in ${file} (already used by ${previousFile}).`,
      );
    }
    seenSlugs.set(entry.companySlug, file);

    for (const source of entry.sources) {
      if (!(source.collectorSlug in KNOWN_COLLECTORS)) {
        throw new CompanyDirectoryValidationError(
          `${file}: unknown collector slug "${source.collectorSlug}" ` +
            `(expected one of ${Object.keys(KNOWN_COLLECTORS).join(", ")}).`,
        );
      }
    }

    entries.push(entry);
  }

  return entries;
}
