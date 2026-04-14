import axios, { AxiosInstance, AxiosError } from 'axios';
import axiosRetry from 'axios-retry';
import { config } from '../config';

const OUTREACH_BASE_URL = 'https://api.outreach.io/api/v2';
const TOKEN_URL = 'https://api.outreach.io/oauth/token';

/**
 * Thin HTTP client for the Outreach v2 JSON:API.
 * Handles OAuth token refresh and automatic retry on 429 / 5xx responses.
 */
export class OutreachClient {
  private http: AxiosInstance;
  private accessToken: string;

  constructor() {
    this.accessToken = config.outreach.accessToken;

    this.http = axios.create({
      baseURL: OUTREACH_BASE_URL,
      headers: {
        'Content-Type': 'application/vnd.api+json',
        Accept: 'application/vnd.api+json',
      },
    });

    // Retry on network errors and 5xx; honour Retry-After on 429
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

    // Attach bearer token to every request
    this.http.interceptors.request.use((req) => {
      req.headers.Authorization = `Bearer ${this.accessToken}`;
      return req;
    });

    // Auto-refresh on 401 if a refresh token is available
    this.http.interceptors.response.use(
      (res) => res,
      async (err: AxiosError) => {
        if (err.response?.status === 401 && config.outreach.refreshToken) {
          try {
            await this.refreshToken();
            if (err.config) {
              err.config.headers = err.config.headers ?? {};
              err.config.headers.Authorization = `Bearer ${this.accessToken}`;
              return this.http.request(err.config);
            }
          } catch {
            // Refresh failed – surface original 401
          }
        }
        return Promise.reject(err);
      }
    );
  }

  private async refreshToken(): Promise<void> {
    const { data } = await axios.post<{ access_token: string }>(TOKEN_URL, {
      client_id: config.outreach.clientId,
      client_secret: config.outreach.clientSecret,
      redirect_uri: config.outreach.redirectUri,
      refresh_token: config.outreach.refreshToken,
      grant_type: 'refresh_token',
    });
    this.accessToken = data.access_token;
    console.log('[outreach] Access token refreshed.');
  }

  get instance(): AxiosInstance {
    return this.http;
  }
}
