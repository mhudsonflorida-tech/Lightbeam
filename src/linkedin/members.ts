import { AxiosInstance } from 'axios';
import { LinkedInClient } from './client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MemberLocation {
  /** Human-readable location as shown on the LinkedIn profile.
   *  e.g. "Miami, Florida, United States" or "Greater Tampa Bay Area" */
  display: string;
  /** ISO country code when available, e.g. "US" */
  countryCode: string | null;
}

// LinkedIn REST API response shapes (partial)
interface LiteProfile {
  id: string;
  localizedFirstName?: string;
  localizedLastName?: string;
  profilePicture?: unknown;
  /** Available via r_liteprofile scope */
  geoLocation?: {
    geo?: string; // URN like "urn:li:geo:103644278"
  };
}

interface GeoNode {
  defaultLocalizedName?: { value?: string };
}

interface SalesNavProfile {
  memberId?: string;
  geoRegion?: string;   // e.g. "Greater Miami Area"
  geoCountry?: string;  // e.g. "United States"
}

// ─── MembersService ──────────────────────────────────────────────────────────

/**
 * Resolves the physical location of a LinkedIn member.
 *
 * Strategy (in priority order):
 *   1. Sales Navigator extended profile  – richest location data
 *   2. Lite profile geo URN → geo name   – fallback via standard API
 *
 * `linkedInUrl` can be a vanity URL (linkedin.com/in/handle) or a numeric
 * member URN (urn:li:person:12345).
 */
export class MembersService {
  private http: AxiosInstance;

  constructor(client: LinkedInClient) {
    this.http = client.instance;
  }

  /**
   * Returns the prospect's self-reported location from their LinkedIn profile.
   * Returns null if the profile can't be resolved or has no location set.
   */
  async getLocation(linkedInUrl: string): Promise<MemberLocation | null> {
    const memberId = extractMemberId(linkedInUrl);
    if (!memberId) {
      console.warn(`[linkedin] Could not parse member ID from URL: ${linkedInUrl}`);
      return null;
    }

    // Try Sales Navigator profile first (richer location)
    const navLocation = await this.getSalesNavLocation(memberId);
    if (navLocation) return navLocation;

    // Fall back to standard lite profile
    return this.getLiteProfileLocation(memberId);
  }

  private async getSalesNavLocation(
    memberId: string
  ): Promise<MemberLocation | null> {
    try {
      const { data } = await this.http.get<SalesNavProfile>(
        '/v2/salesNavigatorMemberProfile',
        {
          params: {
            q: 'member',
            memberId,
            projection: '(memberId,geoRegion,geoCountry)',
          },
        }
      );

      if (data.geoRegion) {
        return {
          display: [data.geoRegion, data.geoCountry]
            .filter(Boolean)
            .join(', '),
          countryCode: resolveCountryCode(data.geoCountry),
        };
      }
    } catch {
      // Sales Nav API unavailable – fall through to lite profile
    }
    return null;
  }

  private async getLiteProfileLocation(
    memberId: string
  ): Promise<MemberLocation | null> {
    try {
      const { data } = await this.http.get<LiteProfile>(
        `/v2/people/(id:${memberId})`,
        {
          params: {
            projection: '(id,geoLocation)',
          },
        }
      );

      const geoUrn = data.geoLocation?.geo;
      if (!geoUrn) return null;

      // Resolve the URN to a human-readable name
      const encodedUrn = encodeURIComponent(geoUrn);
      const { data: geo } = await this.http.get<GeoNode>(
        `/v2/geo/${encodedUrn}`,
        { params: { projection: '(defaultLocalizedName)' } }
      );

      const display = geo.defaultLocalizedName?.value ?? null;
      return display ? { display, countryCode: null } : null;
    } catch {
      return null;
    }
  }

  /**
   * Batch-resolve locations for multiple LinkedIn URLs.
   * Returns a map of { linkedInUrl → MemberLocation | null }.
   */
  async batchGetLocations(
    linkedInUrls: string[]
  ): Promise<Map<string, MemberLocation | null>> {
    const results = new Map<string, MemberLocation | null>();
    for (const url of linkedInUrls) {
      results.set(url, await this.getLocation(url));
    }
    return results;
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Extracts the LinkedIn member ID from a variety of URL formats:
 *   https://www.linkedin.com/in/john-doe-123abc  → "john-doe-123abc" (vanity)
 *   https://linkedin.com/in/ACoAAA...             → "ACoAAA..." (encoded ID)
 *   urn:li:person:12345                           → "12345"
 */
function extractMemberId(linkedInUrl: string): string | null {
  // URN format
  const urnMatch = linkedInUrl.match(/urn:li:person:([^,)]+)/);
  if (urnMatch) return urnMatch[1];

  // Standard profile URL
  const urlMatch = linkedInUrl.match(
    /linkedin\.com\/in\/([^/?#\s]+)/i
  );
  if (urlMatch) return urlMatch[1];

  return null;
}

const COUNTRY_CODES: Record<string, string> = {
  'United States': 'US',
  'United Kingdom': 'GB',
  Canada: 'CA',
  Australia: 'AU',
  Germany: 'DE',
  France: 'FR',
  India: 'IN',
  Brazil: 'BR',
  Mexico: 'MX',
  Singapore: 'SG',
};

function resolveCountryCode(country: string | undefined): string | null {
  if (!country) return null;
  return COUNTRY_CODES[country] ?? null;
}
