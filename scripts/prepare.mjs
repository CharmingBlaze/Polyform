// Point git at the tracked hooks. Skips quietly outside a git checkout (e.g. a ZIP download) or without git.
import { execSync } from 'node:child_process'
try {
  execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' })
  execSync('git config core.hooksPath .githooks', { stdio: 'ignore' })
} catch {
  // not a git checkout: nothing to set up
}
