import { AxiosInstance } from 'axios';
import { config } from '../config';
import { OutreachClient } from './client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OutreachProspect {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  linkedInUrl: string | null;
  /** Value of the configured OUTREACH_LOCATION_FIELD attribute */
  physicalLocation: string | null;
  /** Raw attributes from the API – useful for debugging */
  raw: Record<string, unknown>;
}

interface JsonApiProspect {
  id: string;
  type: 'prospect';
  attributes: Record<string, unknown>;
}

interface JsonApiResponse {
  data: JsonApiProspect[];
  meta?: { count?: number; hasMore?: boolean };
  links?: { next?: string | null };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toProspect(resource: JsonApiProspect): OutreachProspect {
  const a = resource.attributes;
  const emails = (a.emailAddresses as Array<{ email: string }> | null) ?? [];
  return {
    id: resource.id,
    firstName: (a.firstName as string | null) ?? null,
    lastName: (a.lastName as string | null) ?? null,
    email: emails[0]?.email ?? null,
    linkedInUrl: (a.linkedInUrl as string | null) ?? null,
    physicalLocation:
      (a[config.outreach.locationField] as string | null) ?? null,
    raw: a,
  };
}

// ─── ProspectsRepository ─────────────────────────────────────────────────────

export class ProspectsRepository {
  private http: AxiosInstance;

  constructor(client: OutreachClient) {
    this.http = client.instance;
  }

  /**
   * Fetch all prospects that have a LinkedIn URL set.
   * Uses cursor-based pagination so this works on any size book.
   */
  async *allWithLinkedIn(): AsyncGenerator<OutreachProspect> {
    let cursor: string | null = null;

    do {
      const params: Record<string, unknown> = {
        'filter[linkedInUrl][exists]': true,
        'page[size]': config.sync.batchSize,
        'fields[prospect]': [
          'firstName',
          'lastName',
          'emailAddresses',
          'linkedInUrl',
          config.outreach.locationField,
        ].join(','),
      };
      if (cursor) params['page[after]'] = cursor;

      const { data } = await this.http.get<JsonApiResponse>('/prospects', {
        params,
      });

      for (const resource of data.data) {
        yield toProspect(resource);
      }

      // Outreach returns a `links.next` cursor URL when there are more pages
      const nextLink = data.links?.next ?? null;
      if (nextLink) {
        const url = new URL(nextLink);
        cursor = url.searchParams.get('page[after]');
      } else {
        cursor = null;
      }
    } while (cursor !== null);
  }

  /**
   * Fetch prospects whose physical location field is empty so we only
   * process records that actually need updating.
   */
  async *missingLocation(): AsyncGenerator<OutreachProspect> {
    for await (const prospect of this.allWithLinkedIn()) {
      if (!prospect.physicalLocation) yield prospect;
    }
  }

  /**
   * Update the physical-location custom field for a single prospect.
   */
  async setLocation(prospectId: string, location: string): Promise<void> {
    await this.http.patch(`/prospects/${prospectId}`, {
      data: {
        type: 'prospect',
        id: prospectId,
        attributes: {
          [config.outreach.locationField]: location,
        },
      },
    });
  }

  /**
   * Fetch prospects filtered by a location string for event invite targeting.
   * Outreach doesn't support partial-match filters server-side for custom
   * fields, so we fetch all prospects and filter in-process. For large books
   * consider adding a dedicated search index.
   */
  async findByLocation(locationQuery: string): Promise<OutreachProspect[]> {
    const normalised = locationQuery.toLowerCase();
    const results: OutreachProspect[] = [];

    for await (const prospect of this.allWithLinkedIn()) {
      if (
        prospect.physicalLocation &&
        prospect.physicalLocation.toLowerCase().includes(normalised)
      ) {
        results.push(prospect);
      }
    }

    return results;
  }
}
