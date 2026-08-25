import type { ApartmentMeta } from './apt-data'

/**
 * Live K-apt (www.k-apt.go.kr) lookup of complex facts shown as
 * "인테리어 준비 정보" on the apartment map — ported from the standalone
 * apt.intm.kr server. Public data, fetched on demand and cached in memory.
 *
 * Caches hold promises, not values: a cold apartment opened by several
 * clients at once must scrape K-apt once, not once per request.
 */

export type InteriorInfo = {
  source: 'K-apt'
  sourceName: string
  approvalDate: string
  ageYears: number | null
  heating: string
  corridor: string
  buildings: number | null
  households: number | null
  builder: string
  managementPhone: string
  scopeWarning: string
}

const KAPT_BASE = 'https://www.k-apt.go.kr'
const KAPT_USER_AGENT = 'apt.intm.kr interior-prep-info/1.0'
const INFO_TTL_MS = 86_400_000
const DETAIL_TTL_MS = 7 * 86_400_000

const interiorInfoCache = new Map<string, { at: number; value: Promise<InteriorInfo | null> }>()
const kaptDetailCache = new Map<string, { at: number; value: Promise<string> }>()

export function getInteriorInfo(meta: ApartmentMeta): Promise<InteriorInfo | null> {
  const cached = interiorInfoCache.get(meta.apartmentId)
  if (cached && Date.now() - cached.at < INFO_TTL_MS) return cached.value

  const value = lookupInteriorInfo(meta)
  interiorInfoCache.set(meta.apartmentId, { at: Date.now(), value })
  value.catch(() => interiorInfoCache.delete(meta.apartmentId))
  return value
}

async function lookupInteriorInfo(meta: ApartmentMeta): Promise<InteriorInfo | null> {
  const candidate = await searchKapt(meta)
  if (!candidate) return null
  const html = await fetchKaptDetail(candidate)
  return parseKaptInterior(html, candidate, meta)
}

type KaptCandidate = {
  kaptCode: string
  kaptName: string
  bjdCode: string
  addr: string
}

function decodeHtml(value: string): string {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

function stripHtml(value: string): string {
  return decodeHtml(
    String(value || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?\s*>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeAddress(value: string): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/(서울|부산|대구|인천|광주|대전|울산)(?:특별시|광역시|시)/g, '$1')
    .replace(/세종(?:특별자치시|시)/g, '세종')
    .replace(/제주(?:특별자치도|도)/g, '제주')
    .replace(/(?:번지\s*)?일원/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
}

function normalizeAptName(value: string): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/e(?=[가-힣])/g, '이')
    .replace(/\([^)]*\)/g, '')
    .replace(/아파트|주상복합|도시형|공동주택/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
}

function fallbackAptQuery(value: string): string {
  return String(value || '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[0-9]+(?:-[0-9]+)?차$/i, '')
    .trim()
}

function nameSimilarity(rawA: string, rawB: string): number {
  const a = normalizeAptName(rawA)
  const b = normalizeAptName(rawB)
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.includes(b) || b.includes(a))
    return Math.min(a.length, b.length) / Math.max(a.length, b.length)
  const grams = (value: string) => new Set([...value].slice(0, -1).map((c, i) => c + value[i + 1]))
  const ga = grams(a)
  const gb = grams(b)
  if (!ga.size || !gb.size) return 0
  let common = 0
  for (const gram of ga) if (gb.has(gram)) common++
  return (2 * common) / (ga.size + gb.size)
}

function xmlValue(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return stripHtml(match?.[1] || '')
}

async function fetchText(
  url: string,
  options: RequestInit = {},
): Promise<{ response: Response; text: string }> {
  const response = await fetch(url, {
    ...options,
    headers: { 'user-agent': KAPT_USER_AGENT, ...(options.headers || {}) },
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) throw new Error(`KAPT_HTTP_${response.status}`)
  return { response, text: await response.text() }
}

async function searchKapt(meta: ApartmentMeta): Promise<KaptCandidate | null> {
  const eAlias = String(meta.name || '').replace(/e(?=[가-힣])/gi, '이')
  const queries = [...new Set([eAlias, meta.name, fallbackAptQuery(meta.name)].filter(Boolean))]
  const candidates = new Map<string, KaptCandidate>()
  for (const query of queries) {
    const { text } = await fetchText(
      `${KAPT_BASE}/cmmn/getMinViewAptInfo.do?keyword=${encodeURIComponent(query)}`,
    )
    for (const block of text.match(/<list>[\s\S]*?<\/list>/gi) || []) {
      const candidate: KaptCandidate = {
        kaptCode: xmlValue(block, 'kaptCode'),
        kaptName: xmlValue(block, 'kaptName'),
        bjdCode: xmlValue(block, 'bjdCode'),
        addr: xmlValue(block, 'addr'),
      }
      if (candidate.kaptCode) candidates.set(candidate.kaptCode, candidate)
    }
    if (candidates.size) break
  }
  const legacy = normalizeAddress(meta.legacyAddr)
  const locality = normalizeAddress(`${meta.guSi}${meta.dongEup}`)
  const ranked = [...candidates.values()]
    .map((candidate) => {
      const candidateAddr = normalizeAddress(candidate.addr)
      const addressExact = !!legacy && candidateAddr === legacy
      const sameLocality = !!locality && candidateAddr.includes(locality)
      const similarity = nameSimilarity(meta.name, candidate.kaptName)
      return {
        ...candidate,
        addressExact,
        sameLocality,
        similarity,
        score: (addressExact ? 1000 : 0) + (sameLocality ? 100 : 0) + similarity * 100,
      }
    })
    .sort((a, b) => b.score - a.score)
  const best = ranked[0]
  if (
    !best ||
    !(
      (best.addressExact && best.similarity >= 0.25) ||
      (best.sameLocality && best.similarity >= 0.72)
    )
  ) {
    return null
  }
  return best
}

function csrfToken(html: string): string | undefined {
  return (
    html.match(/name="_csrf"[^>]*value="([^"]+)"/)?.[1] ??
    html.match(/value="([^"]+)"[^>]*name="_csrf"/)?.[1]
  )
}

function cookieHeader(response: Response): string {
  return (response.headers.getSetCookie?.() || []).map((value) => value.split(';')[0]).join('; ')
}

async function kaptPost(pathname: string, data: Record<string, string>, cookie: string) {
  return fetchText(KAPT_BASE + pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8', cookie },
    body: new URLSearchParams(data),
  })
}

function fetchKaptDetail(candidate: KaptCandidate): Promise<string> {
  const cached = kaptDetailCache.get(candidate.kaptCode)
  if (cached && Date.now() - cached.at < DETAIL_TTL_MS) return cached.value

  const value = (async () => {
    const main = await fetchText(`${KAPT_BASE}/web/main/index.do`)
    const cookie = cookieHeader(main.response)
    const firstToken = csrfToken(main.text)
    if (!cookie || !firstToken) throw new Error('KAPT_SESSION_FAILED')
    const mapPage = await kaptPost(
      '/cmmn/knewMapView.do',
      { go_url: '/kaptinfo/openkaptinfo.do', _csrf: firstToken },
      cookie,
    )
    const secondToken = csrfToken(mapPage.text) ?? firstToken
    const detail = await kaptPost(
      '/cmmn/selectKapt.do',
      {
        go_url: '/kaptinfo/openkaptinfo.do',
        bjd_code: candidate.bjdCode,
        kapt_code: candidate.kaptCode,
        search_date: '',
        kapt_usedate: '',
        kapt_name: '',
        kaptDuty: 'ALL',
        _csrf: secondToken,
      },
      cookie,
    )
    if (!detail.text.includes(candidate.kaptCode)) throw new Error('KAPT_DETAIL_MISMATCH')
    return detail.text
  })()

  kaptDetailCache.set(candidate.kaptCode, { at: Date.now(), value })
  value.catch(() => kaptDetailCache.delete(candidate.kaptCode))
  return value
}

function tableField(html: string, label: string): string {
  const pairs = html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)(?=<\/td>|<th\b)/gi)
  for (const pair of pairs) {
    if (stripHtml(pair[1] ?? '').startsWith(label)) return stripHtml(pair[2] ?? '')
  }
  return ''
}

function formatPhone(value: string): string {
  const digits = String(value || '').match(/\d{9,11}/)?.[0] || ''
  if (digits.startsWith('02') && digits.length === 9)
    return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`
  if (digits.startsWith('02') && digits.length === 10)
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
  return digits
}

function parseKaptInterior(
  html: string,
  candidate: KaptCandidate,
  meta: ApartmentMeta,
): InteriorInfo {
  const approvalDate = tableField(html, '사용승인일')
  const scale = tableField(html, '동수 / 세대수').match(/([0-9,]+)\s*\/\s*([0-9,]+)/)
  const builderAndDeveloper = tableField(html, '시공사 / 시행사')
  const sourceName =
    stripHtml(
      html.match(/<strong[^>]*class="aptInfo_Tle"[^>]*>([\s\S]*?)<\/strong>/i)?.[1] ?? '',
    ) || candidate.kaptName
  const year = Number(approvalDate.slice(0, 4))
  const exactName = normalizeAptName(meta.name) === normalizeAptName(sourceName)
  return {
    source: 'K-apt',
    sourceName,
    approvalDate,
    ageYears: year > 1800 ? new Date().getFullYear() - year + 1 : null,
    heating: tableField(html, '난방방식'),
    corridor: tableField(html, '복도유형'),
    buildings: scale?.[1] ? Number(scale[1].replace(/,/g, '')) : null,
    households: scale?.[2] ? Number(scale[2].replace(/,/g, '')) : null,
    builder: builderAndDeveloper.split('/')[0]?.trim() || '',
    managementPhone: formatPhone(tableField(html, '관리사무소연락처')),
    scopeWarning: exactName
      ? ''
      : `K-apt에서는 '${sourceName}' 통합 단지로 관리되어 동수·세대수는 통합 기준일 수 있습니다.`,
  }
}
