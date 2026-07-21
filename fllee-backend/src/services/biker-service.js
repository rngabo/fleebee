const { randomUUID } = require("node:crypto");

const { env } = require("../config/env");
const { DEFAULT_BIKERS } = require("../data/defaults");
const { prisma } = require("../lib/prisma");
const {
  buildFirstName,
  normalizeBoolean,
  normalizeOptionalText,
  normalizeRequiredText
} = require("./workflow-support");

const ALLOWED_BIKER_STATUSES = new Set(["Active", "Inactive"]);

function normalizeStatus(value, fallback = "Active") {
  const normalized = normalizeRequiredText(value).toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (normalized === "active") {
    return "Active";
  }

  if (normalized === "inactive") {
    return "Inactive";
  }

  return null;
}

async function seedDefaultBikers() {
  if (!env.SEED_DEFAULT_BIKERS) {
    return;
  }

  const bikerCount = await prisma.biker.count();
  if (bikerCount === 0) {
    await prisma.biker.createMany({
      data: DEFAULT_BIKERS.map((item) => ({
        ...item,
        firstName: item.firstName || buildFirstName(item.name),
        notificationsEnabled: item.notificationsEnabled ?? true,
        isTeamLeader: item.isTeamLeader ?? false,
        notes: item.notes || ""
      }))
    });
  }
}

function serializeBiker(item) {
  const latestBike = item.bikes?.[0] || null;
  return {
    id: item.id,
    name: item.name,
    firstName: item.firstName || buildFirstName(item.name),
    phoneNumber: item.phoneNumber,
    bikePlate: item.bikePlate || latestBike?.plateNumber || "",
    bikeModel: item.bikeModel || latestBike?.bikeModel || "",
    status: item.status,
    reminderDue: Boolean(item.reminderDue),
    urgentAlert: Boolean(item.urgentAlert),
    notificationsEnabled: Boolean(item.notificationsEnabled),
    isTeamLeader: Boolean(item.isTeamLeader),
    notes: item.notes || "",
    batchId: item.batchId || latestBike?.batchId || "",
    batchName: item.batch?.name || latestBike?.batch?.name || "",
    activeBikeCount: Array.isArray(item.bikes)
      ? item.bikes.filter((bike) => String(bike.lifecycleStage || "").trim().toUpperCase() !== "DELIVERED").length
      : 0,
    latestBikeId: latestBike?.id || "",
    latestBikeStage: latestBike?.lifecycleStage || "",
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString()
  };
}

async function listBikers() {
  const items = await prisma.biker.findMany({
    include: {
      batch: true,
      bikes: {
        include: {
          batch: true
        },
        orderBy: {
          createdAt: "desc"
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return items.map(serializeBiker);
}

async function validateBatchId(batchId) {
  if (!batchId) {
    return null;
  }

  return prisma.batch.findUnique({
    where: {
      id: batchId
    }
  });
}

async function buildBikerFields(payload, existing = {}) {
  const status = normalizeStatus(payload.status, existing.status || "Active");
  if (!status || !ALLOWED_BIKER_STATUSES.has(status)) {
    return { error: "Status must be Active or Inactive." };
  }

  const name = normalizeRequiredText(payload.name ?? existing.name ?? "");
  const phoneNumber = normalizeRequiredText(payload.phoneNumber ?? existing.phoneNumber ?? "");
  if (!name || !phoneNumber) {
    return { error: "Name and phone number are required." };
  }

  const batchId = normalizeOptionalText(payload.batchId ?? existing.batchId ?? "");
  if (batchId) {
    const batch = await validateBatchId(batchId);
    if (!batch) {
      return { error: "Selected batch was not found." };
    }
  }

  const firstName = normalizeRequiredText(payload.firstName ?? existing.firstName ?? "")
    || buildFirstName(name);

  return {
    data: {
      name,
      firstName,
      phoneNumber,
      bikePlate: normalizeRequiredText(payload.bikePlate ?? existing.bikePlate ?? ""),
      bikeModel: normalizeRequiredText(payload.bikeModel ?? existing.bikeModel ?? ""),
      status,
      reminderDue: normalizeBoolean(payload.reminderDue, existing.reminderDue ?? false),
      urgentAlert: normalizeBoolean(payload.urgentAlert, existing.urgentAlert ?? false),
      notificationsEnabled: normalizeBoolean(
        payload.notificationsEnabled,
        existing.notificationsEnabled ?? true
      ),
      isTeamLeader: normalizeBoolean(payload.isTeamLeader, existing.isTeamLeader ?? false),
      notes: normalizeRequiredText(payload.notes ?? existing.notes ?? ""),
      batchId
    }
  };
}

async function createBiker(payload) {
  const record = await buildBikerFields(payload);
  if (record.error) {
    return record;
  }

  const item = await prisma.biker.create({
    data: {
      id: randomUUID(),
      ...record.data
    },
    include: {
      batch: true,
      bikes: {
        include: {
          batch: true
        },
        orderBy: {
          createdAt: "desc"
        }
      }
    }
  });

  return {
    item: serializeBiker(item)
  };
}

async function updateBiker(id, payload) {
  const bikerId = normalizeRequiredText(id);
  if (!bikerId) {
    return {
      statusCode: 400,
      body: {
        error: "Biker id is required."
      }
    };
  }

  const existing = await prisma.biker.findUnique({
    where: {
      id: bikerId
    }
  });

  if (!existing) {
    return {
      statusCode: 404,
      body: {
        error: "Biker not found."
      }
    };
  }

  const record = await buildBikerFields(payload, existing);
  if (record.error) {
    return {
      statusCode: 400,
      body: record
    };
  }

  const item = await prisma.biker.update({
    where: {
      id: bikerId
    },
    data: record.data,
    include: {
      batch: true,
      bikes: {
        include: {
          batch: true
        },
        orderBy: {
          createdAt: "desc"
        }
      }
    }
  });

  return {
    statusCode: 200,
    body: {
      item: serializeBiker(item)
    }
  };
}

async function deleteBiker(id) {
  const bikerId = normalizeRequiredText(id);
  if (!bikerId) {
    return {
      statusCode: 400,
      body: {
        error: "Biker id is required."
      }
    };
  }

  const existing = await prisma.biker.findUnique({
    where: {
      id: bikerId
    }
  });

  if (!existing) {
    return {
      statusCode: 404,
      body: {
        error: "Biker not found."
      }
    };
  }

  const [messageCount, scheduleCount, bikeCount, fineCount] = await Promise.all([
    prisma.message.count({
      where: {
        bikerId
      }
    }),
    prisma.scheduledMessage.count({
      where: {
        bikerId
      }
    }),
    prisma.bike.count({
      where: {
        bikerId
      }
    }),
    prisma.fine.count({
      where: {
        bikerId
      }
    })
  ]);

  if (messageCount > 0) {
    return {
      statusCode: 409,
      body: {
        error: "This biker has message history and cannot be deleted yet. Mark it inactive instead."
      }
    };
  }

  if (scheduleCount > 0) {
    return {
      statusCode: 409,
      body: {
        error: "This biker has scheduled messages and cannot be deleted yet. Remove or reassign those schedules first."
      }
    };
  }

  if (bikeCount > 0) {
    return {
      statusCode: 409,
      body: {
        error: "This biker still has bike records. Reassign or delete those bikes first."
      }
    };
  }

  if (fineCount > 0) {
    return {
      statusCode: 409,
      body: {
        error: "This biker still has fine records. Remove or archive those first."
      }
    };
  }

  await prisma.biker.delete({
    where: {
      id: bikerId
    }
  });

  return {
    statusCode: 200,
    body: {
      ok: true,
      deletedId: bikerId
    }
  };
}

module.exports = {
  createBiker,
  deleteBiker,
  listBikers,
  seedDefaultBikers,
  serializeBiker,
  updateBiker
};
