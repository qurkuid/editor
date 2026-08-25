import { NextResponse } from 'next/server'
import { aptRateLimit } from '@/lib/apt-api'
import { getAptData } from '@/lib/apt-data'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The full apartment snapshot the map client renders (`{cols,picPrefix,rows}`,
 * ~6MB). Replaces the old standalone server's static `/data.js`; same payload,
 * served as JSON instead of a `window.APT_DATA` script.
 */
export async function GET(request: Request) {
  const limited = aptRateLimit(request, 'dataset', 30)
  if (limited) return limited

  try {
    const { datasetJson } = await getAptData()
    return new NextResponse(datasetJson, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    console.warn('apt dataset unavailable:', error instanceof Error ? error.message : error)
    return NextResponse.json({ code: 'DATASET_UNAVAILABLE' }, { status: 503 })
  }
}
