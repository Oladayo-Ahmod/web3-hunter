"use client";

import type { SkillDTO, UserProfileSummaryDTO } from "@web3-hunter/application";
import { Button } from "@web3-hunter/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

const FIELD_CLASS =
  "h-9 rounded-md border bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

const SENIORITY_OPTIONS = ["junior", "mid", "senior"] as const;

interface ProfileFormProps {
  allSkills: SkillDTO[];
  currentSkillIds: string[];
  currentDealBreakerSkillIds: string[];
  /**
   * The full `TARGET_ROLES` vocabulary, pre-resolved to plain `{slug,
   * name}` pairs by the Server Component parent — never imported as a
   * value here. `TARGET_ROLES` lives in `@web3-hunter/application`,
   * whose barrel also re-exports DB-backed query services; a Client
   * Component importing *any* value (not just a type) from that barrel
   * pulls the whole module graph — including `postgres` and `node:crypto`
   * — into the browser bundle, which `next build` refuses to compile.
   * `import type` elsewhere in this file is exactly why those imports
   * stay safe and this one didn't.
   */
  targetRoles: { slug: string; name: string }[];
  currentTargetRoleSlugs: string[];
  currentRemotePreference: UserProfileSummaryDTO["remotePreference"];
  currentLocationConstraint: string | null;
  currentSeniorityPreference: string[];
}

export function ProfileForm({
  allSkills,
  currentSkillIds,
  currentDealBreakerSkillIds,
  targetRoles,
  currentTargetRoleSlugs,
  currentRemotePreference,
  currentLocationConstraint,
  currentSeniorityPreference,
}: ProfileFormProps) {
  const router = useRouter();
  const [skillIds, setSkillIds] = useState<Set<string>>(new Set(currentSkillIds));
  const [dealBreakerSkillIds, setDealBreakerSkillIds] = useState<Set<string>>(
    new Set(currentDealBreakerSkillIds),
  );
  const [targetRoleSlugs, setTargetRoleSlugs] = useState<Set<string>>(
    new Set(currentTargetRoleSlugs),
  );
  const [remotePreference, setRemotePreference] = useState(currentRemotePreference ?? "");
  const [locationConstraint, setLocationConstraint] = useState(currentLocationConstraint ?? "");
  const [seniorityPreference, setSeniorityPreference] = useState<Set<string>>(
    new Set(currentSeniorityPreference),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(set: Set<string>, setSet: (next: Set<string>) => void, id: string) {
    const next = new Set(set);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSet(next);
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const response = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        skillIds: [...skillIds],
        dealBreakerSkillIds: [...dealBreakerSkillIds],
        targetRoleSlugs: [...targetRoleSlugs],
        remotePreference: remotePreference || null,
        locationConstraint: locationConstraint.trim() || null,
        seniorityPreference: [...seniorityPreference],
      }),
    });

    setSubmitting(false);

    if (!response.ok) {
      setError("Could not save your Profile. Please try again.");
      return;
    }

    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-lg font-medium">Your Skills</h2>
        <p className="text-sm text-muted-foreground">
          Used to compute your Match with each Opportunity and Job.
        </p>
        <SkillChecklist
          skills={allSkills}
          selected={skillIds}
          onToggle={(id) => toggle(skillIds, setSkillIds, id)}
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Deal-breaker Skills</h2>
        <p className="text-sm text-muted-foreground">
          Opportunities tagged with any of these are excluded from your Matches entirely.
        </p>
        <SkillChecklist
          skills={allSkills}
          selected={dealBreakerSkillIds}
          onToggle={(id) => toggle(dealBreakerSkillIds, setDealBreakerSkillIds, id)}
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Target Roles</h2>
        <p className="text-sm text-muted-foreground">
          Used for Job relevance scoring — matched against each posting&apos;s title. Leave empty to
          skip this component of the score entirely, rather than penalize every Job for it.
        </p>
        <div className="grid max-h-48 grid-cols-1 gap-2 overflow-y-auto rounded-lg border p-4 sm:grid-cols-2">
          {targetRoles.map((role) => (
            <label key={role.slug} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={targetRoleSlugs.has(role.slug)}
                onChange={() => toggle(targetRoleSlugs, setTargetRoleSlugs, role.slug)}
              />
              {role.name}
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Remote Preference</h2>
        <select
          value={remotePreference}
          onChange={(event) => setRemotePreference(event.target.value)}
          className={FIELD_CLASS}
        >
          <option value="">No preference</option>
          <option value="remote_only">Remote only</option>
          <option value="remote_friendly">Remote-friendly (remote or hybrid)</option>
        </select>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Location Constraint</h2>
        <input
          type="text"
          value={locationConstraint}
          onChange={(event) => setLocationConstraint(event.target.value)}
          placeholder="e.g. Worldwide, USA, EU"
          className={`${FIELD_CLASS} w-64`}
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Seniority Preference</h2>
        <div className="flex gap-4">
          {SENIORITY_OPTIONS.map((level) => (
            <label key={level} className="flex items-center gap-2 text-sm capitalize">
              <input
                type="checkbox"
                checked={seniorityPreference.has(level)}
                onChange={() => toggle(seniorityPreference, setSeniorityPreference, level)}
              />
              {level}
            </label>
          ))}
        </div>
      </section>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={submitting}>
        Save Profile
      </Button>
    </form>
  );
}

function SkillChecklist({
  skills,
  selected,
  onToggle,
}: {
  skills: SkillDTO[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto rounded-lg border p-4 sm:grid-cols-3">
      {skills.map((skill) => (
        <label key={skill.id} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={selected.has(skill.id)}
            onChange={() => onToggle(skill.id)}
          />
          {skill.name}
        </label>
      ))}
    </div>
  );
}
