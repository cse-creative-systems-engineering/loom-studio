/**
 * Built-in control behaviour.
 *
 * Every interactive component WORKS, with no authoring: a button presses, a
 * tab switches, a disclosure opens, a switch flips, a table sorts. There is
 * no event system to configure and no state to wire — that is the point. A
 * designer cannot break a control by forgetting a handler, and exported
 * output behaves identically because it carries the same contract.
 *
 * HOW IT WORKS, and why this shape:
 *
 *  - ROLES ARE DATA. `ROLE_OF` maps a component type to one role. Adding a
 *    control is a one-line table entry, not a new bespoke branch in three
 *    renderers.
 *  - STATE LIVES IN THE DOM. The runtime writes `data-loom-on`,
 *    `data-loom-open`, `data-loom-active` and friends. One mechanism serves
 *    all three targets — the live preview (React), the standalone HTML export
 *    (static markup + inline script) and the React export (attributes +
 *    `useEffect`) — because they all end up as the same DOM.
 *  - COLOURS FLOW IN AS CUSTOM PROPERTIES. The renderer emits
 *    `--loom-accent`, `--loom-on`, `--loom-off`… from the theme; the
 *    stylesheet below decides what each STATE looks like. Inline styles can
 *    never win that fight, so a pressed button really does look pressed.
 *
 * The runtime is deliberately vanilla and tiny: exported documents must work
 * by opening the file, with no framework and no network.
 */

/** The interaction contract a component type ships with. */
export type Role =
  | 'press'
  | 'toggle'
  | 'check'
  | 'radio'
  | 'tab'
  | 'panel'
  | 'disclosure'
  | 'sort'
  | 'page'
  | 'dot'
  | 'step'
  | 'expand'
  | 'reveal'
  | 'rate'

/**
 * type -> built-in role, where the component's OWN ROOT ELEMENT is the
 * interactive item. Anything absent is static by nature (a Label does not
 * need a click). This table IS the promise: if a control is in here, it
 * works in the preview and in every export.
 */
export const ROLE_OF: Record<string, Role> = {
  // Press
  Button: 'press',
  IconButton: 'press',
  BackButton: 'press',
  Link: 'press',
  FileUpload: 'press',
  // Two-state
  Switch: 'toggle',
  ToggleButton: 'toggle',
  DropdownButton: 'toggle',
  // Boolean / exclusive input
  Checkbox: 'check',
  Checklist: 'check',
  // The panel a tab reveals
  TabPanel: 'panel',
  // Disclosure
  AccordionItem: 'disclosure',
}

/**
 * type -> the role its GENERATED ITEMS carry.
 *
 * A TabBar is not itself a tab, and a DataGrid is not itself a sortable column:
 * the interaction belongs to each child the component renders. Keeping the
 * two apart stops a container from toggling itself when a child is clicked.
 */
export const ITEM_ROLE: Record<string, Role> = {
  Tabs: 'tab',
  TabBar: 'tab',
  // DataGrid, not the removed Table: the role follows the tool that exists.
  DataGrid: 'sort',
  Pagination: 'page',
  ProgressDots: 'dot',
  Stepper: 'step',
  TreeList: 'expand',
  Rating: 'rate',
}

/** Chrome that opens or closes rather than acting on itself. */
export const REVEAL_OF: Record<string, Role> = {
  Drawer: 'reveal',
  SidebarPanel: 'reveal',
  Modal: 'reveal',
}

/** The built-in role for a component type, if it has one. */
export function roleOf(type: string): Role | undefined {
  return ROLE_OF[type]
}

/** Every type the tables claim to make interactive. Used by the tests. */
export function interactiveTypes(): string[] {
  return [...Object.keys(ROLE_OF), ...Object.keys(ITEM_ROLE), ...Object.keys(REVEAL_OF)]
}

/**
 * The attribute bag a control renders with.
 *
 * `group` ties siblings together (tabs in one tablist, radios in one group);
 * `index` is the position within it. `on`/`open` carry the AUTHORED initial
 * state, so a Switch authored as on starts on and the runtime takes over from
 * there — the output still respects the design.
 */
export function behaviourAttrs(input: {
  role: Role
  group?: string
  index?: number
  on?: boolean
  open?: boolean
  active?: boolean
  target?: string
  label?: string
}): Record<string, string> {
  const attrs: Record<string, string> = { 'data-loom-b': input.role }
  if (input.group) attrs['data-loom-g'] = input.group
  if (input.index !== undefined) attrs['data-loom-i'] = String(input.index)
  if (input.on !== undefined) attrs['data-loom-on'] = input.on ? '1' : '0'
  if (input.open !== undefined) attrs['data-loom-open'] = input.open ? '1' : '0'
  if (input.active !== undefined) attrs['data-loom-active'] = input.active ? '1' : '0'
  if (input.target) attrs['data-loom-target'] = input.target
  if (input.label) attrs['aria-label'] = input.label
  return attrs
}

/**
 * The behaviour stylesheet.
 *
 * Only STATE lives here. Colours arrive as custom properties set inline by
 * the renderer, so this stays theme-agnostic: the same rules serve the
 * midnight, daylight and contrast themes, and any future one.
 */
export function behaviourCss(): string {
  return [
    // --- form controls speak the design's typeface ---
    // A browser draws <button>/<input>/<select>/<textarea> in its own UI font
    // unless told otherwise, so every generated control that did not set a
    // family inline (tab strips, pagination, dialog buttons, collapse glyphs,
    // Send…) shipped in Arial beside Inter text. Scoped to design surfaces so
    // the Studio's own chrome is untouched.
    ':is(.loom-container,.dw-stage) :is(button,input,select,textarea){font-family:inherit}',
    // --- focus you can see, on everything operable ---
    // Seven text tools draw their field as a WELL around a borderless input
    // with `outline:none` inline, so focus left no trace at all (WCAG 2.4.7).
    // The ring goes on the well, the thing that looks like the field.
    ':is(.loom-container,.dw-stage) :has(> :is(input,textarea):is([style*="outline:none"],[style*="outline: none"]):focus-visible){outline:2px solid var(--loom-accent,#5b8cff);outline-offset:2px}',
    ':is(.loom-container,.dw-stage) :is([role=button],[role=menuitem],[role=slider],[data-loom-b=sort],[data-loom-cmd],a[href]):focus-visible{outline:2px solid var(--loom-accent,#5b8cff);outline-offset:2px}',
    // --- command palette ---
    '[data-loom-palette]{pointer-events:none}',
    '[data-loom-palette][data-loom-open="1"]{pointer-events:auto}',
    '[data-loom-palette] [data-loom-palette-panel]{display:none}',
    '[data-loom-palette][data-loom-open="1"] [data-loom-palette-panel]{display:flex}',
    '[data-loom-palette] [data-loom-palette-scrim]{display:none}',
    '[data-loom-palette][data-loom-open="1"] [data-loom-palette-scrim]{display:block}',
    '[data-loom-palette] [data-loom-trigger]{display:none}',
    '[data-loom-palette][data-loom-open="1"] [data-loom-trigger]{display:flex}',
    '[data-loom-cmd]{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:6px;cursor:pointer}',
    '[data-loom-cmd][data-loom-active="1"]{background:var(--loom-on-bg,rgba(91,140,255,0.12))}',
    '[data-loom-cmd]:hover{background:var(--loom-on-bg,rgba(91,140,255,0.12))}',
    '[data-loom-cmd-group]{padding:8px 10px 4px;font-size:10px;letter-spacing:.6px;text-transform:uppercase;color:var(--loom-muted,#7d879b);font-weight:600}',

    // --- app shell: collapse to an icon rail ---
    '[data-loom-shell] [data-loom-shell-sidebar]{transition:width 160ms ease}',
    /* The sidebar's width is inline (it is a property), so collapsing has to
       override it deliberately — and the rail width comes from the document
       rather than a number buried here. */
    '[data-loom-shell][data-loom-collapsed="1"] [data-loom-shell-sidebar]{--loom-sidebar-w:var(--loom-rail,64px);align-items:center}',

    // --- field validation ------------------------------------------------
    // A field OWNS validation, not the control inside it: whatever control you
    // dropped in — text, select, switch, date — picks up the state's colour.
    // That is why Field is a container and the old FormField was not.
    '[data-loom-field]{--loom-field-ring:var(--loom-border-strong,transparent)}',
    '[data-loom-field][data-loom-state="error"]{--loom-field-ring:var(--loom-danger)}',
    '[data-loom-field][data-loom-state="success"]{--loom-field-ring:var(--loom-success)}',
    '[data-loom-field][data-loom-state="warning"]{--loom-field-ring:var(--loom-warning)}',
    '[data-loom-field] :is(input,select,textarea){border-color:var(--loom-field-ring) !important}',
    '[data-loom-field] :is(input,select,textarea):focus{outline:2px solid var(--loom-field-ring);outline-offset:1px}',
    '[data-loom-field][data-loom-state="error"] :is(input,select,textarea){background:var(--loom-danger-wash,transparent)}',
    '[data-loom-field][aria-invalid="true"] [data-loom-field-message]{font-weight:600}',

    // --- pressable: hover, press, keyboard focus ---
    '[data-loom-b="press"],[data-loom-b="toggle"],[data-loom-b="check"],',
    '[data-loom-b="radio"],[data-loom-b="rate"],[data-loom-b="expand"]{cursor:pointer}',
    '[data-loom-b="press"]{transition:filter 90ms ease,transform 90ms ease}',
    '[data-loom-b="press"]:hover{filter:brightness(1.09)}',
    '[data-loom-b="press"][data-loom-pressed="1"]{filter:brightness(.9);transform:translateY(1px)}',
    '[data-loom-b="press"]:focus-visible,[data-loom-b="toggle"]:focus-visible,',
    '[data-loom-b="tab"]:focus-visible{outline:2px solid var(--loom-accent,#5b8cff);outline-offset:2px}',
    // --- drawn checkbox / radio (see ControlBox in web.tsx) ---
    // The native input stays for forms, keyboard and assistive tech, hidden
    // in place (absolute with no offsets keeps its static position, so
    // focusing it never scrolls the page); the box after it is drawn from
    // its state.
    '[data-loom-ctl]{position:absolute;opacity:0;width:1px;height:1px;margin:0;pointer-events:none}',
    '[data-loom-box]{flex:none;box-sizing:border-box;width:16px;height:16px;display:inline-grid;place-items:center;border:1.5px solid var(--loom-border-strong);background:var(--loom-well,var(--loom-surface));box-shadow:var(--loom-well-shadow,none);color:var(--loom-on-accent);transition:background-color 120ms ease,border-color 120ms ease,box-shadow 120ms ease}',
    '[data-loom-box="check"]{border-radius:5px}',
    '[data-loom-box="radio"]{border-radius:999px}',
    '[data-loom-box] svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}',
    '[data-loom-box] path{opacity:0;transition:opacity 120ms ease}',
    ':checked+[data-loom-box],:indeterminate+[data-loom-box]{background:var(--loom-tick,var(--loom-accent));border-color:var(--loom-tick,var(--loom-accent))}',
    ':checked:not(:indeterminate)+[data-loom-box] [data-loom-tick],:indeterminate+[data-loom-box] [data-loom-dash]{opacity:1}',
    // A radio is a ring with a dot: the accent fill shows through a surface ring.
    ':checked+[data-loom-box="radio"]{box-shadow:inset 0 0 0 3px var(--loom-surface)}',
    'label:hover>:not(:checked):not(:disabled)+[data-loom-box]{border-color:var(--loom-muted)}',
    ':focus-visible+[data-loom-box]{outline:2px solid var(--loom-accent);outline-offset:2px}',
    ':disabled+[data-loom-box]{opacity:.45}',
    // A part drawn as a well takes the well's inner shadow from here.
    '[data-loom-well]{box-shadow:var(--loom-well-shadow)}',
    // --- segmented: the chosen option is RAISED out of the well ---
    '[data-loom-seg]{color:var(--loom-muted);border:1px solid transparent;transition:background-color 120ms ease,color 120ms ease,box-shadow 120ms ease}',
    '[data-loom-seg]:hover{color:var(--loom-text)}',
    '[data-loom-seg][data-loom-on="1"]{background:var(--loom-seg-on,var(--loom-raised));box-shadow:var(--loom-raised-shadow);color:var(--loom-text)}',
    // --- slider: a well filled to the value, an extruded knob ---
    'input[data-loom-range]{-webkit-appearance:none;appearance:none;background:transparent;cursor:pointer}',
    'input[data-loom-range]::-webkit-slider-runnable-track{height:6px;border-radius:999px;background:linear-gradient(90deg,var(--loom-tick,var(--loom-accent)) var(--loom-fill,50%),var(--loom-well,rgba(0,0,0,.25)) var(--loom-fill,50%));box-shadow:var(--loom-well-shadow,none)}',
    'input[data-loom-range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:16px;height:16px;margin-top:-5px;border-radius:50%;background:var(--loom-knob,#fff);box-shadow:var(--loom-knob-shadow,0 1px 3px rgba(0,0,0,.4))}',
    'input[data-loom-range]:focus-visible::-webkit-slider-thumb{outline:2px solid var(--loom-accent);outline-offset:2px}',
    'input[data-loom-range]:disabled{opacity:.45;cursor:not-allowed}',
    // --- drawn select ---
    // The OS arrow goes; the chevron is the theme's (a data URL in a custom
    // property, set with the other theme variables). `!important` is narrow
    // and deliberate: the select's inline `background` shorthand (its fill)
    // would otherwise reset the chevron layer, and its inline padding would
    // run text under it.
    'select[data-loom-dropdown]{appearance:none;-webkit-appearance:none;background-image:var(--loom-chevron) !important;background-repeat:no-repeat !important;background-position:right 9px center !important;background-size:14px 14px !important;padding-right:30px !important}',
    // --- native pickers: the browser's icon, in the design's ink ---
    '::-webkit-calendar-picker-indicator{opacity:.55;cursor:pointer}',
    '::-webkit-calendar-picker-indicator:hover{opacity:.9}',
    // A text input with a suggestion list gets the same browser indicator,
    // beside the control's own chevron: two arrows. The chevron stays.
    'input[list]::-webkit-calendar-picker-indicator{display:none !important}',
    // --- switch / toggle button ---
    // The track is a well; the knob is extruded from it (soft depth as an
    // accent: see the theme's well/knob tokens).
    '[data-loom-b="toggle"] [data-loom-track]{background:var(--loom-well,var(--loom-off));box-shadow:var(--loom-well-shadow,none),inset 0 0 0 1px var(--loom-off);transition:background-color 140ms ease}',
    '[data-loom-b="toggle"][data-loom-on="1"] [data-loom-track]{background:var(--loom-on);box-shadow:inset 0 1px 2px rgba(0,0,0,.25)}',
    '[data-loom-knob]{background:var(--loom-knob,#fff);box-shadow:var(--loom-knob-shadow,none)}',
    '[data-loom-b="toggle"] [data-loom-knob]{transform:translateX(0);transition:transform 140ms ease}',
    '[data-loom-b="toggle"][data-loom-on="1"] [data-loom-knob]{transform:translateX(14px)}',
    '[data-loom-b="toggle"][aria-pressed="true"]{background:var(--loom-on-bg);color:var(--loom-on-fg)}',
    // --- tabs ---
    // `!important` is deliberate and narrow: the renderer styles a tab from
    // its AUTHORED active index inline, and inline styles beat any stylesheet.
    // Without this the strip could never show a switch, which is the one thing
    // a tab control exists to do. Only the state-bearing properties are forced.
    '[data-loom-b="tab"]{transition:color 90ms ease,background 90ms ease}',
    '[data-loom-b="tab"][data-loom-active="1"]{color:var(--loom-accent) !important;font-weight:600 !important}',
    '[data-loom-b="tab"][data-loom-active="0"]{color:var(--loom-muted) !important;font-weight:500 !important}',
    '[data-loom-b="tab"]{background:transparent;box-shadow:none}',
    '[data-loom-b="tab"][data-loom-active="1"]{background:var(--loom-tab-on,transparent);box-shadow:var(--loom-tab-shadow,none)}',
    // A panel's own `display` is inline (it is a flex column), and inline
    // beats a stylesheet: without `!important` on the hidden state no panel
    // ever hid, and a tab set drew every page stacked. Only "hidden" is
    // forced; a shown panel keeps its own display.
    '[data-loom-b="panel"][data-loom-shown="0"]{display:none !important}',
    // --- disclosure ---
    // A selector with an unterminated quote does not fail alone: the parser
    // keeps consuming until it finds a `]`, so a stray `"` here silently eats
    // every rule after it — which is how a whole sheet of state rules can stop
    // applying in an export with nothing in the console to say so.
    '[data-loom-b="disclosure"] [data-loom-summary]{cursor:pointer}',
    '[data-loom-b="disclosure"] [data-loom-body]{display:none}',
    '[data-loom-b="disclosure"][data-loom-open="1"] [data-loom-body]{display:block}',
    '[data-loom-b="disclosure"] [data-loom-caret]{transition:transform 120ms ease;display:inline-block}',
    '[data-loom-b="disclosure"][data-loom-open="1"] [data-loom-caret]{transform:rotate(90deg)}',
    // --- sortable column ---
    '[data-loom-b="sort"]{cursor:pointer;user-select:none;transition:color 90ms ease}',
    '[data-loom-b="sort"]:hover{color:var(--loom-accent,#5b8cff)}',
    '[data-loom-b="sort"][data-loom-sort]::after{content:attr(data-loom-sort);margin-left:6px;opacity:.9}',
    // --- pagination / progress dots / steps ---
    '[data-loom-b="page"][aria-current="page"]{background:var(--loom-on-bg,#ffffff14);color:var(--loom-accent,#5b8cff)}',
    '[data-loom-b="dot"]{transition:background 120ms ease}',
    '[data-loom-b="step"][data-loom-state="done"],[data-loom-b="step"][data-loom-state="now"]{color:var(--loom-accent,#5b8cff)}',
    // --- rating ---
    '[data-loom-b="rate"] [data-loom-star]{opacity:.28;transition:opacity 90ms ease,transform 90ms ease}',
    '[data-loom-b="rate"] [data-loom-star][data-loom-lit="1"]{opacity:1}',
    '[data-loom-b="rate"]:hover [data-loom-star]{opacity:.5}',
    '[data-loom-b="rate"] [data-loom-star]:hover{opacity:1;transform:scale(1.12)}',
    // --- data grid: selection drives the bulk bar, no framework involved ---
    '[data-loom-grid=""] [data-loom-bulk]{display:none}',
    '[data-loom-grid]:not([data-loom-selected="0"]) [data-loom-bulk]{display:flex !important}',
    '[data-loom-grid] [data-loom-row]:hover{background:var(--loom-row-hover,rgba(127,140,170,0.08))}',
    '[data-loom-grid] [data-loom-nomatch]{display:none}',
    '[data-loom-grid][data-loom-visible="0"] [data-loom-nomatch]{display:table-row !important}',
    '[data-loom-grid] [data-loom-menu-panel][data-loom-open="1"]{display:flex !important}',

    // --- toast: a timer, and what it leaves behind ---
    // `duration` is a number of SECONDS and the runtime owns the clock; the
    // fade is here so dismissal looks like the message leaving rather than the
    // message blinking out. `dismissible` toasts are also hidden by their own
    // close button, and a toast the runtime has already hidden stays hidden.
    '[data-loom-toast]{transition:opacity 160ms ease}',
    // `!important` for the same reason the reveal rule needs it: the renderer
    // styles the toast's own box inline, and inline beats any stylesheet.
    '[data-loom-toast][data-loom-gone="1"]{display:none !important}',
    '[data-loom-dismissable][data-loom-gone="1"]{display:none !important}',
    // Actions (model/actions.ts): a node a control has hidden.
    '[data-loom-shown="0"]{display:none !important}',
    '[data-loom-toast][data-loom-leaving="1"]{opacity:0}',

    // --- pagination: the rows-per-page control re-pages the pager ---
    '[data-loom-pager] [data-loom-more]{color:var(--loom-muted,#7d879b)}',

    // --- an indeterminate bar is a bar that moves, not a bar at 40% ---
    // Determinate fills are widths and are left alone. The indeterminate fill
    // slides across the track, which is the only thing that distinguishes "I do
    // not know how long this will take" from "40% done".
    '@keyframes loom-indeterminate{from{transform:translateX(-105%)}to{transform:translateX(255%)}}',
    '[data-loom-indeterminate="1"]{animation:loom-indeterminate 1150ms cubic-bezier(0.45,0,0.55,1) infinite}',
    '@media (prefers-reduced-motion:reduce){[data-loom-indeterminate="1"]{animation-duration:2400ms}}',

    // --- a sparkline that draws itself in ---
    // The trace carries `pathLength=1`, so one dash of length 1 IS the whole
    // path whatever its real length is — the draw-in needs no measurement and
    // no script, so it survives into the exported document.
    '@keyframes loom-spark-draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}',
    '@keyframes loom-spark-fade{from{opacity:0}to{opacity:1}}',
    '@keyframes loom-spark-pop{from{opacity:0;transform:scale(0.4)}to{opacity:1;transform:scale(1)}}',
    '[data-loom-spark-line]{stroke-dasharray:1;stroke-dashoffset:0}',
    '[data-loom-spark="animate"] [data-loom-spark-line]{animation:loom-spark-draw 900ms cubic-bezier(0.2,0.8,0.3,1) both}',
    '[data-loom-spark="animate"] [data-loom-spark-area]{animation:loom-spark-fade 900ms ease both}',
    // The head marker rides the end of the stroke, so it is the LAST thing to
    // appear: a dot that lands first reads as a data point, not a destination.
    '[data-loom-spark="animate"] [data-loom-spark-head]{animation:loom-spark-pop 260ms ease 760ms both;transform-box:fill-box;transform-origin:center}',
    '@media (prefers-reduced-motion:reduce){[data-loom-spark="animate"] [data-loom-spark-line],[data-loom-spark="animate"] [data-loom-spark-area],[data-loom-spark="animate"] [data-loom-spark-head]{animation:none}}',

    // --- reveal (drawer / sidebar / modal) ---
    '[data-loom-reveal]:not([data-loom-open="1"]){display:none !important}',
    '[data-loom-reveal] [data-loom-body]{display:flex;flex-direction:column;gap:inherit}',
    '[data-loom-scrim]{position:fixed;inset:0;background:#000a;z-index:40}',
    // Top-layer overlays (output only): centred on the screen, dimmed behind
    // by ::backdrop instead of an in-dialog scrim.
    '[data-loom-modal][popover]:popover-open{position:fixed !important;inset:0 !important;margin:auto !important;height:fit-content !important;max-height:calc(100vh - 32px);overflow:auto;translate:none !important;transform:none !important}',
    '[data-loom-modal][popover]>[data-loom-scrim]{display:none !important}',
    '[data-loom-modal][popover]::backdrop{background:#000a}',
    '[data-loom-palette-layer][popover]{position:fixed;inset:0;width:auto;height:auto;margin:0;padding:0;border:0;background:transparent;overflow:visible;color:inherit}',
    // The canvas is the design being edited: an open modal is drawn in place
    // and never dims the rest of it.
    '.surface [data-loom-scrim]{display:none !important}',
    '[data-loom-scrim="0"]{display:none}',
    // --- dropdown menu ---
    '[data-loom-menu-panel][data-loom-open="0"]{display:none !important}',
    // --- live readouts (slider value, spinbox value) ---
    '[data-loom-readout]{font-variant-numeric:tabular-nums}',
    // --- conversation ---
    // The composer grows with its text in CSS where the engine can
    // (`field-sizing`), up to the max-height the renderer set from `maxRows`;
    // the runtime measures only where it cannot.
    '[data-loom-composer-input]{field-sizing:content}',
    '[data-loom-composer][data-loom-empty="1"] [data-loom-composer-send]{opacity:.45;cursor:default}',
    '[data-loom-list-jump][data-loom-open="1"]{display:inline-flex !important}',
    '@keyframes loom-typing{0%,60%,100%{transform:translateY(0);opacity:.45}30%{transform:translateY(-3px);opacity:1}}',
    '[data-loom-typing-dot]{animation:loom-typing 1.2s ease-in-out infinite}',
    '[data-loom-typing-dot]:nth-child(2){animation-delay:.15s}',
    '[data-loom-typing-dot]:nth-child(3){animation-delay:.3s}',
    '@media (prefers-reduced-motion:reduce){[data-loom-typing-dot]{animation:none;opacity:.8}}',
  ].join('\n')
}

/**
 * The behaviour runtime: vanilla, delegated, and idempotent.
 *
 * One delegated listener per event type on the document, so it works for
 * markup that already exists and for rows/tabs added later. State is written
 * as data attributes and read by the stylesheet — the runtime never touches
 * styles, which keeps theme decisions in one place.
 *
 * This is a real function, not a string, because the app must be able to CALL
 * it: a renderer content-security-policy blocks eval, and an eval that throws
 * inside a React effect unmounts the whole tree. The HTML export reuses this
 * exact function's source through `toString()`, so exported documents and the
 * app still run one single implementation.
 */
export function behaviourRuntime(): string {
  return `(${installBehaviour.toString()})()`
}

/**
 * The installer as a FUNCTION expression, not a running script: for a module
 * that installs it when it mounts (the React export). Inlined as the running
 * form, it touched `window` the moment the module was imported (a crash in
 * any server render) and left nothing to call on mount.
 */
export function behaviourInstaller(): string {
  return `(${installBehaviour.toString()})`
}

/** Install the behaviour layer on the current document. Idempotent. */
export function installBehaviour(): void {
  const w = window as unknown as { __loomBehaviour?: boolean }
  if (w.__loomBehaviour) return
  w.__loomBehaviour = true

  const q = (sel: string, root?: ParentNode): Element[] =>
    Array.prototype.slice.call((root ?? document).querySelectorAll(sel)) as Element[]
  const target = (e: Event): Element | null => (e.target as Element | null) ?? null
  const closest = (e: Event, sel: string): Element | null => target(e)?.closest(sel) ?? null

  /** A semantic event so a host page can react without Loom knowing about it. */
  const fire = (el: Element, name: string): void => {
    try {
      el.dispatchEvent(new CustomEvent('loom:' + name, { bubbles: true }))
    } catch {
      // CustomEvent unavailable: the visible state still applied, which is the
      // part a person can see. The event is a hook, never a dependency.
    }
  }

  // --- press feedback ---------------------------------------------------
  // Any pressable shows it while held, so a click is visible even when the
  // control has nothing else to change.
  document.addEventListener(
    'pointerdown',
    (e) => {
      const el = closest(e, '[data-loom-b="press"],[data-loom-b="toggle"],[data-loom-b="check"],[data-loom-b="radio"],[data-loom-b="rate"]')
      if (el) el.setAttribute('data-loom-pressed', '1')
    },
    true,
  )
  const release = (): void => {
    q('[data-loom-pressed="1"]').forEach((n) => n.removeAttribute('data-loom-pressed'))
  }
  document.addEventListener('pointerup', release, true)
  document.addEventListener('pointercancel', release, true)

  // --- live readouts ----------------------------------------------------
  // A slider dragged with the mouse only fires "change" when the pointer is
  // released, so "input" is the listener that matters for anything numeric.
  document.addEventListener(
    'input',
    (e) => {
      const el = target(e)
      // A drawn slider's track is filled to the value: keep it with the thumb.
      if (el instanceof HTMLInputElement && el.hasAttribute('data-loom-range')) {
        const min = Number(el.min) || 0
        const span = (Number(el.max) || 100) - min
        el.style.setProperty('--loom-fill', `${span > 0 ? Math.round(((Number(el.value) - min) / span) * 100) : 0}%`)
      }
      const out = el?.getAttribute('data-loom-output')
      if (!out) return
      const readout = document.getElementById(out)
      if (readout && el instanceof HTMLInputElement) readout.textContent = el.value
    },
    true,
  )

  // --- keep mirrored state honest --------------------------------------
  // Native inputs already work; this keeps the data attribute, the stylesheet
  // and assistive tech in agreement with what is actually checked.
  document.addEventListener(
    'change',
    (e) => {
      const el = target(e)
      if (!(el instanceof HTMLInputElement)) return
      if (el.type === 'checkbox') {
        const box = el.closest('[data-loom-b="check"],[data-loom-b="toggle"]') ?? el
        box.setAttribute('data-loom-on', el.checked ? '1' : '0')
        box.setAttribute('aria-checked', el.checked ? 'true' : 'false')
      }
      if (el.type === 'radio' && el.name) {
        q(`input[type=radio][name="${el.name}"]`).forEach((r) => {
          const box = (r as HTMLInputElement).closest('[data-loom-b="radio"]') ?? r
          box.setAttribute('data-loom-on', (r as HTMLInputElement).checked ? '1' : '0')
        })
      }
    },
    true,
  )

  // --- grid selection and filtering -------------------------------------
  // A grid's selection is real state, so the bulk bar appears because rows are
  // checked. Counted onto the grid element, and CSS does the rest.
  const syncGridSelection = (): void => {
    q('[data-loom-grid]').forEach((grid) => {
      const id = grid.getAttribute('data-loom-grid')
      const boxes = q(`[data-loom-select="${id}"]`, grid)
      const checked = boxes.filter((b) => (b as HTMLInputElement).checked)
      grid.setAttribute('data-loom-selected', String(checked.length))
      const label = grid.querySelector('[data-loom-bulk-count]')
      if (label) label.textContent = `${checked.length} selected`
      const all = grid.querySelector('[data-loom-select-all]') as HTMLInputElement | null
      if (all) {
        all.checked = boxes.length > 0 && checked.length === boxes.length
        all.indeterminate = checked.length > 0 && checked.length < boxes.length
      }
    })
  }

  const applyFilter = (input: HTMLInputElement): void => {
    const id = input.getAttribute('data-loom-filter')
    if (!id) return
    const grid = document.querySelector(`[data-loom-grid="${id}"]`)
    if (!grid) return
    const term = input.value.trim().toLowerCase()
    let shown = 0
    q('[data-loom-row]', grid).forEach((row: Element) => {
      // filterText keeps the searchable text to the DATA cells, so a control
      // in the row (a checkbox, a menu button) cannot accidentally match.
      const text = (row.getAttribute('data-loom-filter-text') ?? row.textContent ?? '').toLowerCase()
      const hit = term === '' || text.includes(term)
      row.setAttribute('data-loom-hidden', hit ? '0' : '1')
      if (row instanceof HTMLElement) row.style.display = hit ? '' : 'none'
      if (hit) shown += 1
    })
    grid.setAttribute('data-loom-visible', String(shown))
  }

  document.addEventListener(
    'change',
    (e) => {
      const el = target(e)
      if (el instanceof HTMLInputElement && (el.hasAttribute('data-loom-select') || el.hasAttribute('data-loom-select-all'))) {
        if (el.hasAttribute('data-loom-select-all')) {
          const id = el.getAttribute('data-loom-select-all') ?? ''
          q(`[data-loom-select="${id}"]`).forEach((b) => {
            ;(b as HTMLInputElement).checked = el.checked
          })
        }
        syncGridSelection()
      }
    },
    true,
  )

  document.addEventListener(
    'input',
    (e) => {
      const el = target(e)
      if (el instanceof HTMLInputElement && el.hasAttribute('data-loom-filter')) applyFilter(el)
    },
    true,
  )

  // --- toast auto-dismiss ------------------------------------------------
  // The renderer's whole contribution to `duration` is the number of seconds,
  // and the CLOCK is the runtime's — a timer is not something markup can carry.
  // Armed once per element, and re-armed by an observer because a toast is
  // usually added after the runtime has already installed.
  const gone = (el: Element): void => {
    el.setAttribute('data-loom-leaving', '1')
    el.setAttribute('data-loom-gone', '1')
  }
  const armToasts = (): void => {
    q('[data-loom-toast]').forEach((toast) => {
      if (toast.getAttribute('data-loom-armed') === '1') return
      const ms = Number(toast.getAttribute('data-loom-duration') ?? 0) * 1000
      if (!(ms > 0)) return
      toast.setAttribute('data-loom-armed', '1')
      setTimeout(() => gone(toast), ms)
    })
  }
  armToasts()

  // --- overlays in the top layer ------------------------------------------
  // A popover-marked overlay (output only) is put into, or taken out of, the
  // browser's top layer to match its open state; where the API is missing the
  // overlay simply stays where it is drawn.
  function topLayer(el: Element, open: boolean): void {
    const pop = el as HTMLElement & { showPopover?: () => void; hidePopover?: () => void }
    if (!pop.hasAttribute('popover') || typeof pop.showPopover !== 'function' || !pop.isConnected) return
    let isOpen = false
    try {
      isOpen = pop.matches(':popover-open')
    } catch {
      return
    }
    try {
      if (open && !isOpen) pop.showPopover()
      else if (!open && isOpen) pop.hidePopover?.()
    } catch {
      // Not in a document that can show it; it stays drawn in place.
    }
  }
  const armOverlays = (): void => {
    q('[data-loom-modal][popover]').forEach((m) => topLayer(m, m.getAttribute('data-loom-open') === '1'))
  }
  armOverlays()
  if (typeof MutationObserver === 'function') {
    const root = document.body ?? document.documentElement
    if (root) {
      // Only re-scan when a toast actually arrived: the editor re-renders the
      // canvas constantly, and a full-document query on every mutation would
      // tax the thing it is meant to serve.
      new MutationObserver((records) => {
        for (let i = 0; i < records.length; i += 1) {
          const added = records[i].addedNodes
          for (let j = 0; j < added.length; j += 1) {
            const node = added[j]
            if (node.nodeType !== 1) continue
            const el = node as Element
            if (el.hasAttribute('data-loom-toast') || el.querySelector('[data-loom-toast]')) armToasts()
            if (el.hasAttribute('data-loom-modal') || el.querySelector('[data-loom-modal]')) armOverlays()
          }
        }
      }).observe(root, { childList: true, subtree: true })
    }
  }

  // --- rows per page -----------------------------------------------------
  // The control changes how many pages there are, and the pager is made of DOM
  // that already exists: the pages past the end are hidden, the ellipses
  // follow, and a current page that the new size no longer contains is moved
  // rather than left claiming to be somewhere that is not. It cannot ADD the
  // pages a larger size brings into being — that needs a re-render — so it
  // fires `loom:pagesize` and a host that renders can finish the job.
  const repaginate = (select: HTMLSelectElement): void => {
    const nav = select.closest('[data-loom-pager]')
    if (!nav) return
    // An unrecognised selection keeps the size the pager already had, rather
    // than dividing the row count by nothing.
    const chosen = Number(select.value)
    const size = chosen > 0 ? chosen : Math.max(1, Number(nav.getAttribute('data-loom-pagesize') ?? 10))
    const items = Number(nav.getAttribute('data-loom-items') ?? '0')
    const last = items > 0
      ? Math.max(1, Math.ceil(items / size))
      : Math.max(1, Number(nav.getAttribute('data-loom-total') ?? '1'))
    nav.setAttribute('data-loom-pagesize', String(size))
    nav.setAttribute('data-loom-total', String(last))
    const buttons = q('[data-loom-b="page"][data-loom-i]', nav)
    buttons.forEach((b) => {
      if (b instanceof HTMLElement) b.style.display = Number(b.getAttribute('data-loom-i')) > last ? 'none' : ''
    })
    const current = buttons.find((b) => b.getAttribute('aria-current') === 'page')
    let page = Number(current?.getAttribute('data-loom-i') ?? 1)
    if (page > last) {
      // A page that no longer exists cannot stay the current one. Fall back to
      // the last page still on screen, or to the new last page itself.
      const fallback = buttons
        .filter((b) => (b as HTMLElement).style.display !== 'none')
        .pop()
      page = Number(fallback?.getAttribute('data-loom-i') ?? last)
      current?.removeAttribute('aria-current')
      fallback?.setAttribute('aria-current', 'page')
    }
    nav.setAttribute('data-loom-page', String(page))
    const shown = buttons.filter((b) => (b as HTMLElement).style.display !== 'none')
    const lowest = Number(shown[0]?.getAttribute('data-loom-i') ?? 0)
    const highest = Number(shown[shown.length - 1]?.getAttribute('data-loom-i') ?? 0)
    const moreStart = nav.querySelector('[data-loom-more="start"]')
    const moreEnd = nav.querySelector('[data-loom-more="end"]')
    if (moreStart instanceof HTMLElement) moreStart.style.display = lowest > 1 ? '' : 'none'
    if (moreEnd instanceof HTMLElement) moreEnd.style.display = highest > 0 && highest < last ? '' : 'none'
    const prev = nav.querySelector('[data-loom-b="page"][data-loom-delta="-1"]')
    const next = nav.querySelector('[data-loom-b="page"][data-loom-delta="1"]')
    if (prev instanceof HTMLButtonElement) prev.disabled = page <= 1
    if (next instanceof HTMLButtonElement) next.disabled = page >= last
    fire(select, 'pagesize')
  }

  document.addEventListener(
    'change',
    (e) => {
      const el = target(e)
      if (el instanceof HTMLSelectElement && el.hasAttribute('data-loom-pagesize-select')) repaginate(el)
    },
    true,
  )

  // --- conversation: send, append, stay on the newest message ------------
  // A Composer names its list (`data-loom-sends-to`); the list names the bubble
  // new messages copy (`data-loom-template`). Nothing is inferred: a composer
  // with no list, or a list with no template, says so in the console and
  // sends nothing rather than guessing.
  const NEAR = 48
  const atBottom = (list: Element): boolean => list.scrollHeight - list.scrollTop - list.clientHeight <= NEAR
  const toBottom = (list: Element): void => {
    list.scrollTop = list.scrollHeight
    list.querySelector('[data-loom-list-jump]')?.setAttribute('data-loom-open', '0')
  }
  const listFor = (composer: Element): Element | null => {
    const id = composer.getAttribute('data-loom-sends-to')
    if (!id) return null
    return q('[data-loom-list]').find((l) => l.getAttribute('data-loom-list') === id) ?? null
  }
  /** Add `unit` to `list`: after the last message, before a typing indicator. */
  const append = (list: Element, unit: Element): void => {
    const follow = atBottom(list)
    list.querySelector(':scope > [data-loom-list-empty]')?.remove()
    const before = list.querySelector(':scope > [data-loom-typing], :scope > * > [data-loom-typing]')
    const anchor = before ? (before.parentElement === list ? before : before.parentElement) : list.querySelector(':scope > [data-loom-list-jump]')
    list.insertBefore(unit, anchor)
    if (follow || list.getAttribute('data-loom-stick') !== '1') toBottom(list)
    else list.querySelector('[data-loom-list-jump]')?.setAttribute('data-loom-open', '1')
  }
  const grow = (input: HTMLTextAreaElement): void => {
    // Only where CSS cannot: `field-sizing` does this with no script at all.
    const css = (window as unknown as { CSS?: { supports?: (p: string, v: string) => boolean } }).CSS
    if (css?.supports?.('field-sizing', 'content')) return
    input.style.height = 'auto'
    input.style.height = `${input.scrollHeight}px`
  }
  const send = (composer: Element): void => {
    const input = composer.querySelector('[data-loom-composer-input]') as HTMLTextAreaElement | null
    if (!input || input.disabled) return
    const text = input.value.trim()
    if (text === '') return
    const list = listFor(composer)
    if (!list) {
      console.error('Loom: this Composer has no message list to send to. Pick one in "Sends to".')
      return
    }
    const template = list.querySelector('[data-loom-template]')
    if (!template) {
      console.error('Loom: the message list has no template message. Mark one bubble as the template.')
      return
    }
    // The unit copied is the list's direct child that holds the template, so a
    // row of avatar + bubble is copied whole.
    let unit: Element = template
    while (unit.parentElement && unit.parentElement !== list) unit = unit.parentElement
    const copy = unit.cloneNode(true) as Element
    const bubble = copy.matches('[data-loom-template]') ? copy : copy.querySelector('[data-loom-template]')
    bubble?.removeAttribute('data-loom-template')
    // Ids must stay unique; the copy is a new message, not the template.
    copy.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'))
    const body = bubble?.querySelector('[data-loom-bubble-text]')
    if (body) body.textContent = text
    const time = bubble?.querySelector('[data-loom-bubble-time]')
    if (time) {
      const now = new Date()
      time.textContent = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`
    }
    append(list, copy)
    input.value = ''
    input.style.height = ''
    setEmpty(composer, true)
    // The hook a host page (or a future data runtime) listens for.
    try {
      composer.dispatchEvent(new CustomEvent('loom:send', { bubbles: true, detail: { text } }))
    } catch {
      // Event unavailable: the message still appeared, which is what a person sees.
    }
  }
  // Nothing to send: Send is dimmed AND says it is inactive, so assistive
  // tech hears the same state the eye sees (and it is an inactive control,
  // not low-contrast text).
  function setEmpty(composer: Element, empty: boolean): void {
    composer.setAttribute('data-loom-empty', empty ? '1' : '0')
    composer.querySelector('[data-loom-composer-send]')?.setAttribute('aria-disabled', empty ? 'true' : 'false')
  }
  document.addEventListener('input', (e) => {
    const input = target(e)
    if (!(input instanceof HTMLTextAreaElement) || !input.hasAttribute('data-loom-composer-input')) return
    const composer = input.closest('[data-loom-composer]')
    if (composer) setEmpty(composer, input.value.trim() === '')
    grow(input)
  })
  document.addEventListener('keydown', (e) => {
    const input = target(e)
    if (!(input instanceof HTMLTextAreaElement) || !input.hasAttribute('data-loom-composer-input')) return
    const composer = input.closest('[data-loom-composer]')
    if (!composer || composer.getAttribute('data-loom-enter-sends') !== '1') return
    // Shift+Enter is a new line; Enter while an IME is composing is a
    // character, not a send.
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return
    e.preventDefault()
    send(composer)
  })
  document.addEventListener('click', (e) => {
    const sendBtn = closest(e, '[data-loom-composer-send]')
    if (sendBtn) {
      const composer = sendBtn.closest('[data-loom-composer]')
      if (composer) send(composer)
      return
    }
    const jump = closest(e, '[data-loom-list-jump]')
    const list = jump?.closest('[data-loom-list]')
    if (list) toBottom(list)
  })
  // Reading back up the conversation hides the pill once you are at the end.
  document.addEventListener(
    'scroll',
    (e) => {
      const list = target(e)
      if (list instanceof Element && list.hasAttribute('data-loom-list') && atBottom(list)) {
        list.querySelector('[data-loom-list-jump]')?.setAttribute('data-loom-open', '0')
      }
    },
    true,
  )
  // A conversation opens at its newest message.
  q('[data-loom-list][data-loom-stick="1"]').forEach(toBottom)

  // --- the keyboard: everything a click does, Enter and Space do --------
  // Native controls activate themselves; everything else that is operable
  // (an accordion summary, a menu item, a sortable header, a tree expander, a
  // progress dot) was mouse-only. One rule, for every one of them.
  document.addEventListener('keydown', (e) => {
    const k = e as KeyboardEvent
    const el = k.target
    if (!(el instanceof HTMLElement) || el.closest('[inert]') || k.altKey || k.ctrlKey || k.metaKey) return
    // A rating is a slider: arrows, Home and End move it.
    if (el.getAttribute('data-loom-b') === 'rate') {
      const stars = q('[data-loom-star]', el)
      const cur = Number(el.getAttribute('data-loom-value') ?? 1)
      const next = k.key === 'ArrowRight' || k.key === 'ArrowUp' ? cur + 1 : k.key === 'ArrowLeft' || k.key === 'ArrowDown' ? cur - 1 : k.key === 'Home' ? 1 : k.key === 'End' ? stars.length : null
      if (next === null) return
      k.preventDefault()
      const star = stars.find((s) => Number(s.getAttribute('data-loom-i')) === Math.max(1, Math.min(stars.length, next)))
      star?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return
    }
    // Inside a tab strip, the arrows move between tabs and choose one
    // (automatic activation), Home and End go to the ends.
    if (el.matches('[role=tab]') && /^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End)$/.test(k.key)) {
      const strip = el.closest('[role=tablist]')
      const tabs = strip ? q('[role=tab]', strip).filter((t) => !(t as HTMLButtonElement).disabled) : []
      const i = tabs.indexOf(el)
      if (i < 0) return
      const n = tabs.length
      const j = k.key === 'Home' ? 0 : k.key === 'End' ? n - 1 : k.key === 'ArrowLeft' || k.key === 'ArrowUp' ? (i - 1 + n) % n : (i + 1) % n
      k.preventDefault()
      const next = tabs[j] as HTMLElement
      next.focus()
      next.click()
      return
    }
    if (k.key !== 'Enter' && k.key !== ' ') return
    if (/^(BUTTON|A|INPUT|SELECT|TEXTAREA|SUMMARY|LABEL)$/.test(el.tagName) || el.isContentEditable) return
    // Unquoted on purpose: this source ships inside every export, and tests
    // count the design's own role="…" attributes in that file.
    if (!el.matches('[role=button],[role=menuitem],[role=tab],[role=option],[role=checkbox],[role=switch],[role=radio],[data-loom-b],[data-loom-cmd]')) return
    k.preventDefault()
    el.click()
  })

  // --- the interactions -------------------------------------------------
  document.addEventListener('click', (e) => {
    // Dismiss first: a close button is a close button whatever else it wears.
    const closer = closest(e, '[data-loom-close]')
    if (closer) {
      const id = closer.getAttribute('data-loom-close') ?? ''
      const host = document.getElementById(id)
      if (host) hide(host)
      fire(closer, closer.getAttribute('data-loom-action') || 'close')
      return
    }
    // A click on a top-layer modal's backdrop lands on the modal itself,
    // outside its box: that dismisses it, when it may be dismissed.
    const tgt = e.target
    if (tgt instanceof HTMLElement && tgt.hasAttribute('data-loom-modal') && tgt.querySelector('[data-loom-scrim="1"]')) {
      const r = tgt.getBoundingClientRect()
      const m = e as MouseEvent
      if (m.clientX < r.left || m.clientX > r.right || m.clientY < r.top || m.clientY > r.bottom) {
        hide(tgt)
        fire(tgt, 'dismiss')
        return
      }
    }

    // A close control closes what it belongs to: a toast, an alert, a
    // notification, a confirm dialog's Cancel and its confirm button. It was
    // toast-only, so every other x was decoration. The event it emits is the
    // hand-off for whatever needs a backend ("confirm" deletes the project in
    // the real app); its value names it, "dismiss" when unnamed.
    const dismiss = closest(e, '[data-loom-dismiss]')
    if (dismiss) {
      const owner = dismiss.closest('[data-loom-toast],[data-loom-dismissable]')
      if (owner) {
        gone(owner)
        fire(dismiss, dismiss.getAttribute('data-loom-dismiss') || 'dismiss')
      }
      return
    }

    // Dropdown menus: toggle on the trigger, dismiss on Escape or outside.
    const trigger = closest(e, '[data-loom-menu-trigger]')
    if (trigger) {
      const id = trigger.getAttribute('data-loom-menu-trigger') ?? ''
      const panel = document.querySelector(`[data-loom-menu-panel="${id}"]`)
      if (panel) {
        const open = panel.getAttribute('data-loom-open') === '1'
        panel.setAttribute('data-loom-open', open ? '0' : '1')
        trigger.setAttribute('data-loom-on', open ? '0' : '1')
        trigger.setAttribute('aria-expanded', open ? 'false' : 'true')
      }
      return
    }
    if (!closest(e, '[data-loom-menu-panel]')) {
      q('[data-loom-menu-panel][data-loom-open="1"]').forEach((m) => m.setAttribute('data-loom-open', '0'))
      q('[data-loom-menu-trigger][data-loom-on="1"]').forEach((m) => {
        m.setAttribute('data-loom-on', '0')
        m.setAttribute('aria-expanded', 'false')
      })
    }

    const el = closest(e, '[data-loom-b]')
    if (!el) return
    const role = el.getAttribute('data-loom-b')

    if (role === 'toggle') {
      // A toggle that wraps a REAL input (a switch is a label + checkbox) must
      // let the platform do the toggling: the native activation already flips
      // the input and fires `change`, and flipping here as well would toggle
      // twice. The change listener mirrors the resulting state.
      const input = el.querySelector('input')
      if (el.tagName === 'BUTTON' || !input) {
        const on = el.getAttribute('data-loom-on') === '1'
        el.setAttribute('data-loom-on', on ? '0' : '1')
        if (el.tagName === 'BUTTON') el.setAttribute('aria-pressed', on ? 'false' : 'true')
        else el.setAttribute('aria-checked', on ? 'false' : 'true')
        fire(el, 'toggle')
      } else {
        fire(el, 'toggle')
      }
      return
    }

    if (role === 'tab') {
      const wrap = el.closest('[data-loom-tabs]')
      if (!wrap) return
      const g = el.getAttribute('data-loom-g') ?? ''
      const i = el.getAttribute('data-loom-i') ?? '0'
      q(`[data-loom-b="tab"][data-loom-g="${g}"]`, wrap).forEach((t) => {
        const selected = t.getAttribute('data-loom-i') === i
        t.setAttribute('data-loom-active', selected ? '1' : '0')
        t.setAttribute('aria-selected', selected ? 'true' : 'false')
      })
      q(`[data-loom-b="panel"][data-loom-g="${g}"]`, wrap).forEach((p) => {
        p.setAttribute('data-loom-shown', p.getAttribute('data-loom-i') === i ? '1' : '0')
      })
      wrap.setAttribute('data-loom-active', i)
      fire(el, 'tab')
      return
    }

    if (role === 'disclosure') {
      const open = el.getAttribute('data-loom-open') === '1'
      el.setAttribute('data-loom-open', open ? '0' : '1')
      el.setAttribute('aria-expanded', open ? 'false' : 'true')
      // The state a screen reader hears lives on the element that IS the
      // button (the summary); it stayed "false" while the item was open.
      el.querySelector(':scope > [data-loom-summary]')?.setAttribute('aria-expanded', open ? 'false' : 'true')
      fire(el, 'disclosure')
      return
    }

    if (role === 'page') {
      const nav = el.closest('[data-loom-pager]')
      if (!nav) return
      // Prev/next carry a DELTA, not an index: a numbered button and the
      // "next" arrow can point at the same page, and two buttons claiming to
      // be the current page is a lie the user can see.
      const delta = el.getAttribute('data-loom-delta')
      const current = nav.querySelector('[data-loom-b="page"][aria-current="page"]')
      const base = Number(current?.getAttribute('data-loom-i') ?? 1)
      const wanted = delta === null ? el.getAttribute('data-loom-i') : String(base + Number(delta))
      if (wanted === null) return
      q('[data-loom-b="page"]', nav).forEach((b) => {
        if (b.hasAttribute('disabled')) return
        const isWanted = b.getAttribute('data-loom-i') === wanted
        if (isWanted) b.setAttribute('aria-current', 'page')
        else b.removeAttribute('aria-current')
      })
      nav.setAttribute('data-loom-page', wanted)
      fire(el, 'page')
      return
    }

    if (role === 'dot') {
      const dots = el.closest('[data-loom-dots]')
      if (!dots) return
      const k = Number(el.getAttribute('data-loom-i') ?? 1)
      q('[data-loom-b="dot"]', dots).forEach((d) => {
        d.setAttribute('data-loom-lit', Number(d.getAttribute('data-loom-i') ?? 0) < k ? '1' : '0')
      })
      dots.setAttribute('data-loom-current', String(k))
      fire(el, 'dot')
      return
    }

    // A step itself: going there. Clickable steps are how a stepper is used
    // to move back to an earlier stage; they did nothing.
    if (role === 'step' && !el.getAttribute('data-loom-nav') && el.hasAttribute('data-loom-i')) {
      const steps = el.closest('[data-loom-steps]')
      if (steps) {
        const all = q('[data-loom-b="step"]', steps).filter((s) => s.hasAttribute('data-loom-i') && !s.getAttribute('data-loom-nav'))
        const next = all.indexOf(el) + 1
        steps.setAttribute('data-loom-current', String(next))
        all.forEach((s, idx) => {
          s.setAttribute('data-loom-state', idx + 1 < next ? 'done' : idx + 1 === next ? 'now' : 'todo')
          if (idx + 1 === next) s.setAttribute('aria-current', 'step')
          else s.removeAttribute('aria-current')
        })
        fire(el, 'step')
      }
      return
    }

    if (role === 'step' && el.getAttribute('data-loom-nav')) {
      const steps = el.closest('[data-loom-steps]')
      if (!steps) return
      const forward = el.getAttribute('data-loom-nav') === 'next'
      const lo = steps.getAttribute('data-loom-value-min')
      const hi = steps.getAttribute('data-loom-value-max')
      if (lo !== null || hi !== null) {
        // SpinBox: a real bounded number, not a progress marker.
        const by = Number(steps.getAttribute('data-loom-value-step') ?? 1)
        const readout = steps.querySelector('[data-loom-spin]')
        let v = Number(readout?.textContent ?? 0)
        v += forward ? by : -by
        if (lo !== null) v = Math.max(Number(lo), v)
        if (hi !== null) v = Math.min(Number(hi), v)
        if (readout) readout.textContent = String(v)
        steps.setAttribute('data-loom-current', String(v))
        fire(el, 'step')
        return
      }
      const all = q('[data-loom-b="step"]', steps).filter((s) => s.hasAttribute('data-loom-i'))
      const cur = Number(steps.getAttribute('data-loom-current') ?? 1)
      const next = Math.min(all.length, Math.max(1, cur + (forward ? 1 : -1)))
      steps.setAttribute('data-loom-current', String(next))
      all.forEach((s, idx) => {
        s.setAttribute('data-loom-state', idx + 1 < next ? 'done' : idx + 1 === next ? 'now' : 'todo')
      })
      fire(el, 'step')
      return
    }

    if (role === 'rate') {
      const stars = q('[data-loom-star]', el)
      const hit = closest(e, '[data-loom-star]')
      const pick = Math.max(1, Number(hit?.getAttribute('data-loom-i') ?? el.getAttribute('data-loom-value') ?? 1))
      stars.forEach((s) => {
        s.setAttribute('data-loom-lit', Number(s.getAttribute('data-loom-i') ?? 0) <= pick ? '1' : '0')
      })
      el.setAttribute('data-loom-value', String(pick))
      el.setAttribute('aria-label', `${pick} of ${stars.length}`)
      el.setAttribute('aria-valuenow', String(pick))
      fire(el, 'rate')
      return
    }

    if (role === 'expand') {
      const row = el.closest('[data-loom-row]')
      if (row) {
        const open = row.getAttribute('data-loom-open') === '1'
        row.setAttribute('data-loom-open', open ? '0' : '1')
        row.setAttribute('aria-expanded', open ? 'false' : 'true')
      }
      fire(el, 'expand')
      return
    }

    if (role === 'sort') {
      // The header lives in `thead` and the rows in `tbody`, so the grid is
      // found FIRST and the row container looked up inside it. (Looking for the
      // rows first finds nothing, because a header cell is not a descendant of
      // the body.)
      const table = el.closest('[data-loom-grid],[data-loom-table]')
      if (!table) return
      const body = table.querySelector('[data-loom-rows]')
      if (!body) return
      const col = el.getAttribute('data-loom-i') ?? '0'
      const dir = el.getAttribute('data-loom-sort') === 'asc' ? 'desc' : 'asc'
      q('[data-loom-b="sort"]', table).forEach((h) => {
        h.setAttribute('data-loom-sort', '')
        h.setAttribute('aria-sort', 'none')
      })
      el.setAttribute('data-loom-sort', dir)
      // What a screen reader announces; it stayed "none" after every sort.
      el.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending')
      {
        const rows = q('[data-loom-row]', body)
        // Read the cell BY COLUMN, not by child position: a row may carry a
        // selection checkbox and an actions cell, so child N is not column N.
        const cellText = (row: Element): string =>
          row.querySelector(`[data-loom-cell="${col}"]`)?.textContent?.trim() ?? ''
        rows.sort((a, b) => {
          const av = cellText(a)
          const bv = cellText(b)
          const an = parseFloat(av)
          const bn = parseFloat(bv)
          const cmp = !isNaN(an) && !isNaN(bn) ? an - bn : av.localeCompare(bv)
          return dir === 'asc' ? cmp : -cmp
        })
        rows.forEach((r) => body.appendChild(r))
      }
      fire(el, 'sort')
      return
    }

    if (role === 'reveal') {
      const id = el.getAttribute('data-loom-target')
      const found = id ? document.getElementById(id) : null
      if (!found) return
      const host: HTMLElement = found
      if (host.getAttribute('data-loom-open') === '1') hide(host)
      else show(host)
      fire(el, 'reveal')
      return
    }

    if (el.hasAttribute('data-loom-shell-toggle')) {
      const shell = document.querySelector(`[data-loom-shell="${el.getAttribute('data-loom-shell-toggle') ?? ''}"]`)
      if (shell) {
        // Compute the NEXT state once and describe everything from it. Reading
        // the pre-click state twice is how you end up with a collapse button
        // that reports itself still expanded.
        const wasCollapsed = shell.getAttribute('data-loom-collapsed') === '1'
        const nowCollapsed = !wasCollapsed
        shell.setAttribute('data-loom-collapsed', nowCollapsed ? '1' : '0')
        el.setAttribute('aria-expanded', nowCollapsed ? 'false' : 'true')
        el.setAttribute('aria-label', nowCollapsed ? 'Expand sidebar' : 'Collapse sidebar')
        el.textContent = nowCollapsed ? '›' : '‹'
        fire(el, nowCollapsed ? 'collapse' : 'expand')
      }
      return
    }

    if (role === 'press') {
      fire(el, 'press')
      // A named action ("clear.filters") is also announced by name: the
      // hand-off a host listens for.
      const action = el.getAttribute('data-loom-action')
      if (action) fire(el, action)
    }
  })

  // --- command palette --------------------------------------------------
  // The palette indexes the DOCUMENT: every pressable control and link is a
  // command, and running one runs the real control. No hand-maintained list,
  // so it can never drift from the interface it describes.
  const commandLabel = (el: Element): string =>
    (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim()

  const commandGroup = (el: Element): string => {
    if (el.closest('[data-loom-shell-sidebar]')) return 'Navigate'
    if (el.closest('[data-loom-shell-top]')) return 'Navigate'
    if (el.closest('[data-loom-menu-panel]')) return 'Actions'
    return 'Commands'
  }

  const paletteCommands = (): Array<{ el: Element; label: string; group: string }> => {
    const out: Array<{ el: Element; label: string; group: string }> = []
    q('[data-loom-b="press"],a[href],[role="menuitem"]').forEach((el) => {
      // A command inside the palette is the palette's own chrome.
      if (el.closest('[data-loom-palette]')) return
      const label = commandLabel(el)
      if (!label) return
      out.push({ el, label, group: commandGroup(el) })
    })
    return out
  }

  /** Subsequence match with a score that rewards early and contiguous hits. */
  const fuzzy = (needle: string, hay: string): number => {
    const n = needle.toLowerCase()
    const h = hay.toLowerCase()
    let score = 0
    let hi = 0
    let streak = 0
    for (let ni = 0; ni < n.length; ni += 1) {
      const found = h.indexOf(n[ni], hi)
      if (found === -1) return -1
      streak = found === hi && ni > 0 ? streak + 1 : 0
      score += 10 + streak * 6 - Math.min(found - hi, 8)
      hi = found + 1
    }
    return score
  }

  const paintPalette = (palette: Element, term: string): void => {
    const list = palette.querySelector('[data-loom-palette-list]')
    const empty = palette.querySelector('[data-loom-palette-empty]')
    if (!list) return
    const all = paletteCommands()
    const q = term.trim()
    const ranked = (q === ''
      ? all.map((c) => ({ c, score: 0 }))
      : all
          .map((c) => ({ c, score: fuzzy(q, c.label) }))
          .filter((r) => r.score >= 0)
          .sort((a, b) => b.score - a.score)
    ).slice(0, 40)
    list.textContent = ''
    let group = ''
    ranked.forEach((r, i) => {
      if (r.c.group !== group) {
        group = r.c.group
        const head = document.createElement('div')
        head.setAttribute('data-loom-cmd-group', '')
        head.textContent = group
        list.appendChild(head)
      }
      const row = document.createElement('div')
      row.setAttribute('data-loom-cmd', '')
      row.setAttribute('role', 'option')
      row.setAttribute('data-loom-active', i === 0 ? '1' : '0')
      row.textContent = r.c.label
      row.addEventListener('click', () => {
        ;(r.c.el as HTMLElement).click()
        closePalette(palette)
      })
      list.appendChild(row)
    })
    if (empty instanceof HTMLElement) empty.style.display = ranked.length === 0 ? 'block' : 'none'
  }

  const openPalette = (palette: Element): void => {
    palette.setAttribute('data-loom-open', '1')
    const layer = palette.querySelector('[data-loom-palette-layer]')
    if (layer) topLayer(layer, true)
    const trigger = palette.querySelector('[data-loom-palette-trigger]')
    if (trigger) trigger.setAttribute('aria-expanded', 'true')
    paintPalette(palette, '')
    const input = palette.querySelector('[data-loom-palette-input]') as HTMLInputElement | null
    if (input) {
      input.value = ''
      input.focus()
    }
    fire(palette, 'palette-open')
  }

  function closePalette(palette: Element): void {
    palette.setAttribute('data-loom-open', '0')
    const layer = palette.querySelector('[data-loom-palette-layer]')
    if (layer) topLayer(layer, false)
    const trigger = palette.querySelector('[data-loom-palette-trigger]')
    if (trigger) trigger.setAttribute('aria-expanded', 'false')
    fire(palette, 'palette-close')
  }

  const activeRow = (palette: Element): Element | null =>
    palette.querySelector('[data-loom-cmd][data-loom-active="1"]')

  const moveActive = (palette: Element, delta: number): void => {
    const rows = q('[data-loom-cmd]', palette)
    if (rows.length === 0) return
    const current = rows.findIndex((r) => r.getAttribute('data-loom-active') === '1')
    const next = Math.min(rows.length - 1, Math.max(0, (current === -1 ? 0 : current) + delta))
    rows.forEach((r, i) => r.setAttribute('data-loom-active', i === next ? '1' : '0'))
    rows[next].scrollIntoView({ block: 'nearest' })
  }

  document.addEventListener('input', (e) => {
    const el = target(e)
    if (el instanceof HTMLInputElement && el.hasAttribute('data-loom-palette-input')) {
      const palette = el.closest('[data-loom-palette]')
      if (palette) paintPalette(palette, el.value)
    }
  }, true)

  document.addEventListener('keydown', (e) => {
    const k = e as KeyboardEvent
    const palette = (document.activeElement as Element | null)?.closest?.('[data-loom-palette][data-loom-open="1"]')
      ?? document.querySelector('[data-loom-palette][data-loom-open="1"]')

    // The hotkey: mod+K anywhere, and nothing else claims it.
    if ((k.metaKey || k.ctrlKey) && (k.key === 'k' || k.key === 'K')) {
      const target2 = document.querySelector('[data-loom-palette]')
      if (target2) {
        k.preventDefault()
        if (target2.getAttribute('data-loom-open') === '1') closePalette(target2)
        else openPalette(target2)
      }
      return
    }
    if (palette) {
      if (k.key === 'Escape') {
        k.preventDefault()
        closePalette(palette)
        return
      }
      if (k.key === 'ArrowDown') {
        k.preventDefault()
        moveActive(palette, 1)
        return
      }
      if (k.key === 'ArrowUp') {
        k.preventDefault()
        moveActive(palette, -1)
        return
      }
      if (k.key === 'Enter') {
        k.preventDefault()
        const row = activeRow(palette) as HTMLElement | null
        if (row) row.click()
        return
      }
    }
  })

  // --- actions: what a control does to OTHER components ---------------------
  // (model/actions.ts) A pressable runs its `data-loom-do` list; a choice
  // control shows the view of its current choice and hides the others'. The
  // targets are found by their output hook within the same design.
  const targetEl = (from: Element, id: string): HTMLElement | null => {
    const scope = from.closest('.loom-export, .loom-container, .dw-stage') ?? document
    const el = scope.querySelector(`[data-loom-node="${CSS.escape(id)}"]`) ?? document.getElementById(id)
    return el instanceof HTMLElement ? el : null
  }
  const isShown = (el: HTMLElement): boolean =>
    el.hasAttribute('data-loom-reveal') ? el.getAttribute('data-loom-open') === '1' : el.getAttribute('data-loom-shown') !== '0'
  const setShown = (el: HTMLElement, on: boolean): void => {
    if (el.hasAttribute('data-loom-reveal')) {
      if (on) show(el)
      else hide(el)
      return
    }
    el.setAttribute('data-loom-shown', on ? '1' : '0')
    el.setAttribute('aria-hidden', on ? 'false' : 'true')
  }
  const runActions = (control: HTMLElement): void => {
    let list: Array<[string, string]> = []
    try {
      list = JSON.parse(control.getAttribute('data-loom-do') ?? '[]')
    } catch {
      return
    }
    let last: HTMLElement | null = null
    for (const [verb, id] of list) {
      const t = targetEl(control, id)
      if (!t) continue
      const on = verb === 'show' || verb === 'open' ? true : verb === 'hide' || verb === 'close' ? false : !isShown(t)
      setShown(t, on)
      fire(t, on ? 'show' : 'hide')
      last = t
    }
    // A control that shows or hides ONE thing says whether it is showing.
    if (list.length === 1 && last) control.setAttribute('aria-expanded', isShown(last) ? 'true' : 'false')
  }
  const currentChoice = (c: Element): string | null => {
    const sel = c.matches('select') ? c : c.querySelector('select')
    if (sel instanceof HTMLSelectElement) return sel.value
    const item = c.querySelector('[data-loom-choice][data-loom-on="1"],[data-loom-choice][data-loom-active="1"],[data-loom-choice][aria-selected="true"]')
    if (item) return item.getAttribute('data-loom-choice')
    const box = c.querySelector('input[type=checkbox]')
    if (box instanceof HTMLInputElement) return box.checked ? 'on' : 'off'
    return c.getAttribute('data-loom-on') === '1' ? 'on' : c.hasAttribute('data-loom-on') ? 'off' : null
  }
  const syncViews = (c: Element): void => {
    let views: Record<string, string> = {}
    try {
      views = JSON.parse(c.getAttribute('data-loom-views') ?? '{}')
    } catch {
      return
    }
    const cur = currentChoice(c)
    if (cur === null) return
    // A node shown by the current choice wins over one hidden by another.
    const showing = new Set(Object.entries(views).filter(([k]) => k === cur).map(([, id]) => id))
    for (const id of new Set(Object.values(views))) {
      const t = targetEl(c, id)
      if (t) setShown(t, showing.has(id))
    }
    fire(c, 'view')
  }
  const afterChoice = (e: Event): void => {
    const c = (e.target as Element | null)?.closest?.('[data-loom-views]')
    // After the control's own handler (and the browser's) has settled its state.
    if (c) setTimeout(() => syncViews(c), 0)
  }
  document.addEventListener('click', (e) => {
    const control = closest(e, '[data-loom-do]')
    if (control instanceof HTMLElement && !control.closest('[inert]')) runActions(control)
    afterChoice(e)
  })
  document.addEventListener('change', afterChoice)

  document.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key !== 'Escape') return
    q('[data-loom-menu-panel][data-loom-open="1"]').forEach((m) => m.setAttribute('data-loom-open', '0'))
    q('[data-loom-scrim="1"]').forEach((s) => {
      const host = s.closest('[data-loom-reveal]')
      if (host instanceof HTMLElement) hide(host)
    })
  })

  function show(host: HTMLElement): void {
    host.setAttribute('data-loom-open', '1')
    host.setAttribute('aria-hidden', 'false')
    const scrim = host.querySelector('[data-loom-scrim]')
    if (scrim) scrim.setAttribute('data-loom-scrim', '1')
    topLayer(host, true)
  }

  function hide(host: HTMLElement): void {
    host.setAttribute('data-loom-open', '0')
    host.setAttribute('aria-hidden', 'true')
    const scrim = host.querySelector('[data-loom-scrim]')
    if (scrim) scrim.setAttribute('data-loom-scrim', '0')
    topLayer(host, false)
  }
}

/**
 * A stable id for grouping siblings (tabs in a tablist, radios in a group).
 * Node ids are unique per document, so they are exactly the right scope.
 */
export function groupId(nodeId: string, suffix: string): string {
  return nodeId + ':' + suffix
}
