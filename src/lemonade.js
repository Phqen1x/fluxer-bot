// Thin client for Lemonade's OpenAI-compatible API.

export class Lemonade {
  constructor({ lemonadeUrl, lemonadeModel, lemonadeKey }) {
    this.url = lemonadeUrl;
    this.model = lemonadeModel;
    this.key = lemonadeKey;
  }

  async chat(messages, { temperature = 0.3, maxTokens = 2048, json = false } = {}) {
    const body = { model: this.model, messages, temperature, max_tokens: maxTokens, stream: false };
    if (json) body.response_format = { type: 'json_object' };
    let res;
    try {
      res = await fetch(`${this.url}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.key ? { Authorization: `Bearer ${this.key}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (e) {
      throw new Error(`Cannot reach Lemonade at ${this.url} (${e.message}). Is lemonade-server running?`);
    }
    if (!res.ok) throw new Error(`Lemonade ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Lemonade returned no content');
    // Strip reasoning blocks some models emit.
    return content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  }
}
