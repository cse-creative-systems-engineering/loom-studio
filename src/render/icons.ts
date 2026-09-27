/**
 * A real icon set.
 *
 * The toolbox had 82 distinct icon STRINGS — a mix of geometric glyphs, dingbats
 * and emoji — which is the visual equivalent of mixing three icon families in
 * one product. "Never mix icon styles" is table stakes, and it was impossible to
 * obey when the only way to change an icon was to type a different character.
 *
 * So: one curated set, one stroke weight, one 24px grid, and every icon string
 * in the toolbox is resolved through it. A string that matches a registered
 * NAME renders as that icon; anything else is treated as a literal glyph, which
 * is a real special case (an emoji brand mark is a legitimate icon) rather than
 * a fallback nobody thought about.
 *
 * The paths are 24x24, stroked, round-capped, and no fill — one family, drawn
 * once. They are compile-time constants in this file, never user input, so the
 * inner-markup string is not an injection surface.
 */

/** name -> inner SVG markup. */
export const ICONS: Record<string, string> = {
  // --- navigation & chrome ---
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/>',
  'chevron-up': '<path d="M6 15l6-6 6 6"/>',
  'chevron-down': '<path d="M6 9l6 6 6-6"/>',
  'chevron-left': '<path d="M15 6l-6 6 6 6"/>',
  'chevron-right': '<path d="M9 6l6 6-6 6"/>',
  'arrow-up': '<path d="M12 20V4M5 11l7-7 7 7"/>',
  'arrow-down': '<path d="M12 4v16M19 13l-7 7-7-7"/>',
  'arrow-left': '<path d="M20 12H4M11 5l-7 7 7 7"/>',
  'arrow-right': '<path d="M4 12h16M13 5l7 7-7 7"/>',
  'external-link': '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  sort: '<path d="M7 4v16M7 20l-3-3M7 4l3 3"/><path d="M17 20V4M17 4l3 3M17 20l-3-3"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  // --- actions ---
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="M4 12.5 9.5 18 20 6.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  edit: '<path d="M4 20h4L20 8l-4-4L4 16z"/><path d="M14 6l4 4"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h9"/>',
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h7V3"/><path d="M8 14h8v7H8z"/>',
  download: '<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/>',
  upload: '<path d="M12 21V9"/><path d="M7 13l5-5 5 5"/><path d="M4 4h16"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-1.5 6"/><path d="M20 5v6h-6"/>',
  undo: '<path d="M4 10h10a5 5 0 0 1 0 10h-3"/><path d="M4 10l4-4M4 10l4 4"/>',
  redo: '<path d="M20 10H10a5 5 0 0 0 0 10h3"/><path d="M20 10l-4-4M20 10l-4 4"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/>',
  // --- status & meta ---
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 8h.01"/>',
  'alert-triangle': '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7v.5M12 17h.01"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  star: '<path d="M12 3.5l2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6L3.4 9.9l6-.8z"/>',
  bell: '<path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  // --- objects & people ---
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3-5 7-5s7 1.5 7 5"/><path d="M16 5.2a3.5 3.5 0 0 1 0 5.6M17 15c2.6.4 5 1.8 5 5"/>',
  folder: '<path d="M3 6h6l2 2.5h10V19H3z"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M4 17l5-5 4 4 3-2 4 4"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  link: '<path d="M10 13a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2"/><path d="M14 11a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 19.7l1.2-1.2"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  eye: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6"/><circle cx="12" cy="12" r="2.5"/>',
  'eye-off': '<path d="M4 4l16 16"/><path d="M9.5 5.4A9.9 9.9 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.3 6.8A17 17 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 4.2-.9"/>',
  key: '<circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v3M15 12v2"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  zap: '<path d="M13 2 4 14h6l-1 8 9-12h-6z"/>',
  database: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.7 2.5 15 0 18-2.5-3-2.5-15.3 0-18"/>',
  code: '<path d="M9 8l-4 4 4 4M15 8l4 4-4 4"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/>',
  logOut: '<path d="M14 4h5v16h-5"/><path d="M10 8l-4 4 4 4M6 12h9"/>',
  tag: '<path d="M3 12V4h8l9 9-8 8z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
  // --- status colours & charts, drawn as icons rather than emoji ---
  trending: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  activity: '<path d="M3 12h4l3 8 4-16 3 8h4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>',
}

/** Every registered icon name, sorted — this is the Inspector's option list. */
export const ICON_NAMES: string[] = Object.keys(ICONS).sort()

/** True when `value` names an icon in the set. */
export function isIconName(value: string): boolean {
  return Object.prototype.hasOwnProperty.call(ICONS, value)
}

/**
 * Resolve an icon VALUE, which may be a name from the set or a literal glyph.
 *
 * Both are legitimate: a name is the house style, and a glyph or emoji is a real
 * special case (a brand mark, a symbol that has no icon equivalent). What this
 * forbids is the old middle ground — a typo silently rendering as a blank box.
 */
export function resolveIcon(value: string): { kind: 'icon'; name: string } | { kind: 'glyph'; glyph: string } {
  const trimmed = value.trim()
  if (isIconName(trimmed)) return { kind: 'icon', name: trimmed }
  return { kind: 'glyph', glyph: trimmed }
}

/** The inline markup for a name, or undefined when it is not an icon. */
export function iconMarkup(name: string): string | undefined {
  return ICONS[name]
}
