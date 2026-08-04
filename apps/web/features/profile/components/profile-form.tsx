"use client";

import type { SkillDTO } from "@web3-hunter/application";
import { Button } from "@web3-hunter/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface ProfileFormProps {
  allSkills: SkillDTO[];
  currentSkillIds: string[];
  currentDealBreakerSkillIds: string[];
}

export function ProfileForm({
  allSkills,
  currentSkillIds,
  currentDealBreakerSkillIds,
}: ProfileFormProps) {
  const router = useRouter();
  const [skillIds, setSkillIds] = useState<Set<string>>(new Set(currentSkillIds));
  const [dealBreakerSkillIds, setDealBreakerSkillIds] = useState<Set<string>>(
    new Set(currentDealBreakerSkillIds),
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
          Used to compute your Match with each Opportunity.
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
