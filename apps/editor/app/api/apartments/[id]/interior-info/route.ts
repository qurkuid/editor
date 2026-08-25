import { aptJson, aptRateLimit } from '@/lib/apt-api'
import { getAptData } from '@/lib/apt-data'
import { getInteriorInfo } from '@/lib/apt-interior-info'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * "인테리어 준비 정보" for one complex, scraped live from K-apt (with an
 * in-memory day-long cache). The tight rate limit is deliberate: each cold
 * lookup costs up to four sequential upstream requests, and this route is
 * public — see `lib/apt-api.ts`.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = aptRateLimit(request, 'interior-info', 20)
  if (limited) return limited

  const { id } = await params
  const apartmentId = decodeURIComponent(id)
  try {
    const { apartmentMeta } = await getAptData()
    const meta = apartmentMeta.get(apartmentId)
    if (!meta) return aptJson(request, { code: 'NOT_FOUND' }, 404)

    const data = await getInteriorInfo(meta)
    if (!data) return aptJson(request, { code: 'INFO_NOT_FOUND' }, 404)
    return aptJson(request, { code: 'OK', source: 'K-apt', data }, 200, 'private, max-age=3600')
  } catch (error) {
    console.warn(
      `K-apt lookup failed for ${apartmentId}:`,
      error instanceof Error ? error.message : error,
    )
    return aptJson(request, { code: 'INFO_SOURCE_UNAVAILABLE' }, 502)
  }
}
