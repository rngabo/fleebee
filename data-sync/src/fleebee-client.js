class FleebeeClient {
  constructor({ baseUrl, serviceToken, timeoutMs = 60000 }) {
    this.baseUrl = baseUrl;
    this.serviceToken = serviceToken;
    this.timeoutMs = timeoutMs;
  }

  async request(pathname, { method = "GET", body } = {}) {
    const response = await fetch(`${this.baseUrl}${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.serviceToken}`,
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Fleebee returned HTTP ${response.status}.`);
    }
    return payload;
  }

  startRun(spreadsheetId, trigger) {
    return this.request("/api/internal/data-sync/v1/runs", {
      method: "POST",
      body: { spreadsheetId, trigger }
    });
  }

  applyData(runId, data) {
    return this.request(`/api/internal/data-sync/v1/runs/${encodeURIComponent(runId)}/data`, {
      method: "PUT",
      body: data
    });
  }

  failRun(runId, errorMessage) {
    return this.request(`/api/internal/data-sync/v1/runs/${encodeURIComponent(runId)}/fail`, {
      method: "POST",
      body: { errorMessage }
    });
  }
}

module.exports = { FleebeeClient };
