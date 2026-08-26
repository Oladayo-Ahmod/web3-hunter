// Re-exported so Collectors — which depend on `packages/ingestion` but,
// per docs/ARCHITECTURE.md §3, never depend on `packages/events` directly
// — can still register their own canonical Event Types. This changes
// nothing about the registry itself (see @web3-hunter/events/registry.ts);
// it's a facade, not a second implementation.
export { registerEventType, type EventTypeDefinition } from "@web3-hunter/events";

export { hashContent } from "./content-hash";
export { deriveEventId } from "./deterministic-id";
export type { NormalizedEvent, Normalizer, NormalizerInput } from "./normalizer";
export {
  reconcileMissingRecords,
  runIngestionPipeline,
  type IngestionPipelineResult,
  type ReconcileMissingRecordsInput,
  type RunIngestionPipelineInput,
} from "./run-ingestion-pipeline";
export {
  storeRawRecord,
  storeRawRecords,
  type RawRecord,
  type StoreRawRecordInput,
} from "./store-raw-record";
