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

import type { Node, NodeId, PropValue } from './types'
import { getComponent, instantiate } from './registry'

export interface StarterNode {
  type: string
  props?: Record<string, PropValue>
  /** Lay this container's children out in flow. */
  flow?: boolean
  /** A name other nodes in the same starter can reference as `@name`. */
  ref?: string
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
          children: [
            { type: 'Divider', props: { label: 'Today', margin: 4 } },
            assistant('Hi! I can find anything in your workspace. What are you looking for?', '9:41'),
            // The template: what a message you send in the preview looks like.
            { type: 'MessageBubble', props: { side: 'sent', text: 'What shipped last week?', time: '9:42', status: 'read', showAuthor: false, template: true } },
            assistant('Three releases: the new billing page, faster search, and dark mode for exports.', '9:42'),
            { type: 'TypingIndicator', props: { label: 'Assistant is typing' } },
          ],
        },
        {
          type: 'Composer',
          flow: true,
          props: { sendsTo: '@list', placeholder: 'Ask anything…' },
          children: [{ type: 'IconButton', props: { icon: 'plus', variant: 'ghost', ariaLabel: 'Attach a file' } }],
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
    const node: Node = {
      id,
      type: src.type,
      props: { ...built.props, ...(src.props ?? {}), x: 0, y: 0 },
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
