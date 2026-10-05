import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite"],
  // The desk is opened at 127.0.0.1. Next blocks dev JS from that host unless it is listed.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
}

export default nextConfig
