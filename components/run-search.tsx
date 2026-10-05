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
        {pending ? "Checking the imported set…" : "Run search"}
      </Button>
      <p className="max-w-xs text-xs text-muted-foreground sm:text-right">
        Re-reads the imported set and flags roles that were not here before. Nothing is crawled.
      </p>
    </div>
  )
}
