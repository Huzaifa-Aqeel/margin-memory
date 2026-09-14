import 'server-only'

import { createHash } from 'node:crypto'
import { canonicalExcelSnapshot, canonicalExcelSourceIdentity, parseExcelLiveSnapshot, serializeExcelSnapshotArtifact } from './excel-snapshot'

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')

export function analyzeExcelSnapshotIdentity(input: unknown) {
  const snapshot = parseExcelLiveSnapshot(input)
  const canonicalSnapshot = canonicalExcelSnapshot(snapshot)
  const artifact = serializeExcelSnapshotArtifact(snapshot)
  return {
    snapshot,
    canonicalSnapshot,
    snapshotHash: sha256(canonicalSnapshot),
    sourceIdentityHash: sha256(canonicalExcelSourceIdentity(snapshot)),
    artifact,
    artifactBytes: Buffer.byteLength(artifact, 'utf8'),
  }
}

