import { getUserProfileSummary, listSkills, TARGET_ROLES } from "@web3-hunter/application";
import { redirect } from "next/navigation";
import { AIContentSection } from "@/features/ai/components/ai-content-section";
import { ProfileForm } from "@/features/profile/components/profile-form";
import { getCurrentUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const userId = await getCurrentUserId();
  if (!userId) {
    redirect("/sign-in");
  }

  const [allSkills, profileSummary] = await Promise.all([
    listSkills(),
    getUserProfileSummary(userId),
  ]);

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-10">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Your Profile</h1>
        <p className="text-muted-foreground">
          Deterministic, explainable Matches — the same evidence-based approach used for Company
          Intelligence.
        </p>
      </div>
      <ProfileForm
        allSkills={allSkills}
        currentSkillIds={profileSummary?.skills.map((skill) => skill.id) ?? []}
        currentDealBreakerSkillIds={
          profileSummary?.dealBreakerSkills.map((skill) => skill.id) ?? []
        }
        targetRoles={Object.entries(TARGET_ROLES).map(([slug, role]) => ({
          slug,
          name: role.name,
        }))}
        currentTargetRoleSlugs={profileSummary?.targetRoles.map((role) => role.slug) ?? []}
        currentRemotePreference={profileSummary?.remotePreference ?? null}
        currentLocationConstraint={profileSummary?.locationConstraint ?? null}
        currentSeniorityPreference={profileSummary?.seniorityPreference ?? []}
      />
      {profileSummary && (
        <AIContentSection
          title="AI Profile Insight"
          endpoint="/api/profile/insight"
          initialArtifact={profileSummary.aiInsight}
        />
      )}
    </main>
  );
}
