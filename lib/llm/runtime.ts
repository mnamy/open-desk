export class InterpretationMemo<T> {
  private readonly values = new Map<string, T>()
  private readonly pending = new Map<string, Promise<T>>()

  async get(hash: string, produce: () => Promise<T>): Promise<T> {
    if (this.values.has(hash)) return this.values.get(hash) as T
    const existing = this.pending.get(hash)
    if (existing) return existing
    const run = produce().then((value) => {
      this.values.set(hash, value)
      this.pending.delete(hash)
      return value
    })
    this.pending.set(hash, run)
    return run
  }
}

export interface InterpretationStore<T> {
  read(hash: string): T | undefined
  write(hash: string, value: T): void
}

export interface LocalModel {
  interpret(kind: "feedback" | "job", text: string): Promise<string>
}

export async function interpretText<T>(options: {
  webgpu: boolean
  model: LocalModel | null
  memo: InterpretationMemo<T | null>
  store?: InterpretationStore<T | null>
  kind: "feedback" | "job"
  text: string
  hash: string
  parse: (raw: string) => T | null
}): Promise<T | null> {
  if (!options.text.trim()) return null
  if (!options.webgpu || !options.model) return null
  const stored = options.store?.read(options.hash)
  if (stored !== undefined) return stored
  const model = options.model
  return options.memo.get(options.hash, async () => {
    try {
      const raw = await model.interpret(options.kind, options.text)
      const parsed = options.parse(raw)
      options.store?.write(options.hash, parsed)
      return parsed
    } catch {
      options.store?.write(options.hash, null)
      return null
    }
  })
}
