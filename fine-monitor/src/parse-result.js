function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeDate(value) {
  const text = normalizeText(value);
  const match = text.match(/\b(\d{4})[-/](\d{2})[-/](\d{2})\b/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function normalizeAmount(value) {
  const display = normalizeText(value);
  const digits = display.replace(/[^0-9]/g, "");
  const amountRwf = digits ? Number(digits) : Number.NaN;
  return {
    amountDisplay: display,
    amountRwf
  };
}

function parseFineRow(raw) {
  const amount = normalizeAmount(raw.amount);
  const row = {
    ticketNumber: normalizeText(raw.ticketNumber),
    issuedDate: normalizeDate(raw.issuedDate),
    dueDate: normalizeDate(raw.dueDate),
    reason: normalizeText(raw.reason),
    amountDisplay: amount.amountDisplay,
    amountRwf: amount.amountRwf
  };

  if (
    !row.ticketNumber
    || !row.issuedDate
    || !row.reason
    || !row.amountDisplay
    || !Number.isInteger(row.amountRwf)
  ) {
    throw new Error("Irembo returned a fine row with missing or invalid required fields.");
  }

  return row;
}

module.exports = {
  normalizeAmount,
  normalizeDate,
  normalizeText,
  parseFineRow
};

