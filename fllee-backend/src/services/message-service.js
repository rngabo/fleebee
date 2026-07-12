const { randomUUID } = require("node:crypto");

const { env } = require("../config/env");
const { prisma } = require("../lib/prisma");
const { getPhoneState, routeLabel } = require("./phone-service");
const { hasValidStoredDispatchPassword } = require("./setting-service");

const EDITABLE_MESSAGE_STATUSES = new Set(["pending"]);
const DUPLICATE_MESSAGE_STATUSES = ["pending", "queued", "dispatched", "submitted", "sent"];

function normalizeCategory(value) {
  const allowed = new Set(["REMINDER", "GENERAL", "EMERGENCY"]);
  const normalized = String(value || "REMINDER").toUpperCase();
  return allowed.has(normalized) ? normalized : "REMINDER";
}

function normalizeMessageBody(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizePhoneNumber(value) {
  return String(value || "").replace(/\D+/g, "");
}

function isDispatchPasswordValid(value) {
  return String(value || "").trim() === env.SMS_SEND_PASSWORD;
}

function normalizeMessageSource(value) {
  return String(value || "").trim().toLowerCase() === "scheduled" ? "scheduled" : "manual";
}

function buildPendingReleaseAt(from = new Date()) {
  return new Date(from.getTime() + env.MESSAGE_PENDING_WINDOW_MS);
}

function buildPendingHoldNote(source) {
  const label = source === "scheduled" ? "Scheduled message" : "Message";
  return `${label} saved in the pending queue and waiting for release to the Android phone.`;
}

function defaultResultNote(status) {
  if (status === "submitted") {
    return "Submitted to the mobile carrier. Waiting for delivery confirmation.";
  }

  if (status === "sent") {
    return "Delivered to the recipient handset.";
  }

  return "";
}

async function releaseDuePendingMessages(tx = prisma, now = new Date()) {
  await tx.message.updateMany({
    where: {
      status: "pending",
      availableAt: {
        lte: now
      }
    },
    data: {
      status: "queued"
    }
  });
}

async function syncScheduledMessageDispatchResult(tx, message, status, note, occurredAt) {
  if (!message.scheduledMessageId) {
    return;
  }

  await tx.scheduledMessage.updateMany({
    where: {
      id: message.scheduledMessageId,
      lastQueuedMessageId: message.id
    },
    data: {
      lastRunAt: occurredAt,
      lastDispatchStatus: status,
      lastDispatchNote: note
    }
  });
}

function serializeMessage(message) {
  return {
    id: message.id,
    bikerId: message.bikerId,
    bikerName: message.bikerName,
    source: message.source,
    scheduledMessageId: message.scheduledMessageId || "",
    category: message.category,
    body: message.body,
    status: message.status,
    availableAt: message.availableAt ? message.availableAt.toISOString() : null,
    createdAt: message.createdAt.toISOString(),
    claimedAt: message.claimedAt ? message.claimedAt.toISOString() : null,
    claimedBy: message.claimedBy || "",
    resultAt: message.resultAt ? message.resultAt.toISOString() : null,
    resultNote: message.resultNote || "",
    failureReason: message.failureReason || "",
    route: message.route,
    targetNumber: message.targetNumber
  };
}

function isPrismaNotFound(error) {
  return Boolean(error && typeof error === "object" && error.code === "P2025");
}

async function listMessages() {
  await releaseDuePendingMessages();

  const items = await prisma.message.findMany({
    orderBy: {
      createdAt: "desc"
    }
  });

  return items.map(serializeMessage);
}

async function findRecentDuplicate(bikerId, normalizedBody, targetNumberNormalized, excludeMessageId = null) {
  const duplicateCutoff = new Date(Date.now() - env.DUPLICATE_WINDOW_MS);

  return prisma.message.findFirst({
    where: {
      bikerId,
      normalizedBody,
      targetNumberNormalized,
      status: {
        in: DUPLICATE_MESSAGE_STATUSES
      },
      createdAt: {
        gte: duplicateCutoff
      },
      ...(excludeMessageId
        ? {
            id: {
              not: excludeMessageId
            }
          }
        : {})
    },
    orderBy: {
      createdAt: "desc"
    }
  });
}

async function buildMessageWriteData(payload, { excludeMessageId = null } = {}) {
  const bikerId = String(payload.bikerId || "").trim();
  const biker = await prisma.biker.findUnique({
    where: {
      id: bikerId
    }
  });

  if (!biker) {
    return {
      statusCode: 400,
      body: {
        error: "Selected biker was not found."
      }
    };
  }

  const body = String(payload.body || "").trim();
  if (!body) {
    return {
      statusCode: 400,
      body: {
        error: "Message body is required."
      }
    };
  }

  const phone = await getPhoneState();
  const normalizedBody = normalizeMessageBody(body);
  const targetNumberNormalized = normalizePhoneNumber(phone.targetNumber);
  const duplicate = await findRecentDuplicate(
    biker.id,
    normalizedBody,
    targetNumberNormalized,
    excludeMessageId
  );

  if (duplicate) {
    return {
      statusCode: 409,
      body: {
        error: `Duplicate blocked: the same message for ${biker.name} was already ${duplicate.status}.`,
        note: "The backend ignored this request to avoid flooding the same recipient.",
        existing: serializeMessage(duplicate)
      }
    };
  }

  return {
    statusCode: 200,
    body: {
      biker,
      body,
      category: normalizeCategory(payload.category),
      normalizedBody,
      phone,
      targetNumberNormalized
    }
  };
}

async function queueMessageForDispatch(payload, { requirePassword = false } = {}) {
  if (requirePassword) {
    const provided = String(payload.password || "").trim();
    const authorized = provided
      ? isDispatchPasswordValid(provided)
      : await hasValidStoredDispatchPassword();

    if (!authorized) {
      return {
        statusCode: 401,
        body: {
          error: provided
            ? "Dispatch password is incorrect."
            : "No dispatch password. Enter it, or save it once on the SMS page."
        }
      };
    }
  }

  const record = await buildMessageWriteData(payload);
  if (record.statusCode !== 200) {
    return record;
  }

  const { biker, body, category, normalizedBody, phone, targetNumberNormalized } = record.body;
  const availableAt = buildPendingReleaseAt();

  const message = await prisma.message.create({
    data: {
      id: randomUUID(),
      bikerId: biker.id,
      bikerName: biker.name,
      source: normalizeMessageSource(payload.source),
      scheduledMessageId: payload.scheduledMessageId ? String(payload.scheduledMessageId).trim() : null,
      category,
      body,
      normalizedBody,
      status: "pending",
      availableAt,
      route: routeLabel(phone),
      targetNumber: phone.targetNumber,
      targetNumberNormalized
    }
  });

  return {
    statusCode: 201,
    body: {
      item: serializeMessage(message),
      note: buildPendingHoldNote(message.source)
    }
  };
}

async function createMessageRecord(payload) {
  return queueMessageForDispatch(payload, {
    requirePassword: true
  });
}

async function updatePendingMessage(id, payload) {
  const messageId = String(id || "").trim();
  if (!messageId) {
    return {
      statusCode: 400,
      body: {
        error: "Message id is required."
      }
    };
  }

  await releaseDuePendingMessages();

  const existing = await prisma.message.findUnique({
    where: {
      id: messageId
    }
  });

  if (!existing) {
    return {
      statusCode: 404,
      body: {
        error: "Message not found."
      }
    };
  }

  if (!EDITABLE_MESSAGE_STATUSES.has(existing.status)) {
    return {
      statusCode: 409,
      body: {
        error: "Only pending messages can be edited."
      }
    };
  }

  const record = await buildMessageWriteData(payload, {
    excludeMessageId: messageId
  });
  if (record.statusCode !== 200) {
    return record;
  }

  const { biker, body, category, normalizedBody, phone, targetNumberNormalized } = record.body;
  const availableAt = buildPendingReleaseAt();

  const message = await prisma.message.update({
    where: {
      id: messageId
    },
    data: {
      bikerId: biker.id,
      bikerName: biker.name,
      category,
      body,
      normalizedBody,
      status: "pending",
      availableAt,
      claimedAt: null,
      claimedBy: null,
      resultAt: null,
      resultNote: null,
      failureReason: null,
      route: routeLabel(phone),
      targetNumber: phone.targetNumber,
      targetNumberNormalized
    }
  });

  return {
    statusCode: 200,
    body: {
      item: serializeMessage(message),
      note: "Pending SMS updated and returned to the pending queue."
    }
  };
}

async function deletePendingMessage(id) {
  const messageId = String(id || "").trim();
  if (!messageId) {
    return {
      statusCode: 400,
      body: {
        error: "Message id is required."
      }
    };
  }

  await releaseDuePendingMessages();

  return prisma.$transaction(async (tx) => {
    const message = await tx.message.findUnique({
      where: {
        id: messageId
      }
    });

    if (!message) {
      return {
        statusCode: 404,
        body: {
          error: "Message not found."
        }
      };
    }

    if (!EDITABLE_MESSAGE_STATUSES.has(message.status)) {
      return {
        statusCode: 409,
        body: {
          error: "Only pending messages can be deleted."
        }
      };
    }

    await tx.message.delete({
      where: {
        id: messageId
      }
    });

    if (message.scheduledMessageId) {
      await tx.scheduledMessage.updateMany({
        where: {
          id: message.scheduledMessageId,
          lastQueuedMessageId: message.id
        },
        data: {
          lastQueuedMessageId: null,
          lastDispatchStatus: "cancelled",
          lastDispatchNote: "Pending scheduled message cancelled before dispatch."
        }
      });
    }

    return {
      statusCode: 200,
      body: {
        ok: true,
        deletedId: messageId,
        note: message.source === "scheduled"
          ? "Pending scheduled SMS removed before dispatch."
          : "Pending SMS removed before dispatch."
      }
    };
  });
}

async function claimNextMessage(deviceId) {
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - env.JOB_STALE_MS);

  return prisma.$transaction(async (tx) => {
    await releaseDuePendingMessages(tx, now);

    const message = await tx.message.findFirst({
      where: {
        OR: [
          {
            status: "queued"
          },
          {
            status: "dispatched",
            claimedAt: {
              lt: staleCutoff
            }
          }
        ]
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    if (!message) {
      return null;
    }

    return tx.message.update({
      where: {
        id: message.id
      },
      data: {
        status: "dispatched",
        claimedAt: new Date(),
        claimedBy: deviceId,
        resultAt: null,
        failureReason: "",
        resultNote: ""
      }
    });
  });
}

async function updateMessageResult(messageId, status, note) {
  try {
    return await prisma.$transaction(async (tx) => {
      const occurredAt = new Date();
      const normalizedNote = note ? String(note) : defaultResultNote(status);
      const message = await tx.message.update({
        where: {
          id: messageId
        },
        data: {
          status,
          resultAt: occurredAt,
          resultNote: normalizedNote,
          failureReason: status === "failed" ? String(note || "Unknown failure") : ""
        }
      });

      await syncScheduledMessageDispatchResult(
        tx,
        message,
        status,
        normalizedNote || (status === "failed" ? message.failureReason || "Unknown failure" : ""),
        occurredAt
      );

      return message;
    });
  } catch (error) {
    if (isPrismaNotFound(error)) {
      return null;
    }

    throw error;
  }
}

function isAllowedGatewayResultStatus(value) {
  return value === "submitted" || value === "sent" || value === "failed";
}

function normalizeGatewayResultStatus(value) {
  return isAllowedGatewayResultStatus(value) ? value : "failed";
}

module.exports = {
  claimNextMessage,
  createMessageRecord,
  deletePendingMessage,
  isAllowedGatewayResultStatus,
  listMessages,
  normalizeGatewayResultStatus,
  queueMessageForDispatch,
  serializeMessage,
  updateMessageResult,
  updatePendingMessage
};
