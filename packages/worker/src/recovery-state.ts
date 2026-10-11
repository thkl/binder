let recoveryActive = false;

/**
 * Marks whether a restore is active so normal pipeline work can pause safely.
 *
 * @param {boolean} active - Whether recovery mode is active.
 * @returns {void} - No value.
 */
export function setRecoveryActive(active: boolean): void {
  recoveryActive = active;
}

/**
 * Returns the process-local restore flag used by the pipeline and maintenance scheduler.
 *
 * @returns {boolean} - true when the operation succeeds; otherwise, false.
 */
export function isRecoveryActive(): boolean {
  return recoveryActive;
}
