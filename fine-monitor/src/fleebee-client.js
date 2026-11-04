class FleebeeClient {
  constructor({ baseUrl, serviceToken, timeoutMs = 30000 }) {
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
      throw new Error(payload.error || `Fleebee returned HTTP ${response.status}`);
    }

    return payload;
  }

  startRun(plateNumber, trigger = "manual") {
    return this.request("/api/internal/fine-monitor/v1/runs", {
      method: "POST",
      body: {
        trigger,
        ...(plateNumber ? { plateNumber } : {})
      }
    });
  }

  recordTarget(runId, bikeId, result) {
    return this.request(
      `/api/internal/fine-monitor/v1/runs/${encodeURIComponent(runId)}/targets/${encodeURIComponent(bikeId)}`,
      {
        method: "PUT",
        body: result
      }
    );
  }

  completeRun(runId, errorMessage = "") {
    return this.request(`/api/internal/fine-monitor/v1/runs/${encodeURIComponent(runId)}/complete`, {
      method: "POST",
      body: {
        errorMessage
      }
    });
  }
}

module.exports = {
  FleebeeClient
};
