export interface TextCache {
  get(key: string): Promise<string | null>
  set(key: string, body: string): Promise<void>
}

export interface HttpClient {
  getJson<T>(url: string, timeoutMs?: number): Promise<T>
  getText(url: string, timeoutMs?: number): Promise<string>
}

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"

export function createHttpClient(options?: {
  fetchImpl?: typeof fetch
  cache?: TextCache
  timeoutMs?: number
}): HttpClient {
  const fetchImpl = options?.fetchImpl ?? fetch
  const timeoutMs = options?.timeoutMs ?? 12_000
  const cache = options?.cache

  async function getText(url: string, timeout = timeoutMs): Promise<string> {
    if (cache) {
      const cached = await cache.get(url)
      if (cached !== null) return cached
    }
    const browser = /workatastartup\.com|ycombinator\.com/i.test(url)
    const response = await fetchImpl(url, {
      headers: {
        Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
        "User-Agent": browser ? BROWSER_UA : "OpenDesk/1.0",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(timeout),
    })
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`.trim())
    }
    const body = await response.text()
    if (cache && body.length > 0 && body.length <= 1_500_000) {
      await cache.set(url, body)
    }
    return body
  }

  return {
    getText,
    async getJson<T>(url: string, timeout = timeoutMs): Promise<T> {
      return JSON.parse(await getText(url, timeout)) as T
    },
  }
}

export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}
