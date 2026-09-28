/* eslint-disable @typescript-eslint/no-explicit-any */
export class MetaApiClient {
  private readonly baseUrl = 'https://graph.facebook.com/v20.0';

  constructor(private readonly accessToken: string) {}

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
      payload.tag = 'HUMAN_AGENT';
    } else {
      payload.messaging_type = 'RESPONSE';
    }

    return this.fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  async createPagePost(pageId: string, message: string): Promise<any> {
    const url = `${this.baseUrl}/${pageId}/feed`;
    
    const payload = {
      message,
      access_token: this.accessToken
    };

    return this.fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  private async fetchWithRetry(url: string, options: RequestInit, retries = 3): Promise<any> {
    for (let i = 0; i < retries; i++) {
      const response = await fetch(url, options);
      const data = await response.json();

      if (response.ok) return data;

      if (response.status === 429 || (data.error && data.error.code === 4)) {
        const backoff = Math.pow(2, i) * 1000;
        console.warn(`Meta API rate limit hit. Retrying in ${backoff}ms...`);
        await new Promise(res => setTimeout(res, backoff));
        continue;
      }

      throw new Error(`Meta API Error: ${data.error?.message || response.statusText}`);
    }
    throw new Error('Meta API failed after max retries.');
  }
}
