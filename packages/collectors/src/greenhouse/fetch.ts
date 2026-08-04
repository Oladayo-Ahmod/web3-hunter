import { greenhouseBoardResponseSchema, type GreenhouseJob } from "./types";

const GREENHOUSE_API_BASE = "https://boards-api.greenhouse.io/v1/boards";

/**
 * Fetches a company's currently open roles from Greenhouse's public Job
 * Board API — no authentication required; it's the same API that powers
 * the company's own public careers page. This is the entire extent of
 * this Collector's job: fetch and validate the shape, nothing more. See
 * docs/ROADMAP.md Milestone 2 for why Greenhouse was chosen first.
 */
export async function fetchGreenhouseJobs(boardToken: string): Promise<GreenhouseJob[]> {
  const response = await fetch(`${GREENHOUSE_API_BASE}/${boardToken}/jobs`);

  if (!response.ok) {
    throw new Error(
      `Greenhouse API request failed for board "${boardToken}": ${response.status} ${response.statusText}`,
    );
  }

  const body: unknown = await response.json();
  return greenhouseBoardResponseSchema.parse(body).jobs;
}
