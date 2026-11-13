// Optional: publish a profile as a Fluxer theme (POST /v1/users/@me/themes).
// This route rejects bot tokens, so it needs the owner's own session token.
export class Themes {
  constructor(endpoints, userToken) {
    this.endpoints = endpoints;
    this.userToken = userToken;
  }
  async upload(css) {
    if (!this.userToken) {
      return 'Theme upload skipped: set FLUXER_USER_TOKEN (bots cannot create themes — the API returns 403).';
    }
    const res = await fetch(`${this.endpoints.api_public}/v1/users/@me/themes`, {
      method: 'POST',
      headers: { Authorization: this.userToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ css }),
    });
    if (!res.ok) return `Theme upload failed: ${res.status} ${(await res.text()).slice(0, 200)}`;
    const { id } = await res.json();
    return `Uploaded as Fluxer theme \`${id}\` → ${this.endpoints.media}/themes/${id}.css\n(Docs don't describe how to activate a theme ID; apply it from your client's settings.)`;
  }
}
