import { Type } from "@sinclair/typebox";
import { jsonResult, readStringParam } from "openclaw/plugin-sdk/agent-runtime";
import type { HabiticaAuth } from "./api.js";
import { fetchDashboard, fetchTasks, fetchUserStats, scoreTask } from "./api.js";

const HabiticaToolSchema = Type.Object(
  {
    action: Type.Unsafe<"dashboard" | "dailies" | "habits" | "todos" | "stats" | "complete">({
      type: "string",
      enum: ["dashboard", "dailies", "habits", "todos", "stats", "complete"],
      description:
        "Action to perform: 'dashboard' for full overview, 'dailies'/'habits'/'todos' for specific lists, 'stats' for user stats, 'complete' to mark a task done.",
    }),
    task_id: Type.Optional(
      Type.String({ description: "Task ID (required for 'complete' action)" }),
    ),
  },
  { additionalProperties: false },
);

export function createHabiticaTool(auth: HabiticaAuth) {
  return {
    name: "habitica",
    label: "Habitica",
    ownerOnly: true,
    description:
      "Interact with Habitica: fetch dashboard (dailies, habits, todos, stats), individual task lists, or complete a task.",
    parameters: HabiticaToolSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const action = readStringParam(rawParams, "action", { required: true }) ?? "dashboard";

      if (action === "dashboard") {
        const data = await fetchDashboard(auth);
        return jsonResult(data);
      }

      if (action === "dailies") {
        const tasks = await fetchTasks(auth, "dailys");
        const overdue = tasks.filter((t) => t.isDue && !t.completed);
        return jsonResult({
          total: tasks.length,
          overdue: overdue.length,
          dailies: tasks.map((t) => ({
            id: t.id,
            text: t.text,
            completed: t.completed,
            isDue: t.isDue,
            streak: t.streak,
          })),
        });
      }

      if (action === "habits") {
        const tasks = await fetchTasks(auth, "habits");
        return jsonResult({
          total: tasks.length,
          habits: tasks.map((t) => ({
            id: t.id,
            text: t.text,
            value: t.value,
          })),
        });
      }

      if (action === "todos") {
        const tasks = await fetchTasks(auth, "todos");
        const incomplete = tasks.filter((t) => !t.completed);
        return jsonResult({
          total: tasks.length,
          incomplete: incomplete.length,
          todos: incomplete.map((t) => ({
            id: t.id,
            text: t.text,
            priority: t.priority,
            date: t.date,
            notes: t.notes || undefined,
          })),
        });
      }

      if (action === "stats") {
        const stats = await fetchUserStats(auth);
        return jsonResult({
          hp: `${Math.round(stats.hp)}/${stats.maxHealth}`,
          mp: `${Math.round(stats.mp)}/${stats.maxMP}`,
          exp: `${stats.exp}/${stats.toNextLevel}`,
          level: stats.lvl,
          gold: Math.round(stats.gp * 100) / 100,
          class: stats.class,
        });
      }

      if (action === "complete") {
        const taskId = readStringParam(rawParams, "task_id", { required: true });
        if (!taskId) {
          return jsonResult({ error: "task_id is required for the 'complete' action" });
        }
        const result = await scoreTask(auth, taskId);
        return jsonResult({ success: true, taskId, result });
      }

      return jsonResult({ error: `Unknown action: ${action}` });
    },
  };
}
