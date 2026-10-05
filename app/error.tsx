"use client"

import { Button } from "@/components/ui/button"

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center gap-4 px-4 py-16">
      <h1 className="font-heading text-4xl">Open Desk could not load.</h1>
      <p className="max-w-md text-sm leading-6 text-muted-foreground">
        The local database did not respond. Roles already saved on this machine are still in the data folder.
      </p>
      <div>
        <Button type="button" onClick={() => reset()}>
          Try again
        </Button>
      </div>
    </main>
  )
}
