import { definePluginEntry, type AnyAgentTool } from "openclaw/plugin-sdk/core";
import { createHabiticaTool } from "./src/tool.js";

export default definePluginEntry({
  id: "habitica",
  name: "Habitica Plugin",
  description: "Habitica dashboard and task management agent tool",
  register(api) {
    const userId = process.env.HABITICA_USER_ID?.trim();
    const apiKey = process.env.HABITICA_API_KEY?.trim();

    if (!userId || !apiKey) {
      api.logger.warn?.(
        "Habitica tool disabled: HABITICA_USER_ID and HABITICA_API_KEY env vars are required. Get them from Habitica Settings > API.",
      );
      return;
    }

    api.registerTool(createHabiticaTool({ userId, apiKey }) as AnyAgentTool);
  },
});
