import '../bridge/node-shims'

import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadOntologyPack } from './pack'

const canonicalRoot = join(process.cwd(), 'ontology/pascal-architecture-core')

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function replaceManifestHash(manifest: string, path: string, hash: string): string {
  const marker = `"path": "${path}", "sha256": "`
  const markerStart = manifest.indexOf(marker)
  if (markerStart < 0) return manifest
  const hashStart = markerStart + marker.length
  return `${manifest.slice(0, hashStart)}${hash}${manifest.slice(hashStart + 64)}`
}

describe('Pascal Architecture Core pack boundary', () => {
  test('loads the canonical Pack v1 with hashes and referential integrity', async () => {
    const result = await loadOntologyPack()

    expect(result.status).toBe('available')
    if (result.status !== 'available') return
    expect(result.pack.manifest.packId).toBe('pascal-architecture-core')
    expect(result.pack.manifest.version).toBe('1.0.0')
    expect(result.pack.manifest.license.spdxId).toBe('MIT')
    expect(result.pack.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([
        'pascal:architecture/body',
        'pascal:architecture/wall',
        'pascal:architecture/window',
        'pascal:affordance/pushPullBodyFace',
        'pascal:rule/window-hosted-by-wall',
      ]),
    )
  })

  test('reports malformed, tampered, and referentially broken packs as invalid', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pascal-invalid-pack-'))
    try {
      await cp(canonicalRoot, root, { recursive: true })
      const manifestPath = join(root, 'manifest.json')
      const originalManifest = await readFile(manifestPath, 'utf8')

      const malformed = 'not-json\n'
      await writeFile(join(root, 'graph/nodes.jsonl'), malformed)
      await writeFile(
        manifestPath,
        replaceManifestHash(originalManifest, 'graph/nodes.jsonl', sha256(malformed)),
      )
      const malformedResult = await loadOntologyPack(root)
      expect(malformedResult).toMatchObject({ status: 'invalid', code: 'schema' })

      const brokenNodes = (
        await readFile(join(canonicalRoot, 'graph/nodes.jsonl'), 'utf8')
      ).replace('evidence:body-push-pull', 'evidence:missing')
      await writeFile(join(root, 'graph/nodes.jsonl'), brokenNodes)
      await writeFile(
        manifestPath,
        replaceManifestHash(originalManifest, 'graph/nodes.jsonl', sha256(brokenNodes)),
      )
      const integrityResult = await loadOntologyPack(root)
      expect(integrityResult).toMatchObject({ status: 'invalid', code: 'integrity' })

      await writeFile(
        manifestPath,
        replaceManifestHash(originalManifest, 'graph/nodes.jsonl', '0'.repeat(64)),
      )
      const hashResult = await loadOntologyPack(root)
      expect(hashResult).toMatchObject({ status: 'invalid', code: 'hash' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('reports an explicit missing configured pack as unavailable', async () => {
    const previous = process.env.PASCAL_ONTOLOGY_PACK_PATH
    const root = join(tmpdir(), 'pascal-ontology-does-not-exist')
    process.env.PASCAL_ONTOLOGY_PACK_PATH = root
    try {
      const result = await loadOntologyPack()
      expect(result).toEqual({
        status: 'unavailable',
        code: 'not_found',
        message: `Ontology pack not found: ${root}`,
      })
    } finally {
      if (previous === undefined) delete process.env.PASCAL_ONTOLOGY_PACK_PATH
      else process.env.PASCAL_ONTOLOGY_PACK_PATH = previous
    }
  })

  test('rejects a non-MIT manifest before reading artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pascal-license-pack-'))
    try {
      await cp(canonicalRoot, root, { recursive: true })
      const manifestPath = join(root, 'manifest.json')
      const manifest = (await readFile(manifestPath, 'utf8')).replace(
        '"spdxId": "MIT"',
        '"spdxId": "Apache-2.0"',
      )
      await writeFile(manifestPath, manifest)
      const result = await loadOntologyPack(root)
      expect(result).toMatchObject({ status: 'invalid', code: 'license' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
