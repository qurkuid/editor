import type { EstimateDraft, EstimateLine } from './estimate-lines'
import { intmBaseUrl } from './intm-session'

/**
 * Pushing a priced draft into INTM as a real estimate.
 *
 * The estimate document itself stays INTM's — its numbering, rates, insurance
 * and VAT arithmetic, PDF and 팝빌 issuance all live there and are not
 * reimplemented here. This only carries the scene-derived line items across,
 * so the quote a customer sees is the same document INTM has always produced.
 */

/**
 * One row of INTM's `estimate_items`. Field names follow INTM's own POST
 * contract (`/api/estimates/[estimateId]/items`) rather than a shape of our
 * own — the estimate document is theirs, so the payload is theirs too.
 */
export type EstimateItemPayload = {
  /** Purchase units, already converted from the takeoff. */
  quantity: number
  unitPrice: number
  /** Traces the line back to the drawing. */
  description: string
  materialId?: string
  productCategoryId?: string
}

export type SubmitEstimateInput = {
  /** INTM requires an existing project — an estimate hangs off one. */
  projectId: string
  title: string
  customerId?: string
  description?: string
}

/**
 * Only fully-resolved lines become estimate items. A line missing a material,
 * a coverage spec or a price is a question for the user, not a zero to bury in
 * a customer-facing document.
 */
export function toEstimateItems(draft: EstimateDraft): EstimateItemPayload[] {
  return draft.lines.filter(isSubmittable).map((line) => ({
    quantity: line.quantity ?? 0,
    unitPrice: line.unitPrice ?? 0,
    description: describeLine(line),
    materialId: line.material?.id,
    productCategoryId: line.material?.productCategoryId,
  }))
}

function isSubmittable(line: EstimateLine): boolean {
  return line.status === 'priced' && (line.quantity ?? 0) > 0
}

/** e.g. "실크 벽지 · 도면 산출 33.06㎡ · 손실 20% · 2곳" */
function describeLine(line: EstimateLine): string {
  const parts = [
    line.material?.name ?? line.takeoff.label,
    `도면 산출 ${line.takeoff.quantity.toFixed(2)}${unitLabel(line.takeoff.unit)}`,
  ]
  if (line.wasteRate) parts.push(`손실 ${Math.round(line.wasteRate * 100)}%`)
  if (line.takeoff.nodeIds.length > 0) parts.push(`${line.takeoff.nodeIds.length}곳`)
  return parts.join(' · ')
}

function unitLabel(unit: string): string {
  if (unit === 'm2') return '㎡'
  if (unit === 'ea') return '개'
  return unit
}

export type SubmitResult =
  | { ok: true; estimateId: string; itemCount: number; failedItems: number }
  | { ok: false; error: string }

/**
 * Create the estimate in INTM, then add each line as an item.
 *
 * Two calls because that is INTM's shape: `POST /api/estimates` makes the
 * document (which is where numbering, rates and VAT live), and each item goes
 * to `POST /api/estimates/{id}/items`. Item failures are counted and reported
 * rather than rolled back — a partially filled estimate the user can finish is
 * more useful than a silently discarded one, and INTM has no batch endpoint to
 * make this atomic.
 */
export async function submitEstimate(
  draft: EstimateDraft,
  input: SubmitEstimateInput,
  cookieHeader: string | null | undefined,
  fetcher: typeof fetch = fetch,
): Promise<SubmitResult> {
  const base = intmBaseUrl()
  if (!base) return { ok: false, error: 'INTM이 설정되지 않았습니다.' }
  if (!cookieHeader) return { ok: false, error: 'INTM 로그인이 필요합니다.' }
  if (!input.projectId) return { ok: false, error: '프로젝트를 먼저 선택하세요.' }
  if (!input.title) return { ok: false, error: '견적서 제목이 필요합니다.' }

  const items = toEstimateItems(draft)
  if (items.length === 0) {
    return { ok: false, error: '견적에 올릴 확정 항목이 없습니다. 규격과 단가를 먼저 보정하세요.' }
  }

  const headers = { cookie: cookieHeader, 'content-type': 'application/json' }

  let estimateId: string
  try {
    const response = await fetcher(`${base}/api/estimates`, {
      method: 'POST',
      headers,
      cache: 'no-store',
      body: JSON.stringify({
        projectId: input.projectId,
        title: input.title,
        description: input.description ?? '도면에서 산출',
        customerId: input.customerId,
      }),
    })
    if (!response.ok) {
      return { ok: false, error: `INTM이 견적 생성을 거부했습니다 (${response.status})` }
    }
    const body = (await response.json()) as { id?: string; data?: { id?: string } }
    const id = body.id ?? body.data?.id
    if (!id) return { ok: false, error: 'INTM 응답에 견적 ID가 없습니다.' }
    estimateId = id
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '견적 생성 실패' }
  }

  let added = 0
  let failed = 0
  for (const item of items) {
    try {
      const response = await fetcher(`${base}/api/estimates/${estimateId}/items`, {
        method: 'POST',
        headers,
        cache: 'no-store',
        body: JSON.stringify(item),
      })
      if (response.ok) added += 1
      else failed += 1
    } catch {
      failed += 1
    }
  }

  return { ok: true, estimateId, itemCount: added, failedItems: failed }
}
