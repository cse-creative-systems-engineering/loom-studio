declare module '*.css'
/** Output fonts, inlined as data URLs by both bundlers (see src/render/fonts.ts). */
declare module '*.woff2' {
  const src: string
  export default src
}
