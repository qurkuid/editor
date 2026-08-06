'use client'

import { useT } from '@pascal-app/editor'
import { History, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { withBasePath } from '@/lib/base-path'

type SceneRevisionMeta = {
  version: number
  createdAt: string
  authorKind: string
  authorId: string | null
  sizeBytes: number
  nodeCount: number
}

type VersionsPayload = {
  currentVersion: number
  versions: SceneRevisionMeta[]
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`
  return `${bytes}B`
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

/**
 * Per-card "버전" button on the scenes page: opens the scene's revision
 * history (version, time, node count, size, author) and restores a selected
 * revision by re-saving its graph as a new head version — the store keeps
 * every revision, so restoring is never destructive.
 */
export function SceneVersionsButton({
  sceneId,
  sceneName,
  className,
}: {
  sceneId: string
  sceneName: string
  className?: string
}) {
  const t = useT()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [payload, setPayload] = useState<VersionsPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyVersion, setBusyVersion] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setPayload(null)
    setError(null)
    setNotice(null)
    fetch(withBasePath(`/api/scenes/${sceneId}/versions`))
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status))
        setPayload((await response.json()) as VersionsPayload)
      })
      .catch(() => setError(t('scenes.versionLoadFailed')))
  }, [open, sceneId, t])

  const handleRestore = useCallback(
    async (version: number) => {
      setBusyVersion(version)
      setError(null)
      setNotice(null)
      try {
        const revisionResponse = await fetch(
          withBasePath(`/api/scenes/${sceneId}/versions/${version}`),
        )
        if (!revisionResponse.ok) throw new Error('revision fetch failed')
        const { graph } = (await revisionResponse.json()) as { graph: unknown }

        // Re-read the head version right before writing so a concurrent save
        // surfaces as a version conflict instead of silently losing.
        const metaResponse = await fetch(withBasePath(`/api/scenes/${sceneId}`))
        if (!metaResponse.ok) throw new Error('scene fetch failed')
        const meta = (await metaResponse.json()) as { version: number }

        const put = await fetch(withBasePath(`/api/scenes/${sceneId}`), {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'If-Match': String(meta.version),
            // Restoring an old (possibly near-empty) revision is an explicit
            // user decision — bypass the accidental-wipe guard.
            'X-Pascal-Allow-Wipe': '1',
          },
          body: JSON.stringify({ name: sceneName, graph }),
        })
        if (!put.ok) throw new Error(String(put.status))
        const saved = (await put.json()) as { version: number }

        setNotice(t('scenes.versionRestored'))
        // Refresh both the modal list (the restore itself is a new head
        // revision) and the scenes-page card behind it.
        const refreshed = await fetch(withBasePath(`/api/scenes/${sceneId}/versions`))
        if (refreshed.ok) {
          setPayload((await refreshed.json()) as VersionsPayload)
        } else {
          setPayload((current) =>
            current ? { ...current, currentVersion: saved.version } : current,
          )
        }
        router.refresh()
      } catch {
        setError(t('scenes.versionRestoreFailed'))
      } finally {
        setBusyVersion(null)
      }
    },
    [router, sceneId, sceneName, t],
  )

  return (
    <>
      <button
        className={`pointer-events-auto flex items-center gap-1.5 rounded-md border border-border/60 bg-background/90 px-2 py-1 font-medium text-xs shadow-sm backdrop-blur transition-colors hover:bg-accent/60 ${className ?? ''}`}
        onClick={() => setOpen(true)}
        type="button"
      >
        <History className="h-3.5 w-3.5" />
        {t('scenes.versions')}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-border bg-background shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-border/60 border-b px-4 py-3">
              <div>
                <h2 className="font-semibold text-sm">{t('scenes.versionHistory')}</h2>
                <p className="truncate text-muted-foreground text-xs">{sceneName}</p>
              </div>
              <button
                aria-label={t('scenes.close')}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => setOpen(false)}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {(notice || error) && (
              <div
                className={`px-4 py-2 text-xs ${error ? 'text-destructive' : 'text-muted-foreground'}`}
              >
                {error ?? notice}
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {!(payload || error) && (
                <p className="px-2 py-6 text-center text-muted-foreground text-xs">…</p>
              )}
              {payload?.versions.length === 0 && (
                <p className="px-2 py-6 text-center text-muted-foreground text-xs">
                  {t('scenes.versionEmpty')}
                </p>
              )}
              {payload?.versions.map((revision) => {
                const isCurrent = revision.version === payload.currentVersion
                return (
                  <div
                    className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 hover:bg-accent/30"
                    key={revision.version}
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-xs">
                        v{revision.version}
                        {isCurrent && (
                          <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {t('scenes.versionCurrent')}
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {formatDate(revision.createdAt)} · {revision.nodeCount}{' '}
                        {t('scenes.versionNodes')} · {formatBytes(revision.sizeBytes)} ·{' '}
                        {revision.authorKind}
                      </p>
                    </div>
                    {!isCurrent && (
                      <button
                        className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1.5 font-medium text-xs hover:bg-accent/60 disabled:opacity-50"
                        disabled={busyVersion !== null}
                        onClick={() => handleRestore(revision.version)}
                        type="button"
                      >
                        {busyVersion === revision.version
                          ? t('scenes.versionRestoring')
                          : t('scenes.versionRestore')}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
