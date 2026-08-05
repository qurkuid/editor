import type { Dictionary } from './types'

/** Icon-rail / tab-bar labels for the standalone editor app's top-level
 * sidebar sections (`SIDEBAR_TABS` in `apps/editor`). */
export const sidebarTabsDictionary = {
  'sidebarTabs.scene': { ko: '장면', en: 'Scene' },
  'sidebarTabs.modeling': { ko: '모델링', en: 'Modeling' },
  'sidebarTabs.furniture': { ko: '가구', en: 'Furniture' },
  'sidebarTabs.lighting': { ko: '조명', en: 'Lighting' },
  'sidebarTabs.items': { ko: '아이템', en: 'Items' },
  'sidebarTabs.painting': { ko: '도장', en: 'Painting' },
  'sidebarTabs.ai': { ko: 'AI', en: 'AI' },
  'sidebarTabs.stats': { ko: '통계', en: 'Takeoff' },
  'sidebarTabs.views': { ko: '뷰', en: 'Views' },
  'sidebarTabs.settings': { ko: '설정', en: 'Settings' },
} as const satisfies Dictionary
