export function notifyBackupCompleted(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("egc:backup-completed"));
}
