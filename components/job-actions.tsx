"use client"

import { useRef, useState, useTransition } from "react"
import { feedbackAction, saveInterpretationAction } from "@/app/actions"
import { useLocalAi } from "@/components/local-ai"
import { Button } from "@/components/ui/button"
import { buttonVariants } from "@/components/ui/button"
import { REJECTION_REASONS } from "@/lib/jobs/reasons"
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
  const [saving, setSaving] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [reasons, setReasons] = useState<string[]>([])
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const local = useLocalAi()
  const busy = pending || saving

  function act(action: "save" | "applied" | "restore") {
    start(async () => {
      await feedbackAction(jobId, action)
    })
  }

  function toggleReason(id: string) {
    setReasons((current) => (current.includes(id) ? current.filter((reason) => reason !== id) : [...current, id]))
  }

  async function hide() {
    if (reasons.length === 0) {
      setError("Choose at least one reason.")
      return
    }
    const chosen = reasons
    const text = note
    setError(null)
    setSaving(true)
    try {
      await feedbackAction(jobId, "not_interested", { reasons: chosen, note: text })
    } catch {
      setError("Open Desk could not hide that role.")
      setSaving(false)
      return
    }
    setSaving(false)
    dialogRef.current?.close()
    setReasons([])
    setNote("")
    if (!text.trim() || !local) return
    const reading = await local.interpretFeedback(text)
    if (!reading || !("positive_preferences" in reading.signals)) return
    await saveInterpretationAction({
      kind: "feedback",
      jobId,
      rawText: text,
      signals: reading.signals,
      modelId: reading.modelId,
      contentHash: reading.hash,
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <a href={applicationUrl} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "default" }))}>
          View job
        </a>
        <Button type="button" variant={saved ? "secondary" : "outline"} disabled={busy} aria-pressed={saved} onClick={() => act("save")}>
          {saved ? "Saved" : "Save"}
        </Button>
        <Button
          type="button"
          variant={applied ? "secondary" : "outline"}
          disabled={busy}
          aria-pressed={applied}
          onClick={() => act("applied")}
        >
          Applied
        </Button>
        {hidden ? (
          <Button type="button" variant="outline" disabled={busy} onClick={() => act("restore")}>
            Restore
          </Button>
        ) : (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => dialogRef.current?.showModal()}>
            Not interested
          </Button>
        )}
      </div>
      <dialog
        ref={dialogRef}
        className="w-[min(100%,28rem)] rounded-xl border bg-background p-4 text-foreground shadow-lg backdrop:bg-black/40"
        onClose={() => setError(null)}
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            hide()
          }}
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Why isn&apos;t this a fit?</legend>
            <p className="text-xs leading-5 text-muted-foreground">Choose at least one. Open Desk uses this to reorder later roles.</p>
            {REJECTION_REASONS.map((reason) => (
              <label key={reason.id} className="flex items-start gap-2 text-sm leading-5">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={reasons.includes(reason.id)}
                  onChange={() => toggleReason(reason.id)}
                />
                {reason.label}
              </label>
            ))}
          </fieldset>
          <label className="flex flex-col gap-1 text-sm">
            Note, optional
            <p className="text-xs leading-5 text-muted-foreground">
              Interpreted in this browser when local AI is available, then saved with this role. It is not sent to an AI
              service.
            </p>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              maxLength={1000}
              className="rounded-lg border border-border bg-background px-2 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
            />
          </label>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || reasons.length === 0}>
              Hide role
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setError(null)
                dialogRef.current?.close()
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      </dialog>
    </div>
  )
}
