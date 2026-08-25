import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Offline apartment dataset backing `/apt` and `/api/apartments/*`.
 *
 * The files are proprietary INTM data and live OUTSIDE this public repository,
 * in the directory named by `APT_DATA_DIR`:
 *   - `data.js`           `window.APT_DATA={cols,picPrefix,rows}` snapshot the
 *                         map client renders (one row per representative plan)
 *   - `full-plans.ndjson` one `{id, plans:[{type,planId,planPic,name}]}` line
 *                         per apartment complex
 */

export type AptPlan = {
  type: string
  planId: string
  planPic: string
  name: string
}

export type ApartmentMeta = {
  apartmentId: string
  name: string
  roadAddr: string
  legacyAddr: string
  cityDo: string
  guSi: string
  dongEup: string
}

export type AptData = {
  /** The `{cols,picPrefix,rows}` payload as a JSON string, served verbatim. */
  datasetJson: string
  plansByApartment: Map<string, AptPlan[]>
  apartmentMeta: Map<string, ApartmentMeta>
  /** apartmentId → planId → absolute image URL, for the image proxy. */
  planPicByApartment: Map<string, Map<string, string>>
}

let cached: Promise<AptData> | null = null

/**
 * Failures are not memoized: the data lives on an external volume that can
 * mount after the server boots, so a failed load must retry on the next
 * request instead of pinning every response to 503.
 */
export function getAptData(): Promise<AptData> {
  if (!cached) {
    cached = load().catch((error) => {
      cached = null
      throw error
    })
  }
  return cached
}

async function load(): Promise<AptData> {
  const dir = process.env.APT_DATA_DIR
  if (!dir) throw new Error('APT_DATA_DIR is not configured')

  const [ndjson, dataSource] = await Promise.all([
    readFile(path.join(dir, 'full-plans.ndjson'), 'utf8'),
    readFile(path.join(dir, 'data.js'), 'utf8'),
  ])

  const plansByApartment = new Map<string, AptPlan[]>()
  for (const line of ndjson.split('\n')) {
    if (!line) continue
    const row = JSON.parse(line) as { id?: string; plans?: AptPlan[] }
    if (row.id && Array.isArray(row.plans) && row.plans.length) {
      plansByApartment.set(String(row.id), row.plans)
    }
  }
  if (plansByApartment.size === 0) throw new Error('full-plans.ndjson yielded no apartments')

  const payload = dataSource.slice(dataSource.indexOf('{'), dataSource.lastIndexOf('}') + 1)
  const dataset = JSON.parse(payload) as {
    cols: string[]
    picPrefix: string
    rows: (string | number)[][]
  }
  const idx = new Map(dataset.cols.map((name, i) => [name, i]))
  const col = (row: (string | number)[], name: string) => String(row[idx.get(name) ?? -1] ?? '')

  const apartmentMeta = new Map<string, ApartmentMeta>()
  const planPicByApartment = new Map<string, Map<string, string>>()
  const absolutePic = (pic: string) =>
    pic && !pic.startsWith('http') ? dataset.picPrefix + pic : pic

  for (const [apartmentId, plans] of plansByApartment) {
    const pics = new Map<string, string>()
    for (const plan of plans) {
      if (plan.planId && plan.planPic) pics.set(String(plan.planId), absolutePic(plan.planPic))
    }
    planPicByApartment.set(apartmentId, pics)
  }

  for (const row of dataset.rows) {
    const apartmentId = col(row, 'apartmentId')
    if (!apartmentId) continue
    if (!apartmentMeta.has(apartmentId)) {
      apartmentMeta.set(apartmentId, {
        apartmentId,
        name: col(row, 'apartmentName'),
        roadAddr: col(row, 'roadAddress'),
        legacyAddr: col(row, 'legacyAddress'),
        cityDo: col(row, 'cityDo'),
        guSi: col(row, 'guSi'),
        dongEup: col(row, 'dongEup'),
      })
    }
    // Representative plans can cover apartments missing from the full index.
    const planId = col(row, 'planId')
    const planPic = col(row, 'planPic')
    if (planId && planPic) {
      let pics = planPicByApartment.get(apartmentId)
      if (!pics) {
        pics = new Map()
        planPicByApartment.set(apartmentId, pics)
      }
      if (!pics.has(planId)) pics.set(planId, absolutePic(planPic))
    }
  }
  if (apartmentMeta.size === 0) throw new Error('data.js yielded no apartment metadata')

  if (apartmentMeta.size < plansByApartment.size) {
    console.warn(
      `apt-data: metadata rows (${apartmentMeta.size}) cover fewer apartments than the plan index (${plansByApartment.size})`,
    )
  }

  return { datasetJson: payload, plansByApartment, apartmentMeta, planPicByApartment }
}
