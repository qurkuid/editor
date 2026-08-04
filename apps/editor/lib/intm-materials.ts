import { intmBaseUrl } from './intm-session'
import type { CoverageFields } from './material-coverage'

/**
 * INTM's material catalogue, read with the caller's own INTM session.
 *
 * Scoping is INTM's job, not ours: its `/api/materials` already selects
 * `company_id = <session company> OR company_id IS NULL`, so one call returns
 * the signed-in company's materials *and* the shared (공용) ones. Re-deriving
 * that here would be a second source of truth for who may see what.
 */

export type IntmMaterial = CoverageFields & {
  id: string
  name: string
  unit: string
  unitPrice: number
  productCategoryId?: string
  productCategoryName?: string
  /** Null/absent for shared (공용) materials; set for company-owned ones. */
  companyId?: string | null
}

export type IntmMaterialCategory = CoverageFields & {
  id: string
  name: string
}

/** Shared materials are the ones with no owning company. */
export function isSharedMaterial(material: IntmMaterial): boolean {
  return !material.companyId
}

/**
 * Whether this session may correct a material's coverage spec.
 *
 * INTM only lets a shared (공용) material's status be changed — anything else
 * is rejected, because one company editing a shared row would change it for
 * every company. Floorplan honours that rather than routing around it: the
 * edit field is disabled, and the spec falls back to the category default.
 */
export function canEditCoverage(material: IntmMaterial): boolean {
  return !isSharedMaterial(material)
}

type MaterialsResponse = { data?: unknown; materials?: unknown }

/**
 * A number that may arrive as a string.
 *
 * Postgres `numeric` columns come back from the driver as strings to preserve
 * precision, so `coverage_value` reached us as `"28.8000"` and was rejected as
 * "not a number" — a material with a perfectly good spec reported 규격 미등록.
 */
function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function coerceMaterials(body: MaterialsResponse): IntmMaterial[] {
  const rows = Array.isArray(body.data)
    ? body.data
    : Array.isArray(body.materials)
      ? body.materials
      : []
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const record = row as Record<string, unknown>
    const id = record.id
    const name = record.name
    if (typeof id !== 'string' || typeof name !== 'string') return []
    return [
      {
        id,
        name,
        unit: typeof record.unit === 'string' ? record.unit : '',
        unitPrice: num(record.unitPrice) ?? 0,
        productCategoryId:
          typeof record.productCategoryId === 'string' ? record.productCategoryId : undefined,
        productCategoryName:
          typeof record.productCategoryName === 'string' ? record.productCategoryName : undefined,
        companyId: typeof record.companyId === 'string' ? record.companyId : null,
        coverageValue: num(record.coverageValue),
        coverageUnit: typeof record.coverageUnit === 'string' ? record.coverageUnit : null,
        isDiscrete: typeof record.isDiscrete === 'boolean' ? record.isDiscrete : null,
        wasteRate: num(record.wasteRate),
      } satisfies IntmMaterial,
    ]
  })
}

async function getJson(
  path: string,
  cookieHeader: string | null | undefined,
  fetcher: typeof fetch,
): Promise<MaterialsResponse | null> {
  const base = intmBaseUrl()
  if (!base || !cookieHeader) return null
  try {
    const response = await fetcher(`${base}${path}`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    })
    if (!response.ok) return null
    return (await response.json()) as MaterialsResponse
  } catch {
    return null
  }
}

/** INTM pages `/api/materials` and defaults to 1000 rows; its ceiling is 50000. */
const MATERIAL_PAGE_SIZE = 1000
/** Runaway guard, set at INTM's own maximum rather than below it. */
const MATERIAL_PAGE_LIMIT = 50

/**
 * Every material the signed-in user may price with — their company's plus the
 * shared catalogue. Returns an empty list rather than throwing so a catalogue
 * outage degrades the estimate to "no prices" instead of breaking the page.
 *
 * Paged deliberately: taking only the default first page quietly hid two
 * thirds of a 2,901-row catalogue, so materials that existed simply could not
 * be found or priced. A short page means the last one.
 */
export async function fetchIntmMaterials(
  cookieHeader: string | null | undefined,
  fetcher: typeof fetch = fetch,
): Promise<IntmMaterial[]> {
  const all: IntmMaterial[] = []
  for (let page = 1; page <= MATERIAL_PAGE_LIMIT; page += 1) {
    const body = await getJson(
      `/api/materials?page=${page}&limit=${MATERIAL_PAGE_SIZE}`,
      cookieHeader,
      fetcher,
    )
    if (!body) break
    const rows = coerceMaterials(body)
    all.push(...rows)
    if (rows.length < MATERIAL_PAGE_SIZE) break
  }
  return all
}

/** Category rows, for the coverage defaults a material falls back to. */
export async function fetchIntmCategories(
  cookieHeader: string | null | undefined,
  fetcher: typeof fetch = fetch,
): Promise<IntmMaterialCategory[]> {
  const body = await getJson('/api/product-categories', cookieHeader, fetcher)
  const rows = Array.isArray(body?.data) ? body.data : []
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const record = row as Record<string, unknown>
    if (typeof record.id !== 'string' || typeof record.name !== 'string') return []
    return [
      {
        id: record.id,
        name: record.name,
        coverageValue: num(record.defaultCoverageValue),
        coverageUnit:
          typeof record.defaultCoverageUnit === 'string' ? record.defaultCoverageUnit : null,
        isDiscrete: typeof record.defaultIsDiscrete === 'boolean' ? record.defaultIsDiscrete : null,
        wasteRate: num(record.defaultWasteRate),
      } satisfies IntmMaterialCategory,
    ]
  })
}

/**
 * Persist a corrected coverage/waste spec back to INTM.
 *
 * The same spec is editable from both sides — floorplan is where a wrong
 * quantity shows up, INTM is where the catalogue is maintained — so this
 * writes to INTM's material record rather than keeping a floorplan-local
 * override that would silently diverge.
 */
export async function saveIntmMaterialCoverage(
  materialId: string,
  patch: CoverageFields,
  cookieHeader: string | null | undefined,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const base = intmBaseUrl()
  if (!base || !cookieHeader) return false
  try {
    const response = await fetcher(`${base}/api/materials/${materialId}`, {
      method: 'PATCH',
      headers: { cookie: cookieHeader, 'content-type': 'application/json' },
      body: JSON.stringify(patch),
      cache: 'no-store',
    })
    return response.ok
  } catch {
    return false
  }
}
