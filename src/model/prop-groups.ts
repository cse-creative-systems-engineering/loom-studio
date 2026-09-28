/**
 * Which group a property belongs to, and the order the groups come in.
 *
 * Groups were whatever each component's author typed, and the same property
 * landed in different groups on different components: `value` in Content,
 * State or Data; `align` in Style, Layout or Type; `size` in Layout, Style
 * or a "Size" group of its own while width and height sat in Layout; a
 * "Logic" group held `href` and `duration`. Content had become a drawer for
 * anything, list separators far from their lists, "show X" switches far from
 * X. A panel that files one thing under three names is a panel you search
 * instead of read.
 *
 * So a property's group is decided HERE, once, by what it means, and applied
 * to every component at registration. The declared group is only the
 * fallback for keys this file does not know.
 */

import type { PropSpec } from './registry'

/** The order a person thinks about a component in. */
export const GROUP_ORDER = [
  'Content', // what it says and shows
  'Data', // the numbers behind it
  'Behaviour', // what it does, where it goes
  'State', // what it is right now
  'Layout', // how its insides are arranged
  'Size', // how big it is
  'Style', // how it looks
  'Type', // how its text looks
  'Position', // where it sits
  'Accessibility', // what assistive tech hears
] as const

export type GroupName = (typeof GROUP_ORDER)[number]

const BY_KEY: Record<string, GroupName> = {}
const put = (group: GroupName, keys: string) => {
  for (const k of keys.split(/\s+/).filter(Boolean)) BY_KEY[k] = group
}

put('Behaviour', `href target rel action type hotkey trigger duration dismissible removable sortable selectable search
  hoverable interactive autocomplete accept name maxLength sendsTo enterSends stickToBottom template saveBar rowActions
  railOnCollapse multiple reveal bulkActions`)
put('State', `disabled readOnly required checked selected open collapsed expanded active current loading indeterminate
  pressed on dirty page sortColumn sortDirection expandDepth`)
put('Data', `min step points values warnAt dangerAt unit precision trend goodDirection total itemCount pageSize progress
  referenceAt delta deltaLabel count month weekStart days offset visual today`)
put('Size', `width height size fullWidth minHeight aspect ratio maxRows listHeight sidebarWidth topbarHeight railWidth
  widthCap length`)
put('Layout', `padding paddingX paddingY gap direction justify wrap rows orientation density indent layout side
  scrollbars contentPadding stickyHeader labelAlign labelWidth buttonAlign stretch siblings markerGap margin freezeFirst
  divided dividers`)
put('Style', `background border borderWidth radius shadow variant accent elevation surface glass glow`)
put('Type', `fontSize fontWeight lineHeight letterSpacing truncate uppercase italic clamp`)
put('Position', `anchor rotate sticky`)
put('Accessibility', `ariaLabel live`)

/**
 * The group for one property of one component. Most keys mean one thing
 * everywhere; the few that do not are decided by what they hold.
 */
export function groupFor(key: string, ps: PropSpec, component: { container?: boolean; rendersText?: boolean }): string {
  switch (key) {
    // A container aligns its children; a leaf aligns its text.
    case 'align':
      return component.container ? 'Layout' : 'Type'
    // A number is data (a slider's value); words are content (an input's).
    case 'value':
      return ps.type === 'number' ? 'Data' : ps.type === 'boolean' ? 'State' : 'Content'
    case 'max':
    case 'maxItems':
    case 'steps':
    case 'columns':
      // A count or bound is data; a list of words (a grid's column names,
      // a stepper's step titles) is content.
      return ps.type === 'number' ? (key === 'columns' ? 'Layout' : 'Data') : 'Content'
    // The measure of a line of text is typography; a box's cap is its size.
    case 'maxWidth':
      return component.container ? 'Size' : 'Type'
    // An enum is how the box clips; a switch is a "+3 more" count (content).
    case 'overflow':
      return ps.type === 'enum' ? 'Layout' : 'Content'
    // The text colour is typography; a line's or a mark's colour is style.
    case 'color':
      return ps.group === 'Type' ? 'Type' : 'Style'
    // A validation tone (Field, Input) is state; a colour intent is style.
    case 'tone':
      return ps.group === 'State' ? 'State' : 'Style'
    // What a validation message says is content.
    case 'message':
      return 'Content'
    case 'icon':
      return 'Content'
    // Where it is only what a screen reader announces (an icon's, a
    // spinner's), a label is accessibility; everywhere else it is the words.
    case 'label':
      return ps.group === 'Accessibility' ? 'Accessibility' : 'Content'
    default:
      break
  }
  const known = BY_KEY[key]
  if (known) return known
  // Keys this file does not name keep their author's group, mapped onto the
  // shared names.
  const declared = ps.group ?? 'Content'
  if (declared === 'Logic') return 'Behaviour'
  if (declared === 'General') return 'Content'
  return (GROUP_ORDER as readonly string[]).includes(declared) ? declared : 'Content'
}

/**
 * Put related keys next to each other inside a group: a list's separator
 * right after the list, a "show X" switch right before X.
 */
export function relatedOrder(keys: string[]): string[] {
  const out = keys.filter((k) => !(/Sep$/.test(k) && keys.includes(k.slice(0, -3))) && !showsKey(k, keys))
  const place = (k: string, before: boolean, anchor: string) => {
    const i = out.indexOf(anchor)
    out.splice(before ? i : i + 1, 0, k)
  }
  for (const k of keys) {
    if (/Sep$/.test(k) && keys.includes(k.slice(0, -3))) place(k, false, k.slice(0, -3))
  }
  for (const k of keys) {
    const subject = showsKey(k, keys)
    if (subject) place(k, true, subject)
  }
  return out
}

/** `showIcon` -> `icon` when both exist in the same list. */
function showsKey(k: string, keys: string[]): string | undefined {
  const m = /^show([A-Z]\w*)$/.exec(k)
  if (!m) return undefined
  const subject = m[1]!.charAt(0).toLowerCase() + m[1]!.slice(1)
  return keys.includes(subject) ? subject : undefined
}
