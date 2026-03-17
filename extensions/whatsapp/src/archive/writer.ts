import type { DatabaseSync } from "node:sqlite";
import type { proto } from "@whiskeysockets/baileys";

export function archiveInboundMessage(
  db: DatabaseSync,
  raw: proto.IWebMessageInfo,
  accountId: string,
): void {
  const key = raw.key;
  if (!key) return;

  const messageId = key.id ?? null;
  const remoteJid = key.remoteJid ?? null;
  const isGroup = remoteJid?.endsWith("@g.us") ? 1 : 0;
  const sender = isGroup
    ? (key.participant ?? null)
    : key.fromMe
      ? "me"
      : (remoteJid ?? null);
  const recipient = key.fromMe ? (remoteJid ?? null) : "me";

  const msg = raw.message;
  const body =
    msg?.conversation ??
    msg?.extendedTextMessage?.text ??
    msg?.imageMessage?.caption ??
    msg?.videoMessage?.caption ??
    msg?.documentMessage?.caption ??
    null;

  const mediaType =
    msg?.audioMessage?.mimetype ??
    msg?.imageMessage?.mimetype ??
    msg?.videoMessage?.mimetype ??
    msg?.documentMessage?.mimetype ??
    null;

  const timestampRaw = raw.messageTimestamp;
  const timestamp =
    typeof timestampRaw === "number"
      ? timestampRaw * 1000
      : typeof timestampRaw === "object" && timestampRaw !== null && "low" in timestampRaw
        ? Number(timestampRaw.low) * 1000
        : Date.now();

  let rawJson: string | null = null;
  try {
    rawJson = JSON.stringify(raw);
  } catch {
    // non-serializable edge case
  }

  db.prepare(
    `INSERT OR IGNORE INTO whatsapp_messages
      (message_id, direction, sender, recipient, body, media_type, is_group, group_id, group_subject, timestamp, account_id, raw_json)
     VALUES (?, 'inbound', ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
  ).run(
    messageId,
    sender,
    recipient,
    body,
    mediaType,
    isGroup,
    isGroup ? remoteJid : null,
    timestamp,
    accountId,
    rawJson,
  );
}

export interface OutboundMessageContext {
  to: string;
  content: string;
  channelId: string;
  accountId?: string;
  messageId?: string;
  isGroup?: boolean;
  groupId?: string;
}

export function archiveOutboundMessage(db: DatabaseSync, ctx: OutboundMessageContext): void {
  const messageId = ctx.messageId ?? `out_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const isGroup = ctx.isGroup ? 1 : 0;

  db.prepare(
    `INSERT OR IGNORE INTO whatsapp_messages
      (message_id, direction, sender, recipient, body, is_group, group_id, timestamp, account_id)
     VALUES (?, 'outbound', 'me', ?, ?, ?, ?, ?, ?)`,
  ).run(
    messageId,
    ctx.to,
    ctx.content,
    isGroup,
    ctx.groupId ?? null,
    Date.now(),
    ctx.accountId ?? null,
  );
}
