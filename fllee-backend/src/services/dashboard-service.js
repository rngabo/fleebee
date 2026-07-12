const { prisma } = require("../lib/prisma");
const { getPhoneState, isPhoneOnline, serializePhone } = require("./phone-service");

async function buildDashboardResponse() {
  const [totalBikers, pendingReminders, emergencyOpen, queuedMessages, phone] = await Promise.all([
    prisma.biker.count(),
    prisma.biker.count({
      where: {
        reminderDue: true
      }
    }),
    prisma.biker.count({
      where: {
        urgentAlert: true
      }
    }),
    prisma.message.count({
      where: {
        status: {
          in: ["pending", "queued", "dispatched", "submitted"]
        }
      }
    }),
    getPhoneState()
  ]);

  return {
    summary: {
      totalBikers,
      pendingReminders,
      emergencyOpen,
      queuedMessages,
      phoneOnline: isPhoneOnline(phone)
    },
    phone: serializePhone(phone),
    testRoute: phone.targetNumber
  };
}

module.exports = {
  buildDashboardResponse
};
