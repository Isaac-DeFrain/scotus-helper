/** Restores `process.env` keys to their pre-test values. */
export function restoreEnvVars(vars: Record<string, string | undefined>): void {
  for (const key in vars) {
    if (vars[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = vars[key];
    }
  }
}
