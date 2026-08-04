'use client'

import { registerLibraryMaterials, unregisterLibraryMaterials } from '@pascal-app/core'
import { useEffect } from 'react'
import { withBasePath } from '@/lib/base-path'
import { toConstructionCatalogItems } from '@/lib/intm-construction-materials'
import type { IntmMaterial } from '@/lib/intm-materials'

/**
 * Put INTM's catalogue in front of the wall build-up picker.
 *
 * Renders nothing. It exists because the picker reads the shared material
 * library, and until now only RawPainter finishes were ever registered there —
 * so no construction layer could name a real product and every wall came out
 * of the takeoff unpriced.
 *
 * A missing or unauthenticated INTM leaves the library untouched: the editor
 * works without a catalogue, it just cannot price anything.
 */
export function IntmMaterialLibrary() {
  useEffect(() => {
    let cancelled = false
    let registered: string[] = []

    void (async () => {
      try {
        const response = await fetch(withBasePath('/api/intm/materials'))
        if (!response.ok) return
        const body = (await response.json()) as { materials?: IntmMaterial[] }
        if (cancelled) return

        const items = toConstructionCatalogItems(body.materials ?? [])
        if (items.length === 0) return
        registered = items.map((item) => item.id)
        registerLibraryMaterials(items)
      } catch {
        // No catalogue is a degraded editor, not a broken one.
      }
    })()

    return () => {
      cancelled = true
      if (registered.length > 0) unregisterLibraryMaterials(registered)
    }
  }, [])

  return null
}
