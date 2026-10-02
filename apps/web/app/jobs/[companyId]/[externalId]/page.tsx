import { getJobDetail } from "@web3-hunter/application";
import { notFound } from "next/navigation";
import { JobDetailView } from "@/features/jobs/components/job-detail-view";
import { getCurrentUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

interface JobDetailPageProps {
  params: Promise<{ companyId: string; externalId: string }>;
}

export default async function JobDetailPage({ params }: JobDetailPageProps) {
  const { companyId, externalId } = await params;
  const viewerId = await getCurrentUserId();
  const job = await getJobDetail(companyId, externalId, viewerId);

  if (!job) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <JobDetailView job={job} />
    </main>
  );
}
