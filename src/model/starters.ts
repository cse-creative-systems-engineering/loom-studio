/**
 * Starters: ready-made arrangements of real tools.
 *
 * A starter is NOT a component. Dropping one inserts ordinary nodes, the same
 * ones a person could have dragged in one by one, already arranged and wired.
 * Nothing about the result is special afterwards: every piece is selectable,
 * restyleable and deletable on its own. That is the point of building a chat
 * from tools instead of shipping a Chat component, and a starter is how that
 * choice stays quick to start from.
 *
 * References between the nodes (a Composer's "Sends to") are written as
 * `@name` and resolved to the new ids at drop time, so every drop is wired to
 * its OWN list, never to the list from an earlier drop.
 */

import { takeShorthand } from './grid'
import { BUILTIN_STYLES, cloneLookSet, type LookSet } from './look'
import type { Node, NodeId, PropValue } from './types'
import { getComponent, instantiate } from './registry'

export interface StarterNode {
  type: string
  props?: Record<string, PropValue>
  /** Lay this container's children out in flow. */
  flow?: boolean
  /** A name other nodes in the same starter can reference as `@name`. */
  ref?: string
  /** Its look: a built-in style's id, or a whole look (model/look.ts). */
  look?: string | LookSet
  children?: StarterNode[]
}

export interface Starter {
  id: string
  label: string
  icon: string
  description: string
  tree: StarterNode
}

const row = (children: StarterNode[]): StarterNode => ({
  type: 'Stack',
  flow: true,
  props: { direction: 'row', align: 'end', gap: 8 },
  children,
})
const assistant = (text: string, time: string): StarterNode =>
  row([
    { type: 'Avatar', props: { initials: 'AI', size: 28, ariaLabel: 'Assistant' } },
    { type: 'MessageBubble', props: { author: 'Assistant', text, time } },
  ])

export const STARTERS: Starter[] = [
  {
    id: 'chat-sidebar',
    label: 'Chat sidebar',
    icon: '◧',
    description: 'A sidebar docked to the left edge with a conversation and a composer that sends into it. Every piece is a normal tool you can restyle or remove.',
    tree: {
      type: 'SidebarPanel',
      flow: true,
      props: { anchor: 'left', width: 360, padding: 12, gap: 8, ariaLabel: 'Assistant' },
      children: [
        { type: 'HeaderBar', props: { title: 'Assistant', height: 48 } },
        {
          type: 'MessageList',
          ref: 'list',
          flow: true,
          props: { showTyping: true, typingLabel: 'Assistant is typing' },
          children: [
            { type: 'Divider', props: { label: 'Today', margin: 4 } },
            assistant('Hi! I can find anything in your workspace. What are you looking for?', '9:41'),
            // The template: what a message you send in the preview looks like.
            { type: 'MessageBubble', props: { side: 'sent', text: 'What shipped last week?', time: '9:42', status: 'read', showAuthor: false, template: true } },
            assistant('Three releases: the new billing page, faster search, and dark mode for exports.', '9:42'),
          ],
        },
        {
          type: 'Composer',
          flow: true,
          props: { sendsTo: '@list', placeholder: 'Ask anything…' },
          children: [{ type: 'IconButton', props: { icon: 'paperclip', variant: 'ghost', ariaLabel: 'Attach a file' } }],
        },
      ],
    },
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: '▦',
    description: 'A page of headline numbers, a trend and a table: three KPI cards, a line chart and a sortable grid, laid out in flow.',
    tree: {
      type: 'Panel',
      flow: true,
      props: { w: 1040, padding: 28, gap: 20, ariaLabel: 'Overview' },
      children: [
        {
          type: 'Stack',
          flow: true,
          props: { gap: 4 },
          children: [
            { type: 'Heading', props: { text: 'Overview', level: '1' } },
            { type: 'Caption', props: { text: 'Last 30 days · updated just now', size: 'sm' } },
          ],
        },
        {
          type: 'Grid',
          flow: true,
          props: { columns: 3, gap: 16 },
          children: [
            { type: 'KpiCard', props: { width: 317, label: 'Revenue', value: '$48.2k', delta: '+12.4%', trend: 'up' } },
            { type: 'KpiCard', props: { width: 317, label: 'Active users', value: '12,480', delta: '+3.1%', trend: 'up', points: '40,42,41,45,47,46,50,53' } },
            { type: 'KpiCard', props: { width: 317, label: 'Churn', value: '2.1', unit: '%', delta: '-0.4%', trend: 'down', goodDirection: 'down', visual: 'bars', points: '30,28,29,26,25,23,22,21' } },
          ],
        },
        {
          type: 'Panel',
          flow: true,
          props: { title: 'Weekly traffic', padding: 18, gap: 10 },
          children: [{ type: 'LineChart', props: { width: 948, height: 180, points: '420,510,480,620,590,710,760', showArea: true, curve: 'smooth', ariaLabel: 'Weekly traffic' } }],
        },
        { type: 'DataGrid', props: { title: 'Customers', columns: 'Customer,Plan,Seats,MRR,Status', rows: 'Northwind|Team|24|$1,150|Active;Globex|Enterprise|310|$12,400|Active;Initech|Starter|5|$90|Trial;Umbrella|Team|48|$2,300|Past due', ariaLabel: 'Customers' } },
      ],
    },
  },
  {
    id: 'settings-page',
    label: 'Settings page',
    icon: '⚙',
    description: 'Account settings in sections: profile fields, notification switches, and a save bar at the end.',
    tree: {
      type: 'Panel',
      flow: true,
      props: { w: 720, padding: 28, gap: 20, ariaLabel: 'Settings' },
      children: [
        { type: 'Heading', props: { text: 'Settings', level: '1' } },
        {
          type: 'SettingsSection',
          flow: true,
          props: { title: 'Profile', description: 'How you appear to your team.' },
          children: [
            { type: 'SettingsRow', flow: true, props: { label: 'Display name', align: 'left' }, children: [{ type: 'Input', props: { value: 'Ada Lovelace', ariaLabel: 'Display name' } }] },
            { type: 'SettingsRow', flow: true, props: { label: 'Email', align: 'left' }, children: [{ type: 'Input', props: { value: 'ada@example.com', type: 'email', ariaLabel: 'Email' } }] },
          ],
        },
        {
          type: 'SettingsSection',
          flow: true,
          props: { title: 'Notifications' },
          children: [
            { type: 'SettingsRow', flow: true, props: { label: 'Product updates', description: 'New features, once a month.', align: 'left' }, children: [{ type: 'Switch', props: { label: '', on: true, ariaLabel: 'Product updates' } }] },
            { type: 'SettingsRow', flow: true, props: { label: 'Weekly digest', align: 'left' }, children: [{ type: 'Switch', props: { label: '', ariaLabel: 'Weekly digest' } }] },
          ],
        },
        {
          type: 'Stack',
          flow: true,
          props: { direction: 'row', justify: 'end', gap: 8 },
          children: [
            { type: 'Button', props: { label: 'Cancel', variant: 'secondary' } },
            { type: 'Button', props: { label: 'Save changes' } },
          ],
        },
      ],
    },
  },
  {
    id: 'sign-in',
    label: 'Sign-in',
    icon: '⚿',
    description: 'A sign-in card: email and password fields, a remember-me box, the primary action and a recovery link.',
    tree: {
      type: 'Card',
      flow: true,
      props: { w: 380, padding: 28, gap: 14, ariaLabel: 'Sign in' },
      children: [
        {
          type: 'Stack',
          flow: true,
          props: { gap: 4 },
          children: [
            { type: 'Heading', props: { text: 'Sign in', level: '2' } },
            { type: 'Caption', props: { text: 'Welcome back. Enter your details to continue.', size: 'sm' } },
          ],
        },
        { type: 'Field', flow: true, props: { label: 'Email' }, children: [{ type: 'Input', props: { width: 324, type: 'email', placeholder: 'you@example.com', ariaLabel: 'Email' } }] },
        { type: 'Field', flow: true, props: { label: 'Password' }, children: [{ type: 'PasswordInput', props: { width: 324, ariaLabel: 'Password' } }] },
        { type: 'Checkbox', props: { label: 'Keep me signed in' } },
        { type: 'Button', props: { label: 'Sign in', fullWidth: true, type: 'submit' } },
        { type: 'Link', props: { text: 'Forgot your password?', underline: false, size: 'sm' } },
      ],
    },
  },
  {
    id: 'light-study',
    label: 'Light study',
    icon: '☀',
    description: 'Every material, lit by one sun: floating, clay, glass, gloss, neon, pressed in. Press ☀ in the canvas toolbar and drag the sun.',
    tree: {
      type: 'Panel',
      flow: true,
      props: { w: 960, padding: 56, gap: 32, align: 'stretch' },
      children: [
        {
          type: 'Stack',
          flow: true,
          props: { gap: 6 },
          children: [
            { type: 'Heading', props: { text: 'Light study', level: 1 } },
            { type: 'Paragraph', props: { text: 'One sun lights everything here. Press ☀ in the canvas toolbar and drag the sun: every shadow, bevel and sheen follows.' } },
          ],
        },
        {
          type: 'Stack',
          flow: true,
          props: { direction: 'row', gap: 24, align: 'stretch' },
          children: [
            { type: 'Card', flow: true, look: 'floating', props: { title: 'Floating', w: 268, h: null as unknown as number, gap: 6 }, children: [{ type: 'Paragraph', props: { text: 'High above the page. Its shadow falls far from the light, long and soft.' } }] },
            { type: 'Card', flow: true, look: 'clay', props: { title: 'Clay', w: 268, h: null as unknown as number, gap: 6 }, children: [{ type: 'Paragraph', props: { text: 'Pillowy relief: the edge toward the light is lit, the far edge shaded.' } }] },
            { type: 'Card', flow: true, look: 'glass', props: { title: 'Glass', w: 268, h: null as unknown as number, gap: 6 }, children: [{ type: 'Paragraph', props: { text: 'Its own colour, frosted. A lit edge, and whatever is behind it blurred.' } }] },
          ],
        },
        {
          type: 'Stack',
          flow: true,
          look: 'pressed-in',
          props: { direction: 'row', gap: 16, align: 'center', padding: 24 },
          children: [
            { type: 'Button', look: 'raised', props: { label: 'Raised' } },
            { type: 'Button', look: 'gloss', props: { label: 'Gloss', variant: 'secondary' } },
            { type: 'Button', look: 'ripple', props: { label: 'Ripple' } },
            { type: 'Button', look: 'neon', props: { label: 'Neon edge', variant: 'ghost' } },
            { type: 'Button', look: 'traced', props: { label: 'Traced', variant: 'secondary' } },
          ],
        },
        { type: 'Input', look: 'pressed-in', props: { placeholder: 'A field pressed into the surface', width: 420 } },
      ],
    },
  },
  {
    id: 'landing-hero',
    label: 'Landing hero',
    icon: '★',
    description: 'The top of a landing page: a headline, a supporting line and two calls to action, centred.',
    tree: {
      type: 'Hero',
      flow: true,
      props: { w: 960, padding: 56, gap: 20, title: 'Interfaces that actually work', subtitle: 'Design it, run it, ship it: every component behaves in the preview exactly as it will in production.' },
      children: [
        {
          type: 'Stack',
          flow: true,
          props: { direction: 'row', justify: 'center', gap: 12 },
          children: [
            { type: 'Button', props: { label: 'Get started', size: 'lg' } },
            { type: 'Button', props: { label: 'See it run', variant: 'secondary', size: 'lg' } },
          ],
        },
      ],
    },
  },
]

export function getStarter(id: string): Starter | undefined {
  return STARTERS.find((s) => s.id === id)
}

/**
 * Materialise a starter as fresh nodes: the root, and every other node keyed
 * by id (the shape an `insert` op's `tree` takes, so the drop is ONE undo
 * step). Throws on an unknown tool or an unresolved `@reference`: a starter
 * that cannot be built exactly is a bug to fix, not a drop to approximate.
 */
export function buildStarter(starter: Starter, newId: () => NodeId): { root: Node; tree: Record<NodeId, Node> } {
  const refs = new Map<string, NodeId>()
  const made: Array<{ node: Node; source: StarterNode }> = []
  const build = (src: StarterNode): Node => {
    const built = instantiate(src.type)
    const id = newId()
    if (src.ref) refs.set(src.ref, id)
    const props: Record<string, PropValue> = { ...built.props, ...(src.props ?? {}), x: 0, y: 0 }
    const lists = takeShorthand(src.type, props)
    const look = typeof src.look === 'string' ? BUILTIN_STYLES.find((x) => x.id === src.look)?.set : src.look
    if (src.look !== undefined && !look) throw new Error(`starter: unknown style ${String(src.look)}`)
    const node: Node = {
      id,
      type: src.type,
      props,
      ...(look ? { looks: { '': cloneLookSet(look) } } : {}),
      ...(lists ? { lists } : {}),
      children: [],
      flow: src.flow ?? built.flow,
      visible: true,
      locked: false,
      opacity: 1,
    }
    made.push({ node, source: src })
    node.children = (src.children ?? []).map((c) => build(c).id)
    return node
  }
  const root = build(starter.tree)
  for (const { node } of made) {
    const spec = getComponent(node.type)
    for (const [key, ps] of Object.entries(spec?.props ?? {})) {
      const v = node.props[key]
      if (ps.type !== 'node' || typeof v !== 'string' || !v.startsWith('@')) continue
      const id = refs.get(v.slice(1))
      if (!id) throw new Error(`starter ${starter.id}: unresolved reference ${v}`)
      node.props[key] = id
    }
  }
  const tree: Record<NodeId, Node> = {}
  for (const { node } of made) if (node.id !== root.id) tree[node.id] = node
  return { root, tree }
}
