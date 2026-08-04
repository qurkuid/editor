import { intmBaseUrl } from './intm-session'

/**
 * INTM's projects, so an estimate can be filed against one by name.
 *
 * The panel used to ask for a project's raw id, which nobody knows by heart.
 * INTM's own endpoint has no text-search parameter — it returns the projects
 * the session may see — so the list is fetched once and searched here.
 */

export type IntmProject = {
  id: string
  name: string
  customerName?: string
  apartmentName?: string
  address?: string
  status?: string
}

type ProjectsResponse = { data?: unknown; success?: boolean }

function coerceProjects(body: ProjectsResponse): IntmProject[] {
  const rows = Array.isArray(body.data) ? body.data : []
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const record = row as Record<string, unknown>
    if (typeof record.id !== 'string' || typeof record.name !== 'string') return []
    const text = (key: string) => (typeof record[key] === 'string' ? (record[key] as string) : undefined)
    return [
      {
        id: record.id,
        name: record.name,
        customerName: text('customerName'),
        apartmentName: text('apartmentName'),
        address: text('detailedAddress') ?? text('apartmentAddress'),
        status: text('status'),
      } satisfies IntmProject,
    ]
  })
}

export async function fetchIntmProjects(
  cookieHeader: string | null | undefined,
  fetcher: typeof fetch = fetch,
): Promise<IntmProject[]> {
  const base = intmBaseUrl()
  if (!base || !cookieHeader) return []
  try {
    const response = await fetcher(`${base}/api/projects`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    })
    if (!response.ok) return []
    return coerceProjects((await response.json()) as ProjectsResponse)
  } catch {
    return []
  }
}

/**
 * Projects matching what has been typed, newest listing order preserved.
 *
 * Matches on everything the user might remember a job by — its name, the
 * customer, the building, the address — because "방배동" is a likelier search
 * than the project's formal name.
 */
export function searchProjects(
  projects: readonly IntmProject[],
  query: string,
  limit = 20,
): IntmProject[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return projects.slice(0, limit)

  const terms = needle.split(/\s+/)
  return projects
    .filter((project) => {
      const haystack = [
        project.name,
        project.customerName,
        project.apartmentName,
        project.address,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return terms.every((term) => haystack.includes(term))
    })
    .slice(0, limit)
}

/** How a project reads in the picker — enough to tell two jobs apart. */
export function projectSubtitle(project: IntmProject): string {
  return [project.customerName, project.apartmentName ?? project.address]
    .filter(Boolean)
    .join(' · ')
}
