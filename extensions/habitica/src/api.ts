const HABITICA_API_BASE = "https://habitica.com/api/v3";

export interface HabiticaAuth {
  userId: string;
  apiKey: string;
}

async function habiticaFetch(auth: HabiticaAuth, endpoint: string, options?: RequestInit) {
  const response = await fetch(`${HABITICA_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-api-user": auth.userId,
      "x-api-key": auth.apiKey,
      "x-client": "openclaw-habitica-plugin",
      ...(options?.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Habitica API ${endpoint}: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as { success: boolean; data: unknown };
}

interface HabiticaTask {
  id: string;
  text: string;
  type: string;
  completed?: boolean;
  isDue?: boolean;
  streak?: number;
  value?: number;
  priority?: number;
  notes?: string;
  date?: string;
  tags?: string[];
  checklist?: Array<{ text: string; completed: boolean }>;
}

interface HabiticaUserStats {
  hp: number;
  maxHealth: number;
  mp: number;
  maxMP: number;
  exp: number;
  toNextLevel: number;
  lvl: number;
  gp: number;
  class: string;
}

export async function fetchTasks(
  auth: HabiticaAuth,
  type?: "habits" | "dailys" | "todos" | "rewards",
): Promise<HabiticaTask[]> {
  const endpoint = type ? `/tasks/user?type=${type}` : "/tasks/user";
  const result = await habiticaFetch(auth, endpoint);
  return result.data as HabiticaTask[];
}

export async function fetchUserStats(auth: HabiticaAuth): Promise<HabiticaUserStats> {
  const result = await habiticaFetch(auth, "/user?userFields=stats");
  const data = result.data as { stats: HabiticaUserStats };
  return data.stats;
}

export async function scoreTask(auth: HabiticaAuth, taskId: string): Promise<unknown> {
  const result = await habiticaFetch(auth, `/tasks/${taskId}/score/up`, { method: "POST" });
  return result.data;
}

export async function fetchDashboard(auth: HabiticaAuth) {
  const [dailies, habits, todos, stats] = await Promise.all([
    fetchTasks(auth, "dailys"),
    fetchTasks(auth, "habits"),
    fetchTasks(auth, "todos"),
    fetchUserStats(auth),
  ]);

  const overdueDailies = dailies.filter((d) => d.isDue && !d.completed);
  const incompleteTodos = todos.filter((t) => !t.completed);

  return {
    stats: {
      hp: `${Math.round(stats.hp)}/${stats.maxHealth}`,
      mp: `${Math.round(stats.mp)}/${stats.maxMP}`,
      exp: `${stats.exp}/${stats.toNextLevel}`,
      level: stats.lvl,
      gold: Math.round(stats.gp * 100) / 100,
      class: stats.class,
    },
    overdueDailies: overdueDailies.map((d) => ({
      id: d.id,
      text: d.text,
      streak: d.streak,
      notes: d.notes || undefined,
    })),
    incompleteTodos: incompleteTodos.map((t) => ({
      id: t.id,
      text: t.text,
      priority: t.priority,
      date: t.date || undefined,
      notes: t.notes || undefined,
    })),
    habits: habits.map((h) => ({
      id: h.id,
      text: h.text,
      value: h.value,
    })),
    summary: {
      totalDailies: dailies.length,
      completedDailies: dailies.filter((d) => d.completed).length,
      overdueDailies: overdueDailies.length,
      totalTodos: todos.length,
      incompleteTodos: incompleteTodos.length,
      totalHabits: habits.length,
    },
  };
}
