const { randomUUID } = require("node:crypto");

const { DEFAULT_SMS_TEMPLATES } = require("../data/workflow-defaults");
const { prisma } = require("../lib/prisma");
const {
  normalizeBoolean,
  normalizeCategory,
  normalizeRequiredText,
  normalizeStage,
  normalizeUrgency
} = require("./workflow-support");

function serializeTemplate(item) {
  return {
    id: item.id,
    stage: item.stage,
    category: item.category,
    urgency: item.urgency,
    title: item.title,
    body: item.body,
    isActive: Boolean(item.isActive),
    includeSignature: Boolean(item.includeSignature),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString()
  };
}

async function ensureDefaultSmsTemplates() {
  const count = await prisma.smsTemplate.count();
  if (count > 0) {
    return;
  }

  await prisma.smsTemplate.createMany({
    data: DEFAULT_SMS_TEMPLATES.map((item) => ({
      id: randomUUID(),
      ...item
    }))
  });
}

async function listSmsTemplates() {
  const items = await prisma.smsTemplate.findMany({
    orderBy: [
      {
        stage: "asc"
      },
      {
        category: "asc"
      },
      {
        urgency: "asc"
      }
    ]
  });

  return items.map(serializeTemplate);
}

function buildTemplateFields(payload, existing = {}) {
  const stage = normalizeStage(payload.stage, existing.stage || "LEAD_CAPTURED");
  if (!stage) {
    return { error: "Choose a valid workflow stage." };
  }

  const category = normalizeCategory(payload.category, existing.category || "progress-update");
  if (!category) {
    return { error: "Choose a valid template category." };
  }

  const urgency = normalizeUrgency(payload.urgency, existing.urgency || "normal");
  if (!urgency) {
    return { error: "Choose a valid urgency level." };
  }

  const title = normalizeRequiredText(payload.title ?? existing.title ?? "");
  const body = normalizeRequiredText(payload.body ?? existing.body ?? "");
  if (!title || !body) {
    return { error: "Template title and body are required." };
  }

  return {
    data: {
      stage,
      category,
      urgency,
      title,
      body,
      isActive: normalizeBoolean(payload.isActive, existing.isActive ?? true),
      includeSignature: normalizeBoolean(
        payload.includeSignature,
        existing.includeSignature ?? true
      )
    }
  };
}

async function createSmsTemplate(payload) {
  const record = buildTemplateFields(payload);
  if (record.error) {
    return {
      statusCode: 400,
      body: record
    };
  }

  const duplicate = await prisma.smsTemplate.findFirst({
    where: {
      stage: record.data.stage,
      category: record.data.category,
      urgency: record.data.urgency
    }
  });
  if (duplicate) {
    return {
      statusCode: 409,
      body: {
        error: "A template already exists for that stage, category, and urgency."
      }
    };
  }

  const item = await prisma.smsTemplate.create({
    data: {
      id: randomUUID(),
      ...record.data
    }
  });

  return {
    statusCode: 201,
    body: {
      item: serializeTemplate(item)
    }
  };
}

async function updateSmsTemplate(id, payload) {
  const templateId = normalizeRequiredText(id);
  if (!templateId) {
    return {
      statusCode: 400,
      body: {
        error: "Template id is required."
      }
    };
  }

  const existing = await prisma.smsTemplate.findUnique({
    where: {
      id: templateId
    }
  });
  if (!existing) {
    return {
      statusCode: 404,
      body: {
        error: "Template not found."
      }
    };
  }

  const record = buildTemplateFields(payload, existing);
  if (record.error) {
    return {
      statusCode: 400,
      body: record
    };
  }

  const duplicate = await prisma.smsTemplate.findFirst({
    where: {
      stage: record.data.stage,
      category: record.data.category,
      urgency: record.data.urgency,
      id: {
        not: templateId
      }
    }
  });
  if (duplicate) {
    return {
      statusCode: 409,
      body: {
        error: "Another template already uses that same stage, category, and urgency."
      }
    };
  }

  const item = await prisma.smsTemplate.update({
    where: {
      id: templateId
    },
    data: record.data
  });

  return {
    statusCode: 200,
    body: {
      item: serializeTemplate(item)
    }
  };
}

async function deleteSmsTemplate(id) {
  const templateId = normalizeRequiredText(id);
  if (!templateId) {
    return {
      statusCode: 400,
      body: {
        error: "Template id is required."
      }
    };
  }

  const existing = await prisma.smsTemplate.findUnique({
    where: {
      id: templateId
    }
  });
  if (!existing) {
    return {
      statusCode: 404,
      body: {
        error: "Template not found."
      }
    };
  }

  await prisma.smsTemplate.delete({
    where: {
      id: templateId
    }
  });

  return {
    statusCode: 200,
    body: {
      ok: true,
      deletedId: templateId
    }
  };
}

async function findSmsTemplate({ stage, category, urgency }) {
  const normalizedStage = normalizeStage(stage, "LEAD_CAPTURED");
  const normalizedCategory = normalizeCategory(category, "progress-update");
  const normalizedUrgency = normalizeUrgency(urgency, "normal");

  const candidates = [
    { stage: normalizedStage, category: normalizedCategory, urgency: normalizedUrgency },
    { stage: normalizedStage, category: normalizedCategory, urgency: "normal" },
    { stage: normalizedStage, category: "progress-update", urgency: normalizedUrgency },
    { stage: normalizedStage, category: "progress-update", urgency: "normal" }
  ];

  for (const candidate of candidates) {
    const match = await prisma.smsTemplate.findFirst({
      where: {
        stage: candidate.stage,
        category: candidate.category,
        urgency: candidate.urgency,
        isActive: true
      }
    });
    if (match) {
      return match;
    }
  }

  return null;
}

module.exports = {
  createSmsTemplate,
  deleteSmsTemplate,
  ensureDefaultSmsTemplates,
  findSmsTemplate,
  listSmsTemplates,
  serializeTemplate,
  updateSmsTemplate
};
