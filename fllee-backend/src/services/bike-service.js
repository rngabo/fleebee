const { randomUUID } = require("node:crypto");

const { prisma } = require("../lib/prisma");
const { queueMessageForDispatch } = require("./message-service");
const { findSmsTemplate } = require("./template-service");
const {
  buildFirstName,
  formatDateLabel,
  normalizeBoolean,
  normalizeCategory,
  normalizeDateTime,
  normalizeOptionalText,
  normalizeRequiredText,
  normalizeStage,
  normalizeUrgency,
  renderTemplateBody,
  toMessageCategory
} = require("./workflow-support");

function serializeProgressUpdate(item) {
  return {
    id: item.id,
    bikeId: item.bikeId,
    stage: item.stage,
    category: item.category,
    urgency: item.urgency,
    note: item.note || "",
    notifyRecipient: Boolean(item.notifyRecipient),
    templateId: item.templateId || "",
    sentMessageId: item.sentMessageId || "",
    renderedMessageBody: item.renderedMessageBody || "",
    createdBy: item.createdBy || "",
    createdAt: item.createdAt.toISOString()
  };
}

function serializeFine(item) {
  return {
    id: item.id,
    bikeId: item.bikeId,
    bikerId: item.bikerId,
    bikerName: item.biker?.name || "",
    plateNumber: item.bike?.plateNumber || "",
    bikeModel: item.bike?.bikeModel || "",
    amount: item.amount,
    reason: item.reason,
    fineDate: item.fineDate.toISOString(),
    paymentDeadline: item.paymentDeadline ? item.paymentDeadline.toISOString() : null,
    sourceSummary: item.sourceSummary || "",
    notifyRecipient: Boolean(item.notifyRecipient),
    templateId: item.templateId || "",
    sentMessageId: item.sentMessageId || "",
    renderedMessageBody: item.renderedMessageBody || "",
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString()
  };
}

function serializeBike(item) {
  return {
    id: item.id,
    bikerId: item.bikerId,
    bikerName: item.biker?.name || "",
    firstName: item.biker?.firstName || buildFirstName(item.biker?.name || ""),
    batchId: item.batchId || "",
    batchName: item.batch?.name || "",
    plateNumber: item.plateNumber || "",
    chassisNumber: item.chassisNumber || "",
    bikeModel: item.bikeModel || "",
    lifecycleStage: item.lifecycleStage,
    insuranceStatus: item.insuranceStatus || "",
    authorizationStatus: item.authorizationStatus || "",
    pickupStatus: item.pickupStatus || "",
    officialStartDate: item.officialStartDate ? item.officialStartDate.toISOString() : null,
    nextPaymentDate: item.nextPaymentDate ? item.nextPaymentDate.toISOString() : null,
    notificationsEnabled: Boolean(item.notificationsEnabled),
    knownModelIssues: item.knownModelIssues || "",
    maintenanceNotes: item.maintenanceNotes || "",
    notes: item.notes || "",
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    progressUpdates: Array.isArray(item.progressUpdates)
      ? item.progressUpdates.map(serializeProgressUpdate)
      : [],
    fineCount: Array.isArray(item.fines) ? item.fines.length : item._count?.fines ?? 0,
    latestFine: Array.isArray(item.fines) && item.fines[0] ? serializeFine(item.fines[0]) : null
  };
}

async function ensureBikerExists(bikerId) {
  if (!bikerId) {
    return null;
  }

  return prisma.biker.findUnique({
    where: {
      id: bikerId
    }
  });
}

async function ensureBatchExists(batchId) {
  if (!batchId) {
    return null;
  }

  return prisma.batch.findUnique({
    where: {
      id: batchId
    }
  });
}

async function syncBikerLegacySummary(bikerId) {
  const latestBike = await prisma.bike.findFirst({
    where: {
      bikerId
    },
    orderBy: [
      {
        updatedAt: "desc"
      },
      {
        createdAt: "desc"
      }
    ]
  });

  await prisma.biker.update({
    where: {
      id: bikerId
    },
    data: {
      bikePlate: latestBike?.plateNumber || "",
      bikeModel: latestBike?.bikeModel || ""
    }
  });
}

async function listBikes() {
  const items = await prisma.bike.findMany({
    include: {
      biker: true,
      batch: true,
      progressUpdates: {
        orderBy: {
          createdAt: "desc"
        },
        take: 20
      },
      fines: {
        include: {
          bike: true,
          biker: true
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 1
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return items.map(serializeBike);
}

function buildBikeFields(payload, existing = {}) {
  const rawOfficialStartDate = payload.officialStartDate ?? existing.officialStartDate ?? null;
  if (
    payload.officialStartDate !== undefined
    && payload.officialStartDate !== ""
    && !normalizeDateTime(payload.officialStartDate)
  ) {
    return {
      error: "Official start date is invalid."
    };
  }

  const rawNextPaymentDate = payload.nextPaymentDate ?? existing.nextPaymentDate ?? null;
  if (
    payload.nextPaymentDate !== undefined
    && payload.nextPaymentDate !== ""
    && !normalizeDateTime(payload.nextPaymentDate)
  ) {
    return {
      error: "Next payment date is invalid."
    };
  }

  return {
    data: {
      bikerId: normalizeRequiredText(payload.bikerId ?? existing.bikerId ?? ""),
      batchId: normalizeOptionalText(payload.batchId ?? existing.batchId ?? ""),
      plateNumber: normalizeOptionalText(payload.plateNumber ?? existing.plateNumber ?? ""),
      chassisNumber: normalizeOptionalText(payload.chassisNumber ?? existing.chassisNumber ?? ""),
      bikeModel: normalizeOptionalText(payload.bikeModel ?? existing.bikeModel ?? ""),
      lifecycleStage: normalizeStage(payload.lifecycleStage, existing.lifecycleStage || "LEAD_CAPTURED"),
      insuranceStatus: normalizeRequiredText(payload.insuranceStatus ?? existing.insuranceStatus ?? ""),
      authorizationStatus: normalizeRequiredText(
        payload.authorizationStatus ?? existing.authorizationStatus ?? ""
      ),
      pickupStatus: normalizeRequiredText(payload.pickupStatus ?? existing.pickupStatus ?? ""),
      officialStartDate: payload.officialStartDate === ""
        ? null
        : normalizeDateTime(rawOfficialStartDate),
      nextPaymentDate: payload.nextPaymentDate === ""
        ? null
        : normalizeDateTime(rawNextPaymentDate),
      notificationsEnabled: normalizeBoolean(
        payload.notificationsEnabled,
        existing.notificationsEnabled ?? true
      ),
      knownModelIssues: normalizeRequiredText(payload.knownModelIssues ?? existing.knownModelIssues ?? ""),
      maintenanceNotes: normalizeRequiredText(payload.maintenanceNotes ?? existing.maintenanceNotes ?? ""),
      notes: normalizeRequiredText(payload.notes ?? existing.notes ?? "")
    }
  };
}

async function validateBikeFields(record, existing = null) {
  if (!record.bikerId) {
    return {
      statusCode: 400,
      body: {
        error: "Select the recipient for this bike."
      }
    };
  }

  const biker = await ensureBikerExists(record.bikerId);
  if (!biker) {
    return {
      statusCode: 400,
      body: {
        error: "Selected recipient was not found."
      }
    };
  }

  if (record.batchId) {
    const batch = await ensureBatchExists(record.batchId);
    if (!batch) {
      return {
        statusCode: 400,
        body: {
          error: "Selected batch was not found."
        }
      };
    }
  }

  if (!record.lifecycleStage) {
    return {
      statusCode: 400,
      body: {
        error: "Choose a valid lifecycle stage."
      }
    };
  }

  return {
    statusCode: 200,
    body: {
      biker,
      data: record
    }
  };
}

async function createBike(payload) {
  const record = buildBikeFields(payload);
  if (record.error) {
    return {
      statusCode: 400,
      body: {
        error: record.error
      }
    };
  }

  const validation = await validateBikeFields(record.data);
  if (validation.statusCode !== 200) {
    return validation;
  }

  const item = await prisma.bike.create({
    data: {
      id: randomUUID(),
      ...record.data
    },
    include: {
      biker: true,
      batch: true,
      progressUpdates: {
        orderBy: {
          createdAt: "desc"
        },
        take: 20
      },
      fines: {
        include: {
          bike: true,
          biker: true
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 1
      }
    }
  });

  await syncBikerLegacySummary(record.data.bikerId);

  return {
    statusCode: 201,
    body: {
      item: serializeBike(item)
    }
  };
}

async function updateBike(id, payload) {
  const bikeId = normalizeRequiredText(id);
  if (!bikeId) {
    return {
      statusCode: 400,
      body: {
        error: "Bike id is required."
      }
    };
  }

  const existing = await prisma.bike.findUnique({
    where: {
      id: bikeId
    }
  });
  if (!existing) {
    return {
      statusCode: 404,
      body: {
        error: "Bike not found."
      }
    };
  }

  const record = buildBikeFields(payload, existing);
  if (record.error) {
    return {
      statusCode: 400,
      body: {
        error: record.error
      }
    };
  }

  const validation = await validateBikeFields(record.data, existing);
  if (validation.statusCode !== 200) {
    return validation;
  }

  const item = await prisma.bike.update({
    where: {
      id: bikeId
    },
    data: record.data,
    include: {
      biker: true,
      batch: true,
      progressUpdates: {
        orderBy: {
          createdAt: "desc"
        },
        take: 20
      },
      fines: {
        include: {
          bike: true,
          biker: true
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 1
      }
    }
  });

  if (existing.bikerId !== record.data.bikerId) {
    await syncBikerLegacySummary(existing.bikerId);
  }
  await syncBikerLegacySummary(record.data.bikerId);

  return {
    statusCode: 200,
    body: {
      item: serializeBike(item)
    }
  };
}

async function deleteBike(id) {
  const bikeId = normalizeRequiredText(id);
  if (!bikeId) {
    return {
      statusCode: 400,
      body: {
        error: "Bike id is required."
      }
    };
  }

  const existing = await prisma.bike.findUnique({
    where: {
      id: bikeId
    },
    include: {
      _count: {
        select: {
          messages: true,
          progressUpdates: true,
          fines: true
        }
      }
    }
  });
  if (!existing) {
    return {
      statusCode: 404,
      body: {
        error: "Bike not found."
      }
    };
  }

  if ((existing._count?.messages ?? 0) > 0 || (existing._count?.progressUpdates ?? 0) > 0 || (existing._count?.fines ?? 0) > 0) {
    return {
      statusCode: 409,
      body: {
        error: "This bike already has workflow history. Delete the related updates and fines first, or keep the bike record for audit."
      }
    };
  }

  await prisma.bike.delete({
    where: {
      id: bikeId
    }
  });

  await syncBikerLegacySummary(existing.bikerId);

  return {
    statusCode: 200,
    body: {
      ok: true,
      deletedId: bikeId
    }
  };
}

function buildTemplateContext(bike, extra = {}) {
  return {
    firstName: bike.biker?.firstName || buildFirstName(bike.biker?.name || ""),
    fullName: bike.biker?.name || "",
    plate: bike.plateNumber || bike.biker?.bikePlate || "",
    chassisNumber: bike.chassisNumber || "",
    bikeModel: bike.bikeModel || bike.biker?.bikeModel || "",
    batchName: bike.batch?.name || bike.biker?.batch?.name || "",
    officialStartDate: formatDateLabel(bike.officialStartDate),
    nextPaymentDate: formatDateLabel(bike.nextPaymentDate),
    fineAmount: extra.fineAmount || "",
    fineReason: extra.fineReason || "",
    paymentDeadline: formatDateLabel(extra.paymentDeadline || null)
  };
}

function canAutoNotify(bike) {
  return String(bike?.biker?.status || "").trim().toLowerCase() === "active"
    && Boolean(bike?.biker?.notificationsEnabled)
    && Boolean(bike?.notificationsEnabled)
    && Boolean(String(bike?.biker?.phoneNumber || "").trim());
}

async function buildWorkflowNotification(bike, { stage, category, urgency, extraContext = {} }) {
  const template = await findSmsTemplate({ stage, category, urgency });
  if (!template) {
    return {
      skipped: true,
      reason: "No active SMS template matched this stage, category, and urgency."
    };
  }

  const context = buildTemplateContext(bike, extraContext);
  const renderedBody = renderTemplateBody(template.body, context);
  if (!renderedBody) {
    return {
      skipped: true,
      reason: "The selected template rendered an empty SMS body."
    };
  }

  const response = await queueMessageForDispatch({
    bikerId: bike.bikerId,
    bikeId: bike.id,
    templateId: template.id,
    source: "workflow",
    category: toMessageCategory(category, urgency),
    body: renderedBody,
    workflowStage: stage,
    workflowCategory: category,
    workflowUrgency: urgency
  });

  if (response.statusCode >= 400) {
    return {
      skipped: true,
      template,
      renderedBody,
      reason: response.body?.error || response.body?.note || "Workflow SMS could not be queued."
    };
  }

  return {
    skipped: false,
    template,
    renderedBody,
    messageId: response.body?.item?.id || ""
  };
}

async function createBikeProgressUpdate(bikeId, payload) {
  const targetBikeId = normalizeRequiredText(bikeId);
  if (!targetBikeId) {
    return {
      statusCode: 400,
      body: {
        error: "Bike id is required."
      }
    };
  }

  const bike = await prisma.bike.findUnique({
    where: {
      id: targetBikeId
    },
    include: {
      biker: {
        include: {
          batch: true
        }
      },
      batch: true
    }
  });
  if (!bike) {
    return {
      statusCode: 404,
      body: {
        error: "Bike not found."
      }
    };
  }

  const stage = normalizeStage(payload.stage, bike.lifecycleStage || "LEAD_CAPTURED");
  const category = normalizeCategory(payload.category, "progress-update");
  const urgency = normalizeUrgency(payload.urgency, "normal");
  if (!stage || !category || !urgency) {
    return {
      statusCode: 400,
      body: {
        error: "Choose a valid stage, category, and urgency."
      }
    };
  }

  const notifyRecipient = normalizeBoolean(payload.notifyRecipient, true);
  let notification = {
    skipped: true,
    reason: ""
  };

  if (notifyRecipient && canAutoNotify(bike)) {
    notification = await buildWorkflowNotification(bike, {
      stage,
      category,
      urgency
    });
  } else if (notifyRecipient) {
    notification = {
      skipped: true,
      reason: "Notification was requested, but this bike or recipient is not currently eligible for automatic SMS."
    };
  }

  const note = normalizeRequiredText(payload.note ?? "");
  const update = await prisma.bikeProgressUpdate.create({
    data: {
      id: randomUUID(),
      bikeId: bike.id,
      stage,
      category,
      urgency,
      note,
      notifyRecipient,
      templateId: notification.template?.id || null,
      sentMessageId: notification.messageId || null,
      renderedMessageBody: notification.renderedBody || "",
      createdBy: normalizeRequiredText(payload.createdBy || "operator")
    }
  });

  await prisma.bike.update({
    where: {
      id: bike.id
    },
    data: {
      lifecycleStage: stage
    }
  });

  return {
    statusCode: 201,
    body: {
      item: serializeProgressUpdate(update),
      notification: notification.skipped
        ? {
            sent: false,
            reason: notification.reason || "Notification was skipped."
          }
        : {
            sent: true,
            messageId: notification.messageId
          }
    }
  };
}

async function listFines() {
  const items = await prisma.fine.findMany({
    include: {
      bike: true,
      biker: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return items.map(serializeFine);
}

async function createFine(payload) {
  const bikeId = normalizeRequiredText(payload.bikeId || "");
  if (!bikeId) {
    return {
      statusCode: 400,
      body: {
        error: "Select the bike that received the fine."
      }
    };
  }

  const bike = await prisma.bike.findUnique({
    where: {
      id: bikeId
    },
    include: {
      biker: {
        include: {
          batch: true
        }
      },
      batch: true
    }
  });
  if (!bike) {
    return {
      statusCode: 404,
      body: {
        error: "Bike not found."
      }
    };
  }

  const amount = normalizeRequiredText(payload.amount || "");
  const reason = normalizeRequiredText(payload.reason || "");
  const fineDate = normalizeDateTime(payload.fineDate);
  const paymentDeadline = payload.paymentDeadline === ""
    ? null
    : normalizeDateTime(payload.paymentDeadline ?? null);

  if (!amount || !reason || !fineDate) {
    return {
      statusCode: 400,
      body: {
        error: "Fine amount, reason, and date are required."
      }
    };
  }

  const notifyRecipient = normalizeBoolean(payload.notifyRecipient, true);
  const urgency = normalizeUrgency(payload.urgency, "urgent") || "urgent";
  let notification = {
    skipped: true,
    reason: ""
  };

  if (notifyRecipient && canAutoNotify(bike)) {
    notification = await buildWorkflowNotification(bike, {
      stage: "FINE_RECORDED",
      category: "fine-notice",
      urgency,
      extraContext: {
        fineAmount: amount,
        fineReason: reason,
        paymentDeadline
      }
    });
  } else if (notifyRecipient) {
    notification = {
      skipped: true,
      reason: "Notification was requested, but this bike or recipient is not currently eligible for automatic SMS."
    };
  }

  const item = await prisma.fine.create({
    data: {
      id: randomUUID(),
      bikeId: bike.id,
      bikerId: bike.bikerId,
      amount,
      reason,
      fineDate,
      paymentDeadline,
      sourceSummary: normalizeRequiredText(payload.sourceSummary || ""),
      notifyRecipient,
      templateId: notification.template?.id || null,
      sentMessageId: notification.messageId || null,
      renderedMessageBody: notification.renderedBody || ""
    },
    include: {
      bike: true,
      biker: true
    }
  });

  return {
    statusCode: 201,
    body: {
      item: serializeFine(item),
      notification: notification.skipped
        ? {
            sent: false,
            reason: notification.reason || "Notification was skipped."
          }
        : {
            sent: true,
            messageId: notification.messageId
          }
    }
  };
}

module.exports = {
  createBike,
  createBikeProgressUpdate,
  createFine,
  deleteBike,
  listBikes,
  listFines,
  serializeBike,
  serializeFine,
  serializeProgressUpdate,
  syncBikerLegacySummary,
  updateBike
};
