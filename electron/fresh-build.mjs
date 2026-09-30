/**
 * Refuse to probe a stale build.
 *
 * The node probes drive `dist/`, not the sources. When a build fails part way
 * (the main bundle rewritten, the renderer not), or a probe is run straight
 * after an edit without building, the probe tests old code and can pass or
 * fail for reasons that are not the tree's. So before spawning anything, a
 * probe checks that every build output is newer than every source it was
 * built from, and stops with the stale file named if not.
 */
import fs from 'node:fs'
import path from 'node:path'

/** Written by the build itself (embed:bundle), so it can postdate the outputs. */
const GENERATED = new Set([path.join('src', 'model', 'atelier-bundle.generated.ts')])

function newestIn(root, dir, accept, best = { file: '', ms: 0 }) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name)
    if (entry.isDirectory()) newestIn(root, rel, accept, best)
    else if (accept(rel) && !GENERATED.has(rel)) {
      const ms = fs.statSync(path.join(root, rel)).mtimeMs
      if (ms > best.ms) Object.assign(best, { file: rel, ms })
    }
  }
  return best
}

export function assertFreshBuild(root) {
  // Exactly what `build:main` writes (read from the script, so it cannot drift);
  // dist/main also holds files other scripts leave behind.
  const buildMain = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts['build:main']
  const outputs = [
    ...[...buildMain.matchAll(/--outfile=(\S+)/g)].map((m) => path.normalize(m[1])),
    ...['index.html', 'preview.html', 'desktop.html'].map((f) => path.join('dist', 'renderer', f)),
  ]
  if (outputs.length < 4) throw new Error('fresh-build: could not read the build outputs from package.json')
  let oldest = { file: '', ms: Infinity }
  for (const file of outputs) {
    let ms
    try {
      ms = fs.statSync(path.join(root, file)).mtimeMs
    } catch {
      throw new Error(`no build: ${file} is missing. Run \`npm run build\` first.`)
    }
    if (ms < oldest.ms) oldest = { file, ms }
  }
  const source = newestIn(root, 'src', () => true)
  const main = newestIn(root, 'electron', (f) => /\.c?ts$/.test(f))
  const pages = ['index.html', 'preview.html', 'desktop.html', 'vite.config.ts'].map((file) => ({ file, ms: fs.statSync(path.join(root, file)).mtimeMs }))
  const newest = [source, main, ...pages].reduce((a, b) => (b.ms > a.ms ? b : a))
  if (newest.ms > oldest.ms) {
    throw new Error(`stale build: ${newest.file} is newer than ${oldest.file}. The last build failed or never ran; run \`npm run build\` and fix it first.`)
  }
}
