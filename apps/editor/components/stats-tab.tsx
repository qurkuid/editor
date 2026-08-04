'use client'

import { useScene } from '@pascal-app/core'
import { useT } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { BarChart3, ChevronDown, ChevronRight, FileText, Loader2, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { withBasePath } from '@/lib/base-path'
import { buildEstimateDraft, type EstimateLine } from '@/lib/estimate-lines'
import { toEstimateItems } from '@/lib/estimate-submit'
import { canEditCoverage, type IntmMaterial, type IntmMaterialCategory } from '@/lib/intm-materials'
import {
  type IntmProject,
  projectSubtitle,
  searchProjects,
} from '@/lib/intm-projects'
import { deriveTakeoff, type TakeoffCategory } from '@/lib/quantity-takeoff'
import { readSceneProjectId, sceneProjectPatch } from '@/lib/scene-project-link'

const CATEGORY_LABEL: Record<TakeoffCategory, string> = {
  board: '목자재',
  furniture: '가구',
  lighting: '조명',
  finish: '마감재',
  floor: '바닥재',
  ceiling: '천장재',
  wall: '벽체',
  item: '배치 모델',
}

const STATUS_NOTE: Record<EstimateLine['status'], string | null> = {
  priced: null,
  measure: null,
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

/**
 * `reason` says why there are no prices, which the panel shows verbatim. A bare
 * "not connected" is the same message whether INTM is unconfigured, the session
 * has lapsed, or the request failed — three different things to do about it.
 */
type CatalogueReason = 'not-configured' | 'signed-out' | 'empty' | 'error'

type Catalogue = {
  materials: IntmMaterial[]
  categories: IntmMaterialCategory[]
  connected: boolean
  reason?: CatalogueReason
  status?: number
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
  // The link lives on the scene, so reopening it remembers the project.
  const rootNodeIds = useScene((state) => state.rootNodeIds)
  const linkedProjectId = useMemo(
    () => readSceneProjectId(nodes, rootNodeIds),
    [nodes, rootNodeIds],
  )
  const [projectIdDraft, setProjectIdDraft] = useState<string | null>(null)
  const projectId = projectIdDraft ?? linkedProjectId ?? ''
  const [projectName, setProjectName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(withBasePath('/api/intm/materials'))
      if (response.ok) {
        setCatalogue((await response.json()) as Catalogue)
      } else {
        // 401 is the auth gate: the page loaded on a session that has since
        // lapsed. Anything else is the route or INTM itself failing.
        setCatalogue({
          materials: [],
          categories: [],
          connected: false,
          reason: response.status === 401 ? 'signed-out' : 'error',
          status: response.status,
        })
      }
    } catch {
      setCatalogue({ materials: [], categories: [], connected: false, reason: 'error' })
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

  /**
   * Category → what to order / what it was measured from, mirroring the scene
   * tree's shape. The split matters: 석고보드 14장 is a purchase order line,
   * 벽면 40㎡ is the number it was derived from.
   */
  const grouped = useMemo(() => {
    const byCategory = new Map<
      TakeoffCategory,
      { material: EstimateLine[]; measure: EstimateLine[]; amount: number }
    >()
    for (const line of draft.lines) {
      const group = byCategory.get(line.takeoff.category) ?? {
        material: [],
        measure: [],
        amount: 0,
      }
      group[line.takeoff.role].push(line)
      if (line.status === 'priced') group.amount += line.amount ?? 0
      byCategory.set(line.takeoff.category, group)
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
      // Remember the project on the scene before submitting, so the next
      // estimate from this drawing doesn't ask again.
      if (projectId && projectId !== linkedProjectId) {
        const patch = sceneProjectPatch(useScene.getState().nodes, projectId, rootNodeIds)
        if (patch)
          useScene.getState().updateNode(patch.nodeId as never, {
            metadata: patch.metadata as never,
          })
      }

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
  }, [draft, projectId, projectName, linkedProjectId, rootNodeIds, t])

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
                {t(`stats.noCatalogue.${catalogue.reason ?? 'error'}`).replace(
                  '{status}',
                  String(catalogue.status ?? ''),
                )}
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
              [...grouped.entries()].map(([category, group]) => (
                <CategoryGroup
                  amount={group.amount}
                  key={category}
                  label={CATEGORY_LABEL[category]}
                  material={group.material}
                  measure={group.measure}
                  onSave={saveSpec}
                  savingId={savingId}
                />
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
            <ProjectPicker
              onSelect={(project) => {
                setProjectIdDraft(project.id)
                if (!projectName) setProjectName(project.name)
              }}
              selectedId={projectId}
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

/**
 * Find a project by name, customer or address.
 *
 * Filing an estimate used to mean pasting a project's id, which nobody knows.
 * The whole list is fetched once — INTM has no text-search parameter — and
 * filtered as you type.
 */
function ProjectPicker({
  onSelect,
  selectedId,
}: {
  onSelect: (project: IntmProject) => void
  selectedId: string
}) {
  const t = useT()
  const [projects, setProjects] = useState<IntmProject[] | null>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch(withBasePath('/api/intm/projects'))
        const body = (await response.json()) as { projects?: IntmProject[] }
        setProjects(body.projects ?? [])
      } catch {
        setProjects([])
      }
    })()
  }, [])

  const matches = useMemo(() => searchProjects(projects ?? [], query), [projects, query])
  const selected = projects?.find((project) => project.id === selectedId)

  return (
    <div className="relative">
      <input
        className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder={
          projects === null ? t('stats.estimate.projectLoading') : t('stats.estimate.projectSearch')
        }
        value={open ? query : (selected?.name ?? query)}
      />

      {selected && !open && (
        <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
          {projectSubtitle(selected)}
        </p>
      )}

      {open && (
        <div className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-md border border-border bg-[#252527] shadow-lg">
          {matches.length === 0 ? (
            <p className="p-2 text-[11px] text-muted-foreground">
              {projects === null ? t('stats.estimate.projectLoading') : t('stats.estimate.noProject')}
            </p>
          ) : (
            matches.map((project) => (
              <button
                className="block w-full px-2 py-1.5 text-left hover:bg-muted"
                key={project.id}
                onClick={() => {
                  onSelect(project)
                  setQuery('')
                  setOpen(false)
                }}
                type="button"
              >
                <span className="block truncate text-xs text-foreground">{project.name}</span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {projectSubtitle(project)}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/**
 * One heading in the takeoff tree, collapsible like a scene-tree branch, with
 * its orderables above the measures they came from.
 */
function CategoryGroup({
  amount,
  label,
  material,
  measure,
  onSave,
  savingId,
}: {
  amount: number
  label: string
  material: EstimateLine[]
  measure: EstimateLine[]
  onSave: (material: IntmMaterial, patch: Record<string, number>) => void
  savingId: string | null
}) {
  const t = useT()
  const [open, setOpen] = useState(true)
  const Chevron = open ? ChevronDown : ChevronRight

  const rows = (lines: EstimateLine[], heading: string) =>
    lines.length === 0 ? null : (
      <div className="mt-1.5">
        <p className="mb-1 pl-1 text-[10px] text-muted-foreground/70">
          {heading} · {lines.length}
        </p>
        <div className="space-y-1.5">
          {lines.map((line) => (
            <StatsRow
              key={`${line.takeoff.category}:${line.takeoff.key}`}
              line={line}
              onSave={onSave}
              saving={savingId === line.material?.id}
            />
          ))}
        </div>
      </div>
    )

  return (
    <div className="mb-2 border-l border-border/40 pl-2">
      <button
        className="flex w-full items-center gap-1 py-1 text-left"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <Chevron className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-[11px] font-semibold text-foreground">{label}</span>
        {amount > 0 && (
          <span className="text-[10px] text-muted-foreground">{formatAmount(amount)}</span>
        )}
      </button>
      {open && (
        <div className="pl-3">
          {rows(material, t('stats.group.material'))}
          {rows(measure, t('stats.group.measure'))}
        </div>
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
  // How many scene elements this one order line came from.
  const places = new Set(line.takeoff.nodeIds).size

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
            {places > 1 ? ` · ${t('stats.places').replace('{n}', String(places))}` : ''}
          </span>
        </span>
        <span className="shrink-0 text-right">
          {note ? (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-200">
              {note}
            </span>
          ) : (
            // A measure carries no price by design — "0원" would read as free.
            line.status !== 'measure' && (
              <span className="text-xs text-foreground">{formatAmount(line.amount ?? 0)}</span>
            )
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
