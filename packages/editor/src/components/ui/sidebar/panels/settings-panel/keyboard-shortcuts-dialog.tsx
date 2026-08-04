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

type Shortcut = {
  keys: string[]
  actionKey: MessageId
  noteKey?: MessageId
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
      { keys: ['1'], actionKey: 'panel.shortcutSwitchToSitePhase' },
      { keys: ['2'], actionKey: 'panel.shortcutSwitchToStructurePhase' },
      { keys: ['3'], actionKey: 'panel.shortcutSwitchToFurnishPhase' },
      { keys: ['F'], actionKey: 'panel.shortcutSwitchToFurnishLayer' },
      { keys: ['Z'], actionKey: 'panel.shortcutSwitchToZonesLayer' },
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
      { keys: ['V'], actionKey: 'panel.shortcutSwitchToSelectMode' },
      { keys: ['B'], actionKey: 'panel.shortcutSwitchToBuildMode' },
      { keys: ['M'], actionKey: 'panel.shortcutActivateTheLastMeasurementTool' },
      { keys: ['X'], actionKey: 'panel.shortcutSwitchToDeleteMode' },
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
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="w-full justify-start gap-2" variant="outline">
          <Keyboard className="size-4" />
          Keyboard Shortcuts
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>{t('panel.keyboardShortcuts')}</DialogTitle>
          <DialogDescription>
            Shortcuts are context-aware. Guided constraints are enabled by default; hold Shift
            during an active gesture to build freely.
          </DialogDescription>
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
                    <ShortcutKeys keys={shortcut.keys} />
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
