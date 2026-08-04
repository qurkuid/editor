import { type NextRequest, NextResponse } from 'next/server'
import { fetchIntmProjects } from '@/lib/intm-projects'
import { intmAuthEnabled } from '@/lib/intm-session'

/**
 * The browser's window onto INTM's projects, so an estimate can be filed
 * against one by name instead of by pasted id.
 *
 * Same shape as the materials route: the session cookie is forwarded and never
 * leaves the server, and INTM decides which projects the caller may see.
 */

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!intmAuthEnabled()) {
    return NextResponse.json({ projects: [], connected: false, reason: 'not-configured' })
  }

  const projects = await fetchIntmProjects(request.headers.get('cookie'))
  return NextResponse.json({ projects, connected: projects.length > 0 })
}
