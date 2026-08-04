import type { OpportunityFeedQuery } from "@web3-hunter/application";
import { Button } from "@web3-hunter/ui";

const FIELD_CLASS =
  "h-9 rounded-md border bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

interface OpportunityFiltersProps {
  defaultValues: Pick<
    OpportunityFeedQuery,
    "status" | "opportunityType" | "minScore" | "sort" | "direction"
  >;
}

/**
 * A plain GET `<form>`: submitting re-navigates `/opportunities` with the
 * chosen filters as URL search params, which the feed page (a Server
 * Component) reads directly — no client-side state or JavaScript needed
 * for this to work.
 */
export function OpportunityFilters({ defaultValues }: OpportunityFiltersProps) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
      <Field label="Status" htmlFor="status">
        <select
          id="status"
          name="status"
          defaultValue={defaultValues.status ?? ""}
          className={FIELD_CLASS}
        >
          <option value="">Any</option>
          <option value="detected">Detected</option>
          <option value="scored">Scored</option>
        </select>
      </Field>

      <Field label="Opportunity type" htmlFor="opportunityType">
        <input
          id="opportunityType"
          type="text"
          name="opportunityType"
          defaultValue={defaultValues.opportunityType ?? ""}
          placeholder="e.g. engineering-hiring-surge"
          className={FIELD_CLASS}
        />
      </Field>

      <Field label="Min score" htmlFor="minScore">
        <input
          id="minScore"
          type="number"
          name="minScore"
          min={0}
          max={1}
          step={0.05}
          defaultValue={defaultValues.minScore ?? ""}
          className={`${FIELD_CLASS} w-24`}
        />
      </Field>

      <Field label="Sort by" htmlFor="sort">
        <select id="sort" name="sort" defaultValue={defaultValues.sort} className={FIELD_CLASS}>
          <option value="score">Score</option>
          <option value="relevance">Relevance to me</option>
          <option value="detectedAt">Detected date</option>
          <option value="scoredAt">Scored date</option>
        </select>
      </Field>

      <Field label="Direction" htmlFor="direction">
        <select
          id="direction"
          name="direction"
          defaultValue={defaultValues.direction}
          className={FIELD_CLASS}
        >
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </select>
      </Field>

      <Button type="submit">Apply filters</Button>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
