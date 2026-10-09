import { immunefiBountiesResponseSchema, type ImmunefiBounty } from "./types";

const IMMUNEFI_BOUNTIES_URL = "https://immunefi.com/public-api/bounties.json";

/**
 * Fetches Immunefi's full public bug bounty catalog — no authentication
 * required. This is the entire extent of this Collector's job: fetch
 * and validate the shape, nothing more — the same discipline every
 * other Collector's fetch function follows (see `../defillama/fetch.ts`).
 */
export async function fetchImmunefiBounties(): Promise<ImmunefiBounty[]> {
  const response = await fetch(IMMUNEFI_BOUNTIES_URL);

  if (!response.ok) {
    throw new Error(
      `Immunefi API request failed for "${IMMUNEFI_BOUNTIES_URL}": ${response.status} ${response.statusText}`,
    );
  }

  const body: unknown = await response.json();
  return immunefiBountiesResponseSchema.parse(body);
}
