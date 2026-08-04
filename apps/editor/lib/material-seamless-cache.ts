import { findStoredAsset, loadAssetUrl, saveStoredAsset } from '@pascal-app/core'
import { createSeamlessImageBlob } from './seamless-image'

type SeamlessCacheDependencies = {
  readonly readSource: (url: string) => Promise<Blob>
  readonly loadStored: (id: string) => Promise<string | null>
  readonly transform: (source: Blob) => Promise<Blob>
  readonly store: (id: string, image: Blob) => Promise<string>
}

const pendingAssets = new Map<string, Promise<string>>()
// `seamless2` = the illumination-flatten + wrap-shift pipeline; the version
// keys the cache so results of the retired edge-blur-only pass are not reused.
const seamlessAssetUrlPattern = /^asset:\/\/seamless2-[0-9a-f]{64}$/

export class SeamlessMaterialError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'SeamlessMaterialError'
    this.status = status
  }
}

function requestBlob(url: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('GET', url)
    request.responseType = 'blob'
    request.onload = () => {
      if (request.status >= 200 && request.status < 300 && request.response instanceof Blob) {
        resolve(request.response)
        return
      }
      reject(new SeamlessMaterialError('Material image request failed', request.status))
    }
    request.onerror = () => reject(new SeamlessMaterialError('Could not load the material image'))
    request.send()
  })
}

async function digestBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

const browserDependencies: SeamlessCacheDependencies = {
  async readSource(url) {
    const resolved = await loadAssetUrl(url)
    if (!resolved) throw new SeamlessMaterialError(`Material texture could not be loaded: ${url}`)
    return requestBlob(resolved)
  },
  loadStored: findStoredAsset,
  transform: createSeamlessImageBlob,
  store: saveStoredAsset,
}

export async function getOrCreateSeamlessAsset(
  sourceUrl: string,
  dependencies: SeamlessCacheDependencies = browserDependencies,
): Promise<string> {
  if (seamlessAssetUrlPattern.test(sourceUrl)) return sourceUrl
  const source = await dependencies.readSource(sourceUrl)
  const digest = await digestBlob(source)
  const assetId = `seamless2-${digest}`
  const stored = await dependencies.loadStored(assetId)
  if (stored) return stored

  const pending = pendingAssets.get(assetId)
  if (pending) return pending

  const creation = dependencies
    .transform(source)
    .then((image) => dependencies.store(assetId, image))
    .finally(() => pendingAssets.delete(assetId))
  pendingAssets.set(assetId, creation)
  return creation
}
