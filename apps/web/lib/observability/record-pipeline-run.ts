import { getDb, schema } from "@web3-hunter/db";

export type PipelineName =
  "scoring" | "classification" | "job-classification" | "technology" | "matching" | "decision";
export type PipelineRunScopeType = "company" | "user" | "opportunity";

export interface PipelineRunScope {
  pipelineName: PipelineName;
  scopeType: PipelineRunScopeType;
  scopeId: string;
}

/**
 * The single, generic instrumentation wrapper every pipeline-invoking
 * script (see `../../scripts/run-*.ts`) uses, per Milestone 10's
 * Definition of Ready: "existing pipelines should require only thin
 * instrumentation, not architectural rewrites." Every `run*Pipeline`
 * function in `packages/scoring`/`classification`/`technology`/
 * `matching`/`decision` is called completely unchanged — this only wraps
 * the call, it never alters what's called or how.
 *
 * Records exactly one `pipeline_run` row per invocation: on success, the
 * pipeline's own result object verbatim as `metrics`; on failure, the
 * error message, with the original error **re-thrown** afterward so every
 * calling script's existing per-entity error-isolation loop (the same
 * pattern `run-collector.ts` and every `run-*.ts` script already use)
 * keeps working exactly as it did before this milestone — instrumentation
 * observes failures, it never swallows them.
 *
 * Deliberately lives in `apps/web`, not a domain package: `packages/db`
 * stays schema-only (matching every other schema file), and
 * `packages/application` stays read-only (an existing, binding rule since
 * Milestone 4) — this is the one place both pipeline invocation and its
 * observability can legitimately meet, since `apps/web` is the
 * composition root per every prior milestone's architecture.
 */
export async function recordPipelineRun<T extends object>(
  scope: PipelineRunScope,
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = new Date();

  let result: T;
  try {
    result = await run();
  } catch (error) {
    const completedAt = new Date();
    await getDb()
      .insert(schema.pipelineRun)
      .values({
        pipelineName: scope.pipelineName,
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        status: "failed",
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        metrics: null,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    throw error;
  }

  const completedAt = new Date();
  await getDb()
    .insert(schema.pipelineRun)
    .values({
      pipelineName: scope.pipelineName,
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
      status: "succeeded",
      startedAt,
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      metrics: result,
      errorMessage: null,
    });

  return result;
}
