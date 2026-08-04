'use client'

import { useEffect } from 'react'
import { useT } from '../../i18n/use-t'
import useDeleteConfirmation from '../../store/use-delete-confirmation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/primitives/dialog'

export function DeleteConfirmationDialog() {
  const t = useT()
  const request = useDeleteConfirmation((state) => state.request)
  const cancel = useDeleteConfirmation((state) => state.cancel)
  const confirm = useDeleteConfirmation((state) => state.confirm)

  useEffect(() => cancel, [cancel])

  return (
    <Dialog onOpenChange={(open) => !open && cancel()} open={request !== null}>
      <DialogContent
        className="border-border/70 bg-background/95 shadow-2xl backdrop-blur-xl sm:max-w-md"
        data-delete-confirmation-dialog
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>
            {t('panel.deleteNElements').replace('{n}', String(request?.count ?? 0))}
          </DialogTitle>
          <DialogDescription>{t('panel.deleteNElementsDescription')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button
            className="rounded-full border border-border px-4 py-2 text-sm transition-colors hover:bg-accent"
            onClick={cancel}
            type="button"
          >
            {t('chrome.cancel')}
          </button>
          <button
            className="rounded-full bg-red-600 px-4 py-2 text-sm text-white transition-colors hover:bg-red-700"
            onClick={confirm}
            type="button"
          >
            {t('chrome.delete')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
