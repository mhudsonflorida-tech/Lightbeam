import * as dotenv from 'dotenv';

dotenv.config();

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}\n` +
      `Copy .env.example to .env and fill in your credentials.`
    );
  }
  return value;
}

function optional(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

export const config = {
  outreach: {
    clientId: required('OUTREACH_CLIENT_ID'),
    clientSecret: required('OUTREACH_CLIENT_SECRET'),
    redirectUri: optional('OUTREACH_REDIRECT_URI', 'http://localhost:3000/callback'),
    accessToken: required('OUTREACH_ACCESS_TOKEN'),
    refreshToken: optional('OUTREACH_REFRESH_TOKEN', ''),
    /**
     * The Outreach prospect attribute key that stores the prospect's
     * physical location (e.g. "Miami, FL"). Configurable so teams can
     * use whichever custom field slot they have available.
     */
    locationField: optional('OUTREACH_LOCATION_FIELD', 'custom1'),
  },
  linkedin: {
    clientId: required('LINKEDIN_CLIENT_ID'),
    clientSecret: required('LINKEDIN_CLIENT_SECRET'),
    accessToken: required('LINKEDIN_ACCESS_TOKEN'),
    refreshToken: optional('LINKEDIN_REFRESH_TOKEN', ''),
  },
  sync: {
    batchSize: parseInt(optional('SYNC_BATCH_SIZE', '50'), 10),
    rateLimitDelayMs: parseInt(optional('RATE_LIMIT_DELAY_MS', '500'), 10),
    concurrency: parseInt(optional('SYNC_CONCURRENCY', '5'), 10),
  },
} as const;
