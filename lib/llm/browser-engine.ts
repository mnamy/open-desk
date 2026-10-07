import {
  LOCAL_MODEL_ID,
  interpretationHash,
  interpretationSource,
  parseFeedbackInterpretation,
  parseJobFeatures,
  type FeedbackInterpretation,
  type JobFeatures,
} from "@/lib/llm/schema"
import { promptFor } from "@/lib/llm/prompt"
import { InterpretationMemo, interpretText, type InterpretationStore } from "@/lib/llm/runtime"

/**
 * Free-text notes and job descriptions are interpreted in the browser.
 * This module never sends that text to a hosted model API.
 * WebLLM downloads static weights, then runs them with WebGPU.
 * The parsed signals and the raw note may later be saved in Open Desk's own database.
 */

type Progress = (progress: number, text: string) => void

interface Engine {
  resetChat: () => Promise<void>
  chat: {
    completions: {
      create: (body: {
        messages: { role: "system" | "user"; content: string }[]
        temperature: number
        max_tokens: number
        response_format: { type: "json_object" }
      }) => Promise<{ choices: { message?: { content?: string | null } }[] }>
    }
  }
}

const memo = new InterpretationMemo<FeedbackInterpretation | JobFeatures | null>()
let opening: Promise<Engine | null> | null = null
let unavailable = false
let queue: Promise<unknown> = Promise.resolve()

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

interface BrowserGpu {
  requestAdapter: () => Promise<unknown>
}

function browserGpu(): BrowserGpu | null {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) return null
  const gpu = (navigator as Navigator & { gpu?: BrowserGpu }).gpu
  return gpu ?? null
}

export async function browserHasWebGpu(): Promise<boolean> {
  const gpu = browserGpu()
  if (!gpu) return false
  try {
    return Boolean(await gpu.requestAdapter())
  } catch {
    return false
  }
}

export async function ensureLocalEngine(onProgress: Progress): Promise<Engine | null> {
  if (unavailable) return null
  if (!(await browserHasWebGpu())) {
    unavailable = true
    return null
  }
  if (!opening) {
    opening = (async () => {
      try {
        const webllm = await import("@mlc-ai/web-llm")
        const worker = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" })
        return await webllm.CreateWebWorkerMLCEngine(worker, LOCAL_MODEL_ID, {
          initProgressCallback: (report) => onProgress(report.progress, report.text),
        })
      } catch {
        unavailable = true
        opening = null
        return null
      }
    })()
  }
  return opening
}

function localStore(): InterpretationStore<FeedbackInterpretation | JobFeatures | null> {
  const key = "open-desk.local-interpretations.v1"
  return {
    read(hash) {
      try {
        const all = JSON.parse(localStorage.getItem(key) || "{}") as Record<string, FeedbackInterpretation | JobFeatures | null>
        if (!Object.prototype.hasOwnProperty.call(all, hash)) return undefined
        return all[hash]
      } catch {
        return undefined
      }
    },
    write(hash, value) {
      try {
        const all = JSON.parse(localStorage.getItem(key) || "{}") as Record<string, FeedbackInterpretation | JobFeatures | null>
        all[hash] = value
        const keys = Object.keys(all)
        while (keys.length > 80) {
          const oldest = keys.shift()
          if (oldest) delete all[oldest]
        }
        localStorage.setItem(key, JSON.stringify(all))
      } catch {
        // Private browsing can reject storage. The in-memory memo still applies.
      }
    },
  }
}

async function complete(engine: Engine, kind: "feedback" | "job", text: string): Promise<string> {
  await engine.resetChat()
  const prompt = promptFor(kind, text)
  const reply = await engine.chat.completions.create({
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    temperature: 0,
    max_tokens: kind === "feedback" ? 240 : 400,
    response_format: { type: "json_object" },
  })
  const content = reply.choices[0]?.message?.content
  return typeof content === "string" ? content : ""
}

export interface LocalReading {
  hash: string
  modelId: string
  signals: FeedbackInterpretation | JobFeatures
}

export async function interpretLocally(
  kind: "feedback" | "job",
  text: string,
  onProgress: Progress,
): Promise<LocalReading | null> {
  const source = interpretationSource(kind, text)
  if (!source) return null
  const hash = await interpretationHash(kind, source)
  const engine = await ensureLocalEngine(onProgress)
  const parsed = await interpretText({
    webgpu: Boolean(engine),
    model: engine
      ? {
          interpret: (requested, body) => enqueue(() => complete(engine, requested, body)),
        }
      : null,
    memo,
    store: typeof localStorage === "undefined" ? undefined : localStore(),
    kind,
    text: source,
    hash,
    parse: (raw) => (kind === "feedback" ? parseFeedbackInterpretation(raw) : parseJobFeatures(raw)),
  })
  if (!parsed) return null
  return { hash, modelId: LOCAL_MODEL_ID, signals: parsed }
}
