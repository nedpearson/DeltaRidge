/**
 * Meta Graph API Client
 * 
 * Handles sending messages via Instagram Direct and Facebook Messenger.
 * Enforces production-ready constraints: exponential backoff, rate limit handling,
 * and 24-hour standard messaging window compliance.
 */

export class MetaApiClient {
  private readonly baseUrl = 'https://graph.facebook.com/v20.0';

  constructor(private readonly accessToken: string) {}

  /**
   * Sends a text message to a user via the Graph API.
   * Handles the 24-hour messaging window rule by default (MESSAGE_TAG).
   */
  async sendMessage(
    pageId: string, 
    recipientId: string, 
    text: string, 
    isOutsideWindow = false
  ): Promise<any> {
    const url = `${this.baseUrl}/${pageId}/messages?access_token=${this.accessToken}`;
    
    const payload: any = {
      recipient: { id: recipientId },
      message: { text }
    };

    if (isOutsideWindow) {
      payload.messaging_type = 'MESSAGE_TAG';
      payload.tag = 'HUMAN_AGENT'; // Only applicable if page is approved for it
    } else {
      payload.messaging_type = 'RESPONSE';
    }

    return this.fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  /**
   * Internal fetch wrapper with exponential backoff for rate limits.
   */
  private async fetchWithRetry(url: string, options: RequestInit, retries = 3): Promise<any> {
    for (let i = 0; i < retries; i++) {
      const response = await fetch(url, options);
      const data = await response.json();

      if (response.ok) return data;

      // Rate limit hit
      if (response.status === 429 || (data.error && data.error.code === 4)) {
        const backoff = Math.pow(2, i) * 1000;
        console.warn(`Meta API rate limit hit. Retrying in ${backoff}ms...`);
        await new Promise(res => setTimeout(res, backoff));
        continue;
      }

      // If it's another error (e.g. invalid token, user blocked page), throw immediately
      throw new Error(`Meta API Error: ${data.error?.message || response.statusText}`);
    }

    throw new Error('Meta API failed after max retries.');
  }
}
