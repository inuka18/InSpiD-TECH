// Frontend-only RentEase planning demo. Baseline estimates and predecessor
// relationships are the supplied values; dates are calculated on weekdays.
export const RENT_EASE_PROJECT_ID = "RENTEASE";
export const RENT_EASE_PROJECT = {
  id: RENT_EASE_PROJECT_ID,
  name: "RentEase",
  domain: "Property Rental Management System",
  colorTag: "#0f766e",
  shortDescription: "Property rental management system schedule demo.",
  description: "Frontend-only 10-sprint planning demo for the RentEase property rental management system.",
  startDate: "2026-10-01T09:00:00+05:30",
  activeSprint: { name: "Sprint 1: Planning and Requirements", number: 1, startDate: "2026-10-01T00:00:00+05:30", endDate: "2026-10-14T23:59:59+05:30" },
  health: "on-track",
};

export const rentEaseTeam = [
  { id: "re-pm", projectId: RENT_EASE_PROJECT_ID, name: "Tharindu Bandara", initials: "TB", email: "pm@rentease.demo", jobTitle: "Project Manager", appRole: "pm" },
  { id: "re-ba", projectId: RENT_EASE_PROJECT_ID, name: "Nadeesha Fernando", initials: "NF", email: "ba@rentease.demo", jobTitle: "Business Analyst", appRole: "member" },
  { id: "re-se1", projectId: RENT_EASE_PROJECT_ID, name: "Chamika Rathnayake", initials: "CR", email: "se1@rentease.demo", jobTitle: "Backend Developer", appRole: "member" },
  { id: "re-se2", projectId: RENT_EASE_PROJECT_ID, name: "Malith Perera", initials: "MP", email: "se2@rentease.demo", jobTitle: "Frontend Developer", appRole: "member" },
  { id: "re-qa", projectId: RENT_EASE_PROJECT_ID, name: "Anjali Fonseka", initials: "AF", email: "qa@rentease.demo", jobTitle: "QA Engineer", appRole: "member" },
  { id: "re-ux", projectId: RENT_EASE_PROJECT_ID, name: "Sanduni Rajapaksha", initials: "SR", email: "ux@rentease.demo", jobTitle: "UX/UI Designer", appRole: "member" },
];

const SPRINTS = [
  ["Planning and Requirements", "Establish scope, requirements, user stories and acceptance criteria."],
  ["UI/UX and Architecture", "Define user flows, interface prototypes, architecture and database design."],
  ["Authentication and Profiles", "Enable registration, login, role-based access and profile management."],
  ["Property Browsing", "Browse, search, filter and view property details."],
  ["Property Applications", "Submit applications, track status and review applications."],
  ["Lease Management", "Manage lease records, documents and lease status."],
  ["Rent Payments and Payment History", "Display rent obligations and maintain payment history and receipts."],
  ["Maintenance and Notifications", "Report maintenance issues, track progress and send notifications."],
  ["Integration and System Testing", "Integrate modules and verify reliability, performance and security."],
  ["UAT and Release", "Complete acceptance testing, documentation and release preparation."],
];

const TASKS = [
  ["T01", "Project scope and sprint plan", 2, "re-pm", [], 1],
  ["T02", "Gather and document requirements", 5, "re-ba", ["T01"], 1],
  ["T03", "User stories and acceptance criteria", 3, "re-ba", ["T02"], 1],
  ["T04", "Backlog review and approval", 2, "re-pm", ["T03"], 1],
  ["T05", "User flows and wireframes", 4, "re-ux", ["T04"], 2],
  ["T06", "High-fidelity UI prototype", 4, "re-ux", ["T05"], 2],
  ["T07", "Database and API architecture", 4, "re-se1", ["T04"], 2],
  ["T08", "Development environment setup", 2, "re-se2", ["T07"], 2],
  ["T09", "Registration and login API", 4, "re-se1", ["T08"], 3],
  ["T10", "Login and registration screens", 4, "re-se2", ["T06", "T09"], 3],
  ["T11", "Profile management and validation", 4, "re-se2", ["T10"], 3],
  ["T12", "Authentication and access tests", 2, "re-qa", ["T11"], 3],
  ["T13", "Property data and listing API", 4, "re-se1", ["T12"], 4],
  ["T14", "Property listing UI", 4, "re-se2", ["T13"], 4],
  ["T15", "Search, filters and property details", 4, "re-se2", ["T14"], 4],
  ["T16", "Browse and search testing", 2, "re-qa", ["T15"], 4],
  ["T17", "Application submission API", 4, "re-se1", ["T16"], 5],
  ["T18", "Application form and status UI", 4, "re-se2", ["T17"], 5],
  ["T19", "Review and approval workflow", 4, "re-se1", ["T18"], 5],
  ["T20", "Application workflow testing", 2, "re-qa", ["T19"], 5],
  ["T21", "Lease data model and API", 4, "re-se1", ["T20"], 6],
  ["T22", "Lease details and status UI", 4, "re-se2", ["T21"], 6],
  ["T23", "Lease document and status workflow", 4, "re-se1", ["T22"], 6],
  ["T24", "Lease validation and testing", 2, "re-qa", ["T23"], 6],
  ["T25", "Rent schedule and payment API", 4, "re-se1", ["T24"], 7],
  ["T26", "Payment interface and integration", 4, "re-se2", ["T25"], 7],
  ["T27", "Payment history and receipts", 4, "re-se1", ["T26"], 7],
  ["T28", "Payment workflow and security tests", 2, "re-qa", ["T27"], 7],
  ["T29", "Maintenance request API", 4, "re-se1", ["T28"], 8],
  ["T30", "Maintenance request and tracking UI", 4, "re-se2", ["T29"], 8],
  ["T31", "Notification management", 4, "re-se1", ["T30"], 8],
  ["T32", "Maintenance and notification tests", 2, "re-qa", ["T31"], 8],
  ["T33", "Integrate application modules", 4, "re-se2", ["T32"], 9],
  ["T34", "End-to-end and regression testing", 5, "re-qa", ["T33"], 9],
  ["T35", "Fix defects and verify fixes", 5, "re-se1", ["T34"], 9],
  ["T36", "Performance and security review", 3, "re-qa", ["T35"], 9],
  ["T37", "User acceptance testing", 3, "re-qa", ["T36"], 10],
  ["T38", "Final defect fixes", 3, "re-se1", ["T37"], 10],
  ["T39", "User documentation and handover", 3, "re-ba", ["T38"], 10],
  ["T40", "Release approval and demonstration", 1, "re-pm", ["T39"], 10],
];

const PROJECT_START = new Date("2026-10-01T03:30:00.000Z"); // 09:00 Asia/Colombo

function addWorkingDays(date, amount) {
  const result = new Date(date);
  let remaining = amount;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    const day = result.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  while (result.getUTCDay() === 0 || result.getUTCDay() === 6) result.setUTCDate(result.getUTCDate() + 1);
  return result;
}

function isoAtHour(date, hourUtc) {
  const result = new Date(date);
  result.setUTCHours(hourUtc, 30, 0, 0);
  return result.toISOString();
}

export function buildRentEasePhases() {
  const taskById = new Map();
  const phaseRows = SPRINTS.map(([name, requirement], index) => {
    const startDay = addWorkingDays(PROJECT_START, index * 10);
    const endDay = addWorkingDays(startDay, 9);
    return {
      id: `re-sprint-${index + 1}`,
      name: `Sprint ${index + 1}: ${name}`,
      start: isoAtHour(startDay, 3),
      end: isoAtHour(endDay, 12),
      baselineStart: isoAtHour(startDay, 3),
      baselineEnd: isoAtHour(endDay, 12),
      requirement,
      sprintNumber: index + 1,
      tasks: [],
    };
  });

  TASKS.forEach(([id, name, durationDays, assigneeId, dependencies, sprintNumber], index) => {
    const phase = phaseRows[sprintNumber - 1];
    const sprintStart = new Date(phase.start);
    let start = sprintStart;
    dependencies.forEach((dependencyId) => {
      const predecessor = taskById.get(dependencyId);
      if (predecessor) {
        const nextStart = addWorkingDays(new Date(predecessor.end), 1);
        if (nextStart > start) start = nextStart;
      }
    });
    const end = addWorkingDays(start, durationDays - 1);
    const task = {
      id,
      projectId: RENT_EASE_PROJECT_ID,
      name,
      description: `${name} for RentEase. Initial baseline task; edit dates and assignments in the schedule demo.`,
      requirementId: `RE-REQ-${String(sprintNumber).padStart(2, "0")}`,
      requirement: phase.requirement,
      sprintId: `re-sprint-${sprintNumber}`,
      sprintNumber,
      durationDays,
      estimatedEffortHours: null,
      assigneeId,
      assigneeIds: [assigneeId],
      start: isoAtHour(start, 3),
      end: isoAtHour(end, 12),
      baselineStart: isoAtHour(start, 3),
      baselineEnd: isoAtHour(end, 12),
      storyPoints: durationDays,
      progress: 0,
      status: "not-started",
      priority: ["T01", "T04", "T12", "T16", "T20", "T24", "T28", "T32", "T36", "T40"].includes(id) ? "high" : "medium",
      critical: true,
      milestone: ["T04", "T12", "T20", "T28", "T32", "T36", "T40"].includes(id),
      dependencies: [...dependencies],
      dependencyDetails: dependencies.map((predecessorId) => ({ predecessorId, type: "FS", lagWorkingDays: 0 })),
      successorIds: [],
      cause: null,
      sprintOverrun: new Date(isoAtHour(end, 12)) > new Date(phase.baselineEnd),
    };
    taskById.set(id, task);
    phase.tasks.push(task);
  });

  phaseRows.forEach((phase) => {
    phase.tasks.forEach((task) => {
      task.dependencies.forEach((predecessorId) => taskById.get(predecessorId)?.successorIds.push(task.id));
    });
    const latestFinish = phase.tasks.reduce((latest, task) => Math.max(latest, new Date(task.end).getTime()), new Date(phase.baselineEnd).getTime());
    if (latestFinish > new Date(phase.end).getTime()) phase.end = new Date(latestFinish).toISOString();
  });

  return phaseRows;
}

export const rentEaseCapacity = rentEaseTeam.map((member) => ({
  id: `re-cap-${member.id}`,
  projectId: RENT_EASE_PROJECT_ID,
  memberId: member.id,
  name: member.name,
  role: member.jobTitle,
  plannedHours: 48,
  availableHours: 80,
  loggedHours: 0,
  status: "Balanced",
  offToday: false,
}));
