// Per-stage telemetry (spec 03 · telemetry): correlation ids, counts, and timing
// so a run is reconstructable. No secrets ever enter telemetry (spec 06 · §2).

export interface StageEvent {
  stage: string;
  correlation_id: string;
  counts: Record<string, number>;
  notes?: string[];
}

export class Telemetry {
  readonly events: StageEvent[] = [];
  constructor(readonly runId: string) {}

  stage(stage: string, counts: Record<string, number>, notes?: string[]): void {
    this.events.push({ stage, correlation_id: `${this.runId}:${stage}`, counts, notes });
  }

  toJSON(): { run_id: string; stages: StageEvent[] } {
    return { run_id: this.runId, stages: this.events };
  }
}
