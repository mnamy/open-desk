import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { JobActions } from "@/components/job-actions"
import type { CardModel } from "@/lib/jobs/view"

function riskClass(risk: string | null): string {
  if (risk === "LOW") return "border-transparent bg-emerald-100 text-emerald-950"
  if (risk === "MEDIUM") return "border-transparent bg-amber-100 text-amber-950"
  if (risk === "HIGH") return "border-transparent bg-rose-100 text-rose-950"
  return ""
}

function riskLabel(risk: string | null): string | null {
  if (risk === "LOW") return "Low risk"
  if (risk === "MEDIUM") return "Medium risk"
  if (risk === "HIGH") return "High risk"
  return risk
}

export function JobCard({ job }: { job: CardModel }) {
  const risk = riskLabel(job.risk)

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-heading text-4xl leading-none text-primary">{job.fit ?? "—"}</p>
          {risk ? (
            <Badge variant="outline" className={riskClass(job.risk)}>
              {risk}
            </Badge>
          ) : null}
          {job.isNew ? <Badge variant="secondary">New</Badge> : null}
          <Badge variant="outline">{job.sample ? "Sample" : "Live"}</Badge>
          {job.sourceBadges.map((source) => (
            <Badge key={source} variant="secondary">
              {source}
            </Badge>
          ))}
        </div>
        <div>
          <CardTitle className="font-heading text-2xl leading-tight">{job.title}</CardTitle>
          <p className="mt-1 text-base">{job.companyName}</p>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm leading-6 text-muted-foreground">
          {job.city} · {job.arrangement} · {job.experienceLabel} · {job.roleFamily}
        </p>
        <p className="text-sm leading-6">
          {job.postedLine}
          {job.discoveredLine ? <span className="text-muted-foreground"> · {job.discoveredLine}</span> : null}
        </p>
        {job.arrangementNote ? <p className="text-sm leading-6 text-muted-foreground">{job.arrangementNote}</p> : null}
        <section>
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Why it matches</h3>
          <p className="mt-1 text-sm leading-6">{job.whyMatch}</p>
        </section>
        <section>
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Possible stretch</h3>
          <p className="mt-1 text-sm leading-6">{job.stretchReason}</p>
        </section>
      </CardContent>
      <CardFooter className="flex-wrap">
        <JobActions
          jobId={job.id}
          applicationUrl={job.applicationUrl}
          saved={job.saved}
          applied={job.applied}
          hidden={job.hidden}
        />
      </CardFooter>
    </Card>
  )
}
