import { getDb, schema } from "@web3-hunter/db";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { PipelineRunDTO } from "./dto";
import { toPipelineRunDTO } from "./mappers";

/** No magic numbers: the cap on how many Pipeline Run rows one query returns, per docs/DATABASE.md's discipline. */
const DEFAULT_PIPELINE_RUN_LIMIT = 50;
const MAX_PIPELINE_RUN_LIMIT = 200;

/**
 * Validates raw Pipeline Run history query input — the same schema-owned-
 * by-the-service, parsed-by-the-route shape `searchQuerySchema` and
 * `opportunityFeedQuerySchema` already use, so an API route and a Server
 * Component calling this directly get identical validation for free.
 */
export const pipelineRunQuerySchema = z.object({
  pipelineName: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PIPELINE_RUN_LIMIT).optional(),
});
export type PipelineRunQuery = z.infer<typeof pipelineRunQuerySchema>;

/**
 * Pipeline Run history, per Milestone 10's Definition of Ready: a
 * read-only operational log of Scoring/Classification/Technology/
 * Matching/Decision invocations — storage + read API only, no dashboard,
 * no alerting. Ordered most-recent-first, mirroring
 * `listCollectorHealth`'s read-only, unauthenticated shape.
 */
export async function listPipelineRuns(query: PipelineRunQuery = {}): Promise<PipelineRunDTO[]> {
  const db = getDb();
  const conditions: SQL[] = [];

  if (query.pipelineName !== undefined) {
    conditions.push(eq(schema.pipelineRun.pipelineName, query.pipelineName));
  }

  const limit = Math.min(query.limit ?? DEFAULT_PIPELINE_RUN_LIMIT, MAX_PIPELINE_RUN_LIMIT);

  const rows = await db
    .select()
    .from(schema.pipelineRun)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(schema.pipelineRun.recordedAt))
    .limit(limit);

  return rows.map(toPipelineRunDTO);
}
