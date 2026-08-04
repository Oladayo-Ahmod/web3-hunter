import { getOpportunityDetail } from "@web3-hunter/application";
import { notFound } from "next/navigation";
import { OpportunityDetailView } from "@/features/opportunities/components/opportunity-detail-view";
import { getCurrentUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

interface OpportunityDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function OpportunityDetailPage({ params }: OpportunityDetailPageProps) {
  const { id } = await params;
  const viewerId = await getCurrentUserId();
  const opportunity = await getOpportunityDetail(id, viewerId);

  if (!opportunity) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <OpportunityDetailView opportunity={opportunity} />
    </main>
  );
}
