import pLimit from 'p-limit';
import { config } from './config';
import { OutreachClient } from './outreach/client';
import { ProspectsRepository } from './outreach/prospects';
import { LinkedInClient } from './linkedin/client';
import { MembersService } from './linkedin/members';

export interface SyncResult {
  processed: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{ prospectId: string; linkedInUrl: string; error: string }>;
}

/**
 * Pulls the physical location for every Outreach prospect that has a LinkedIn
 * URL but is missing a value in the configured location field, then writes
 * the location back to Outreach.
 *
 * Pass `forceAll: true` to re-sync even prospects that already have a
 * location value (useful for a full refresh).
 */
export async function syncProspectLocations(
  options: { forceAll?: boolean; dryRun?: boolean } = {}
): Promise<SyncResult> {
  const { forceAll = false, dryRun = false } = options;

  const outreachClient = new OutreachClient();
  const prospects = new ProspectsRepository(outreachClient);

  const linkedinClient = new LinkedInClient();
  const members = new MembersService(linkedinClient);

  const limit = pLimit(config.sync.concurrency);
  const result: SyncResult = {
    processed: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  const source = forceAll
    ? prospects.allWithLinkedIn()
    : prospects.missingLocation();

  const tasks: Array<Promise<void>> = [];

  for await (const prospect of source) {
    result.processed++;

    if (!prospect.linkedInUrl) {
      result.skipped++;
      continue;
    }

    const task = limit(async () => {
      try {
        const location = await members.getLocation(prospect.linkedInUrl!);

        if (!location) {
          console.log(
            `[sync] No location found for ${prospect.firstName} ${prospect.lastName} ` +
            `(${prospect.linkedInUrl})`
          );
          result.skipped++;
          return;
        }

        const locationStr = location.display;
        console.log(
          `[sync] ${prospect.firstName} ${prospect.lastName} → "${locationStr}"` +
          (dryRun ? ' (dry-run, not saved)' : '')
        );

        if (!dryRun) {
          await prospects.setLocation(prospect.id, locationStr);
        }

        result.updated++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[sync] Error processing prospect ${prospect.id}: ${message}`
        );
        result.failed++;
        result.errors.push({
          prospectId: prospect.id,
          linkedInUrl: prospect.linkedInUrl!,
          error: message,
        });
      }

      // Respect rate limits between LinkedIn calls
      await sleep(config.sync.rateLimitDelayMs);
    });

    tasks.push(task);
  }

  await Promise.all(tasks);

  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
