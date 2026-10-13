import { listSecurityDisclosureDiscoveryCandidates } from "@web3-hunter/application";
import { runSecurityDisclosureCollector } from "../lib/collectors/run-security-disclosure";

/**
 * The "simplest viable" trigger for the Security Disclosure Collector,
 * per the same on-a-schedule pattern `collect:immunefi`/`collect:github`
 * use. Candidates come from `listSecurityDisclosureDiscoveryCandidates`
 * — every existing Security Target's already-resolved
 * `identity.websiteUrl`/`repositoryUrl`, never a hardcoded list.
 *
 *   pnpm --filter @web3-hunter/web exec tsx scripts/run-security-disclosure.ts
 */
async function main() {
  const candidates = await listSecurityDisclosureDiscoveryCandidates();
  const result = await runSecurityDisclosureCollector(candidates);

  const published = result.checks.filter((check) => check.status === "published").length;
  const skipped = result.checks.filter((check) => check.status === "skipped").length;
  const errors = result.checks.filter((check) => check.status === "error");

  console.log(
    `[security-disclosure] ${candidates.length} candidate(s), ` +
      `${result.skippedNoCandidateRoute} with no checkable route, ` +
      `${result.checks.length} check(s) attempted: ${published} published, ${skipped} skipped, ` +
      `${errors.length} error(s).`,
  );
  for (const error of errors) {
    console.error(
      `[security-disclosure] ${error.securityTargetId} (${error.routeType}): ${error.message}`,
    );
  }

  if (errors.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    console.error("[security-disclosure] Fatal error running the collector:", error);
    process.exit(1);
  });
