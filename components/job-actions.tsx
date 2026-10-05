"use client"

import { useTransition } from "react"
import { feedbackAction } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "cn"

export function JobActions({
  jobId,
  applicationUrl,
  saved,
  applied,
  hidden,
}: {
  jobId: string
  applicationUrl: string
  saved: boolean
  applied: boolean
  hidden: boolean
}) {
  const [pending, start] = useTransition()

  function act(action: "save" | "applied" | "not_interested" | "restore") {
    start(async () => {
      await feedbackAction(jobId, action)
    })
  }

  return (
    <div className="flex flex-wrap gap-2">
      <a
        href={applicationUrl}
        target="_blank"
        rel="noreferrer"
        className={cn(buttonVariants({ variant: "default" }))}
      >
        View job
      </a>
      <Button type="button" variant={saved ? "secondary" : "outline"} disabled={pending} aria-pressed={saved} onClick={() => act("save")}>
        {saved ? "Saved" : "Save"}
      </Button>
      <Button
        type="button"
        variant={applied ? "secondary" : "outline"}
        disabled={pending}
        aria-pressed={applied}
        onClick={() => act("applied")}
      >
        Applied
      </Button>
      {hidden ? (
        <Button type="button" variant="outline" disabled={pending} onClick={() => act("restore")}>
          Restore
        </Button>
      ) : (
        <Button type="button" variant="ghost" disabled={pending} onClick={() => act("not_interested")}>
          Not interested
        </Button>
      )}
    </div>
  )
}
