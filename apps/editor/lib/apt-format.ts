/**
 * Pure client-side helpers for the apartment map, kept out of the component
 * so the parsing and formatting rules stay unit-testable.
 */

export type AptDatasetPayload = {
  cols: string[]
  picPrefix: string
  rows: (string | number)[][]
}

export type AptEntry = {
  id: string | number
  name: string
  planName: string
  planId: string
  planPic: string
  apartmentId: string
  cityDo: string
  guSi: string
  dongEup: string
  lat: number
  lng: number
  roadAddr: string
  legacyAddr: string
  addr: string
  searchText: string
  type: string
}

/**
 * Rows of the dataset snapshot, one per representative plan. The old map's
 * Korea-bounds coordinate filter is gone with the map itself — a complex with
 * a broken latitude is still searchable.
 */
export function parseAptDataset(payload: AptDatasetPayload): AptEntry[] {
  const idx = new Map(payload.cols.map((name, i) => [name, i]))
  const col = (row: (string | number)[], name: string) => String(row[idx.get(name) ?? -1] ?? '')

  return payload.rows
    .map((row): AptEntry => {
      const name = col(row, 'apartmentName')
      const planName = col(row, 'name')
      const roadAddr = col(row, 'roadAddress')
      const legacyAddr = col(row, 'legacyAddress')
      const cityDo = col(row, 'cityDo')
      const guSi = col(row, 'guSi')
      const dongEup = col(row, 'dongEup')
      const rawPic = col(row, 'planPic')
      return {
        id: row[idx.get('id') ?? -1] ?? '',
        name,
        planName,
        planId: col(row, 'planId'),
        planPic: rawPic && !rawPic.startsWith('http') ? payload.picPrefix + rawPic : rawPic,
        apartmentId: col(row, 'apartmentId'),
        cityDo,
        guSi,
        dongEup,
        lat: Number(col(row, 'latitude')),
        lng: Number(col(row, 'longitude')),
        roadAddr,
        legacyAddr,
        addr: roadAddr || legacyAddr,
        searchText: normalizeSearch(
          [name, planName, roadAddr, legacyAddr, cityDo, guSi, dongEup].join(' '),
        ),
        type: col(row, 'type'),
      }
    })
    .filter((a) => a.apartmentId !== '')
}

export type AptComplex = {
  apartmentId: string
  name: string
  addr: string
  cityDo: string
  guSi: string
  dongEup: string
  searchText: string
  /** Representative plan, used as a fallback when the full index misses. */
  planId: string
  planPic: string
  planName: string
  type: string
}

/** One row per complex — the dataset carries one row per representative plan. */
export function groupComplexes(entries: AptEntry[]): AptComplex[] {
  const byId = new Map<string, AptComplex>()
  for (const entry of entries) {
    if (!entry.apartmentId || byId.has(entry.apartmentId)) continue
    byId.set(entry.apartmentId, {
      apartmentId: entry.apartmentId,
      name: entry.name,
      addr: entry.addr || [entry.cityDo, entry.guSi, entry.dongEup].filter(Boolean).join(' '),
      cityDo: entry.cityDo,
      guSi: entry.guSi,
      dongEup: entry.dongEup,
      searchText: entry.searchText,
      planId: entry.planId,
      planPic: entry.planPic,
      planName: entry.planName,
      type: entry.type,
    })
  }
  return [...byId.values()]
}

export function normalizeSearch(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/(서울|부산|대구|인천|광주|대전|울산)(?:특별시|광역시|시)/g, '$1')
    .replace(/세종(?:특별자치시|시)/g, '세종')
    .replace(/제주(?:특별자치도|도)/g, '제주')
    .replace(/[^\p{L}\p{N}]/gu, '')
}

/** `84A㎡` → `84A㎡ · 약 25평대`; anything unparsable passes through. */
export function typeWithPyeong(type: string): string {
  const raw = String(type || '-')
  const match = raw.match(/^\s*(\d+(?:\.\d+)?)\s*[A-Za-z가-힣0-9-]*\s*(?:㎡|m²|m2)/i)
  if (!match) return raw
  const pyeong = Math.round(Number(match[1]) / 3.305785)
  return Number.isFinite(pyeong) && pyeong > 0 ? `${raw} · 약 ${pyeong}평대` : raw
}

export function shortName(name: string): string {
  return name.length > 12 ? `${name.slice(0, 12)}…` : name
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  )
}
