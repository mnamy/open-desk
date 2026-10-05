"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

export function RunSearchButton() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [note, setNote] = useState<string | null>(null)

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <Button
        type="button"
        disabled={pending}
        onClick={() => {
          start(async () => {
            setNote(null)
            for (let pass = 0; pass < 500; pass += 1) {
              let response: Response
              try {
                response = await fetch("/api/search", { method: "POST" })
              } catch {
                setNote("This pass failed. Run search again to continue. Earlier passes are saved.")
                return
              }
              const body = (await response.json().catch(() => null)) as { done?: boolean; progress?: string } | null
              if (!response.ok || !body) {
                setNote(body?.progress ?? "This pass failed. Run search again to continue. Earlier passes are saved.")
                return
              }
              setNote(body.progress ?? null)
              if (body.done) break
            }
            router.refresh()
          })
        }}
      >
        {pending ? "Checking live sources…" : "Run search"}
      </Button>
      <p className="max-w-xs text-xs text-muted-foreground sm:text-right">
        {note ?? "Checks Greenhouse, Ashby, Lever, YC, and saved career pages in short passes. One source failing does not stop the rest."}
      </p>
    </div>
  )
}
