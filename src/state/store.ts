// Campaign persistence. Phase 0: one JSON file per channel.
// The rest of the code depends only on CampaignStore; phase 1 adds a SQLite implementation.
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Campaign } from './campaign.ts';

export interface CampaignStore {
  load(channelId: string): Promise<Campaign | null>;
  /**
   * Loads, applies `change` and saves, serialized per channel: two calls on the same channel
   * never overlap. If `change` throws, nothing is saved and the error propagates to the caller.
   */
  update(channelId: string, change: (current: Campaign | null) => Campaign | Promise<Campaign>): Promise<Campaign>;
  /**
   * Moves the channel's campaign out of the way (kept for recovery and cost metrics), freeing the
   * channel for a new one. Serialized with updates. Returns false if there was nothing to archive.
   */
  archive(channelId: string): Promise<boolean>;
  /** Every active (not archived) campaign. */
  list(): Promise<Campaign[]>;
}

export class JsonCampaignStore implements CampaignStore {
  // Per-channel queue: each update waits for the previous one on the same channel.
  private queues = new Map<string, Promise<unknown>>();

  constructor(private readonly dir: string) {}

  async load(channelId: string): Promise<Campaign | null> {
    try {
      const raw = await readFile(this.filePath(channelId), 'utf8');
      return JSON.parse(raw) as Campaign;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  update(
    channelId: string,
    change: (current: Campaign | null) => Campaign | Promise<Campaign>,
  ): Promise<Campaign> {
    return this.enqueue(channelId, async () => {
      const updated = await change(await this.load(channelId));
      await this.save(updated);
      return updated;
    });
  }

  archive(channelId: string, now = new Date()): Promise<boolean> {
    return this.enqueue(channelId, async () => {
      const archiveDir = path.join(this.dir, 'archive');
      await mkdir(archiveDir, { recursive: true });
      const stamp = now.toISOString().replace(/[:.]/g, '-'); // ':' is not allowed in Windows file names
      try {
        await rename(this.filePath(channelId), path.join(archiveDir, `${channelId}-${stamp}.json`));
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    });
  }

  async list(): Promise<Campaign[]> {
    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    // Only <channelId>.json: skips the archive folder and leftover .tmp files.
    const channelIds = files.flatMap((file) => /^(\d+)\.json$/.exec(file)?.[1] ?? []);
    const campaigns = await Promise.all(channelIds.map((id) => this.load(id)));
    return campaigns.filter((c): c is Campaign => c !== null);
  }

  /** Runs `task` after every earlier task on the same channel has finished. */
  private enqueue<T>(channelId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(channelId) ?? Promise.resolve();
    const next = previous
      .catch(() => {}) // a failed previous task must not block the queue
      .then(task);
    this.queues.set(channelId, next);
    // Drop the queue entry once nothing is waiting, so the Map does not grow forever.
    next.finally(() => {
      if (this.queues.get(channelId) === next) this.queues.delete(channelId);
    }).catch(() => {});
    return next;
  }

  private async save(campaign: Campaign): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const file = this.filePath(campaign.channelId);
    // Write to a temp file and rename: if the process dies mid-write, the old file stays intact.
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(campaign, null, 2), 'utf8');
    await rename(tmp, file);
  }

  private filePath(channelId: string): string {
    // Discord IDs are digits only; validating prevents path traversal.
    if (!/^\d+$/.test(channelId)) {
      throw new Error(`Invalid channelId: ${channelId}`);
    }
    return path.join(this.dir, `${channelId}.json`);
  }
}
