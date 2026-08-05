"use client";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@web3-hunter/ui";
import { useState } from "react";

export interface AIContentArtifact {
  content: string;
  version: number;
  generatedAt: string;
}

interface AIContentSectionProps {
  title: string;
  /** The POST route that generates (or returns the cached) artifact. */
  endpoint: string;
  initialArtifact: AIContentArtifact | null;
}

/**
 * A reusable "AI-generated" content block, per Milestone 7's requirement
 * that AI content is always visually distinguishable from deterministic
 * system facts (the "AI-generated" Badge) and always user-triggered,
 * never automatic (a Generate/Regenerate button, never fired on mount).
 * If nothing has been generated yet — or AI is unavailable entirely —
 * this renders a plain "not yet generated" state; nothing else on the
 * page depends on it.
 */
export function AIContentSection({ title, endpoint, initialArtifact }: AIContentSectionProps) {
  const [artifact, setArtifact] = useState(initialArtifact);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    const response = await fetch(endpoint, { method: "POST" });
    if (!response.ok) {
      setError(
        response.status === 503
          ? "AI is not currently available."
          : "Could not generate this right now.",
      );
      setLoading(false);
      return;
    }
    setArtifact((await response.json()) as AIContentArtifact);
    setLoading(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>{title}</span>
          {artifact && <Badge variant="secondary">AI-generated</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {artifact ? (
          <p>{artifact.content}</p>
        ) : (
          <p className="text-muted-foreground">Not yet generated.</p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button size="sm" variant="outline" disabled={loading} onClick={() => void generate()}>
          {loading ? "Generating..." : artifact ? "Regenerate" : `Generate ${title}`}
        </Button>
      </CardContent>
    </Card>
  );
}
