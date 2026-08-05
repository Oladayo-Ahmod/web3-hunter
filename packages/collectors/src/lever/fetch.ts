import { leverPostingsResponseSchema, type LeverPosting } from "./types";

const LEVER_API_BASE = "https://api.lever.co/v0/postings";

/**
 * Fetches a company's currently open roles from Lever's public Postings
 * API — no authentication required. This is the entire extent of this
 * Collector's job: fetch and validate the shape, nothing more — the same
 * discipline `packages/collectors/greenhouse`'s `fetchGreenhouseJobs`
 * follows.
 */
export async function fetchLeverPostings(site: string): Promise<LeverPosting[]> {
  const response = await fetch(`${LEVER_API_BASE}/${site}?mode=json`);

  if (!response.ok) {
    throw new Error(
      `Lever API request failed for site "${site}": ${response.status} ${response.statusText}`,
    );
  }

  const body: unknown = await response.json();
  return leverPostingsResponseSchema.parse(body);
}
