"use client";

import type { RecommendationStatusDTO } from "@web3-hunter/application";
import { Button } from "@web3-hunter/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface RecommendationActionsProps {
  recommendationId: string;
  status: RecommendationStatusDTO;
}

/** Dismiss/archive/restore — deterministic Recommendation state changes only, per docs/ROADMAP.md Milestone 6. */
export function RecommendationActions({ recommendationId, status }: RecommendationActionsProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function act(action: "dismiss" | "archive" | "restore") {
    setSubmitting(true);
    await fetch(`/api/recommendations/${recommendationId}/${action}`, { method: "POST" });
    setSubmitting(false);
    router.refresh();
  }

  if (status === "expired") {
    return <span className="text-xs text-muted-foreground">Expired</span>;
  }

  return (
    <div className="flex gap-2">
      {status === "active" && (
        <>
          <Button size="sm" variant="outline" disabled={submitting} onClick={() => act("dismiss")}>
            Dismiss
          </Button>
          <Button size="sm" variant="outline" disabled={submitting} onClick={() => act("archive")}>
            Archive
          </Button>
        </>
      )}
      {(status === "dismissed" || status === "archived") && (
        <Button size="sm" variant="outline" disabled={submitting} onClick={() => act("restore")}>
          Restore
        </Button>
      )}
    </div>
  );
}
