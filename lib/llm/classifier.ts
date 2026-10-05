import type { Classification, ClassificationInput, JobClassifier } from "@/lib/llm/types"
import { classifyDeterministic, contentHash } from "@/lib/scoring/score"

export interface ClassificationCache {
  get(hash: string): Promise<Classification | null>
  set(value: Classification): Promise<void>
}

/** Milestone 1 never calls a model. The method exists so a provider can be dropped in later. */
export class LlmClassifier implements JobClassifier {
  constructor(private readonly fallback: JobClassifier) {}

  async classify(input: ClassificationInput): Promise<Classification> {
    return this.fallback.classify(input)
  }
}

export class DeterministicClassifier implements JobClassifier {
  async classify(input: ClassificationInput): Promise<Classification> {
    return classifyDeterministic(input)
  }
}

export class CachingClassifier implements JobClassifier {
  constructor(
    private readonly inner: JobClassifier,
    private readonly cache: ClassificationCache,
  ) {}

  async classify(input: ClassificationInput): Promise<Classification> {
    const hash = contentHash(input)
    const cached = await this.cache.get(hash)
    if (cached) return cached
    const result = await this.inner.classify(input)
    await this.cache.set({ ...result, contentHash: hash })
    return { ...result, contentHash: hash }
  }
}

export function createClassifier(cache: ClassificationCache): JobClassifier {
  return new CachingClassifier(new LlmClassifier(new DeterministicClassifier()), cache)
}
