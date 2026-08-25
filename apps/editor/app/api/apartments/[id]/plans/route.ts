import { aptJson, aptRateLimit } from '@/lib/apt-api'
import { getAptData } from '@/lib/apt-data'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Every floor plan of one apartment complex, from the offline index.
 * Response shape is kept identical to the retired apt.intm.kr server.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = aptRateLimit(request, 'plans', 120)
  if (limited) return limited

  const { id } = await params
  try {
    const { plansByApartment } = await getAptData()
    const plans = plansByApartment.get(decodeURIComponent(id))
    if (!plans) return aptJson(request, { code: 'NOT_FOUND', data: [] }, 404)
    return aptJson(
      request,
      { code: 'OK', successful: true, source: 'offline-full-index', data: plans },
      200,
      'public, max-age=86400',
    )
  } catch (error) {
    console.warn('apt plans unavailable:', error instanceof Error ? error.message : error)
    return aptJson(request, { code: 'DATASET_UNAVAILABLE', data: [] }, 503)
  }
}
