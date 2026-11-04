const { prisma } = require("../lib/prisma");

function plateKey(value) {
  return String(value ?? "").toUpperCase().replace(/\s+/g, "");
}

/**
 * One row per bike (plate): who uses it now and the cumulative amount paid on it.
 * "Current user" is the active rider on that plate in the sheet's Setup tab (latest start date);
 * when the plate is not in Setup, the app's own bike record is used if its biker is Active.
 * The amount adds the payments of EVERY rider who has had the plate, so a replaced rider's
 * payments stay with the bike.
 */
async function getFleet() {
  const [members, payments, bikes] = await Promise.all([
    prisma.dataMember.findMany({
      where: { isPresent: true },
      include: { biker: { select: { phoneNumber: true, status: true } } }
    }),
    prisma.dataPayment.findMany({
      where: { isPresent: true },
      select: { dataMemberId: true, amountRwf: true, paymentDate: true }
    }),
    prisma.bike.findMany({
      include: { biker: { select: { name: true, firstName: true, phoneNumber: true, status: true } }, batch: { select: { name: true } } }
    })
  ]);

  const paidByMember = new Map();
  for (const payment of payments) {
    const entry = paidByMember.get(payment.dataMemberId) || { total: 0, count: 0, last: null };
    entry.total += payment.amountRwf;
    entry.count += 1;
    if (!entry.last || payment.paymentDate > entry.last) entry.last = payment.paymentDate;
    paidByMember.set(payment.dataMemberId, entry);
  }

  const fleet = new Map();
  const slot = (plate) => {
    if (!fleet.has(plate)) fleet.set(plate, { plate, model: "", members: [], bike: null });
    return fleet.get(plate);
  };
  for (const member of members) {
    const plate = plateKey(member.sourcePlate);
    if (plate) slot(plate).members.push(member);
  }
  for (const bike of bikes) {
    const plate = plateKey(bike.plateNumber);
    if (!plate) continue;
    const entry = slot(plate);
    entry.bike = bike;
    entry.model = bike.bikeModel || entry.model;
  }

  const items = [...fleet.values()].map((entry) => {
    const activeMembers = entry.members
      .filter((member) => String(member.sourceStatus).toLowerCase() === "active")
      .sort((a, b) => (b.startDate?.getTime() || 0) - (a.startDate?.getTime() || 0));
    let currentUser = null;
    if (activeMembers.length) {
      const member = activeMembers[0];
      currentUser = {
        name: member.sourceName,
        phone: member.biker?.phoneNumber || member.sourcePhone || "",
        since: member.startDate ? member.startDate.toISOString().slice(0, 10) : null
      };
    } else if (!entry.members.length && entry.bike && String(entry.bike.biker?.status).toLowerCase() === "active") {
      const biker = entry.bike.biker;
      currentUser = { name: [biker.name, biker.firstName].filter(Boolean).join(" "), phone: biker.phoneNumber || "", since: null };
    }

    // Batch of the current rider; for an available bike, of the most recent former rider.
    const byRecent = [...entry.members].sort((a, b) => (b.startDate?.getTime() || 0) - (a.startDate?.getTime() || 0));
    const batch = (activeMembers[0] || byRecent[0])?.batchCode || entry.bike?.batch?.name || "";

    let totalPaidRwf = 0;
    let paymentCount = 0;
    for (const member of entry.members) {
      const paid = paidByMember.get(member.id);
      if (paid) {
        totalPaidRwf += paid.total;
        paymentCount += paid.count;
      }
    }
    const formerRiders = entry.members
      .filter((member) => member.sourceName !== currentUser?.name)
      .map((member) => member.sourceName);

    return {
      plate: entry.plate,
      model: entry.model,
      batch,
      status: currentUser ? "ACTIVE" : "AVAILABLE",
      currentUser,
      totalPaidRwf,
      paymentCount,
      riderCount: entry.members.length,
      formerRiders
    };
  });

  // Ranked from the highest total paid; ties fall back to plate order.
  items.sort((a, b) => (b.totalPaidRwf - a.totalPaidRwf) || a.plate.localeCompare(b.plate));
  return {
    items,
    totals: {
      bikes: items.length,
      active: items.filter((item) => item.status === "ACTIVE").length,
      available: items.filter((item) => item.status === "AVAILABLE").length,
      totalPaidRwf: items.reduce((sum, item) => sum + item.totalPaidRwf, 0)
    }
  };
}

module.exports = { getFleet, plateKey };
