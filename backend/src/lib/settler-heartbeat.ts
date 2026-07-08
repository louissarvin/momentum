/**
 * Cross-process settler heartbeat using a small file on disk.
 *
 * Chosen over adding a `SettlerHeartbeat` Prisma model because Phase C
 * conventions forbid destructive schema changes without the user running
 * `bun run db:push` — a filesystem pointer keeps the tier changes
 * self-contained. The file is written on each settler tick and read from
 * /health.
 *
 * File contains a single JSON object: { updatedAt: ISO string, tickCount:
 * number }.
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';

const HEARTBEAT_PATH = join(tmpdir(), 'momentum-settler.heartbeat.json');

export interface SettlerHeartbeat {
  updatedAt: string;
  tickCount: number;
  lastJobId?: string;
}

let localTicks = 0;

export async function writeSettlerHeartbeat(patch?: { lastJobId?: string }): Promise<void> {
  localTicks += 1;
  const body: SettlerHeartbeat = {
    updatedAt: new Date().toISOString(),
    tickCount: localTicks,
    lastJobId: patch?.lastJobId,
  };
  try {
    await writeFile(HEARTBEAT_PATH, JSON.stringify(body), { encoding: 'utf8', flag: 'w' });
  } catch {
    // ignore — heartbeat is best-effort
  }
}

export async function readSettlerHeartbeat(): Promise<SettlerHeartbeat | null> {
  try {
    const raw = await readFile(HEARTBEAT_PATH, 'utf8');
    return JSON.parse(raw) as SettlerHeartbeat;
  } catch {
    return null;
  }
}

export function settlerHeartbeatPath(): string {
  return HEARTBEAT_PATH;
}
