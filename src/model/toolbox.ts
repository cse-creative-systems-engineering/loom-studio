/**
 * The initial toolbox.
 *
 * Deliberately small: a handful of containers and leaves that exercise every
 * structural feature (containers, free positioning, flow, bindable props,
 * target-gated props). This is a spike toolbox, not a shipped catalogue.
 */

import { defineComponent } from '../model/registry'
import './catalog1'
import './catalog2'

defineComponent({
  name: 'Panel',
  category: 'Containers',
  container: true,
  icon: '▦',
  description: 'A surface container. Accepts children.',
  props: {
    title: { type: 'string', default: '', group: 'Content' },
    padding: { type: 'number', default: 16, min: 0, max: 96, group: 'Layout' },
    radius: { type: 'number', default: 14, min: 0, max: 48, group: 'Style' },
    direction: {
      type: 'enum',
      options: ['row', 'column'],
      default: 'column',
      group: 'Layout',
    },
    gap: { type: 'number', default: 12, min: 0, max: 64, group: 'Layout' },
    surface: {
      type: 'enum',
      options: ['solid', 'glass', 'gradient'],
      // Desktop-first: the default surface must be portable to a native
      // widget tree. Glass stays available as an explicit web-only choice.
      default: 'solid',
      group: 'Style',
    },
    glass: {
      type: 'boolean',
      default: false,
      group: 'Style',
      requires: ['css-backdrop-filter'],
    },
  },
})

defineComponent({
  name: 'Stack',
  category: 'Containers',
  container: true,
  icon: '≡',
  description: 'Tight vertical/horizontal stack of children.',
  props: {
    gap: { type: 'number', default: 8, min: 0, max: 64, group: 'Layout' },
    align: {
      type: 'enum',
      options: ['start', 'center', 'end', 'stretch'],
      default: 'stretch',
      group: 'Layout',
    },
  },
})

defineComponent({
  name: 'Grid',
  category: 'Containers',
  container: true,
  icon: '⊞',
  description: 'Uniform grid of children.',
  props: {
    columns: { type: 'number', default: 2, min: 1, max: 12, step: 1, group: 'Layout' },
    gap: { type: 'number', default: 12, min: 0, max: 64, group: 'Layout' },
  },
})

defineComponent({
  name: 'Button',
  category: 'Controls',
  icon: '⬢',
  description: 'Clickable button with an optional action binding.',
  props: {
    label: { type: 'string', default: 'Button', group: 'Content', bindable: true },
    variant: {
      type: 'enum',
      options: ['primary', 'secondary', 'ghost', 'danger'],
      default: 'primary',
      group: 'Style',
    },
    size: { type: 'enum', options: ['sm', 'md', 'lg'], default: 'md', group: 'Layout' },
    glow: { type: 'boolean', default: false, group: 'Style', requires: ['css-filter'] },
    disabled: { type: 'boolean', default: false, group: 'State' },
    action: { type: 'string', default: '', group: 'Logic' },
  },
})

defineComponent({
  name: 'Label',
  category: 'Text',
  icon: 'T',
  description: 'Static or bound text.',
  props: {
    text: { type: 'string', default: 'Text', group: 'Content', bindable: true },
    size: { type: 'enum', options: ['xs', 'sm', 'md', 'lg', 'xl'], default: 'md', group: 'Style' },
    weight: { type: 'enum', options: ['400', '500', '600', '700'], default: '500', group: 'Style' },
    color: { type: 'color', default: '#e6e9ef', group: 'Style' },
  },
})

defineComponent({
  name: 'Input',
  category: 'Controls',
  icon: '▭',
  description: 'Text field.',
  props: {
    placeholder: { type: 'string', default: 'Type here…', group: 'Content' },
    value: { type: 'string', default: '', group: 'State', bindable: true },
    width: { type: 'number', default: 200, min: 40, max: 1200, group: 'Layout' },
  },
})

defineComponent({
  name: 'FormField',
  category: 'Controls',
  icon: '⌸',
  description: 'Label + input + hint/error. The most-reached-for control in a real app.',
  props: {
    label: { type: 'string', default: 'Label', group: 'Content' },
    placeholder: { type: 'string', default: '', group: 'Content' },
    value: { type: 'string', default: '', group: 'State', bindable: true },
    hint: { type: 'string', default: '', group: 'Content' },
    error: { type: 'string', default: '', group: 'State' },
    width: { type: 'number', default: 240, min: 80, max: 800, group: 'Layout' },
    required: { type: 'boolean', default: false, group: 'State' },
  },
})

defineComponent({
  name: 'Heading',
  category: 'Text',
  icon: 'H',
  description: 'Semantic heading with a real type scale.',
  props: {
    text: { type: 'string', default: 'Heading', group: 'Content', bindable: true },
    level: { type: 'enum', options: ['1', '2', '3'], default: '1', group: 'Style' },
    color: { type: 'color', default: '', group: 'Style' },
    align: { type: 'enum', options: ['left', 'center', 'right'], default: 'left', group: 'Style' },
  },
})

defineComponent({
  name: 'Gauge',
  category: 'Data',
  icon: '◔',
  description: 'Radial value gauge with a real scale and colour-by-value. Bound to a data source.',
  props: {
    value: { type: 'number', default: 0, min: 0, max: 100, step: 0.1, group: 'Data', bindable: true },
    min: { type: 'number', default: 0, group: 'Data' },
    max: { type: 'number', default: 100, group: 'Data' },
    unit: { type: 'string', default: '%', group: 'Data' },
    size: { type: 'number', default: 140, min: 48, max: 480, group: 'Layout' },
    warnAt: { type: 'number', default: 65, min: 0, max: 100, group: 'Data' },
    dangerAt: { type: 'number', default: 85, min: 0, max: 100, group: 'Data' },
  },
})

defineComponent({
  name: 'Sparkline',
  category: 'Data',
  icon: '∿',
  description: 'Trend line with an area fill and end-point marker.',
  props: {
    points: { type: 'string', default: '12,30,22,48,41,66,58,80,74,92', group: 'Data', bindable: true },
    width: { type: 'number', default: 220, min: 60, max: 1200, group: 'Layout' },
    height: { type: 'number', default: 60, min: 20, max: 400, group: 'Layout' },
    accent: { type: 'color', default: '', group: 'Style' },
    /**
     * Animate the trace. Honoured on every target, so the claim is true —
     * unlike the previous `shader` prop, which was documented as WebGL but
     * referenced nowhere in the renderer.
     */
    animate: { type: 'boolean', default: true, group: 'Style' },
    shader: {
      type: 'boolean',
      default: false,
      group: 'Style',
      requires: ['webgl'],
    },
  },
})
