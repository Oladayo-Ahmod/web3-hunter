import { ashbyJobBoardResponseSchema, type AshbyJob } from "./types";

const ASHBY_API_BASE = "https://api.ashbyhq.com/posting-api/job-board";

/**
 * Fetches a company's currently open roles from Ashby's public Job Board
 * API — no authentication required. This is the entire extent of this
 * Collector's job: fetch and validate the shape, nothing more — the same
 * discipline `packages/collectors/greenhouse`'s `fetchGreenhouseJobs`
 * follows.
 */
export async function fetchAshbyJobs(boardName: string): Promise<AshbyJob[]> {
  const response = await fetch(`${ASHBY_API_BASE}/${boardName}`);

  if (!response.ok) {
    throw new Error(
      `Ashby API request failed for board "${boardName}": ${response.status} ${response.statusText}`,
    );
  }

  const body: unknown = await response.json();
  return ashbyJobBoardResponseSchema.parse(body).jobs;
}
