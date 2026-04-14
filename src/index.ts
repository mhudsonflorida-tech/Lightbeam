#!/usr/bin/env ts-node
import { Command } from 'commander';
import { syncProspectLocations } from './sync';
import { EventInviteService } from './eventInvites';
import { OutreachClient } from './outreach/client';

const program = new Command();

program
  .name('lightbeam')
  .description(
    'Sync LinkedIn Sales Navigator prospect locations to Outreach.io ' +
    'and build geo-targeted event invite lists.'
  )
  .version('1.0.0');

// ─── sync command ─────────────────────────────────────────────────────────────

program
  .command('sync')
  .description(
    'Pull each prospect\'s physical location from LinkedIn Sales Navigator ' +
    'and write it to the configured Outreach custom field.'
  )
  .option('--force-all', 'Re-sync prospects that already have a location value', false)
  .option('--dry-run', 'Show what would be updated without writing to Outreach', false)
  .action(async (opts) => {
    console.log('═'.repeat(60));
    console.log(' Lightbeam – Prospect Location Sync');
    console.log('═'.repeat(60));
    console.log(`Mode   : ${opts.dryRun ? 'Dry run (no writes)' : 'Live'}`);
    console.log(`Scope  : ${opts.forceAll ? 'All prospects with LinkedIn URL' : 'Only prospects missing location'}`);
    console.log('─'.repeat(60));

    try {
      const result = await syncProspectLocations({
        forceAll: opts.forceAll,
        dryRun: opts.dryRun,
      });

      console.log('\n' + '─'.repeat(60));
      console.log(' Sync complete');
      console.log('─'.repeat(60));
      console.log(`  Processed : ${result.processed}`);
      console.log(`  Updated   : ${result.updated}`);
      console.log(`  Skipped   : ${result.skipped}  (no location found)`);
      console.log(`  Failed    : ${result.failed}`);

      if (result.errors.length > 0) {
        console.log('\n  Errors:');
        for (const e of result.errors) {
          console.log(`    - Prospect ${e.prospectId} (${e.linkedInUrl}): ${e.error}`);
        }
      }

      process.exit(result.failed > 0 ? 1 : 0);
    } catch (err) {
      console.error('\n[error]', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// ─── event-invites command ────────────────────────────────────────────────────

program
  .command('event-invites')
  .description(
    'Find all prospects whose physical location matches an event city/region ' +
    'and optionally enroll them in an Outreach sequence.'
  )
  .requiredOption(
    '-l, --location <location>',
    'City, metro area, or region to target (e.g. "Miami", "Tampa Bay", "Florida")'
  )
  .option(
    '-s, --sequence-id <id>',
    'Outreach sequence ID to enroll matching prospects into'
  )
  .option('--dry-run', 'List matching prospects without enrolling them', false)
  .action(async (opts) => {
    console.log('═'.repeat(60));
    console.log(' Lightbeam – Event Invite Builder');
    console.log('═'.repeat(60));
    console.log(`Location   : ${opts.location}`);
    console.log(`Sequence   : ${opts.sequenceId ?? '(not provided – list only)'}`);
    console.log(`Mode       : ${opts.dryRun ? 'Dry run' : 'Live'}`);
    console.log('─'.repeat(60));

    try {
      const client = new OutreachClient();
      const service = new EventInviteService(client);

      const result = await service.prepareEventInvites({
        location: opts.location,
        sequenceId: opts.sequenceId,
        dryRun: opts.dryRun,
      });

      console.log('─'.repeat(60));
      console.log(' Summary');
      console.log('─'.repeat(60));
      console.log(`  Prospects matched : ${result.matched.length}`);
      console.log(`  Enrolled          : ${result.addedToSequence}`);
      if (result.errors.length > 0) {
        console.log(`  Enrollment errors : ${result.errors.length}`);
      }

      process.exit(result.errors.length > 0 ? 1 : 0);
    } catch (err) {
      console.error('\n[error]', err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program.parse(process.argv);

// Show help if no command given
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
