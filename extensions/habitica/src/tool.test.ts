import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api.js", () => ({
  fetchDashboard: vi.fn(),
  fetchTasks: vi.fn(),
  fetchUserStats: vi.fn(),
  scoreTask: vi.fn(),
}));

import type { HabiticaAuth } from "./api.js";
import { fetchDashboard, fetchTasks, fetchUserStats, scoreTask } from "./api.js";
import { createHabiticaTool } from "./tool.js";

describe("habitica tool", () => {
  const auth: HabiticaAuth = { userId: "test-user", apiKey: "test-key" };

  beforeEach(() => {
    vi.mocked(fetchDashboard).mockResolvedValue({
      stats: { hp: "50/50", mp: "30/60", exp: "100/200", level: 10, gold: 42, class: "warrior" },
      overdueDailies: [],
      incompleteTodos: [],
      habits: [],
      summary: {
        totalDailies: 0,
        completedDailies: 0,
        overdueDailies: 0,
        totalTodos: 0,
        incompleteTodos: 0,
        totalHabits: 0,
      },
    });
    vi.mocked(fetchTasks).mockResolvedValue([]);
    vi.mocked(fetchUserStats).mockResolvedValue({
      hp: 50,
      maxHealth: 50,
      mp: 30,
      maxMP: 60,
      exp: 100,
      toNextLevel: 200,
      lvl: 10,
      gp: 42,
      class: "warrior",
    });
    vi.mocked(scoreTask).mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct tool metadata", () => {
    const tool = createHabiticaTool(auth);
    expect(tool.name).toBe("habitica");
    expect(tool.ownerOnly).toBe(true);
  });

  it("handles dashboard action", async () => {
    const tool = createHabiticaTool(auth);
    const result = await tool.execute("call-1", { action: "dashboard" });

    expect(fetchDashboard).toHaveBeenCalledWith(auth);
    expect(result).toHaveProperty("content");
  });

  it("handles dailies action", async () => {
    vi.mocked(fetchTasks).mockResolvedValue([
      { id: "d1", text: "Run", type: "daily", isDue: true, completed: false, streak: 5 },
    ]);
    const tool = createHabiticaTool(auth);
    const result = await tool.execute("call-2", { action: "dailies" });

    expect(fetchTasks).toHaveBeenCalledWith(auth, "dailys");
    expect(result).toHaveProperty("content");
  });

  it("handles habits action", async () => {
    const tool = createHabiticaTool(auth);
    await tool.execute("call-3", { action: "habits" });

    expect(fetchTasks).toHaveBeenCalledWith(auth, "habits");
  });

  it("handles todos action", async () => {
    const tool = createHabiticaTool(auth);
    await tool.execute("call-4", { action: "todos" });

    expect(fetchTasks).toHaveBeenCalledWith(auth, "todos");
  });

  it("handles stats action", async () => {
    const tool = createHabiticaTool(auth);
    await tool.execute("call-5", { action: "stats" });

    expect(fetchUserStats).toHaveBeenCalledWith(auth);
  });

  it("handles complete action", async () => {
    const tool = createHabiticaTool(auth);
    await tool.execute("call-6", { action: "complete", task_id: "task-abc" });

    expect(scoreTask).toHaveBeenCalledWith(auth, "task-abc");
  });

  it("returns error for complete without task_id", async () => {
    const tool = createHabiticaTool(auth);
    const result = await tool.execute("call-7", { action: "complete" });

    const block = result.content[0]!;
    const parsed = JSON.parse(block.type === "text" ? block.text : "");
    expect(parsed).toHaveProperty("error");
  });

  it("returns error for unknown action", async () => {
    const tool = createHabiticaTool(auth);
    const result = await tool.execute("call-8", { action: "invalid" });

    const block = result.content[0]!;
    const parsed = JSON.parse(block.type === "text" ? block.text : "");
    expect(parsed.error).toContain("Unknown action");
  });
});
