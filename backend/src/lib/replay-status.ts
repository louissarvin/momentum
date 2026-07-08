/**
 * Shared replay-mode status file — Phase E / E.1.
 *
 * The replay worker runs in its own Bun process. The HTTP process exposes
 * `GET /api/replay/status` and includes `replayMode` in `/health`. Both
 * need a cross-process pointer, so we write a small JSON heartbeat file
 * into the system tmpdir (same pattern as `settler-heartbeat.ts`).
 *
 * Absence of the file = replay not active.
 */

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FILE = join(tmpdir(), 'momentum-replay.status.json');

export interface ReplayStatus {
  active: boolean;
  fixtureId: string;
  currentSeq: number;
  endSeq: number;
  startSeq: number;
  totalPackets: number;
  processedPackets: number;
  speed: number;
  startedAt: string;
  updatedAt: string;
  estimatedCompletionAt: string | null;
  finishedAt?: string;
}

export async function writeReplayStatus(patch: Partial<ReplayStatus>): Promise<void> {
  let current: Partial<ReplayStatus> = {};
  try {
    const buf = await fs.readFile(FILE, 'utf8');
    current = JSON.parse(buf) as Partial<ReplayStatus>;
  } catch {
    // no prior file
  }
  const defaults: ReplayStatus = {
    active: false,
    fixtureId: '',
    currentSeq: 0,
    endSeq: 0,
    startSeq: 0,
    totalPackets: 0,
    processedPackets: 0,
    speed: 1,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    estimatedCompletionAt: null,
  };
  const next: ReplayStatus = {
    ...defaults,
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  } as ReplayStatus;
  await fs.writeFile(FILE, JSON.stringify(next), 'utf8');
}

export async function readReplayStatus(): Promise<ReplayStatus | null> {
  try {
    const buf = await fs.readFile(FILE, 'utf8');
    return JSON.parse(buf) as ReplayStatus;
  } catch {
    return null;
  }
}

export async function clearReplayStatus(): Promise<void> {
  try {
    await fs.unlink(FILE);
  } catch {
    // best-effort
  }
}
