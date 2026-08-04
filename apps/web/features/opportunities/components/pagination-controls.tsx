import { buttonVariants, cn } from "@web3-hunter/ui";
import Link from "next/link";

interface PaginationControlsProps {
  page: number;
  totalPages: number;
  buildHref: (page: number) => string;
}

export function PaginationControls({ page, totalPages, buildHref }: PaginationControlsProps) {
  if (totalPages <= 1) {
    return null;
  }

  const hasPrevious = page > 1;
  const hasNext = page < totalPages;

  return (
    <nav className="flex items-center justify-center gap-4" aria-label="Pagination">
      <PageLink label="Previous" href={hasPrevious ? buildHref(page - 1) : undefined} />
      <span className="text-sm text-muted-foreground">
        Page {page} of {totalPages}
      </span>
      <PageLink label="Next" href={hasNext ? buildHref(page + 1) : undefined} />
    </nav>
  );
}

function PageLink({ label, href }: { label: string; href: string | undefined }) {
  const className = cn(buttonVariants({ variant: "outline" }));

  if (!href) {
    return (
      <span className={cn(className, "pointer-events-none opacity-50")} aria-disabled="true">
        {label}
      </span>
    );
  }

  return (
    <Link href={href} className={className}>
      {label}
    </Link>
  );
}
