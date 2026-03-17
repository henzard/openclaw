import type { DatabaseSync } from "node:sqlite";

export interface ArchiveSearchFilters {
  dateFrom?: string;
  dateTo?: string;
  sender?: string;
  group?: string;
  query?: string;
  direction?: "inbound" | "outbound";
  limit?: number;
}

export interface ArchivedMessage {
  id: number;
  message_id: string | null;
  direction: string;
  sender: string | null;
  recipient: string | null;
  body: string | null;
  media_type: string | null;
  media_path: string | null;
  is_group: number;
  group_id: string | null;
  group_subject: string | null;
  timestamp: number;
  account_id: string | null;
}

export function searchMessages(db: DatabaseSync, filters: ArchiveSearchFilters): ArchivedMessage[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.dateFrom) {
    conditions.push("timestamp >= ?");
    params.push(new Date(filters.dateFrom).getTime());
  }
  if (filters.dateTo) {
    conditions.push("timestamp <= ?");
    params.push(new Date(filters.dateTo).getTime());
  }
  if (filters.sender) {
    conditions.push("sender LIKE ?");
    params.push(`%${filters.sender}%`);
  }
  if (filters.group) {
    conditions.push("(group_id LIKE ? OR group_subject LIKE ?)");
    params.push(`%${filters.group}%`, `%${filters.group}%`);
  }
  if (filters.query) {
    conditions.push("body LIKE ?");
    params.push(`%${filters.query}%`);
  }
  if (filters.direction) {
    conditions.push("direction = ?");
    params.push(filters.direction);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(filters.limit ?? 50, 200);

  return db
    .prepare(
      `SELECT id, message_id, direction, sender, recipient, body, media_type, media_path,
              is_group, group_id, group_subject, timestamp, account_id
       FROM whatsapp_messages ${where}
       ORDER BY timestamp DESC LIMIT ?`,
    )
    .all(...params, limit) as ArchivedMessage[];
}

export interface MessageSummary {
  totalMessages: number;
  inbound: number;
  outbound: number;
  bySender: Array<{ sender: string; count: number }>;
  byGroup: Array<{ group_id: string; group_subject: string | null; count: number }>;
}

export function getMessageSummary(
  db: DatabaseSync,
  dateFrom?: string,
  dateTo?: string,
): MessageSummary {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (dateFrom) {
    conditions.push("timestamp >= ?");
    params.push(new Date(dateFrom).getTime());
  }
  if (dateTo) {
    conditions.push("timestamp <= ?");
    params.push(new Date(dateTo).getTime());
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const totalRow = db
    .prepare(`SELECT COUNT(*) as count FROM whatsapp_messages ${where}`)
    .get(...params) as { count: number };

  const inboundRow = db
    .prepare(
      `SELECT COUNT(*) as count FROM whatsapp_messages ${where ? where + " AND" : "WHERE"} direction = 'inbound'`,
    )
    .get(...params) as { count: number };

  const outboundRow = db
    .prepare(
      `SELECT COUNT(*) as count FROM whatsapp_messages ${where ? where + " AND" : "WHERE"} direction = 'outbound'`,
    )
    .get(...params) as { count: number };

  const bySender = db
    .prepare(
      `SELECT sender, COUNT(*) as count FROM whatsapp_messages
       ${where ? where + " AND" : "WHERE"} sender IS NOT NULL
       GROUP BY sender ORDER BY count DESC LIMIT 20`,
    )
    .all(...params) as Array<{ sender: string; count: number }>;

  const byGroup = db
    .prepare(
      `SELECT group_id, group_subject, COUNT(*) as count FROM whatsapp_messages
       ${where ? where + " AND" : "WHERE"} is_group = 1
       GROUP BY group_id ORDER BY count DESC LIMIT 20`,
    )
    .all(...params) as Array<{ group_id: string; group_subject: string | null; count: number }>;

  return {
    totalMessages: totalRow.count,
    inbound: inboundRow.count,
    outbound: outboundRow.count,
    bySender,
    byGroup,
  };
}

export function getRecentMessages(db: DatabaseSync, limit = 20): ArchivedMessage[] {
  return db
    .prepare(
      `SELECT id, message_id, direction, sender, recipient, body, media_type, media_path,
              is_group, group_id, group_subject, timestamp, account_id
       FROM whatsapp_messages ORDER BY timestamp DESC LIMIT ?`,
    )
    .all(Math.min(limit, 200)) as ArchivedMessage[];
}
