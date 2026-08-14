import {
  listOutreachTargets,
  type OpportunityTypeDTO,
  type OutreachTargetDTO,
} from "@web3-hunter/application";
import { OutreachTargetCard } from "@/features/outreach/components/outreach-target-card";

// Outreach data reflects live seeded/collected Company data; it must
// never be served from a build-time snapshot (same reasoning as
// `/jobs` — see that page's own `dynamic` export).
export const dynamic = "force-dynamic";

/**
 * Milestone 17's answer to "who should I contact today" — four
 * actionable sections, each grouping every curated Company by the single
 * strongest reason to reach out (`OutreachTargetDTO.opportunityType`, see
 * `outreach-query-service.ts`'s fixed precedence). Section order here is
 * the priority order a job hunt should actually work in: an open role is
 * the fastest win, so it leads; a hand-flagged high-priority startup with
 * no open role yet is worth a founder DM next; a stated funding round is
 * a timely reason to reach out; everything else curated is still a
 * legitimate speculative outreach target.
 */
const SECTIONS: { type: OpportunityTypeDTO; emoji: string; title: string; blurb: string }[] = [
  {
    type: "OPEN_ROLE",
    emoji: "💼",
    title: "Open Roles",
    blurb: "Apply directly — these companies have a live posting right now.",
  },
  {
    type: "HIGH_PRIORITY_STARTUP",
    emoji: "🔥",
    title: "High Priority Outreach",
    blurb: "No open role yet, but worth a direct message to the founder or CTO today.",
  },
  {
    type: "RECENTLY_FUNDED",
    emoji: "🚀",
    title: "Recently Funded",
    blurb: "A funding signal worth a timely, congratulatory outreach.",
  },
  {
    type: "SPECULATIVE_OUTREACH",
    emoji: "📨",
    title: "Speculative Outreach",
    blurb: "Verified Web3-native companies worth introducing yourself to.",
  },
];

function groupByOpportunityType(
  targets: readonly OutreachTargetDTO[],
): Record<OpportunityTypeDTO, OutreachTargetDTO[]> {
  const grouped: Record<OpportunityTypeDTO, OutreachTargetDTO[]> = {
    OPEN_ROLE: [],
    HIGH_PRIORITY_STARTUP: [],
    RECENTLY_FUNDED: [],
    SPECULATIVE_OUTREACH: [],
  };
  for (const target of targets) {
    grouped[target.opportunityType].push(target);
  }
  return grouped;
}

export default async function OutreachPage() {
  const targets = await listOutreachTargets();
  const grouped = groupByOpportunityType(targets);

  return (
    <main className="mx-auto max-w-6xl space-y-10 px-6 py-10">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Who to Contact Today</h1>
        <p className="text-muted-foreground">
          {targets.length} verified Web3-native companies — open roles to apply to, and founders/
          CTOs/security leads worth a direct message.
        </p>
      </div>

      {SECTIONS.map((section) => {
        const items = grouped[section.type];
        if (items.length === 0) {
          return null;
        }
        return (
          <section key={section.type} className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">
                {section.emoji} {section.title} ({items.length})
              </h2>
              <p className="text-sm text-muted-foreground">{section.blurb}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((target) => (
                <OutreachTargetCard key={target.id} target={target} />
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}
