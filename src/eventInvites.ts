import { AxiosInstance } from 'axios';
import { OutreachClient } from './outreach/client';
import { ProspectsRepository, OutreachProspect } from './outreach/prospects';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EventOptions {
  /** City, metro area, or region to target – supports partial match.
   *  e.g. "Miami", "Tampa Bay", "South Florida", "Florida" */
  location: string;
  /** Outreach sequence ID to add matching prospects into */
  sequenceId?: string;
  /** Print matching prospects without adding to a sequence */
  dryRun?: boolean;
}

export interface EventInviteResult {
  location: string;
  matched: OutreachProspect[];
  addedToSequence: number;
  errors: Array<{ prospectId: string; error: string }>;
}

// ─── Sequence types (Outreach JSON:API) ──────────────────────────────────────

interface SequenceStatePayload {
  data: {
    type: 'sequenceState';
    attributes: { state: 'active' };
    relationships: {
      prospect: { data: { type: 'prospect'; id: string } };
      sequence: { data: { type: 'sequence'; id: string } };
      mailbox: { data: { type: 'mailbox'; id: string } };
    };
  };
}

interface SequenceStateResponse {
  data: { id: string };
}

interface MailboxResponse {
  data: Array<{ id: string }>;
}

// ─── EventInviteService ───────────────────────────────────────────────────────

export class EventInviteService {
  private http: AxiosInstance;
  private prospects: ProspectsRepository;

  constructor(client: OutreachClient) {
    this.http = client.instance;
    this.prospects = new ProspectsRepository(client);
  }

  /**
   * Find all prospects whose physical location matches the event location,
   * then optionally add them to an Outreach sequence in bulk.
   */
  async prepareEventInvites(options: EventOptions): Promise<EventInviteResult> {
    const { location, sequenceId, dryRun = false } = options;

    console.log(`\n[events] Searching for prospects near: "${location}"`);
    const matched = await this.prospects.findByLocation(location);
    console.log(`[events] Found ${matched.length} matching prospect(s).`);

    const result: EventInviteResult = {
      location,
      matched,
      addedToSequence: 0,
      errors: [],
    };

    if (matched.length === 0) {
      console.log('[events] No prospects matched – nothing to enroll.');
      return result;
    }

    // Print the match list always so the user can review
    printMatchTable(matched);

    if (dryRun || !sequenceId) {
      console.log(
        dryRun
          ? '\n[events] Dry-run mode – no prospects enrolled in sequence.'
          : '\n[events] No --sequence-id provided – skipping enrollment.'
      );
      return result;
    }

    // Resolve the sender's primary mailbox
    const mailboxId = await this.getPrimaryMailboxId();
    if (!mailboxId) {
      console.error('[events] No mailbox found – cannot enroll prospects.');
      return result;
    }

    console.log(`\n[events] Enrolling ${matched.length} prospect(s) in sequence ${sequenceId}…`);

    for (const prospect of matched) {
      try {
        await this.addToSequence(prospect.id, sequenceId, mailboxId);
        result.addedToSequence++;
        console.log(
          `  ✓ ${prospect.firstName} ${prospect.lastName} (${prospect.physicalLocation})`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push({ prospectId: prospect.id, error: message });
        console.error(
          `  ✗ ${prospect.firstName} ${prospect.lastName}: ${message}`
        );
      }
    }

    console.log(
      `\n[events] Done. ${result.addedToSequence}/${matched.length} enrolled.`
    );
    return result;
  }

  private async getPrimaryMailboxId(): Promise<string | null> {
    try {
      const { data } =
        await this.http.get<MailboxResponse>('/mailboxes', {
          params: { 'page[size]': 1 },
        });
      return data.data[0]?.id ?? null;
    } catch {
      return null;
    }
  }

  private async addToSequence(
    prospectId: string,
    sequenceId: string,
    mailboxId: string
  ): Promise<SequenceStateResponse> {
    const payload: SequenceStatePayload = {
      data: {
        type: 'sequenceState',
        attributes: { state: 'active' },
        relationships: {
          prospect: { data: { type: 'prospect', id: prospectId } },
          sequence: { data: { type: 'sequence', id: sequenceId } },
          mailbox: { data: { type: 'mailbox', id: mailboxId } },
        },
      },
    };

    const { data } = await this.http.post<SequenceStateResponse>(
      '/sequenceStates',
      payload
    );
    return data;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function printMatchTable(prospects: OutreachProspect[]): void {
  console.log('\n  Matching prospects:\n');
  console.log(
    '  ' +
    'Name'.padEnd(30) +
    'Location'.padEnd(40) +
    'Email'
  );
  console.log('  ' + '─'.repeat(90));

  for (const p of prospects) {
    const name = `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim().substring(0, 28);
    const loc = (p.physicalLocation ?? '—').substring(0, 38);
    const email = p.email ?? '—';
    console.log(`  ${name.padEnd(30)}${loc.padEnd(40)}${email}`);
  }
  console.log();
}
