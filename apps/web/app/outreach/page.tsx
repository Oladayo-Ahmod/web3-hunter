import {
  listOutreachTargets,
  type OpportunityTypeDTO,
  type OutreachTargetDTO,
} from "@web3-hunter/application";
import Link from "next/link";
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
    title: "Open Role — Apply",
    blurb: "Apply directly — these companies have a live posting right now.",
  },
  {
    type: "HIGH_PRIORITY_STARTUP",
    emoji: "🔥",
    title: "High Priority — Contact Now",
    blurb: "No open role yet, but worth a direct message to the founder or CTO today.",
  },
  {
    type: "RECENTLY_FUNDED",
    emoji: "🚀",
    title: "Recently Funded — Contact",
    blurb: "A verified, timely funding event — good odds hiring follows soon.",
  },
  {
    type: "SPECULATIVE_OUTREACH",
    emoji: "📨",
    title: "Active Web3 Startup — Proactive Outreach",
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

const CATEGORY_LABEL: Record<string, string> = {
  security: "Security / Audit",
  defi: "Protocol / DeFi",
  infrastructure: "Infra / Tooling",
  l1: "L1",
  l2: "L2",
  wallet: "Wallet / AA",
  ai: "AI",
  gaming: "Gaming",
  other: "Other",
};

/**
 * A plain per-category count strip, not a filter UI of its own logic —
 * Milestone 18 §2's "fix the category distribution" is a *data* fix
 * (the curated directory itself), but making the resulting mix visible
 * at a glance is what lets the user actually confirm it worked, and
 * doubles as a same-page filter (`?category=`) with zero new state
 * management (a plain link, server-rendered).
 */
function CategoryBar({
  targets,
  activeCategory,
}: {
  targets: readonly OutreachTargetDTO[];
  activeCategory: string | undefined;
}) {
  const counts = new Map<string, number>();
  for (const target of targets) {
    const key = target.category ?? "other";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const categories = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex flex-wrap gap-2 text-sm">
      <Link
        href="/outreach"
        className={
          activeCategory
            ? "rounded-full border px-3 py-1 text-muted-foreground hover:text-foreground"
            : "rounded-full border border-primary bg-primary px-3 py-1 text-primary-foreground"
        }
      >
        All ({targets.length})
      </Link>
      {categories.map(([category, count]) => (
        <Link
          key={category}
          href={`/outreach?category=${category}`}
          className={
            activeCategory === category
              ? "rounded-full border border-primary bg-primary px-3 py-1 text-primary-foreground"
              : "rounded-full border px-3 py-1 text-muted-foreground hover:text-foreground"
          }
        >
          {CATEGORY_LABEL[category] ?? category} ({count})
        </Link>
      ))}
    </div>
  );
}

interface OutreachPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function OutreachPage({ searchParams }: OutreachPageProps) {
  const rawParams = await searchParams;
  const categoryParam =
    typeof rawParams.category === "string" && rawParams.category.length > 0
      ? rawParams.category
      : undefined;

  const allTargets = await listOutreachTargets();
  const targets = categoryParam
    ? allTargets.filter((target) => (target.category ?? "other") === categoryParam)
    : allTargets;
  const grouped = groupByOpportunityType(targets);

  return (
    <main className="mx-auto max-w-6xl space-y-10 px-6 py-10">
      <div className="space-y-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Who to Contact Today</h1>
          <p className="text-muted-foreground">
            {allTargets.length} verified Web3-native companies — open roles to apply to, and
            founders/CTOs/security leads worth a direct message.
          </p>
        </div>
        <CategoryBar targets={allTargets} activeCategory={categoryParam} />
      </div>

      {targets.length === 0 && (
        <p className="text-muted-foreground">No companies match this category yet.</p>
      )}

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
