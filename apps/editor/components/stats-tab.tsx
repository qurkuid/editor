'use client'

import { useScene } from '@pascal-app/core'
import { useT } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { BarChart3, FileText, Loader2, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { withBasePath } from '@/lib/base-path'
import { buildEstimateDraft, type EstimateLine } from '@/lib/estimate-lines'
import { toEstimateItems } from '@/lib/estimate-submit'
import { canEditCoverage, type IntmMaterial, type IntmMaterialCategory } from '@/lib/intm-materials'
import { deriveTakeoff, type TakeoffCategory } from '@/lib/quantity-takeoff'

const CATEGORY_LABEL: Record<TakeoffCategory, string> = {
  board: '목자재',
  furniture: '가구',
  lighting: '조명',
  finish: '마감재',
  floor: '바닥재',
  ceiling: '천장재',
}

const STATUS_NOTE: Record<EstimateLine['status'], string | null> = {
  priced: null,
  'no-material': '자재 미연결',
  'no-coverage': '규격 미등록',
  'no-price': '단가 없음',
}

function formatAmount(value: number): string {
  return `${Math.round(value).toLocaleString('ko-KR')}원`
}

/** Areas read in m², counts as 개. */
function formatTakeoff(quantity: number, unit: string): string {
  if (unit === 'ea') return `${Math.round(quantity)}개`
  return `${quantity.toFixed(2)} ${unit === 'm2' ? '㎡' : unit}`
}

type Catalogue = {
  materials: IntmMaterial[]
  categories: IntmMaterialCategory[]
  connected: boolean
}

/**
 * Quantity takeoff for the current scene, priced against INTM's catalogue.
 *
 * The takeoff itself always renders — it only needs the scene. Prices need
 * INTM, so a missing catalogue degrades this to quantities rather than an
 * error, which is also what local dev sees.
 */
export function StatsTab() {
  const t = useT()
  const nodes = useScene((state) => state.nodes)
  const levelId = useViewer((state) => state.selection.levelId)
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [wholeScene, setWholeScene] = useState(false)
  const [projectId, setProjectId] = useState('')
  const [projectName, setProjectName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(withBasePath('/api/intm/materials'))
      setCatalogue(
        response.ok
          ? ((await response.json()) as Catalogue)
          : { materials: [], categories: [], connected: false },
      )
    } catch {
      setCatalogue({ materials: [], categories: [], connected: false })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const report = useMemo(
    () => deriveTakeoff(nodes, { levelId: wholeScene ? null : levelId }),
    [nodes, levelId, wholeScene],
  )

  const draft = useMemo(
    () => buildEstimateDraft(report, catalogue?.materials ?? [], catalogue?.categories ?? []),
    [report, catalogue],
  )

  const grouped = useMemo(() => {
    const byCategory = new Map<TakeoffCategory, EstimateLine[]>()
    for (const line of draft.lines) {
      const list = byCategory.get(line.takeoff.category) ?? []
      list.push(line)
      byCategory.set(line.takeoff.category, list)
    }
    return byCategory
  }, [draft])

  /** Correct a spec in place — writes straight through to INTM. */
  const saveSpec = useCallback(
    async (material: IntmMaterial, patch: Record<string, number>) => {
      setSavingId(material.id)
      try {
        const response = await fetch(withBasePath('/api/intm/materials'), {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ materialId: material.id, patch }),
        })
        if (response.ok) await load()
      } finally {
        setSavingId(null)
      }
    },
    [load],
  )

  const submittable = useMemo(() => toEstimateItems(draft), [draft])

  /** Hand the resolved lines to INTM, which owns the estimate document. */
  const createEstimate = useCallback(async () => {
    setSubmitting(true)
    setSubmitResult(null)
    try {
      const response = await fetch(withBasePath('/api/intm/estimates'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draft, projectId, title: projectName }),
      })
      const result = (await response.json()) as
        | { ok: true; estimateId: string; itemCount: number }
        | { ok: false; error: string }
      setSubmitResult(
        result.ok ? t('stats.submitted').replace('{n}', String(result.itemCount)) : result.error,
      )
    } catch (error) {
      setSubmitResult(error instanceof Error ? error.message : '견적 생성 실패')
    } finally {
      setSubmitting(false)
    }
  }, [draft, projectId, projectName, t])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-3 text-sm">
      <section className="rounded-xl border border-border bg-background/40 p-3">
        <div className="mb-3 flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-sky-300" />
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-xs">{t('stats.header.title')}</h2>
            <p className="text-[10px] text-muted-foreground">{t('stats.header.desc')}</p>
          </div>
          <button
            className="shrink-0 rounded border border-border px-2 py-1 text-[10px] hover:bg-muted"
            onClick={() => setWholeScene((value) => !value)}
            type="button"
          >
            {wholeScene ? t('stats.scope.whole') : t('stats.scope.level')}
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t('stats.loading')}
          </div>
        ) : (
          <>
            {catalogue && !catalogue.connected && (
              <p className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-200">
                {t('stats.noCatalogue')}
              </p>
            )}

            <div className="mb-3 flex items-baseline justify-between rounded-lg border border-border/50 bg-[#252527] px-3 py-2">
              <span className="text-[11px] text-muted-foreground">{t('stats.total')}</span>
              <span className="font-semibold text-foreground">{formatAmount(draft.total)}</span>
            </div>

            {draft.unresolved.length > 0 && (
              <p className="mb-3 flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-200">
                <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                {t('stats.unresolved').replace('{n}', String(draft.unresolved.length))}
              </p>
            )}

            {draft.lines.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                {t('stats.empty')}
              </p>
            ) : (
              [...grouped.entries()].map(([category, lines]) => (
                <div className="mb-3" key={category}>
                  <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {CATEGORY_LABEL[category]}
                  </h3>
                  <div className="space-y-1.5">
                    {lines.map((line) => (
                      <StatsRow
                        key={`${line.takeoff.category}:${line.takeoff.key}`}
                        line={line}
                        onSave={saveSpec}
                        saving={savingId === line.material?.id}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </section>

      {!loading && catalogue?.connected && (
        <section className="mt-3 rounded-xl border border-border bg-background/40 p-3">
          <div className="mb-2 flex items-center gap-2">
            <FileText className="h-4 w-4 text-emerald-300" />
            <h2 className="font-semibold text-xs">{t('stats.estimate.title')}</h2>
          </div>
          <p className="mb-2 text-[10px] text-muted-foreground">
            {t('stats.estimate.desc').replace('{n}', String(submittable.length))}
          </p>
          <div className="space-y-1.5">
            <input
              className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
              onChange={(event) => setProjectId(event.target.value)}
              placeholder={t('stats.estimate.projectId')}
              value={projectId}
            />
            <input
              className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
              onChange={(event) => setProjectName(event.target.value)}
              placeholder={t('stats.estimate.project')}
              value={projectName}
            />
            <button
              className="w-full rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-40"
              disabled={submitting || submittable.length === 0 || !projectId || !projectName}
              onClick={() => void createEstimate()}
              type="button"
            >
              {submitting ? t('stats.estimate.creating') : t('stats.estimate.create')}
            </button>
            {submitResult && (
              <p className="rounded border border-border/50 bg-[#252527] p-2 text-[11px] text-foreground">
                {submitResult}
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

function StatsRow({
  line,
  onSave,
  saving,
}: {
  line: EstimateLine
  onSave: (material: IntmMaterial, patch: Record<string, number>) => void
  saving: boolean
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const note = STATUS_NOTE[line.status]
  const editable = line.material ? canEditCoverage(line.material) : false

  return (
    <div className="rounded-lg border border-border/40 bg-[#252527] px-2 py-2">
      <button
        className="flex w-full items-start gap-2 text-left"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-foreground">
            {line.takeoff.label}
          </span>
          <span className="block text-[10px] text-muted-foreground">
            {formatTakeoff(line.takeoff.quantity, line.takeoff.unit)}
            {line.quantity != null && line.material
              ? ` → ${line.quantity.toLocaleString('ko-KR')}${line.material.unit}`
              : ''}
            {line.wasteRate ? ` · 손실 ${Math.round(line.wasteRate * 100)}%` : ''}
          </span>
        </span>
        <span className="shrink-0 text-right">
          {note ? (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-200">
              {note}
            </span>
          ) : (
            <span className="text-xs text-foreground">{formatAmount(line.amount ?? 0)}</span>
          )}
        </span>
      </button>

      {open && line.material && (
        <CoverageEditor
          disabled={!editable || saving}
          material={line.material}
          note={editable ? null : t('stats.sharedReadOnly')}
          onSave={(patch) => onSave(line.material!, patch)}
        />
      )}
    </div>
  )
}

/** Inline correction of a material's coverage spec. */
function CoverageEditor({
  disabled,
  material,
  note,
  onSave,
}: {
  disabled: boolean
  material: IntmMaterial
  note: string | null
  onSave: (patch: Record<string, number>) => void
}) {
  const t = useT()
  const [coverage, setCoverage] = useState(String(material.coverageValue ?? ''))
  const [waste, setWaste] = useState(
    material.wasteRate == null ? '' : String(Math.round(material.wasteRate * 100)),
  )

  return (
    <div className="mt-2 space-y-1.5 border-t border-border/30 pt-2">
      {note && <p className="text-[10px] text-amber-200/80">{note}</p>}
      <label className="flex items-center gap-2 text-[11px]">
        <span className="w-20 text-muted-foreground">{t('stats.coverage')}</span>
        <input
          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-right disabled:opacity-40"
          disabled={disabled}
          onChange={(event) => setCoverage(event.target.value)}
          step="0.0001"
          type="number"
          value={coverage}
        />
        <span className="w-8 text-muted-foreground">㎡</span>
      </label>
      <label className="flex items-center gap-2 text-[11px]">
        <span className="w-20 text-muted-foreground">{t('stats.waste')}</span>
        <input
          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-right disabled:opacity-40"
          disabled={disabled}
          onChange={(event) => setWaste(event.target.value)}
          step="1"
          type="number"
          value={waste}
        />
        <span className="w-8 text-muted-foreground">%</span>
      </label>
      <button
        className="w-full rounded border border-border px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-40"
        disabled={disabled}
        onClick={() => {
          const patch: Record<string, number> = {}
          const nextCoverage = Number(coverage)
          if (coverage !== '' && Number.isFinite(nextCoverage) && nextCoverage > 0) {
            patch.coverageValue = nextCoverage
          }
          const nextWaste = Number(waste)
          if (waste !== '' && Number.isFinite(nextWaste) && nextWaste >= 0 && nextWaste < 100) {
            patch.wasteRate = nextWaste / 100
          }
          if (Object.keys(patch).length > 0) onSave(patch)
        }}
        type="button"
      >
        {t('stats.save')}
      </button>
    </div>
  )
}
