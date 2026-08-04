import { afterEach, describe, expect, test } from 'bun:test'
import { fetchIntmProjects, type IntmProject, projectSubtitle, searchProjects } from './intm-projects'

const ORIGINAL = { ...process.env }
afterEach(() => {
  process.env = { ...ORIGINAL }
})

const PROJECTS: IntmProject[] = [
  {
    id: 'prj_1',
    name: '방배동 리모델링',
    customerName: '김철수',
    apartmentName: '방배아크로타워',
    address: '서초구 방배로 12',
  },
  { id: 'prj_2', name: '역삼 사무실', customerName: '이영희', address: '강남구 역삼동 5' },
  { id: 'prj_3', name: '분당 단독주택', customerName: '박민수' },
]

describe('finding a project', () => {
  // Nobody remembers a project id, and few remember its formal name — they
  // remember the neighbourhood or the customer.
  test.each([
    ['방배', 'prj_1'],
    ['김철수', 'prj_1'],
    ['아크로', 'prj_1'],
    ['역삼', 'prj_2'],
    ['박민수', 'prj_3'],
  ])('%s finds %s', (query, id) => {
    expect(searchProjects(PROJECTS, query).map((p) => p.id)).toContain(id)
  })

  test('every word has to match, so two words narrow rather than widen', () => {
    expect(searchProjects(PROJECTS, '방배 김철수').map((p) => p.id)).toEqual(['prj_1'])
    expect(searchProjects(PROJECTS, '방배 이영희')).toEqual([])
  })

  test('an empty query lists what there is, capped', () => {
    expect(searchProjects(PROJECTS, '  ')).toHaveLength(3)
    expect(searchProjects(PROJECTS, '', 2)).toHaveLength(2)
  })

  test('no match is an empty list, not everything', () => {
    expect(searchProjects(PROJECTS, '없는프로젝트')).toEqual([])
  })

  test('the subtitle tells two jobs apart', () => {
    expect(projectSubtitle(PROJECTS[0]!)).toBe('김철수 · 방배아크로타워')
    expect(projectSubtitle(PROJECTS[2]!)).toBe('박민수')
  })
})

describe('reading them from INTM', () => {
  test('rows are mapped to what the picker shows', async () => {
    process.env.INTM_BASE_URL = 'https://intm.kr'
    const fetcher = (async () =>
      new Response(
        JSON.stringify({
          success: true,
          data: [
            {
              id: 'prj_1',
              name: '방배동 리모델링',
              customerName: '김철수',
              apartmentName: '방배아크로타워',
              detailedAddress: '서초구 방배로 12',
              status: 'in_progress',
            },
          ],
        }),
        { status: 200 },
      )) as unknown as typeof fetch

    const [project] = await fetchIntmProjects('session_token=abc', fetcher)
    expect(project?.id).toBe('prj_1')
    expect(project?.customerName).toBe('김철수')
    expect(project?.address).toBe('서초구 방배로 12')
  })

  // An outage must leave the estimate section usable, not blank the panel.
  test.each([
    ['an error status', async () => new Response('nope', { status: 500 })],
    [
      'an unreachable INTM',
      async () => {
        throw new Error('ECONNREFUSED')
      },
    ],
  ])('%s yields no projects rather than throwing', async (_label, fetcher) => {
    process.env.INTM_BASE_URL = 'https://intm.kr'
    expect(await fetchIntmProjects('session_token=abc', fetcher as unknown as typeof fetch)).toEqual(
      [],
    )
  })

  test('no session means no request at all', async () => {
    process.env.INTM_BASE_URL = 'https://intm.kr'
    let called = false
    await fetchIntmProjects(null, (async () => {
      called = true
      return new Response('{}')
    }) as unknown as typeof fetch)
    expect(called).toBe(false)
  })
})
