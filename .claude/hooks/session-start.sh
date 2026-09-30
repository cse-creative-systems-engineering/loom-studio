#!/bin/bash
# Claude Code on the web: make the build, verify and the probes runnable.
#
# Every one of them launches Electron, which in the cloud container needs:
#  - the Electron binary (npm install fetches it; a wiped dist is refetched),
#  - an X display: a headless Xvfb on :99, started detached (setsid) so it
#    outlives this hook and the shell that ran it,
#  - --no-sandbox, since the container runs as root: a wrapper directory that
#    ELECTRON_OVERRIDE_DIST_PATH points at, so `electron`, `npx electron` and
#    the probes' `import electronPath from 'electron'` all use it.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Dependencies, exactly as locked. `npm install` would rewrite
# package-lock.json with whatever npm the container has (dirtying the tree
# every session), so install with `npm ci`, and only when node_modules is
# missing or older than the lockfile; otherwise the cached install stands.
if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci --no-audit --no-fund
fi
if [ ! -x node_modules/electron/dist/electron ]; then
  node node_modules/electron/install.js
fi

# Electron without the sandbox, when running as root.
wrapper_dir="$HOME/.cache/loom-electron"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$wrapper_dir"
  printf '#!/bin/sh\nexec %s --no-sandbox "$@"\n' "$CLAUDE_PROJECT_DIR/node_modules/electron/dist/electron" > "$wrapper_dir/electron"
  chmod +x "$wrapper_dir/electron"
  echo "export ELECTRON_OVERRIDE_DIST_PATH=\"$wrapper_dir\"" >> "$CLAUDE_ENV_FILE"
fi

# A headless display on :99, unless one is already up.
if command -v Xvfb >/dev/null 2>&1; then
  if ! pgrep -x Xvfb >/dev/null 2>&1; then
    rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
    setsid nohup Xvfb :99 -screen 0 1600x1000x24 >/dev/null 2>&1 < /dev/null &
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      [ -S /tmp/.X11-unix/X99 ] && break
      sleep 0.5
    done
  fi
  echo 'export DISPLAY=:99' >> "$CLAUDE_ENV_FILE"
else
  echo "session-start: Xvfb is not installed; Electron (build, verify, probes) cannot start" >&2
fi
