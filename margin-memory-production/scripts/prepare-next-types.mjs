import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const mode = process.argv[2]

if (mode !== 'development' && mode !== 'production') {
  throw new Error('Expected Next.js type mode: development or production.')
}

// Next.js 16 writes route declarations to separate development and production
// directories. Keeping both causes duplicate global declarations when
// skipLibCheck is intentionally disabled. Remove only the opposite generated
// type tree; Next.js recreates the current one before it is consumed.
const conflictingTypes = mode === 'development' ? '.next/types' : '.next/dev/types'
await rm(resolve(process.cwd(), conflictingTypes), { recursive: true, force: true })
