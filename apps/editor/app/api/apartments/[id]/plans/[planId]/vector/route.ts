import { execFile } from 'node:child_process'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { aptJson, aptRateLimit } from '@/lib/apt-api'
import { fetchPlanImage } from '@/lib/apt-plan-upstream'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const execFileAsync = promisify(execFile)
// bump together with the vectorizer's build_doc docVersion to invalidate
// disk-cached documents produced by older extraction logic
const DOC_VERSION = 5
const VECTORIZE_TIMEOUT_MS = 90_000
const MAX_STDOUT_BYTES = 16 * 1024 * 1024
const SAFE_ID = /^[0-9A-Za-z_-]+$/

// Dedupe concurrent requests for the same plan; the cold run (Vision OCR
// warm-up) takes ~10s and would otherwise fork one python per request.
const inflight = new Map<string, Promise<unknown>>()

/**
 * Vectorizes one plan image into walls/openings/rooms (mm coordinates) by
 * running the local floorplan-vectorizer CLI, and caches the result on disk
 * keyed by planId — the upstream plan image for a planId never changes.
 * The vectorizer lives outside this public repo; `VECTORIZER_DIR` points at
 * it (pm2 env), and the feature degrades to 503 when unset.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; planId: string }> },
) {
  const limited = aptRateLimit(request, 'plan-vector', 20)
  if (limited) return limited

  const { id, planId } = await params
  const plainPlanId = decodeURIComponent(planId)
  if (!SAFE_ID.test(plainPlanId)) return aptJson(request, { code: 'NOT_FOUND' }, 404)

  const vectorizerDir = process.env.VECTORIZER_DIR
  if (!vectorizerDir) return aptJson(request, { code: 'VECTOR_UNAVAILABLE' }, 503)

  const cacheDir = cacheDirPath()
  if (cacheDir) {
    try {
      const cached = JSON.parse(
        await readFile(path.join(cacheDir, `${plainPlanId}.json`), 'utf8'),
      ) as { docVersion?: number }
      if ((cached.docVersion ?? 1) >= DOC_VERSION) {
        return aptJson(request, { code: 'OK', data: cached }, 200, 'public, max-age=86400')
      }
      // older vectorizer output — re-run below and overwrite
    } catch {
      // cache miss — fall through to a fresh run
    }
  }

  try {
    let job = inflight.get(plainPlanId)
    if (!job) {
      job = vectorize(id, plainPlanId, vectorizerDir, cacheDir)
      inflight.set(plainPlanId, job)
      job.finally(() => inflight.delete(plainPlanId))
    }
    const doc = await job
    return aptJson(request, { code: 'OK', data: doc }, 200, 'public, max-age=86400')
  } catch (error) {
    const known = error instanceof PlanImageError ? error : null
    if (!known) {
      console.warn(
        `apt plan vectorize failed (${plainPlanId}):`,
        error instanceof Error ? error.message : error,
      )
    }
    return aptJson(request, { code: known?.code ?? 'VECTOR_FAILED' }, known?.status ?? 502)
  }
}

class PlanImageError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code)
  }
}

async function vectorize(
  id: string,
  planId: string,
  vectorizerDir: string,
  cacheDir: string | null,
): Promise<unknown> {
  const image = await fetchPlanImage(id, planId)
  if (!image.ok) throw new PlanImageError(image.code, image.status)

  // stable name on purpose: the vectorizer's OCR cache is keyed by the image
  // basename, so re-vectorizing the same plan skips the ~10 s Vision pass
  const tmpFile = path.join(tmpdir(), `apt-vector-${planId}.img`)
  await writeFile(tmpFile, Buffer.from(image.bytes))
  try {
    const python = process.env.VECTORIZER_PYTHON ?? 'python3'
    const { stdout } = await execFileAsync(
      python,
      [path.join(vectorizerDir, 'vectorize.py'), '--stdout', tmpFile],
      { timeout: VECTORIZE_TIMEOUT_MS, maxBuffer: MAX_STDOUT_BYTES },
    )
    const doc = JSON.parse(stdout) as { walls?: unknown[] }
    if (!Array.isArray(doc.walls)) throw new Error('vectorizer returned no walls array')
    if (cacheDir) {
      await mkdir(cacheDir, { recursive: true })
      await writeFile(path.join(cacheDir, `${planId}.json`), JSON.stringify(doc))
    }
    return doc
  } finally {
    await unlink(tmpFile).catch(() => {})
  }
}

function cacheDirPath(): string | null {
  const dataDir = process.env.APT_DATA_DIR
  return dataDir ? path.join(dataDir, 'vector-cache') : null
}
