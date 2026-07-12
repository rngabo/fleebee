const { randomUUID } = require("node:crypto");

const { prisma } = require("../lib/prisma");
const { queueMessageForDispatch } = require("./message-service");

const ALLOWED_CATEGORIES = new Set(["REMINDER", "GENERAL", "EMERGENCY"]);
const ALLOWED_RECURRENCES = new Set(["ONCE", "DAILY", "WEEKLY", "MONTHLY"]);
const ALLOWED_STATUSES = new Set(["active", "paused", "completed"]);

function normalizeRecurrence(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return ALLOWED_RECURRENCES.has(normalized) ? normalized : null;
}

function normalizeScheduleStatus(value, fallback = "active") {
  const normalized = String(value || "").trim().toLowerCase();
  return ALLOWED_STATUSES.has(normalized) ? normalized : fallback;
}

function normalizeMessageBody(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function parseSendAt(value) {
  const date = new Date(String(value || "").trim());
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  date.setSeconds(0, 0);
  return date;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatTimeOfDay(date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function parseTimeOfDay(value) {
  const [hourPart, minutePart] = String(value || "").split(":");
  return {
    hour: Number(hourPart || 0),
    minute: Number(minutePart || 0)
  };
}

function buildDate(year, monthIndex, day, hour, minute) {
  return new Date(year, monthIndex, day, hour, minute, 0, 0);
}

function buildMonthlyDate(year, monthIndex, dayOfMonth, hour, minute) {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return buildDate(year, monthIndex, Math.min(dayOfMonth, lastDay), hour, minute);
}

function deriveScheduleParts(sendAt) {
  return {
    timeOfDay: formatTimeOfDay(sendAt),
    dayOfWeek: sendAt.getDay(),
    dayOfMonth: sendAt.getDate()
  };
}

function buildNextOccurrence(baseDate, recurrence, scheduleParts) {
  const { hour, minute } = parseTimeOfDay(scheduleParts.timeOfDay);

  if (recurrence === "DAILY") {
    return buildDate(
      baseDate.getFullYear(),
      baseDate.getMonth(),
      baseDate.getDate() + 1,
      hour,
      minute
    );
  }

  if (recurrence === "WEEKLY") {
    return buildDate(
      baseDate.getFullYear(),
      baseDate.getMonth(),
      baseDate.getDate() + 7,
      hour,
      minute
    );
  }

  if (recurrence === "MONTHLY") {
    const targetMonthIndex = baseDate.getMonth() + 1;
    const year = baseDate.getFullYear() + Math.floor(targetMonthIndex / 12);
    const monthIndex = targetMonthIndex % 12;
    return buildMonthlyDate(year, monthIndex, scheduleParts.dayOfMonth, hour, minute);
  }

  return null;
}

function computeInitialNextRun(sendAt, recurrence, scheduleParts, now = new Date()) {
  if (recurrence === "ONCE") {
    return sendAt > now ? sendAt : null;
  }

  let candidate = new Date(sendAt);
  while (candidate <= now) {
    candidate = buildNextOccurrence(candidate, recurrence, scheduleParts);
    if (!candidate) {
      return null;
    }
  }

  return candidate;
}

function computeNextScheduledRun(schedule, now = new Date()) {
  if (schedule.recurrence === "ONCE") {
    return null;
  }

  let candidate = buildNextOccurrence(schedule.nextRunAt || schedule.sendAt, schedule.recurrence, {
    timeOfDay: schedule.timeOfDay,
    dayOfWeek: schedule.dayOfWeek,
    dayOfMonth: schedule.dayOfMonth
  });

  while (candidate && candidate <= now) {
    candidate = buildNextOccurrence(candidate, schedule.recurrence, {
      timeOfDay: schedule.timeOfDay,
      dayOfWeek: schedule.dayOfWeek,
      dayOfMonth: schedule.dayOfMonth
    });
  }

  return candidate;
}

function serializeScheduledMessage(schedule) {
  return {
    id: schedule.id,
    bikerId: schedule.bikerId,
    bikerName: schedule.bikerName,
    category: schedule.category,
    body: schedule.body,
    recurrence: schedule.recurrence,
    status: schedule.status,
    sendAt: schedule.sendAt.toISOString(),
    nextRunAt: schedule.nextRunAt ? schedule.nextRunAt.toISOString() : null,
    timeOfDay: schedule.timeOfDay,
    dayOfWeek: schedule.dayOfWeek,
    dayOfMonth: schedule.dayOfMonth,
    lastRunAt: schedule.lastRunAt ? schedule.lastRunAt.toISOString() : null,
    lastQueuedMessageId: schedule.lastQueuedMessageId || "",
    lastDispatchStatus: schedule.lastDispatchStatus || "",
    lastDispatchNote: schedule.lastDispatchNote || "",
    completedAt: schedule.completedAt ? schedule.completedAt.toISOString() : null,
    createdAt: schedule.createdAt.toISOString(),
    updatedAt: schedule.updatedAt.toISOString()
  };
}

function sortSchedules(items) {
  const statusRank = {
    active: 0,
    paused: 1,
    completed: 2
  };

  return [...items].sort((left, right) => {
    const statusDelta = statusRank[left.status] - statusRank[right.status];
    if (statusDelta !== 0) {
      return statusDelta;
    }

    const leftNext = left.nextRunAt ? left.nextRunAt.getTime() : Number.MAX_SAFE_INTEGER;
    const rightNext = right.nextRunAt ? right.nextRunAt.getTime() : Number.MAX_SAFE_INTEGER;
    if (leftNext !== rightNext) {
      return leftNext - rightNext;
    }

    return right.createdAt.getTime() - left.createdAt.getTime();
  });
}

async function listScheduledMessages() {
  const items = await prisma.scheduledMessage.findMany();
  return sortSchedules(items).map(serializeScheduledMessage);
}

async function buildScheduleWriteData(payload, existing = null) {
  const bikerId = String(payload.bikerId ?? existing?.bikerId ?? "").trim();
  if (!bikerId) {
    return {
      error: "Select a biker for the schedule."
    };
  }

  const biker = await prisma.biker.findUnique({
    where: {
      id: bikerId
    }
  });

  if (!biker) {
    return {
      error: "Selected biker was not found."
    };
  }

  const recurrence = normalizeRecurrence(payload.recurrence ?? existing?.recurrence);
  if (!recurrence) {
    return {
      error: "Recurrence must be one of: once, daily, weekly, monthly."
    };
  }

  const sendAt = parseSendAt(payload.sendAt ?? existing?.sendAt);
  if (!sendAt) {
    return {
      error: "Choose a valid date and time for the schedule."
    };
  }

  const body = String(payload.body ?? existing?.body ?? "").trim();
  if (!body) {
    return {
      error: "Message body is required."
    };
  }

  const category = String(payload.category ?? existing?.category ?? "REMINDER").trim().toUpperCase();
  if (!ALLOWED_CATEGORIES.has(category)) {
    return {
      error: "Message category must be Reminder, General, or Emergency."
    };
  }

  const scheduleParts = deriveScheduleParts(sendAt);
  const nextRunAt = computeInitialNextRun(sendAt, recurrence, scheduleParts);
  if (recurrence === "ONCE" && !nextRunAt) {
    return {
      error: "One-time schedules must be set to a future date and time."
    };
  }

  const requestedStatus = normalizeScheduleStatus(
    payload.status,
    existing?.status === "completed" ? "active" : existing?.status || "active"
  );

  return {
    data: {
      bikerId: biker.id,
      bikerName: biker.name,
      category,
      body,
      normalizedBody: normalizeMessageBody(body),
      recurrence,
      status: requestedStatus === "completed" ? "active" : requestedStatus,
      sendAt,
      nextRunAt,
      timeOfDay: scheduleParts.timeOfDay,
      dayOfWeek: scheduleParts.dayOfWeek,
      dayOfMonth: scheduleParts.dayOfMonth,
      completedAt: requestedStatus === "paused" ? existing?.completedAt ?? null : null
    }
  };
}

async function createScheduledMessage(payload) {
  const record = await buildScheduleWriteData(payload);
  if (record.error) {
    return {
      statusCode: 400,
      body: record
    };
  }

  const item = await prisma.scheduledMessage.create({
    data: {
      id: randomUUID(),
      ...record.data
    }
  });

  return {
    statusCode: 201,
    body: {
      item: serializeScheduledMessage(item)
    }
  };
}

async function updateScheduledMessage(id, payload) {
  const scheduleId = String(id || "").trim();
  if (!scheduleId) {
    return {
      statusCode: 400,
      body: {
        error: "Schedule id is required."
      }
    };
  }

  const existing = await prisma.scheduledMessage.findUnique({
    where: {
      id: scheduleId
    }
  });

  if (!existing) {
    return {
      statusCode: 404,
      body: {
        error: "Schedule not found."
      }
    };
  }

  const record = await buildScheduleWriteData(payload, existing);
  if (record.error) {
    return {
      statusCode: 400,
      body: record
    };
  }

  const nextStatus = normalizeScheduleStatus(payload.status, record.data.status);
  const item = await prisma.scheduledMessage.update({
    where: {
      id: scheduleId
    },
    data: {
      ...record.data,
      status: nextStatus === "completed" ? "active" : nextStatus,
      completedAt: nextStatus === "paused" ? existing.completedAt : null
    }
  });

  return {
    statusCode: 200,
    body: {
      item: serializeScheduledMessage(item)
    }
  };
}

async function deleteScheduledMessage(id) {
  const scheduleId = String(id || "").trim();
  if (!scheduleId) {
    return {
      statusCode: 400,
      body: {
        error: "Schedule id is required."
      }
    };
  }

  const existing = await prisma.scheduledMessage.findUnique({
    where: {
      id: scheduleId
    }
  });

  if (!existing) {
    return {
      statusCode: 404,
      body: {
        error: "Schedule not found."
      }
    };
  }

  await prisma.scheduledMessage.delete({
    where: {
      id: scheduleId
    }
  });

  return {
    statusCode: 200,
    body: {
      ok: true,
      deletedId: scheduleId
    }
  };
}

async function processDueScheduledMessages(limit = 12) {
  const dueItems = await prisma.scheduledMessage.findMany({
    where: {
      status: "active",
      nextRunAt: {
        lte: new Date()
      }
    },
    orderBy: {
      nextRunAt: "asc"
    },
    take: limit
  });

  for (const schedule of dueItems) {
    const runAt = new Date();

    try {
      const response = await queueMessageForDispatch({
        bikerId: schedule.bikerId,
        category: schedule.category,
        body: schedule.body,
        source: "scheduled",
        scheduledMessageId: schedule.id
      });

      if (response.statusCode !== 201 && response.statusCode !== 409) {
        await prisma.scheduledMessage.update({
          where: {
            id: schedule.id
          },
          data: {
            status: "paused",
            lastRunAt: runAt,
            lastDispatchStatus: "error",
            lastDispatchNote: response.body?.error || "Could not queue the scheduled message."
          }
        });
        continue;
      }

      const nextRunAt = computeNextScheduledRun(schedule);
      await prisma.scheduledMessage.update({
        where: {
          id: schedule.id
        },
        data: {
          status: schedule.recurrence === "ONCE" ? "completed" : "active",
          nextRunAt,
          lastRunAt: runAt,
          lastQueuedMessageId: response.body?.item?.id || response.body?.existing?.id || null,
          lastDispatchStatus: response.statusCode === 201
            ? response.body?.item?.status || "pending"
            : "duplicate-blocked",
          lastDispatchNote: response.body?.note || response.body?.error || "Scheduled message processed.",
          completedAt: schedule.recurrence === "ONCE" ? runAt : null
        }
      });
    } catch (error) {
      await prisma.scheduledMessage.update({
        where: {
          id: schedule.id
        },
        data: {
          status: "paused",
          lastRunAt: runAt,
          lastDispatchStatus: "error",
          lastDispatchNote: error instanceof Error ? error.message : String(error)
        }
      });
    }
  }

  return dueItems.length;
}

module.exports = {
  createScheduledMessage,
  deleteScheduledMessage,
  listScheduledMessages,
  processDueScheduledMessages,
  serializeScheduledMessage,
  updateScheduledMessage
};
