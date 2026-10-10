import type { SecurityTargetFeedQuery } from "@web3-hunter/application";
import { Button } from "@web3-hunter/ui";

const FIELD_CLASS =
  "h-9 rounded-md border bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

interface SecurityTargetFiltersProps {
  defaultValues: Pick<SecurityTargetFeedQuery, "tier" | "readiness" | "sort">;
}

/**
 * A plain GET `<form>`, same pattern as `OpportunityFilters`: submitting
 * re-navigates `/security` with the chosen filters as URL search params,
 * which the feed page (a Server Component) reads directly. No hidden
 * `page` field, so any filter/sort change naturally resets to page 1.
 */
export function SecurityTargetFilters({ defaultValues }: SecurityTargetFiltersProps) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
      <Field label="Signal tier" htmlFor="tier">
        <select
          id="tier"
          name="tier"
          defaultValue={defaultValues.tier ?? ""}
          className={FIELD_CLASS}
        >
          <option value="">Any</option>
          <option value="A">A</option>
          <option value="B">B</option>
          <option value="C">C</option>
        </select>
      </Field>

      <Field label="Research readiness" htmlFor="readiness">
        <select
          id="readiness"
          name="readiness"
          defaultValue={defaultValues.readiness ?? ""}
          className={FIELD_CLASS}
        >
          <option value="">Any</option>
          <option value="ready">Ready to research</option>
          <option value="insufficient-evidence">Insufficient evidence</option>
          <option value="no-current-route">No current route</option>
        </select>
      </Field>

      <Field label="Sort by" htmlFor="sort">
        <select id="sort" name="sort" defaultValue={defaultValues.sort} className={FIELD_CLASS}>
          <option value="slug">Name</option>
          <option value="lastSignalAt">Last signal</option>
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
