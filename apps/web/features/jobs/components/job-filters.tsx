import { TARGET_ROLES, type JobFeedQuery } from "@web3-hunter/application";
import { Button } from "@web3-hunter/ui";

const FIELD_CLASS =
  "h-9 rounded-md border bg-background px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

interface JobFiltersProps {
  defaultValues: Pick<
    JobFeedQuery,
    | "search"
    | "sort"
    | "direction"
    | "freshness"
    | "includeStale"
    | "workplaceType"
    | "role"
    | "minMatch"
  >;
  /** Relevance-dependent controls (sort by match, minimum match) only make sense with a signed-in viewer — `job-query-service.ts` has nothing to score against otherwise. */
  showRelevanceControls: boolean;
}

/**
 * A plain GET `<form>`, same pattern as `OpportunityFilters` — no
 * client-side state needed. `search` is a title keyword match; `role`
 * pre-filters by one `TARGET_ROLES` slug's title keywords (a coarser,
 * always-available filter, distinct from the per-viewer relevance score).
 */
export function JobFilters({ defaultValues, showRelevanceControls }: JobFiltersProps) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
      <Field label="Search title" htmlFor="search">
        <input
          id="search"
          type="text"
          name="search"
          defaultValue={defaultValues.search ?? ""}
          placeholder="e.g. Solidity, security, protocol"
          className={`${FIELD_CLASS} w-64`}
        />
      </Field>

      <Field label="Role" htmlFor="role">
        <select
          id="role"
          name="role"
          defaultValue={defaultValues.role ?? ""}
          className={FIELD_CLASS}
        >
          <option value="">Any role</option>
          {Object.entries(TARGET_ROLES).map(([slug, role]) => (
            <option key={slug} value={slug}>
              {role.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Workplace" htmlFor="workplaceType">
        <select
          id="workplaceType"
          name="workplaceType"
          defaultValue={defaultValues.workplaceType ?? ""}
          className={FIELD_CLASS}
        >
          <option value="">Any</option>
          <option value="remote">Remote</option>
          <option value="hybrid">Hybrid</option>
          <option value="onsite">Onsite</option>
        </select>
      </Field>

      <Field label="Freshness" htmlFor="freshness">
        <select
          id="freshness"
          name="freshness"
          defaultValue={defaultValues.freshness ?? ""}
          className={FIELD_CLASS}
        >
          <option value="">Fresh, recent & aging (default)</option>
          <option value="fresh">Fresh only (updated ≤7d)</option>
          <option value="recent">Recent only (8-30d)</option>
          <option value="aging">Aging only (31-60d)</option>
          <option value="stale">Stale only (60d+)</option>
        </select>
      </Field>

      <Field label="Sort by" htmlFor="sort">
        <select id="sort" name="sort" defaultValue={defaultValues.sort} className={FIELD_CLASS}>
          {showRelevanceControls && <option value="relevance">Best match</option>}
          <option value="postedAt">Newest</option>
          <option value="title">Title</option>
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

      {showRelevanceControls && (
        <Field label="Minimum match %" htmlFor="minMatch">
          <input
            id="minMatch"
            type="number"
            name="minMatch"
            min={0}
            max={100}
            step={5}
            defaultValue={defaultValues.minMatch ?? ""}
            placeholder="e.g. 40"
            className={`${FIELD_CLASS} w-28`}
          />
        </Field>
      )}

      <label className="flex items-center gap-2 pb-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          name="includeStale"
          value="true"
          defaultChecked={defaultValues.includeStale}
        />
        Include stale (60d+) postings
      </label>

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
