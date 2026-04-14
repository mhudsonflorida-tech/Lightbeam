import axios, { AxiosInstance, AxiosError } from 'axios';
import axiosRetry from 'axios-retry';
import { config } from '../config';

const LINKEDIN_BASE_URL = 'https://api.linkedin.com';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';

/**
 * HTTP client for the LinkedIn REST API.
 *
 * Required OAuth 2.0 scopes:
 *   - r_liteprofile          (basic member profile + location)
 *   - r_emailaddress         (optional – email matching)
 *   - rw_sales_nav_profile   (Sales Navigator extended profile)
 *
 * Access is gated by LinkedIn's Sales Navigator Application Platform (SNAP).
 * Apply at: https://business.linkedin.com/sales-solutions/sales-navigator-api-program
 */
export class LinkedInClient {
  private http: AxiosInstance;
  private accessToken: string;

  constructor() {
    this.accessToken = config.linkedin.accessToken;

    this.http = axios.create({
      baseURL: LINKEDIN_BASE_URL,
      headers: {
        'LinkedIn-Version': '202309',
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });

    axiosRetry(this.http, {
      retries: 4,
      retryDelay: (retryCount, error) => {
        const retryAfter =
          (error as AxiosError)?.response?.headers?.['retry-after'];
        if (retryAfter) return parseInt(retryAfter, 10) * 1000;
        return axiosRetry.exponentialDelay(retryCount);
      },
      retryCondition: (error: AxiosError) =>
        axiosRetry.isNetworkOrIdempotentRequestError(error) ||
        error.response?.status === 429 ||
        (error.response?.status ?? 0) >= 500,
    });

    this.http.interceptors.request.use((req) => {
      req.headers.Authorization = `Bearer ${this.accessToken}`;
      return req;
    });

    this.http.interceptors.response.use(
      (res) => res,
      async (err: AxiosError) => {
        if (err.response?.status === 401 && config.linkedin.refreshToken) {
          try {
            await this.refreshToken();
            if (err.config) {
              err.config.headers = err.config.headers ?? {};
              err.config.headers.Authorization = `Bearer ${this.accessToken}`;
              return this.http.request(err.config);
            }
          } catch {
            // surface original 401
          }
        }
        return Promise.reject(err);
      }
    );
  }

  private async refreshToken(): Promise<void> {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: config.linkedin.refreshToken,
      client_id: config.linkedin.clientId,
      client_secret: config.linkedin.clientSecret,
    });

    const { data } = await axios.post<{ access_token: string }>(
      TOKEN_URL,
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    this.accessToken = data.access_token;
    console.log('[linkedin] Access token refreshed.');
  }

  get instance(): AxiosInstance {
    return this.http;
  }
}
