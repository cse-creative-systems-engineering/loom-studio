/**
 * The size a component arrives at when it is dropped from the toolbox.
 *
 * Most components have no size of their own: they are as big as their
 * content. For a leaf with words in it that is right (a Label is its text),
 * but an empty container has no content, so a dropped GroupBox, Panel or
 * Stack arrived as a 35px square or a 0x0 point, and a Divider or Paragraph
 * as a sliver. A drop should land as something you can see, drop into and
 * resize: this is that starting size. It is an ordinary w/h afterwards,
 * which the handles change like any other.
 *
 * Only for components that would otherwise be too small to work with; the
 * rest keep their natural size.
 */

import { getComponent } from './registry'
import type { PropValue } from './types'

const SIZES: Record<string, { w?: number; h?: number }> = {
  // Containers: a frame to drop things into.
  Panel: { w: 360, h: 240 },
  Card: { w: 320, h: 200 },
  Stack: { w: 320, h: 200 },
  Grid: { w: 360, h: 240 },
  Tabs: { w: 420, h: 260 },
  Accordion: { w: 360, h: 220 },
  Section: { w: 480, h: 240 },
  GroupBox: { w: 320, h: 200 },
  ScrollView: { w: 320 },
  SplitH: { w: 480, h: 280 },
  SplitV: { w: 360, h: 320 },
  Toolbar: { w: 480, h: 44 },
  StatusBar: { w: 480, h: 28 },
  AppShell: { w: 960, h: 600 },
  FormGrid: { w: 480, h: 200 },
  BannerBox: { w: 480, h: 96 },
  Hero: { w: 720, h: 360 },
  Drawer: { h: 420 },
  SidebarPanel: { h: 480 },
  KanbanColumn: { w: 260, h: 360 },
  DataCard: { w: 240, h: 140 },
  NotificationList: { w: 360, h: 280 },
  ButtonGroup: { w: 240, h: 36 },
  HeaderBar: { w: 480 },
  FooterBar: { w: 480 },
  SettingsSection: { w: 420 },
  CommandBar: { w: 420, h: 44 },
  MessageList: { w: 360, h: 420 },
  Composer: { w: 360 },
  Checklist: { w: 240 },
  // Leaves that are a line, not a shape: they need a width to be seen.
  Divider: { w: 320 },
  Skeleton: { w: 240 },
  Paragraph: { w: 360 },
  Quote: { w: 360 },
  Breadcrumbs: { w: 320 },
  DataGrid: { w: 820 },
}

/**
 * The w/h to give a component dropped into a free (`flow: false`) parent or
 * as the root, and into a flow parent (which places it and sets its width,
 * so only an empty container's height is given).
 */
export function dropSize(type: string, intoFlow: boolean): Record<string, PropValue> {
  const size = SIZES[type]
  if (!size) return {}
  const spec = getComponent(type)
  if (intoFlow) return spec?.container && size.h !== undefined ? { h: size.h } : {}
  const out: Record<string, PropValue> = {}
  if (size.w !== undefined) out.w = size.w
  if (size.h !== undefined) out.h = size.h
  return out
}
