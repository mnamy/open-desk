import { revalidatePath } from "next/cache"
import { getDb } from "@/lib/db/client"
import { continueLiveSearch } from "@/lib/db/repository"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST() {
  try {
    const db = await getDb()
    const step = await continueLiveSearch(db)
    revalidatePath("/")
    return Response.json(step)
  } catch (error) {
    const message = error instanceof Error ? error.message : "search step failed"
    console.error(message.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]"))
    return Response.json(
      { done: false, progress: "This pass failed. Run search again to continue. Earlier passes are saved." },
      { status: 500 },
    )
  }
}
