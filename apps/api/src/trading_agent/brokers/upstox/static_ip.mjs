// Static IP READ API (Stage 22): GET /v2/user/ip. User-level (applies to every OAuth client of the
// user). Read-only on purpose: updating it (PUT) invalidates the user's tokens, is limited to once a
// calendar week, and belongs to the customer's own onboarding, not to this adapter.
export class UpstoxUserIpApi {
  #rest; #base;
  constructor({ rest, apiBase }) { this.#rest = rest; this.#base = apiBase; }
  async getStaticIps(token) {
    const r = await this.#rest.request('GET', `${this.#base}/v2/user/ip`, { token });
    const d = r?.data ?? {};
    return Object.freeze({
      primaryIp: d.primary_ip ?? null, secondaryIp: d.secondary_ip ?? null,
      primaryUpdatedAt: d.primary_ip_updated_at ?? null, secondaryUpdatedAt: d.secondary_ip_updated_at ?? null,
    });
  }
}
