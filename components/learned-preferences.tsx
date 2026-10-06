import { resetPreferencesAction } from "@/app/actions"
import { buttonVariants } from "@/components/ui/button"
import type { PreferenceSummary } from "@/lib/jobs/preferences"

export function LearnedPreferences({ summary }: { summary: PreferenceSummary }) {
  const empty = summary.boosting.length === 0 && summary.rankingDown.length === 0
  return (
    <details className="rounded-lg border px-3 py-2 text-sm leading-6">
      <summary className="cursor-pointer font-medium">What Open Desk is learning</summary>
      {empty ? (
        <p className="mt-2 text-muted-foreground">
          Nothing yet. Save, apply, and mark roles not interested, and this list will show what is moving up or down.
        </p>
      ) : (
        <div className="mt-2 flex flex-col gap-3">
          {summary.boosting.length > 0 ? (
            <section>
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Boosting</h3>
              <ul className="mt-1 list-disc pl-5">
                {summary.boosting.map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {summary.rankingDown.length > 0 ? (
            <section>
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Ranking down</h3>
              <ul className="mt-1 list-disc pl-5">
                {summary.rankingDown.map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
      <form action={resetPreferencesAction} className="mt-3 flex flex-col gap-1">
        <button type="submit" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Reset learned preferences
        </button>
        <p className="text-xs leading-5 text-muted-foreground">
          Clears ranking adjustments. Applied, saved, and hidden roles stay.
        </p>
      </form>
    </details>
  )
}
