const { getAccessToken } = require("./oauth");

class GmailError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

// Minimal read-only Gmail REST client (labels, message list/get, attachment download). Retries 429/5xx a few times.
function createGmailClient(config, { sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  async function call(path, params) {
    const url = `${config.apiBase}/gmail/v1/users/me/${path}${params ? `?${new URLSearchParams(params)}` : ""}`;
    for (let attempt = 0; ; attempt += 1) {
      const token = await getAccessToken(config);
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000) });
      if (response.ok) return response.json();
      if ((response.status === 429 || response.status >= 500) && attempt < 3) { await sleep(500 * 2 ** attempt); continue; }
      const detail = await response.text().catch(() => "");
      throw new GmailError(`Gmail ${path.split("/")[0]} request failed: HTTP ${response.status} ${detail.slice(0, 200)}`, response.status);
    }
  }

  return {
    profile: () => call("profile"),
    async findLabelId(name) {
      const { labels = [] } = await call("labels");
      return labels.find((label) => label.name === name)?.id || null;
    },
    async listMessageIds({ labelId, query, limit }) {
      const ids = [];
      let pageToken;
      do {
        const page = await call("messages", { labelIds: labelId, q: query, maxResults: String(Math.min(limit, 100)), ...(pageToken ? { pageToken } : {}) });
        for (const item of page.messages || []) ids.push(item.id);
        pageToken = page.nextPageToken;
      } while (pageToken && ids.length < limit);
      return ids.slice(0, limit);
    },
    getMessage: (id) => call(`messages/${encodeURIComponent(id)}`, { format: "full" }),
    async getAttachment(messageId, attachmentId) {
      const body = await call(`messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
      return Buffer.from(String(body.data || ""), "base64url");
    }
  };
}

module.exports = { createGmailClient, GmailError };
