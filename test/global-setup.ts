// Build the CLI bundle (and the app the relay serves) once, before any test file runs. Test files used to build in
// their own beforeAll, and two workers rebuilding dist/ at once could delete the plugin folder under each other.

import { buildCli } from '../packages/cli/test/harness.ts'

export default function setup(): void {
  buildCli()
}
