"use server"

import { revalidatePath } from "next/cache"
import { getDb } from "@/lib/db/client"
import {
  importExternalJob,
  resetLearnedPreferences,
  saveInterpretation,
  setFeedback,
  type FeedbackAction,
} from "@/lib/db/repository"
import { fetchExternalJob, postingFromManual, type ManualJobDraft } from "@/lib/jobs/external-url"
import { sourceLabel } from "@/lib/jobs/role-family"
import { createHttpClient } from "@/lib/sources/http"

export async function feedbackAction(
  jobId: string,
  action: FeedbackAction,
  detail?: { reasons?: string[]; note?: string },
): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return
  const db = await getDb()
  await setFeedback(db, jobId, action, detail)
  revalidatePath("/")
}

export async function saveInterpretationAction(input: {
  kind: "feedback" | "job"
  jobId: string
  rawText: string
  signals: unknown
  modelId: string
  contentHash: string
}): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(input.jobId)) return
  const db = await getDb()
  await saveInterpretation(db, input)
  revalidatePath("/")
}

export async function resetPreferencesAction(): Promise<void> {
  const db = await getDb()
  await resetLearnedPreferences(db)
  revalidatePath("/")
}

export async function previewExternalJob(url: string): Promise<
  | { ok: true; mode: "ready"; title: string; company: string; location: string; source: string }
  | { ok: true; mode: "manual"; draft: ManualJobDraft }
  | { ok: false; message: string }
> {
  const draft = await fetchExternalJob(url, createHttpClient())
  if (draft.status === "ready") {
    return {
      ok: true,
      mode: "ready",
      title: draft.preview.title,
      company: draft.preview.company,
      location: draft.preview.location,
      source: sourceLabel(draft.preview.source),
    }
  }
  if (!draft.draft.url) return { ok: false, message: "Paste a full job link, including https://." }
  return { ok: true, mode: "manual", draft: draft.draft }
}

export async function commitExternalJob(input: {
  url: string
  action: "applied" | "save" | "desk"
  manual?: ManualJobDraft
}): Promise<
  | { ok: true; duplicate: boolean; title: string; company: string; placed: string }
  | { ok: false; message: string }
> {
  const db = await getDb()
  let posting = input.manual ? postingFromManual(input.manual) : null
  if (!input.manual) {
    const draft = await fetchExternalJob(input.url, createHttpClient())
    if (draft.status === "manual") {
      return { ok: false, message: "Open Desk could not read that page. Add the details below." }
    }
    posting = draft.posting
  }
  if (!posting) return { ok: false, message: "Add a title, company, location, and a short description." }
  try {
    const saved = await importExternalJob(db, posting, input.action)
    revalidatePath("/")
    const placed =
      input.action === "applied"
        ? "Applied"
        : input.action === "save"
          ? "Saved"
          : saved.feedBucket === "excluded"
            ? "Kept off the discovery feeds by your location and work-mode rules"
            : "Added to the desk"
    return {
      ok: true,
      duplicate: !saved.created,
      title: saved.title,
      company: saved.companyName,
      placed,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Open Desk could not save that job."
    return { ok: false, message }
  }
}
