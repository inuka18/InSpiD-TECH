import { mockTasks, getTasksForProject } from "../data/mockSchedule";
import { getAllTasksForProject } from "../data/mockSchedulePhases";
import { RENT_EASE_PROJECT_ID } from "../data/mockRentEase";
import { delay } from "./simulatedLatency";

export async function fetchTasks(projectId) {
  await delay(450);
  if (!projectId) return mockTasks;
  if (projectId === RENT_EASE_PROJECT_ID) return getAllTasksForProject(projectId);
  return getTasksForProject(projectId);
}
