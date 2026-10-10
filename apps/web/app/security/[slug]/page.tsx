import { getSecurityTargetPriorityBySlug } from "@web3-hunter/application";
import { notFound } from "next/navigation";
import { SecurityTargetDetailView } from "@/features/security/components/security-target-detail-view";

export const dynamic = "force-dynamic";

interface SecurityTargetDetailPageProps {
  params: Promise<{ slug: string }>;
}

export default async function SecurityTargetDetailPage({ params }: SecurityTargetDetailPageProps) {
  const { slug } = await params;
  const target = await getSecurityTargetPriorityBySlug(slug);

  if (!target) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <SecurityTargetDetailView target={target} />
    </main>
  );
}
