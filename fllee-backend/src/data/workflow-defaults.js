const WORKFLOW_STAGES = [
  "LEAD_CAPTURED",
  "PREPARATION",
  "BIKES_ORDERED",
  "WAITING_FOR_COMPANY",
  "BIKE_DETAILS_RECEIVED",
  "PLATE_ASSIGNED",
  "INSURANCE_IN_PROGRESS",
  "INSURANCE_COMPLETED",
  "AUTHORIZATION_IN_PROGRESS",
  "AUTHORIZATION_PENDING",
  "AUTHORIZATION_COMPLETED",
  "PICKUP_READY",
  "PICKUP_SCHEDULED",
  "AT_COMPANY",
  "AT_NOTARY",
  "DELIVERED",
  "WELCOME_SENT",
  "PAYMENT_REMINDER",
  "FINE_RECORDED"
];

const WORKFLOW_CATEGORIES = [
  "onboarding",
  "preparation",
  "progress-update",
  "insurance",
  "authorization",
  "pickup",
  "notary",
  "welcome",
  "payment-reminder",
  "fine-notice",
  "safety",
  "service-information",
  "cleanliness",
  "batch-notice",
  "emergency"
];

const WORKFLOW_URGENCY_LEVELS = ["normal", "important", "urgent"];

const DEFAULT_SMS_TEMPLATES = [
  {
    stage: "LEAD_CAPTURED",
    category: "onboarding",
    urgency: "normal",
    title: "Lead captured",
    body: "Muraho {{firstName}}, twakiriye amakuru yawe kandi turi gutegura gahunda nshya ya moto. Tuzakomeza kukugezaho aho bigeze vuba.",
    isActive: true,
    includeSignature: true
  },
  {
    stage: "PREPARATION",
    category: "preparation",
    urgency: "normal",
    title: "Preparation notice",
    body: "Muraho {{firstName}}, tangira gutegura ibyangombwa byawe no gushaka umwishingizi uzakorana nawe. Turateganya ko uzabona amakuru mashya vuba.",
    isActive: true,
    includeSignature: true
  },
  {
    stage: "PLATE_ASSIGNED",
    category: "progress-update",
    urgency: "important",
    title: "Plate assigned",
    body: "Muraho {{firstName}}, moto yawe ifite plaque {{plate}} ubu yamaze kuboneka. Igikurikiraho ni ugukomeza gahunda y'ubwishingizi.",
    isActive: true,
    includeSignature: true
  },
  {
    stage: "INSURANCE_IN_PROGRESS",
    category: "insurance",
    urgency: "normal",
    title: "Insurance in progress",
    body: "Muraho {{firstName}}, ubwishingizi bwa moto yawe ifite plaque {{plate}} buri gukorwa. Tuzakubwira umunsi wo kujya gufata moto vuba nitubona amakuru mashya.",
    isActive: true,
    includeSignature: true
  },
  {
    stage: "AUTHORIZATION_IN_PROGRESS",
    category: "authorization",
    urgency: "normal",
    title: "Authorization in progress",
    body: "Muraho {{firstName}}, ubusabe bw'uruhushya rwa moto yawe ifite plaque {{plate}} buri gukurikiranwa kuri RURA. Turacyabikurikirana.",
    isActive: true,
    includeSignature: true
  },
  {
    stage: "AUTHORIZATION_PENDING",
    category: "authorization",
    urgency: "important",
    title: "Authorization pending",
    body: "Muraho {{firstName}}, uruhushya rwa moto yawe ifite plaque {{plate}} ruracyategerejwe kuri RURA. Icyakora dosiye yawe iri gukurikiranwa kandi tuzakumenyesha uko bimeze.",
    isActive: true,
    includeSignature: true
  },
  {
    stage: "PICKUP_SCHEDULED",
    category: "pickup",
    urgency: "important",
    title: "Pickup scheduled",
    body: "Muraho {{firstName}}, witegure kuza gufata moto yawe ifite plaque {{plate}} ku itariki n'isaha twaguhaye. Ntuzibagirwe uruhushya rwo gutwara moto.",
    isActive: true,
    includeSignature: true
  },
  {
    stage: "AT_NOTARY",
    category: "notary",
    urgency: "important",
    title: "Notary step",
    body: "Muraho {{firstName}}, nyuma yo gufata moto yawe tuzahurira kwa notaire kugira ngo dusoze amasezerano. Niba umwishingizi wawe agomba kuza gusinya, mutegure neza.",
    isActive: true,
    includeSignature: true
  },
  {
    stage: "DELIVERED",
    category: "welcome",
    urgency: "normal",
    title: "Delivery welcome",
    body: "Muraho {{firstName}}, turagushimiye. Wamaze guhabwa moto yawe {{plate}}. Komeza kuyitwaraho neza kandi tuzakomeza kukugezaho amakuru y'impapuro n'ubwishyu bukurikira.",
    isActive: true,
    includeSignature: true
  },
  {
    stage: "PAYMENT_REMINDER",
    category: "payment-reminder",
    urgency: "important",
    title: "Payment reminder",
    body: "Muraho {{firstName}}, iyi ni reminder y'ubwishyu bukurikira bwa moto yawe {{plate}}. Itariki y'ubwishyu ni {{nextPaymentDate}}. Turakwinginze kubutegura ku gihe.",
    isActive: true,
    includeSignature: true
  },
  {
    stage: "FINE_RECORDED",
    category: "fine-notice",
    urgency: "urgent",
    title: "Traffic fine",
    body: "Muraho {{firstName}}, moto yawe {{plate}} yaciwe amande ya {{fineAmount}} kubera {{fineReason}}. Turagusaba kuyishyura ku gihe no kwirinda ko byongera kuba.",
    isActive: true,
    includeSignature: true
  },
  {
    stage: "DELIVERED",
    category: "safety",
    urgency: "normal",
    title: "Safety reminder",
    body: "Muraho {{firstName}}, turakwibutsa gutwara neza, kubahiriza amategeko y'umuhanda no kwita kuri moto yawe {{plate}} buri munsi.",
    isActive: true,
    includeSignature: true
  },
  {
    stage: "DELIVERED",
    category: "service-information",
    urgency: "normal",
    title: "Service information",
    body: "Muraho {{firstName}}, igihe cya service cyangwa igenzura rya moto yawe {{plate}} nikigera uzabimenyeshwa. Komeza gukurikirana amakuru tuzakohereza.",
    isActive: true,
    includeSignature: true
  },
  {
    stage: "DELIVERED",
    category: "cleanliness",
    urgency: "normal",
    title: "Cleanliness reminder",
    body: "Muraho {{firstName}}, twibutse ko isuku ya moto yawe {{plate}} n'imyitwarire myiza bifasha akazi kawe no kurinda ibihombo.",
    isActive: true,
    includeSignature: true
  },
  {
    stage: "DELIVERED",
    category: "batch-notice",
    urgency: "important",
    title: "Batch notice",
    body: "Muraho {{firstName}}, iri tangazo rireba batch yawe {{batchName}}. Nyamuneka kurikiza amabwiriza watangiwe kandi ukomeze gukurikirana andi makuru.",
    isActive: true,
    includeSignature: true
  },
  {
    stage: "DELIVERED",
    category: "emergency",
    urgency: "urgent",
    title: "Emergency notice",
    body: "Muraho {{firstName}}, hari ikibazo cyihutirwa kireba moto yawe {{plate}}. Nyamuneka twandikire cyangwa uduhamagare vuba bishoboka.",
    isActive: true,
    includeSignature: true
  }
];

module.exports = {
  DEFAULT_SMS_TEMPLATES,
  WORKFLOW_CATEGORIES,
  WORKFLOW_STAGES,
  WORKFLOW_URGENCY_LEVELS
};
