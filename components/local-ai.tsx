"use client"

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { saveInterpretationAction } from "@/app/actions"
import { browserHasWebGpu, interpretLocally, type LocalReading } from "@/lib/llm/browser-engine"
import { interpretationHash, interpretationSource } from "@/lib/llm/schema"

export interface LocalJobInput {
  id: string
  title: string
  description: string
  interpretationHash: string | null
}

type Status =
  | { state: "available" }
  | { state: "parser" }
  | { state: "loading"; progress: number }

const LocalAiContext = createContext<{
  interpretFeedback: (note: string) => Promise<LocalReading | null>
} | null>(null)

export function useLocalAi() {
  return useContext(LocalAiContext)
}

const StatusContext = createContext<Status | null>(null)

function useLocalAiStatus(): Status | null {
  return useContext(StatusContext)
}

export function LocalAiStatus() {
  const status = useLocalAiStatus()
  if (!status) return null
  const line =
    status.state === "loading"
      ? `Downloading local model · ${Math.round(status.progress * 100)}%`
      : status.state === "available"
        ? "Local AI available"
        : "Using standard parser"
  return (
    <p className="text-xs leading-5 text-muted-foreground">
      {line}. Notes are interpreted in this browser and are not sent to an AI service.
    </p>
  )
}

export function LocalAi({ jobs, children }: { jobs: LocalJobInput[]; children: ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null)

  useEffect(() => {
    let cancelled = false
    browserHasWebGpu().then((ok) => {
      if (!cancelled) setStatus(ok ? { state: "available" } : { state: "parser" })
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (jobs.length === 0) return
    let cancelled = false
    ;(async () => {
      for (const job of jobs) {
        if (cancelled) return
        const text = `${job.title}\n${job.description}`
        const source = interpretationSource("job", text)
        const hash = await interpretationHash("job", source)
        if (job.interpretationHash === hash) continue
        const reading = await interpretLocally("job", text, (progress) => {
          if (!cancelled) setStatus({ state: "loading", progress })
        })
        if (cancelled) return
        if (!reading) {
          if (!(await browserHasWebGpu())) setStatus({ state: "parser" })
          continue
        }
        setStatus({ state: "available" })
        await saveInterpretationAction({
          kind: "job",
          jobId: job.id,
          rawText: source,
          signals: reading.signals,
          modelId: reading.modelId,
          contentHash: reading.hash,
        })
      }
    })().catch(() => {
      if (!cancelled) setStatus({ state: "parser" })
    })
    return () => {
      cancelled = true
    }
  }, [jobs])

  const interpretFeedback = useMemo(() => {
    return async (note: string) => {
      try {
        const reading = await interpretLocally("feedback", note, (progress) => {
          setStatus({ state: "loading", progress })
        })
        if (!reading || !("positive_preferences" in reading.signals)) {
          setStatus((current) => (current?.state === "loading" ? { state: "parser" } : current))
          return null
        }
        setStatus({ state: "available" })
        return reading
      } catch {
        setStatus({ state: "parser" })
        return null
      }
    }
  }, [])

  return (
    <StatusContext.Provider value={status}>
      <LocalAiContext.Provider value={{ interpretFeedback }}>{children}</LocalAiContext.Provider>
    </StatusContext.Provider>
  )
}
