"use client"

import type { ReactNode } from "react"
import { useRouter } from "next/navigation"
import type { DeskFilters, FilterOptions } from "@/lib/jobs/view"

const selectClass =
  "h-9 w-full rounded-lg border border-border bg-card px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"

export function Filters({ values, options }: { values: DeskFilters; options: FilterOptions }) {
  const router = useRouter()

  function update(key: string, value: string) {
    const params = new URLSearchParams(window.location.search)
    if (!value || value === "any") params.delete(key)
    else params.set(key, value)
    const query = params.toString()
    router.push(query ? `/?${query}` : "/")
  }

  function clear() {
    const params = new URLSearchParams(window.location.search)
    for (const key of ["city", "role", "industry", "company", "source", "posted", "fit", "risk"]) {
      params.delete(key)
    }
    const query = params.toString()
    router.push(query ? `/?${query}` : "/")
  }

  const active = Object.values(values).some((value) => value && value !== "any")

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label="City">
          <select className={selectClass} value={values.city ?? "any"} onChange={(event) => update("city", event.target.value)}>
            <option value="any">Any city</option>
            {options.cities.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Role family">
          <select className={selectClass} value={values.role ?? "any"} onChange={(event) => update("role", event.target.value)}>
            <option value="any">Any role family</option>
            {options.roles.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Industry">
          <select
            className={selectClass}
            value={values.industry ?? "any"}
            onChange={(event) => update("industry", event.target.value)}
          >
            <option value="any">Any industry</option>
            {options.industries.map((industry) => (
              <option key={industry} value={industry}>
                {industry}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Company">
          <select
            className={selectClass}
            value={values.company ?? "any"}
            onChange={(event) => update("company", event.target.value)}
          >
            <option value="any">Any company</option>
            {options.companies.map((company) => (
              <option key={company} value={company}>
                {company}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Source">
          <select className={selectClass} value={values.source ?? "any"} onChange={(event) => update("source", event.target.value)}>
            <option value="any">Any source</option>
            {options.sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date posted">
          <select className={selectClass} value={values.posted ?? "any"} onChange={(event) => update("posted", event.target.value)}>
            <option value="any">Any date</option>
            <option value="today">Posted today</option>
            <option value="yesterday">Posted yesterday</option>
            <option value="3d">Posted within 3 days</option>
            <option value="7d">Posted within 7 days</option>
            <option value="older">Older</option>
            <option value="unknown">Date unknown</option>
          </select>
        </Field>
        <Field label="Opportunity fit">
          <select className={selectClass} value={values.fit ?? "any"} onChange={(event) => update("fit", event.target.value)}>
            <option value="any">Any fit</option>
            <option value="75">75 or higher</option>
            <option value="60">60 or higher</option>
            <option value="under60">Under 60</option>
          </select>
        </Field>
        <Field label="Qualification risk">
          <select className={selectClass} value={values.risk ?? "any"} onChange={(event) => update("risk", event.target.value)}>
            <option value="any">Any risk</option>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
          </select>
        </Field>
      </div>
      {active ? (
        <button type="button" onClick={clear} className="self-start text-sm text-primary underline-offset-4 hover:underline">
          Clear filters
        </button>
      ) : null}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
      {children}
    </label>
  )
}
