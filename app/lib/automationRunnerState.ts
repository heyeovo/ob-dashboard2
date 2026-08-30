const LOCK_KEY = '__ob2_automation_pro_runner_busy__'
type RunnerGlobal = typeof globalThis & { [LOCK_KEY]?: boolean }

export function isAutomationRunnerBusy(): boolean {
  return Boolean((globalThis as RunnerGlobal)[LOCK_KEY])
}

export function setAutomationRunnerBusy(value: boolean): void {
  ;(globalThis as RunnerGlobal)[LOCK_KEY] = value
}
