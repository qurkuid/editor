import { type MessageId, useT } from '@pascal-app/editor'
import { Check, MousePointer2, PaintBucket, Ruler } from 'lucide-react'

type WorkflowMode = 'build' | 'hidden' | 'material-paint'

type BuildWorkflowGuideProps = {
  readonly activeLabel: string | null
  readonly hasPaintMaterial: boolean
  readonly mode: WorkflowMode
}

type WorkflowStep = {
  readonly label: string
  readonly state: 'active' | 'complete' | 'upcoming'
}

function StepMarker({
  index,
  state,
}: {
  readonly index: number
  readonly state: WorkflowStep['state']
}) {
  return (
    <span
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-semibold text-[10px] ${
        state === 'complete'
          ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-300'
          : state === 'active'
            ? 'border-primary/60 bg-primary/15 text-primary'
            : 'border-border/70 bg-background/40 text-muted-foreground'
      }`}
    >
      {state === 'complete' ? <Check className="h-3 w-3" /> : index}
    </span>
  )
}

export function BuildWorkflowGuide({
  activeLabel,
  hasPaintMaterial,
  mode,
}: BuildWorkflowGuideProps) {
  const t = useT()
  if (mode === 'hidden') return null

  const step = (key: MessageId, state: WorkflowStep['state']): WorkflowStep => ({
    label: t(key),
    state,
  })

  const isPaint = mode === 'material-paint'
  const isOpeningTool = mode === 'build' && activeLabel === 'Door'
  const steps: readonly WorkflowStep[] = isPaint
    ? [
        step(
          'buildWorkflowGuide.paintSteps.chooseMaterial',
          hasPaintMaterial ? 'complete' : 'active',
        ),
        step(
          'buildWorkflowGuide.paintSteps.clickSurface',
          hasPaintMaterial ? 'active' : 'upcoming',
        ),
        step('buildWorkflowGuide.paintSteps.adjustSize', 'upcoming'),
      ]
    : isOpeningTool
      ? [
          step('buildWorkflowGuide.doorSteps.selectDoor', 'complete'),
          step('buildWorkflowGuide.doorSteps.placeOnWall', 'active'),
          step('buildWorkflowGuide.doorSteps.typeOpening', 'upcoming'),
          step('buildWorkflowGuide.doorSteps.adjustRounded', 'upcoming'),
        ]
      : [
          {
            label: activeLabel ?? t('buildWorkflowGuide.defaultSteps.selectElement'),
            state: activeLabel ? 'complete' : 'active',
          },
          step('buildWorkflowGuide.defaultSteps.clickAnchor', activeLabel ? 'active' : 'upcoming'),
          step('buildWorkflowGuide.defaultSteps.setDirection', 'upcoming'),
          step('buildWorkflowGuide.defaultSteps.finalClick', 'upcoming'),
        ]

  return (
    <section
      className="overflow-hidden rounded-xl border border-border/70 bg-background/60 shadow-sm"
      data-testid="build-workflow-guide"
    >
      <div className="flex items-center gap-2 border-border/60 border-b px-2.5 py-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {isPaint ? <PaintBucket className="h-3.5 w-3.5" /> : <Ruler className="h-3.5 w-3.5" />}
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-xs">
            {isPaint ? t('buildWorkflowGuide.paint.title') : t('buildWorkflowGuide.model.title')}
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            {isPaint ? t('buildWorkflowGuide.paint.desc') : t('buildWorkflowGuide.model.desc')}
          </p>
        </div>
        <MousePointer2 className="ml-auto h-3.5 w-3.5 text-muted-foreground/60" />
      </div>
      <ol className="grid gap-1 px-2.5 py-2">
        {steps.map((currentStep, index) => (
          <li className="flex items-center gap-2" key={currentStep.label}>
            <StepMarker index={index + 1} state={currentStep.state} />
            <span
              className={`text-[11px] ${
                currentStep.state === 'active'
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground'
              }`}
            >
              {currentStep.label}
            </span>
          </li>
        ))}
      </ol>
      {!isPaint && !isOpeningTool ? (
        <p className="border-border/60 border-t px-2.5 py-2 text-[10px] text-muted-foreground">
          {t('buildWorkflowGuide.editHint')}
        </p>
      ) : null}
    </section>
  )
}
