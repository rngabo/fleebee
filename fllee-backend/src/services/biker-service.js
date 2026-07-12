const { randomUUID } = require("node:crypto");

const { DEFAULT_BIKERS } = require("../data/defaults");
const { prisma } = require("../lib/prisma");

const ALLOWED_BIKER_STATUSES = new Set(["Active", "Inactive"]);

async function seedDefaultBikers() {
  const bikerCount = await prisma.biker.count();
  if (bikerCount === 0) {
    await prisma.biker.createMany({
      data: DEFAULT_BIKERS
    });
  }
}

async function listBikers() {
  return prisma.biker.findMany({
    orderBy: {
      createdAt: "desc"
    }
  });
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no", "off", ""].includes(normalized)) {
      return false;
    }
  }

  return fallback;
}

function normalizeStatus(value, fallback = "Active") {
  const normalized = String(value || "").trim().toLowerCase();
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

function buildBikerFields(payload, existing = {}) {
  const status = normalizeStatus(payload.status, existing.status || "Active");
  if (!status || !ALLOWED_BIKER_STATUSES.has(status)) {
    return { error: "Status must be Active or Inactive." };
  }

  const record = {
    name: String(payload.name ?? existing.name ?? "").trim(),
    phoneNumber: String(payload.phoneNumber ?? existing.phoneNumber ?? "").trim(),
    bikePlate: String(payload.bikePlate ?? existing.bikePlate ?? "").trim(),
    bikeModel: String(payload.bikeModel ?? existing.bikeModel ?? "").trim(),
    status,
    reminderDue: normalizeBoolean(payload.reminderDue, existing.reminderDue ?? false),
    urgentAlert: normalizeBoolean(payload.urgentAlert, existing.urgentAlert ?? false)
  };

  if (!record.name || !record.phoneNumber) {
    return { error: "Name and phone number are required." };
  }

  return { data: record };
}

async function createBiker(payload) {
  const record = buildBikerFields(payload);
  if (record.error) {
    return record;
  }

  return {
    item: await prisma.biker.create({
      data: {
        id: randomUUID(),
        ...record.data
      }
    })
  };
}

async function updateBiker(id, payload) {
  const bikerId = String(id || "").trim();
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

  const record = buildBikerFields(payload, existing);
  if (record.error) {
    return {
      statusCode: 400,
      body: record
    };
  }

  return {
    statusCode: 200,
    body: {
      item: await prisma.biker.update({
        where: {
          id: bikerId
        },
        data: record.data
      })
    }
  };
}

async function deleteBiker(id) {
  const bikerId = String(id || "").trim();
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

  const messageCount = await prisma.message.count({
    where: {
      bikerId
    }
  });

  if (messageCount > 0) {
    return {
      statusCode: 409,
      body: {
        error: "This biker has message history and cannot be deleted yet. Mark it inactive instead."
      }
    };
  }

  const scheduleCount = await prisma.scheduledMessage.count({
    where: {
      bikerId
    }
  });

  if (scheduleCount > 0) {
    return {
      statusCode: 409,
      body: {
        error: "This biker has scheduled messages and cannot be deleted yet. Remove or reassign those schedules first."
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
  seedDefaultBikers,
  listBikers,
  createBiker,
  updateBiker,
  deleteBiker
};
