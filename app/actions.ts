"use server"

import { revalidatePath } from "next/cache"
import { getDb } from "@/lib/db/client"
import { importLiveSearch, setFeedback, type FeedbackAction } from "@/lib/db/repository"

export async function runSearchAction(): Promise<void> {
  const db = await getDb()
  await importLiveSearch(db)
  revalidatePath("/")
}

export async function feedbackAction(jobId: string, action: FeedbackAction): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return
  const db = await getDb()
  await setFeedback(db, jobId, action)
  revalidatePath("/")
}
