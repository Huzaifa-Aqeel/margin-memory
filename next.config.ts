import {fileURLToPath} from 'node:url'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Keep builds usable on developer laptops; this does not disable any checks.
  experimental: {cpus: 2},
  turbopack: {root: fileURLToPath(new URL('.', import.meta.url))},
  serverExternalPackages: ['exceljs', 'pdf-parse', '@strands-agents/sdk'],
}

export default nextConfig
