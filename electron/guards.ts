/**
 * Main-process trust checks, kept pure so the self-test can exercise them.
 *
 * The designed document is untrusted: a file can carry any link, and any
 * window that loads a remote page keeps the preload bridge. These are the
 * checks that stop a hostile document from reaching the filesystem or the
 * OS through that bridge.
 */

/** URL schemes that may be handed to the OS. Everything else is refused. */
const EXTERNAL_SCHEMES = new Set(['https:', 'http:', 'mailto:'])

/**
 * True when `url` may be opened in the user's real browser / mail client.
 *
 * `shell.openExternal` hands a URL to whatever the OS registered for its
 * scheme, so an unrestricted call is a launcher for arbitrary protocol
 * handlers (`file:`, `smb:`, custom app schemes). Only web and mail links are
 * something a designed UI legitimately opens.
 */
export function isExternalUrlAllowed(url: string): boolean {
  try {
    return EXTERNAL_SCHEMES.has(new URL(url).protocol)
  } catch {
    return false
  }
}

/**
 * The autosave filename, or null when `name` is not exactly what
 * `persist.filenameFor` produces.
 *
 * The name comes from the renderer and is joined onto the autosave directory,
 * so anything with a separator or `..` would write (or read) outside it. The
 * allowlist mirrors the slug grammar rather than trying to strip bad
 * characters: a name that does not match is refused, never repaired.
 */
export function autosaveFileName(name: unknown): string | null {
  if (typeof name !== 'string') return null
  return /^[a-z0-9][a-z0-9-]{0,59}\.loom\.json$/.test(name) ? name : null
}
