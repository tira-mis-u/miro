/** Monotonic gate for delayed/deferred preview work; stale jobs may never publish. */
export class LatestPreviewGate {
  private revision = 0;

  begin(): number {
    this.revision += 1;
    return this.revision;
  }

  isCurrent(revision: number): boolean {
    return revision === this.revision;
  }

  invalidate(): void {
    this.revision += 1;
  }
}
