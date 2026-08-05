import { Keyboard } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from './../../../../../components/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './../../../../../components/ui/primitives/dialog'
import { ShortcutToken } from './../../../../../components/ui/primitives/shortcut-token'
import type { MessageId } from '../../../../../i18n/translate'
import { useT } from '../../../../../i18n/use-t'
import {
  type RebindableShortcutId,
  resolveShortcutKey,
} from '../../../../../lib/keyboard-shortcuts'
import { cn } from '../../../../../lib/utils'
import useEditor from '../../../../../store/use-editor'

type Shortcut = {
  keys: string[]
  actionKey: MessageId
  noteKey?: MessageId
  /** Present when the key can be reassigned from this page (click the chip). */
  rebindId?: RebindableShortcutId
}

type ShortcutCategory = {
  titleKey: MessageId
  shortcuts: Shortcut[]
}

const KEY_DISPLAY_MAP: Record<string, string> = {
  'Arrow Up': '↑',
  'Arrow Down': '↓',
  Esc: '⎋',
  Shift: '⇧',
  Space: '␣',
}

const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    titleKey: 'panel.editorNavigation',
    shortcuts: [
      { keys: ['1'], actionKey: 'panel.shortcutSwitchToSitePhase', rebindId: 'phase-site' },
      {
        keys: ['2'],
        actionKey: 'panel.shortcutSwitchToStructurePhase',
        rebindId: 'phase-structure',
      },
      { keys: ['3'], actionKey: 'panel.shortcutSwitchToFurnishPhase', rebindId: 'phase-furnish' },
      { keys: ['F'], actionKey: 'panel.shortcutSwitchToFurnishLayer', rebindId: 'tool-furnish' },
      { keys: ['Z'], actionKey: 'panel.shortcutSwitchToZonesLayer', rebindId: 'tool-zone' },
      {
        keys: ['Cmd/Ctrl', 'Arrow Up'],
        actionKey: 'panel.shortcutSelectNextLevelInTheActiveBuilding',
      },
      {
        keys: ['Cmd/Ctrl', 'Arrow Down'],
        actionKey: 'panel.shortcutSelectPreviousLevelInTheActiveBuilding',
      },
      { keys: ['Cmd/Ctrl', 'B'], actionKey: 'panel.shortcutToggleSidebar' },
    ],
  },
  {
    titleKey: 'panel.modesHistory',
    shortcuts: [
      { keys: ['V'], actionKey: 'panel.shortcutSwitchToSelectMode', rebindId: 'mode-select' },
      {
        keys: ['Q'],
        actionKey: 'panel.shortcutPivotRotate',
        noteKey: 'panel.shortcutPivotRotateNote',
        rebindId: 'pivot-rotate',
      },
      { keys: ['B'], actionKey: 'panel.shortcutSwitchToBuildMode', rebindId: 'mode-build' },
      {
        keys: ['M'],
        actionKey: 'panel.shortcutActivateTheLastMeasurementTool',
        rebindId: 'tool-measurement',
      },
      {
        keys: ['L'],
        actionKey: 'panel.shortcutGuideLine',
        noteKey: 'panel.shortcutGuideLineNote',
        rebindId: 'tool-guide',
      },
      { keys: ['X'], actionKey: 'panel.shortcutSwitchToDeleteMode', rebindId: 'mode-delete' },
      {
        keys: ['Esc'],
        actionKey: 'panel.shortcutCancelTheActiveToolAndReturnToSelectMode',
      },
      { keys: ['Delete / Backspace'], actionKey: 'panel.shortcutDeleteSelectedObjects' },
      { keys: ['Cmd/Ctrl', 'Z'], actionKey: 'panel.shortcutUndo' },
      { keys: ['Cmd/Ctrl', 'Shift', 'Z'], actionKey: 'panel.shortcutRedo' },
    ],
  },
  {
    titleKey: 'panel.selection',
    shortcuts: [
      {
        keys: ['Cmd/Ctrl', 'C'],
        actionKey: 'panel.shortcutCopyTheSelectedObjects',
        noteKey: 'panel.noteTheCopiedSelectionCanBePasted',
      },
      {
        keys: ['Cmd/Ctrl', 'X'],
        actionKey: 'panel.shortcutCutTheSelectedObjects',
        noteKey: 'panel.noteCopiesTheSelectionToTheClipboard',
      },
      {
        keys: ['Cmd/Ctrl', 'V'],
        actionKey: 'panel.shortcutPasteAndPlaceCopiedObjects',
        noteKey: 'panel.noteCarriesAPreviewUnderTheCursor',
      },
      {
        keys: ['Cmd/Ctrl', 'Left click'],
        actionKey: 'panel.shortcutAddOrRemoveAnObjectFromMultiSelection',
        noteKey: 'panel.noteWorksInSelectModeOnThe',
      },
      {
        keys: ['Shift', 'Left click'],
        actionKey: 'panel.shortcutAddOrRemoveAnObjectFromCanvasMultiSelection',
        noteKey: 'panel.noteInTheSceneGraphShiftClick',
      },
      {
        keys: ['Left click'],
        actionKey: 'panel.shortcutMoveTheWholeMultiSelection',
        noteKey: 'panel.noteWith2ObjectsSelected',
      },
      {
        keys: ['R', 'T'],
        actionKey: 'panel.shortcutRotateAMultiSelection45AroundItsCenter',
        noteKey: 'panel.noteAlsoWorksMidMoveWhileCarrying',
      },
      {
        keys: ['Esc'],
        actionKey: 'panel.shortcutClearTheSelection',
        noteKey: 'panel.noteClickingEmptySpaceDoesTheSame',
      },
    ],
  },
  {
    titleKey: 'panel.directManipulation',
    shortcuts: [
      {
        keys: ['Cmd/Ctrl', 'Left click'],
        actionKey: 'panel.shortcutMoveTheSelectedMovableObjectUnderTheCursor',
        noteKey: 'panel.noteDragInSelectModeWithA',
      },
      {
        keys: ['Cmd/Ctrl', 'Right click'],
        actionKey: 'panel.shortcutRotateTheSelectedObjectUnderTheCursor',
        noteKey: 'panel.noteDragLeftOrRightInSelect',
      },
      {
        keys: ['Cmd/Ctrl', 'Shift', 'Right click'],
        actionKey: 'panel.shortcutRotateFreely',
        noteKey: 'panel.noteHoldShiftDuringTheDragTo',
      },
    ],
  },
  {
    titleKey: 'panel.drawingTools',
    shortcuts: [
      {
        keys: ['Shift'],
        actionKey: 'panel.shortcutBypassGuidedSnappingAndAngleConstraints',
        noteKey: 'panel.noteHoldDuringTheActiveGesturePassive',
      },
      {
        keys: ['Shift'],
        actionKey: 'panel.shortcutRotateFreelyBypassingTheDefault15RotationSnap',
        noteKey: 'panel.noteHoldWhileDraggingARotateHandle',
      },
    ],
  },
  {
    titleKey: 'panel.itemPlacement',
    shortcuts: [
      {
        keys: ['R', 'T'],
        actionKey: 'panel.shortcutRotateItemWithADoorSelectedRTogglesOpenClosedAndTCloses',
      },
      {
        keys: ['E'],
        actionKey: 'panel.shortcutOperateTheSelectedNodeDoorsWindowsAndCabinetDoorsDrawersAnimateOpenClosed',
      },
      {
        keys: ['Shift'],
        actionKey: 'panel.shortcutTemporarilyBypassPlacementValidationConstraints',
        noteKey: 'panel.noteHoldWhilePlacing',
      },
    ],
  },
  {
    titleKey: 'common.camera',
    shortcuts: [
      {
        keys: ['W', 'A', 'S', 'D'],
        actionKey: 'panel.shortcutPanCamera',
        noteKey: 'panel.noteMovesInScreenSpaceSimilarTo',
      },
      {
        keys: ['Middle click'],
        actionKey: 'panel.shortcutPanCamera',
        noteKey: 'panel.noteDragWithTheMiddleMouseButton',
      },
      {
        keys: ['Right click'],
        actionKey: 'panel.shortcutOrbitCamera',
        noteKey: 'panel.noteDragWithTheRightMouseButton',
      },
    ],
  },
]

function getDisplayKey(key: string, isMac: boolean): string {
  const t = useT()
  if (key === 'Cmd/Ctrl') return isMac ? '⌘' : 'Ctrl'
  if (key === 'Delete / Backspace') return isMac ? '⌫' : 'Backspace'
  return KEY_DISPLAY_MAP[key] ?? key
}

/**
 * Click-to-rebind key chip: click, then press the new key. Escape (or blur)
 * cancels; reserved/taken keys keep capture open and show the warning.
 */
function RebindableKeyChip({ id }: { id: RebindableShortcutId }) {
  const t = useT()
  const overrides = useEditor((s) => s.shortcutOverrides)
  const setShortcutOverride = useEditor((s) => s.setShortcutOverride)
  const [capturing, setCapturing] = useState(false)
  const [rejected, setRejected] = useState(false)
  const key = resolveShortcutKey(id, overrides).toUpperCase()

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        aria-label={`${t('settings.keyboard.rebindHint')}: ${key}`}
        className={cn(
          'rounded border px-1.5 py-0.5 font-mono text-xs transition-colors',
          capturing
            ? 'border-ring bg-accent/60 text-foreground'
            : 'border-border/80 bg-background/60 text-foreground hover:border-ring/70',
        )}
        onBlur={() => {
          setCapturing(false)
          setRejected(false)
        }}
        onClick={() => {
          setCapturing((value) => !value)
          setRejected(false)
        }}
        onKeyDown={(event) => {
          if (!capturing) return
          event.preventDefault()
          event.stopPropagation()
          if (event.key === 'Escape') {
            setCapturing(false)
            setRejected(false)
            return
          }
          const candidate = event.key.toLowerCase()
          if (!/^[a-z0-9]$/.test(candidate)) return
          const applied = setShortcutOverride(id, candidate)
          setRejected(!applied)
          if (applied) setCapturing(false)
        }}
        type="button"
      >
        {capturing ? t('settings.keyboard.pressKey') : key}
      </button>
      {rejected ? (
        <span className="text-destructive text-xs">
          {t('settings.keyboard.rotateShortcutTaken')}
        </span>
      ) : null}
    </div>
  )
}

function ShortcutKeys({ keys }: { keys: string[] }) {
  const [isMac, setIsMac] = useState(true)

  useEffect(() => {
    setIsMac(navigator.platform.toUpperCase().indexOf('MAC') >= 0)
  }, [])

  return (
    <div className="flex flex-wrap items-center gap-1">
      {keys.map((key, index) => (
        <div className="flex items-center gap-1" key={`${key}-${index}`}>
          {index > 0 ? <span className="text-[10px] text-muted-foreground">+</span> : null}
          <ShortcutToken displayValue={getDisplayKey(key, isMac)} value={key} />
        </div>
      ))}
    </div>
  )
}

export function KeyboardShortcutsDialog() {
  const t = useT()
  const resetShortcutOverrides = useEditor((s) => s.resetShortcutOverrides)
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="w-full justify-start gap-2" variant="outline">
          <Keyboard className="size-4" />
          {t('panel.keyboardShortcuts')}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>{t('panel.keyboardShortcuts')}</DialogTitle>
          <DialogDescription>
            Shortcuts are context-aware. Guided constraints are enabled by default; hold Shift
            during an active gesture to build freely.
          </DialogDescription>
          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-muted-foreground text-xs">{t('settings.keyboard.rebindHint')}</p>
            <Button onClick={resetShortcutOverrides} size="sm" variant="outline">
              {t('settings.keyboard.resetShortcuts')}
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-4">
          {SHORTCUT_CATEGORIES.map((category) => (
            <section className="space-y-2" key={category.titleKey}>
              <h3 className="font-medium text-sm">{t(category.titleKey)}</h3>
              <div className="overflow-hidden rounded-md border border-border/80">
                {category.shortcuts.map((shortcut, index) => (
                  <div
                    className="grid grid-cols-[minmax(130px,220px)_1fr] gap-3 px-3 py-2"
                    key={`${category.titleKey}-${shortcut.actionKey}`}
                  >
                    {shortcut.rebindId ? (
                      <RebindableKeyChip id={shortcut.rebindId} />
                    ) : (
                      <ShortcutKeys keys={shortcut.keys} />
                    )}
                    <div>
                      <p className="text-sm">{t(shortcut.actionKey)}</p>
                      {shortcut.noteKey ? (
                        <p className="text-muted-foreground text-xs">{t(shortcut.noteKey)}</p>
                      ) : null}
                    </div>
                    {index < category.shortcuts.length - 1 ? (
                      <div className="col-span-2 border-border/60 border-b" />
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
