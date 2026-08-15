import { getTodayDigest } from "@web3-hunter/application";
import { OutreachTargetCard } from "@/features/outreach/components/outreach-target-card";
import { TodayApplyJobRow } from "@/features/today/components/today-apply-job-row";
import { getCurrentUserId } from "@/lib/session";

// Today's digest reflects live seeded/collected data; it must never be
// served from a build-time snapshot (same reasoning as `/jobs`/`/outreach`).
export const dynamic = "force-dynamic";

/**
 * Milestone 19's actual product: "what should I do today," answered in
 * three short, already-ranked lists rather than a browsable database. A
 * thin Server Component over `getTodayDigest` — all ranking/filtering
 * lives there, this just renders it (docs/ARCHITECTURE.md §9's
 * Server-Component-calls-Application-Layer-directly convention).
 */
export default async function TodayPage() {
  const viewerId = await getCurrentUserId();
  const digest = await getTodayDigest(viewerId);

  return (
    <main className="mx-auto max-w-4xl space-y-10 px-6 py-10">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">What To Do Today</h1>
        <p className="text-muted-foreground">
          {digest.applyJobs.length} jobs to apply to, {digest.dmTargets.length} companies to DM,{" "}
          {digest.researchTargets.length} worth a closer look — work top to bottom.
        </p>
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            💼 Apply ({digest.applyJobs.length})
          </h2>
          <p className="text-sm text-muted-foreground">
            Fresh roles at startup-priority Web3 companies — click through and apply.
          </p>
        </div>
        {digest.applyJobs.length === 0 ? (
          <p className="text-muted-foreground">
            No fresh startup roles right now — check back soon.
          </p>
        ) : (
          <div className="space-y-2">
            {digest.applyJobs.map((job) => (
              <TodayApplyJobRow key={job.id} job={job} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            📨 DM ({digest.dmTargets.length})
          </h2>
          <p className="text-sm text-muted-foreground">
            No open role, but worth a direct message today — funded and high-priority startups
            first.
          </p>
        </div>
        {digest.dmTargets.length === 0 ? (
          <p className="text-muted-foreground">Nothing new to DM right now.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {digest.dmTargets.map((target) => (
              <OutreachTargetCard key={target.id} target={target} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            🔎 Research ({digest.researchTargets.length})
          </h2>
          <p className="text-sm text-muted-foreground">
            Verified Web3 startups worth investigating before you reach out.
          </p>
        </div>
        {digest.researchTargets.length === 0 ? (
          <p className="text-muted-foreground">Nothing new to research right now.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {digest.researchTargets.map((target) => (
              <OutreachTargetCard key={target.id} target={target} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
