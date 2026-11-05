// Pure checks: is this message really a BK statement email, and is this attachment really a safe PDF?

const header = (message, name) => (message.payload?.headers || []).filter((item) => item.name.toLowerCase() === name.toLowerCase()).map((item) => item.value);

function senderAddress(fromValue) {
  const text = String(fromValue || "");
  const angled = /<([^<>\s]+)>/.exec(text);
  return (angled ? angled[1] : text).trim().toLowerCase();
}

const domainOf = (address) => address.slice(address.lastIndexOf("@") + 1);

// Gmail's own verdict (Authentication-Results added by mx.google.com): DKIM or SPF must pass for the sender's domain.
function senderAuthenticated(message, senderDomain) {
  const results = header(message, "Authentication-Results").filter((value) => /^\s*mx\.google\.com/i.test(value));
  const inDomain = (value) => {
    const domain = String(value || "").toLowerCase().replace(/^.*@/, "");
    return domain === senderDomain || domain.endsWith(`.${senderDomain}`);
  };
  return results.some((value) => {
    const dkim = /dkim=pass[^;]*?header\.d=([^\s;]+)/i.exec(value);
    const spf = /spf=pass[^;]*?smtp\.mailfrom=([^\s;]+)/i.exec(value);
    return Boolean((dkim && inDomain(dkim[1])) || (spf && inDomain(spf[1])));
  });
}

// Returns null when the message qualifies, otherwise a short reason code.
function checkMessage(message, { sender, subjectPrefix, requireSenderAuth, sinceMs }) {
  if (Number(message.internalDate) < sinceMs) return "older-than-start";
  const from = header(message, "From");
  if (from.length !== 1 || senderAddress(from[0]) !== sender) return "wrong-sender";
  const subject = header(message, "Subject")[0] || "";
  if (!subject.trim().toUpperCase().startsWith(subjectPrefix.toUpperCase())) return "wrong-subject";
  if (requireSenderAuth && !senderAuthenticated(message, domainOf(sender))) return "sender-not-authenticated";
  return null;
}

function* walkParts(part) {
  if (!part) return;
  yield part;
  for (const child of part.parts || []) yield* walkParts(child);
}

function pdfCandidates(message) {
  return [...walkParts(message.payload)].filter((part) => part.filename && part.body?.attachmentId
    && (/\.pdf$/i.test(part.filename) || /pdf/i.test(part.mimeType || "")));
}

// Active content has no place in a bank statement.
const ACTIVE_CONTENT = /\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia)\b/;

function checkPdf(buffer, { maxBytes }) {
  if (buffer.length < 200) return "too-small";
  if (buffer.length > maxBytes) return "too-large";
  if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") return "not-a-pdf";
  if (!buffer.subarray(Math.max(0, buffer.length - 2048)).toString("latin1").includes("%%EOF")) return "truncated-pdf";
  if (ACTIVE_CONTENT.test(buffer.toString("latin1"))) return "active-content";
  return null;
}

// For display only (the file on disk never uses it).
function displayFilename(name) {
  return String(name || "").split(/[\\/]/).pop().replace(/[^\p{L}\p{N}._ ()-]/gu, "_").slice(0, 120);
}

const subjectOf = (message) => (header(message, "Subject")[0] || "").replace(/\s+/g, " ").trim().slice(0, 200);

module.exports = { displayFilename, subjectOf, checkMessage, checkPdf, pdfCandidates, senderAddress, senderAuthenticated };
