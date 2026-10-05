"use client"

import { useTransition } from "react"
import { runSearchAction } from "@/app/actions"
import { Button } from "@/components/ui/button"

export function RunSearchButton() {
  const [pending, start] = useTransition()

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <Button
        type="button"
        disabled={pending}
        onClick={() => {
          start(async () => {
            await runSearchAction()
          })
        }}
      >
        {pending ? "Checking live sources…" : "Run search"}
      </Button>
      <p className="max-w-xs text-xs text-muted-foreground sm:text-right">
        Checks Greenhouse, Ashby, Lever, YC, and saved career pages. One source failing does not stop the rest.
      </p>
    </div>
  )
}
