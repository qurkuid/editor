import { aiChatDictionary } from './ai-chat'
import { bodyModelingDictionary } from './body-modeling'
import { buildWorkflowGuideDictionary } from './build-workflow-guide'
import { furnitureDictionary, statsDictionary } from './furniture'
import { hostSettingsDictionary } from './host-settings'
import { lightingDictionary } from './lighting'
import { paintingDictionary } from './painting'
import { rawpainterDictionary } from './rawpainter'
import { settingsDictionary } from './settings'
import { sidebarTabsDictionary } from './sidebar-tabs'

// Split by feature domain (one file per surface / owning team) so
// concurrent editors add message ids without colliding on one giant
// object literal. Every id is namespaced by its domain prefix
// (`settings.*`, `furniture.*`, ...), so a plain spread merge here is
// safe — TypeScript's excess-property checks on each domain file already
// catch shape mistakes, and unique prefixes rule out cross-domain key
// collisions in practice.
export const DICTIONARY = {
  ...sidebarTabsDictionary,
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
