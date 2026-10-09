import { z } from "zod";

/**
 * Validated, but deliberately not reshaped: `.passthrough()` preserves
 * every field DefiLlama sends, even ones we don't use, so what gets
 * stored as a Raw Record is genuinely the source's native shape — same
 * discipline as `../github/types.ts`. Modeled against DefiLlama's public
 * `GET https://api.llama.fi/protocols` response, directly verified live
 * during Phase 2A research (8,543 protocols, no authentication). Only
 * the fields this Collector's normalizer actually reads are declared;
 * everything else rides through via `.passthrough()`.
 */
export const defiLlamaProtocolSchema = z
  .object({
    name: z.string(),
    slug: z.string(),
    category: z.string().nullable().optional(),
    tvl: z.number().nullable().optional(),
    change_1d: z.number().nullable().optional(),
    change_7d: z.number().nullable().optional(),
    listedAt: z.number().nullable().optional(),
    audits: z.string().nullable().optional(),
    audit_links: z.array(z.string()).nullable().optional(),
    chains: z.array(z.string()).optional().default([]),
    // GitHub organization/user names — verified live in DefiLlama's bulk
    // `/protocols` response (present for ~18% of protocols; absent, not
    // null, otherwise). This is the *only* cross-source identity evidence
    // DefiLlama's own data supplies, and it's already part of the same
    // response this Collector fetches — no separate detail endpoint is
    // needed. Array elements are owner/org names only, never a full repo
    // path — see `security-target-store.ts`'s `extractGithubOwner`.
    github: z.array(z.string()).optional(),
  })
  .passthrough();

export type DefiLlamaProtocol = z.infer<typeof defiLlamaProtocolSchema>;

export const defiLlamaProtocolsResponseSchema = z.array(defiLlamaProtocolSchema);
