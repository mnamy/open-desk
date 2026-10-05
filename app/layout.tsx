import type { ReactNode } from "react"
import type { Metadata } from "next"
import { Fraunces, Source_Sans_3 } from "next/font/google"
import "./globals.css"

const sans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-source",
})

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
})

export const metadata: Metadata = {
  title: "Open Desk",
  description: "Entry-level roles in New York, Chicago, Boston, Miami, and Austin.",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} h-full antialiased`}>
      <body className="min-h-full bg-background text-foreground">{children}</body>
    </html>
  )
}
