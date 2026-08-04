import { getCompanyProfile } from "@web3-hunter/application";
import { notFound } from "next/navigation";
import { CompanyProfileView } from "@/features/companies/components/company-profile-view";
import { getCurrentUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

interface CompanyProfilePageProps {
  params: Promise<{ slug: string }>;
}

export default async function CompanyProfilePage({ params }: CompanyProfilePageProps) {
  const { slug } = await params;
  const viewerId = await getCurrentUserId();
  const profile = await getCompanyProfile(slug, viewerId);

  if (!profile) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <CompanyProfileView profile={profile} />
    </main>
  );
}
