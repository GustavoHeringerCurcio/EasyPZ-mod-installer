import type { UiSuiteView } from '../../../shared/ipc'

export function pickDefaultSuite(suites: UiSuiteView[]): UiSuiteView | null {
  return suites.find((suite) => suite.recommended) ?? suites[0] ?? null
}
