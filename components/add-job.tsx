"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { commitExternalJob, previewExternalJob } from "@/app/actions"
import { Button } from "@/components/ui/button"
import type { ManualJobDraft } from "@/lib/jobs/external-url"

const fieldClass =
  "h-9 w-full rounded-lg border border-border bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"

type Stage =
  | { name: "url" }
  | { name: "ready"; title: string; company: string; location: string; source: string }
  | { name: "manual"; draft: ManualJobDraft }
  | { name: "done"; message: string }

export function AddJobButton() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState("")
  const [stage, setStage] = useState<Stage>({ name: "url" })
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setUrl("")
    setStage({ name: "url" })
    setError(null)
    setOpen(false)
  }

  function lookUp() {
    setError(null)
    start(async () => {
      const result = await previewExternalJob(url)
      if (!result.ok) {
        setError(result.message)
        return
      }
      if (result.mode === "ready") {
        setStage({ name: "ready", title: result.title, company: result.company, location: result.location, source: result.source })
        return
      }
      setStage({ name: "manual", draft: result.draft })
    })
  }

  function commit(action: "applied" | "save" | "desk", manual?: ManualJobDraft) {
    setError(null)
    start(async () => {
      const result = await commitExternalJob({ url: manual?.url || url, action, manual })
      if (!result.ok) {
        setError(result.message)
        if (result.message.includes("could not read")) {
          const preview = await previewExternalJob(url)
          if (preview.ok && preview.mode === "manual") setStage({ name: "manual", draft: preview.draft })
        }
        return
      }
      const where = result.duplicate ? `${result.placed}. It was already on the desk.` : result.placed
      setStage({ name: "done", message: `${result.title} at ${result.company}. ${where}.` })
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen((current) => !current)}>
        Add job
      </Button>
      {open ? (
        <div className="w-full max-w-sm rounded-lg border bg-card p-3 text-left text-sm">
          {stage.name === "url" ? (
            <form
              className="flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                lookUp()
              }}
            >
              <label className="flex flex-col gap-1">
                Job link
                <input
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://"
                  className={fieldClass}
                  inputMode="url"
                />
              </label>
              <Button type="submit" disabled={pending || url.trim().length < 8}>
                {pending ? "Reading…" : "Continue"}
              </Button>
            </form>
          ) : null}
          {stage.name === "ready" ? (
            <div className="flex flex-col gap-2">
              <p>
                <span className="font-medium">{stage.title}</span>
                <span className="text-muted-foreground"> · {stage.company}</span>
              </p>
              <p className="text-muted-foreground">
                {stage.location} · {stage.source}
              </p>
              <Choice pending={pending} onChoose={(action) => commit(action)} />
            </div>
          ) : null}
          {stage.name === "manual" ? (
            <ManualForm
              draft={stage.draft}
              pending={pending}
              onSubmit={(draft, action) => {
                setStage({ name: "manual", draft })
                commit(action, draft)
              }}
            />
          ) : null}
          {stage.name === "done" ? <p>{stage.message}</p> : null}
          {error ? <p className="mt-2 text-destructive">{error}</p> : null}
          <button type="button" className="mt-2 text-xs text-muted-foreground underline" onClick={reset}>
            Close
          </button>
        </div>
      ) : null}
    </div>
  )
}

function Choice({ pending, onChoose }: { pending: boolean; onChoose: (action: "applied" | "save" | "desk") => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={pending} onClick={() => onChoose("applied")}>
        Applied
      </Button>
      <Button type="button" variant="outline" disabled={pending} onClick={() => onChoose("save")}>
        Save
      </Button>
      <Button type="button" variant="ghost" disabled={pending} onClick={() => onChoose("desk")}>
        Just add to desk
      </Button>
    </div>
  )
}

function ManualForm({
  draft,
  pending,
  onSubmit,
}: {
  draft: ManualJobDraft
  pending: boolean
  onSubmit: (draft: ManualJobDraft, action: "applied" | "save" | "desk") => void
}) {
  const [fields, setFields] = useState(draft)
  function set<K extends keyof ManualJobDraft>(key: K, value: ManualJobDraft[K]) {
    setFields((current) => ({ ...current, [key]: value }))
  }
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault()
      }}
    >
      <p className="text-muted-foreground">Open Desk could not read that page. Add the details it needs.</p>
      <label className="flex flex-col gap-1">
        Title
        <input className={fieldClass} value={fields.title} onChange={(event) => set("title", event.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        Company
        <input className={fieldClass} value={fields.company} onChange={(event) => set("company", event.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        Location
        <input className={fieldClass} value={fields.location} placeholder="New York, NY" onChange={(event) => set("location", event.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        Work arrangement
        <select className={fieldClass} value={fields.arrangement} onChange={(event) => set("arrangement", event.target.value)}>
          <option>Unclear</option>
          <option>Hybrid</option>
          <option>On-site</option>
          <option>Remote</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        Description
        <textarea
          rows={4}
          className="w-full rounded-lg border border-border bg-background px-2 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
          value={fields.description}
          onChange={(event) => set("description", event.target.value)}
        />
      </label>
      <Choice pending={pending} onChoose={(action) => onSubmit(fields, action)} />
    </form>
  )
}
