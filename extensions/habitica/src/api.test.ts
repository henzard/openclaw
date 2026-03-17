import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HabiticaAuth } from "./api.js";
import { fetchDashboard, fetchTasks, fetchUserStats, scoreTask } from "./api.js";

describe("habitica api", () => {
  const auth: HabiticaAuth = { userId: "test-user", apiKey: "test-key" };

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("fetchTasks", () => {
    it("calls /tasks/user endpoint", async () => {
      await fetchTasks(auth);

      expect(fetch).toHaveBeenCalledWith(
        "https://habitica.com/api/v3/tasks/user",
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-user": "test-user",
            "x-api-key": "test-key",
          }),
        }),
      );
    });

    it("appends type filter when provided", async () => {
      await fetchTasks(auth, "dailys");

      expect(fetch).toHaveBeenCalledWith(
        "https://habitica.com/api/v3/tasks/user?type=dailys",
        expect.anything(),
      );
    });

    it("returns task array from data", async () => {
      const mockTasks = [
        { id: "t1", text: "Do dishes", type: "daily" },
        { id: "t2", text: "Exercise", type: "habit" },
      ];
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: mockTasks }),
      } as Response);

      const tasks = await fetchTasks(auth);
      expect(tasks).toEqual(mockTasks);
    });

    it("throws on non-OK response", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      } as Response);

      await expect(fetchTasks(auth)).rejects.toThrow("401 Unauthorized");
    });
  });

  describe("fetchUserStats", () => {
    it("calls /user endpoint with stats fields", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            stats: {
              hp: 50,
              maxHealth: 50,
              mp: 30,
              maxMP: 60,
              exp: 100,
              toNextLevel: 200,
              lvl: 10,
              gp: 42.5,
              class: "warrior",
            },
          },
        }),
      } as Response);

      const stats = await fetchUserStats(auth);

      expect(fetch).toHaveBeenCalledWith(
        "https://habitica.com/api/v3/user?userFields=stats",
        expect.anything(),
      );
      expect(stats.hp).toBe(50);
      expect(stats.class).toBe("warrior");
    });
  });

  describe("scoreTask", () => {
    it("calls POST on /tasks/:id/score/up", async () => {
      await scoreTask(auth, "task-123");

      expect(fetch).toHaveBeenCalledWith(
        "https://habitica.com/api/v3/tasks/task-123/score/up",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  describe("fetchDashboard", () => {
    it("aggregates dashboard data", async () => {
      let callCount = 0;
      vi.mocked(fetch).mockImplementation(async (url) => {
        callCount++;
        const urlStr = typeof url === "string" ? url : url.toString();

        if (urlStr.includes("type=dailys")) {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: [
                { id: "d1", text: "Daily 1", isDue: true, completed: false, streak: 3 },
                { id: "d2", text: "Daily 2", isDue: true, completed: true, streak: 7 },
              ],
            }),
          } as Response;
        }

        if (urlStr.includes("type=habits")) {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: [{ id: "h1", text: "Habit 1", value: 5 }],
            }),
          } as Response;
        }

        if (urlStr.includes("type=todos")) {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: [
                { id: "t1", text: "Todo 1", completed: false, priority: 1 },
                { id: "t2", text: "Todo 2", completed: true, priority: 2 },
              ],
            }),
          } as Response;
        }

        if (urlStr.includes("userFields=stats")) {
          return {
            ok: true,
            json: async () => ({
              success: true,
              data: {
                stats: {
                  hp: 45,
                  maxHealth: 50,
                  mp: 30,
                  maxMP: 60,
                  exp: 100,
                  toNextLevel: 200,
                  lvl: 10,
                  gp: 42.567,
                  class: "rogue",
                },
              },
            }),
          } as Response;
        }

        return { ok: true, json: async () => ({ success: true, data: [] }) } as Response;
      });

      const dashboard = await fetchDashboard(auth);

      expect(dashboard.summary.totalDailies).toBe(2);
      expect(dashboard.summary.completedDailies).toBe(1);
      expect(dashboard.summary.overdueDailies).toBe(1);
      expect(dashboard.overdueDailies).toHaveLength(1);
      expect(dashboard.overdueDailies[0]!.text).toBe("Daily 1");

      expect(dashboard.summary.totalTodos).toBe(2);
      expect(dashboard.summary.incompleteTodos).toBe(1);
      expect(dashboard.incompleteTodos).toHaveLength(1);

      expect(dashboard.habits).toHaveLength(1);

      expect(dashboard.stats.hp).toBe("45/50");
      expect(dashboard.stats.gold).toBe(42.57);
      expect(dashboard.stats.class).toBe("rogue");

      expect(callCount).toBe(4);
    });
  });
});
