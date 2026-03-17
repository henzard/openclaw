import type { DatabaseSync } from "node:sqlite";
import { Type } from "@sinclair/typebox";
import type { ChannelAgentTool } from "openclaw/plugin-sdk/channel-runtime";
import { getMessageSummary, getRecentMessages, searchMessages } from "./reader.js";

export function createWhatsAppArchiveTool(db: DatabaseSync): ChannelAgentTool {
  return {
    label: "WhatsApp Archive",
    name: "whatsapp_archive",
    ownerOnly: true,
    description:
      "Query the WhatsApp message archive. Use 'search' to find messages by date/sender/group/text, 'summary' for aggregate counts and activity overview, or 'recent' for the latest messages.",
    parameters: Type.Object({
      action: Type.Unsafe<"search" | "summary" | "recent">({
        type: "string",
        enum: ["search", "summary", "recent"],
      }),
      date_from: Type.Optional(
        Type.String({ description: "Start date (ISO 8601, e.g. 2025-03-17)" }),
      ),
      date_to: Type.Optional(
        Type.String({ description: "End date (ISO 8601, e.g. 2025-03-17T23:59:59)" }),
      ),
      sender: Type.Optional(
        Type.String({ description: "Filter by sender phone number or name" }),
      ),
      group: Type.Optional(
        Type.String({ description: "Filter by group JID or subject" }),
      ),
      query: Type.Optional(
        Type.String({ description: "Text search across message bodies" }),
      ),
      limit: Type.Optional(
        Type.Number({ description: "Max results (default 50, max 200)" }),
      ),
    }),
    execute: async (_toolCallId, args) => {
      const params = args as {
        action?: string;
        date_from?: string;
        date_to?: string;
        sender?: string;
        group?: string;
        query?: string;
        limit?: number;
      };

      const action = params.action ?? "recent";

      if (action === "summary") {
        const dateFrom = params.date_from ?? todayStart();
        const dateTo = params.date_to ?? new Date().toISOString();
        const summary = getMessageSummary(db, dateFrom, dateTo);
        return {
          content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
          details: summary,
        };
      }

      if (action === "search") {
        const messages = searchMessages(db, {
          dateFrom: params.date_from,
          dateTo: params.date_to,
          sender: params.sender,
          group: params.group,
          query: params.query,
          limit: params.limit,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ count: messages.length, messages }, null, 2),
            },
          ],
          details: { count: messages.length, messages },
        };
      }

      // action === "recent"
      const messages = getRecentMessages(db, params.limit ?? 50);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ count: messages.length, messages }, null, 2),
          },
        ],
        details: { count: messages.length, messages },
      };
    },
  };
}

function todayStart(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}
