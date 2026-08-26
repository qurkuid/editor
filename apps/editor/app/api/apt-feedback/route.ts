import { appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { aptJson, aptRateLimit } from '@/lib/apt-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SAFE_ID = /^[0-9A-Za-z_-]+$/

const feedbackPoint = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  type: z.enum(['wall', 'door', 'window', 'zone', 'other']),
  note: z.string().trim().max(300).default(''),
})

const feedbackBody = z.object({
  apartmentId: z.string().regex(SAFE_ID),
  planId: z.string().regex(SAFE_ID),
  docVersion: z.number().int().optional(),
  points: z.array(feedbackPoint).min(1).max(20),
})

/**
 * Pin-based QA feedback from the /apt/debug viewer: image-pixel coordinates
 * plus a defect type, appended as JSONL per plan under
 * APT_DATA_DIR/vector-feedback. Deliberately NOT under /api/apartments/* so
 * the INTM login gate applies (writes are not public).
 */
export async function POST(request: Request) {
  const limited = aptRateLimit(request, 'apt-feedback', 30)
  if (limited) return limited
  const dir = feedbackDir()
  if (!dir) return aptJson(request, { code: 'FEEDBACK_UNAVAILABLE' }, 503)

  let body: z.infer<typeof feedbackBody>
  try {
    body = feedbackBody.parse(await request.json())
  } catch {
    return aptJson(request, { code: 'BAD_REQUEST' }, 400)
  }

  const record = {
    at: new Date().toISOString(),
    apartmentId: body.apartmentId,
    docVersion: body.docVersion ?? null,
    points: body.points,
  }
  await mkdir(dir, { recursive: true })
  await appendFile(path.join(dir, `${body.planId}.jsonl`), `${JSON.stringify(record)}\n`)
  return aptJson(request, { code: 'OK' })
}

export async function GET(request: Request) {
  const limited = aptRateLimit(request, 'apt-feedback', 60)
  if (limited) return limited
  const dir = feedbackDir()
  if (!dir) return aptJson(request, { code: 'FEEDBACK_UNAVAILABLE' }, 503)

  const planId = new URL(request.url).searchParams.get('planId') ?? ''
  if (!SAFE_ID.test(planId)) return aptJson(request, { code: 'NOT_FOUND' }, 404)

  try {
    const raw = await readFile(path.join(dir, `${planId}.jsonl`), 'utf8')
    const entries = raw
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as unknown)
    return aptJson(request, { code: 'OK', data: entries })
  } catch {
    return aptJson(request, { code: 'OK', data: [] })
  }
}

function feedbackDir(): string | null {
  const dataDir = process.env.APT_DATA_DIR
  return dataDir ? path.join(dataDir, 'vector-feedback') : null
}
