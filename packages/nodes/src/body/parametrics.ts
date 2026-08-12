import { getRoundedRectangularFrameParameters, type ParametricDescriptor } from '@pascal-app/core'
import { RoundedFrameOpeningEditor, RoundedFrameRadiusEditor } from './radius-editor'
import type { BodyNode } from './schema'

export const bodyParametrics: ParametricDescriptor<BodyNode> = {
  trailingSection: () => import('./sketchup-attributes'),
  groups: [
    {
      label: 'Rounded frame',
      fields: [
        {
          key: 'topCornerRadius',
          kind: 'custom',
          component: RoundedFrameRadiusEditor,
          visibleIf: (node) => getRoundedRectangularFrameParameters(node) !== null,
        },
        {
          key: 'openingPosition',
          kind: 'custom',
          component: RoundedFrameOpeningEditor,
          visibleIf: (node) => getRoundedRectangularFrameParameters(node) !== null,
        },
      ],
    },
  ],
}
