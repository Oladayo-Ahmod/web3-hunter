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
  // `content=true` is required to get each job's description — Greenhouse
  // omits it by default. Requesting it also means every currently-open
  // job's payload (and therefore its content hash) changes exactly once,
  // the run this ships: `storeRawRecord` sees genuinely new content for
  // every job, which naturally reprocesses all of them and backfills
  // `description` via a real `JobUpdated` Event — no separate backfill
  // script needed (see `hiring-events.ts`'s `JobFields` doc comment).
  const response = await fetch(`${GREENHOUSE_API_BASE}/${boardToken}/jobs?content=true`);

  if (!response.ok) {
    throw new Error(
      `Greenhouse API request failed for board "${boardToken}": ${response.status} ${response.statusText}`,
    );
  }

  const body: unknown = await response.json();
  return greenhouseBoardResponseSchema.parse(body).jobs;
}
