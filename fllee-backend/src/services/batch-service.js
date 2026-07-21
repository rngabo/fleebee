const { randomUUID } = require("node:crypto");

const { prisma } = require("../lib/prisma");
const {
  normalizeDateTime,
  normalizeOptionalText,
  normalizeRequiredText
} = require("./workflow-support");

function serializeBatch(item) {
  return {
    id: item.id,
    name: item.name,
    code: item.code || "",
    notes: item.notes || "",
    expectedDeliveryDate: item.expectedDeliveryDate ? item.expectedDeliveryDate.toISOString() : null,
    leaseEndDate: item.leaseEndDate ? item.leaseEndDate.toISOString() : null,
    bikerCount: item._count?.bikers ?? item.bikers?.length ?? 0,
    bikeCount: item._count?.bikes ?? item.bikes?.length ?? 0,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString()
  };
}

async function listBatches() {
  const items = await prisma.batch.findMany({
    include: {
      _count: {
        select: {
          bikers: true,
          bikes: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return items.map(serializeBatch);
}

function buildBatchFields(payload, existing = {}) {
  const name = normalizeRequiredText(payload.name ?? existing.name ?? "");
  if (!name) {
    return { error: "Batch name is required." };
  }

  const expectedDeliveryDate = normalizeDateTime(
    payload.expectedDeliveryDate ?? existing.expectedDeliveryDate ?? null
  );
  if ((payload.expectedDeliveryDate ?? existing.expectedDeliveryDate) && !expectedDeliveryDate) {
    return { error: "Expected delivery date is invalid." };
  }

  const leaseEndDate = normalizeDateTime(payload.leaseEndDate ?? existing.leaseEndDate ?? null);
  if ((payload.leaseEndDate ?? existing.leaseEndDate) && !leaseEndDate) {
    return { error: "Lease end date is invalid." };
  }

  return {
    data: {
      name,
      code: normalizeRequiredText(payload.code ?? existing.code ?? ""),
      notes: normalizeRequiredText(payload.notes ?? existing.notes ?? ""),
      expectedDeliveryDate,
      leaseEndDate
    }
  };
}

async function createBatch(payload) {
  const record = buildBatchFields(payload);
  if (record.error) {
    return {
      statusCode: 400,
      body: record
    };
  }

  const duplicate = await prisma.batch.findFirst({
    where: {
      name: record.data.name
    }
  });
  if (duplicate) {
    return {
      statusCode: 409,
      body: {
        error: "A batch with that name already exists."
      }
    };
  }

  const item = await prisma.batch.create({
    data: {
      id: randomUUID(),
      ...record.data
    },
    include: {
      _count: {
        select: {
          bikers: true,
          bikes: true
        }
      }
    }
  });

  return {
    statusCode: 201,
    body: {
      item: serializeBatch(item)
    }
  };
}

async function updateBatch(id, payload) {
  const batchId = normalizeRequiredText(id);
  if (!batchId) {
    return {
      statusCode: 400,
      body: {
        error: "Batch id is required."
      }
    };
  }

  const existing = await prisma.batch.findUnique({
    where: {
      id: batchId
    }
  });

  if (!existing) {
    return {
      statusCode: 404,
      body: {
        error: "Batch not found."
      }
    };
  }

  const record = buildBatchFields(payload, existing);
  if (record.error) {
    return {
      statusCode: 400,
      body: record
    };
  }

  const duplicate = await prisma.batch.findFirst({
    where: {
      name: record.data.name,
      id: {
        not: batchId
      }
    }
  });
  if (duplicate) {
    return {
      statusCode: 409,
      body: {
        error: "Another batch already uses that name."
      }
    };
  }

  const item = await prisma.batch.update({
    where: {
      id: batchId
    },
    data: record.data,
    include: {
      _count: {
        select: {
          bikers: true,
          bikes: true
        }
      }
    }
  });

  return {
    statusCode: 200,
    body: {
      item: serializeBatch(item)
    }
  };
}

async function deleteBatch(id) {
  const batchId = normalizeRequiredText(id);
  if (!batchId) {
    return {
      statusCode: 400,
      body: {
        error: "Batch id is required."
      }
    };
  }

  const existing = await prisma.batch.findUnique({
    where: {
      id: batchId
    },
    include: {
      _count: {
        select: {
          bikers: true,
          bikes: true
        }
      }
    }
  });

  if (!existing) {
    return {
      statusCode: 404,
      body: {
        error: "Batch not found."
      }
    };
  }

  if ((existing._count?.bikers ?? 0) > 0 || (existing._count?.bikes ?? 0) > 0) {
    return {
      statusCode: 409,
      body: {
        error: "This batch is still linked to bikers or bikes. Reassign them before deleting the batch."
      }
    };
  }

  await prisma.batch.delete({
    where: {
      id: batchId
    }
  });

  return {
    statusCode: 200,
    body: {
      ok: true,
      deletedId: batchId
    }
  };
}

module.exports = {
  createBatch,
  deleteBatch,
  listBatches,
  serializeBatch,
  updateBatch
};
