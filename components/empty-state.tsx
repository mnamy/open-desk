export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-10">
      <h2 className="font-heading text-2xl">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{body}</p>
    </div>
  )
}
