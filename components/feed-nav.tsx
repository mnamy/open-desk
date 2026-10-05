import Link from "next/link"
import { cn } from "cn"
import { FEEDS, type FeedId } from "@/lib/jobs/feeds"

export function FeedNav({
  feed,
  counts,
  query,
}: {
  feed: FeedId
  counts: Record<FeedId, number>
  query: string
}) {
  return (
    <nav aria-label="Feeds" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {FEEDS.map((item) => {
        const params = new URLSearchParams(query)
        if (item.id === "top") params.delete("feed")
        else params.set("feed", item.id)
        const href = params.size ? `/?${params.toString()}` : "/"
        const active = item.id === feed
        return (
          <Link
            key={item.id}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-foreground hover:bg-muted",
            )}
          >
            {item.label}
            <span className={cn("text-xs", active ? "text-primary-foreground/80" : "text-muted-foreground")}>
              {counts[item.id]}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}
