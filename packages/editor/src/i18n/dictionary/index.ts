import { actionMenuDictionary } from './action-menu'
import { aiChatDictionary } from './ai-chat'
import { bodyModelingDictionary } from './body-modeling'
import { buildWorkflowGuideDictionary } from './build-workflow-guide'
import { commonDictionary } from './common'
import { furnitureDictionary, statsDictionary } from './furniture'
import { hostSettingsDictionary } from './host-settings'
import { lightingDictionary } from './lighting'
import { materialsDictionary } from './materials'
import { nodeInspectorDictionary } from './node-inspector'
import { paintingDictionary } from './painting'
import { rawpainterDictionary } from './rawpainter'
import { scenesDictionary } from './scenes'
import { settingsDictionary } from './settings'
import { sidebarTabsDictionary } from './sidebar-tabs'
import { viewerChromeDictionary } from './viewer-chrome'

// Split by feature domain (one file per surface / owning team) so
// concurrent editors add message ids without colliding on one giant
// object literal. Every id is namespaced by its domain prefix
// (`settings.*`, `furniture.*`, ...), so a plain spread merge here is
// safe — TypeScript's excess-property checks on each domain file already
// catch shape mistakes, and unique prefixes rule out cross-domain key
// collisions in practice.
export const DICTIONARY = {
  ...commonDictionary,
  ...sidebarTabsDictionary,
  ...actionMenuDictionary,
  ...viewerChromeDictionary,
  ...materialsDictionary,
  ...nodeInspectorDictionary,
  ...scenesDictionary,
  ...statsDictionary,
  ...settingsDictionary,
  ...hostSettingsDictionary,
  ...furnitureDictionary,
  ...lightingDictionary,
  ...paintingDictionary,
  ...buildWorkflowGuideDictionary,
  ...aiChatDictionary,
  ...rawpainterDictionary,
  ...bodyModelingDictionary,
}
