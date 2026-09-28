/**
 * Conversation tools: the pieces a chat is made of, as separate tools.
 *
 * Deliberately NOT one Chat composite. A chat is a list, some bubbles and an
 * input, and each of those is useful on its own (a comment thread, an activity
 * feed, a reply box). Built from parts a designer can see and move, every area
 * of the result is theirs to change; a composite would be a black box with a
 * settings panel. A "Chat sidebar" STARTER (see `starters.ts`) drops a
 * ready-made arrangement of these, which is a group of real tools, not a tool.
 *
 * Each is here because no existing tool does its job:
 *  - MessageList is not a ScrollView: it opens at the NEWEST message and stays
 *    there while you are at the bottom, and appends what a Composer sends.
 *  - MessageBubble is not a Card: it knows which side it is on, groups with
 *    the message before it, and carries the time and delivery status.
 *  - Composer is not a Field: it grows as you type and Enter sends.
 *
 * Messages are added from the list's own panel ("Add received", "Add sent"),
 * and the typing indicator is an option of the list: on their own, neither
 * means anything, so neither is a separate tool.
 */

import { defineComponent, type PropSpec } from './registry'

const str = (d: string, group = 'Content', extra: Partial<PropSpec> = {}): PropSpec => ({ type: 'string', default: d, group, ...extra })
const bool = (d: boolean, group = 'Content'): PropSpec => ({ type: 'boolean', default: d, group })
const num = (d: number, group: string, min: number, max: number): PropSpec => ({ type: 'number', default: d, group, min, max })
const choice = (options: string[], d: string, group = 'Style'): PropSpec => ({ type: 'enum', options, default: d, group })

defineComponent({
  name: 'MessageList',
  category: 'Conversation',
  container: true,
  // The one component that opens in flow, and why: a list of messages IS a
  // column, newest at the bottom, and a message a Composer appends has to land
  // after the last one. Free-positioned messages could not be appended to.
  // The inspector's Flow switch still turns it off.
  defaultFlow: true,
  icon: '☰',
  description: 'A conversation: messages in order, opening at the newest. Add messages from its panel; what a Composer sends lands here.',
  adds: [
    { type: 'MessageBubble', label: 'Add received', props: { side: 'received', text: 'New message' } },
    { type: 'MessageBubble', label: 'Add sent', props: { side: 'sent', text: 'New reply', showAuthor: false } },
  ],
  props: {
    stickToBottom: bool(true, 'Behaviour'),
    // Someone is writing: three moving dots after the newest message. An
    // option of the list rather than a tool, because it only means anything
    // at the end of a conversation.
    showTyping: bool(false, 'Content'),
    typingLabel: str('Ada is typing'),
    gap: num(10, 'Layout', 0, 48),
    emptyText: str('No messages yet'),
    jumpLabel: str('New messages'),
    ariaLabel: str('Conversation', 'Accessibility'),
  },
  parts: {
    empty: { label: 'Empty', hint: 'What the list says before the first message', fields: ['text', 'box'] },
    jump: { label: 'Jump', hint: 'The pill that appears when a message arrives while you are scrolled up', fields: ['text', 'box'] },
    typingRow: { label: 'Typing row', hint: 'The dots and who is typing, side by side', fields: ['layout'] },
    typing: { label: 'Typing', hint: 'The bubble around the moving dots', fields: ['box', 'layout'] },
    typingDot: { label: 'Dots', hint: 'Each dot; the background is its colour', fields: ['box'] },
    typingLabel: { label: 'Typing label', hint: 'Who is typing', fields: ['text', 'box'] },
  },
})

defineComponent({
  name: 'MessageBubble',
  category: 'Conversation',
  container: true,
  icon: '◖',
  description: 'One message. Received on the left, sent on the right. Drop an Image or a CodeBlock in to attach it.',
  props: {
    text: str('Hey! How can I help?', 'Content', { bindable: true }),
    side: choice(['received', 'sent'], 'received', 'Content'),
    author: str('Ada'),
    showAuthor: bool(true),
    time: str('9:41'),
    showTime: bool(true),
    status: choice(['none', 'sending', 'sent', 'read'], 'none', 'Content'),
    tail: bool(true, 'Style'),
    // Consecutive messages from one sender read as one turn: no repeated name,
    // and the corner that joins them tightens.
    grouped: bool(false, 'Style'),
    widthCap: { type: 'number', default: 80, min: 30, max: 100, group: 'Layout', label: 'Max width (% of list)' },
    // The bubble a Composer copies for a new message, so a sent message looks
    // exactly like the design. Explicit, and visible here: never "the last
    // bubble on the right".
    template: bool(false, 'Behaviour'),
  },
  parts: {
    author: { label: 'Author', hint: 'The sender name above the message', fields: ['text', 'box'] },
    body: { label: 'Bubble', hint: 'The bubble itself, its text, and the space before any attachment', fields: ['text', 'box', 'layout'] },
    meta: { label: 'Meta', hint: 'The line under the bubble: time and status', fields: ['text', 'box', 'layout'] },
    time: { label: 'Time', hint: 'When it was sent', fields: ['text', 'box'] },
    status: { label: 'Status', hint: 'Sending, sent or read', fields: ['text', 'box'] },
  },
})

defineComponent({
  name: 'Composer',
  category: 'Conversation',
  container: true,
  icon: '⌨',
  description: 'Where a message is written. Grows as you type; Enter sends to the list you pick. Drop buttons in for attach or voice.',
  props: {
    sendsTo: { type: 'node', default: '', group: 'Behaviour', accepts: ['MessageList'], label: 'Sends to' },
    placeholder: str('Message…'),
    enterSends: bool(true, 'Behaviour'),
    showSend: bool(true),
    sendLabel: str('Send'),
    maxRows: num(6, 'Layout', 1, 20),
    disabled: bool(false, 'State'),
  },
  parts: {
    input: { label: 'Input', hint: 'The text box', fields: ['text', 'box'] },
    actions: { label: 'Actions', hint: 'The row holding your buttons and Send', fields: ['box', 'layout'] },
    send: { label: 'Send', hint: 'The send button', fields: ['text', 'box'] },
  },
})
