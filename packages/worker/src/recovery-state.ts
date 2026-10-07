let recoveryActive = false;

export function setRecoveryActive(active: boolean): void {
  recoveryActive = active;
}

export function isRecoveryActive(): boolean {
  return recoveryActive;
}
