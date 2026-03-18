import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { buildAccountScopedAllowlistConfigEditor } from "openclaw/plugin-sdk/allowlist-config-edit";
import {
  buildChannelConfigSchema,
  createActionGate,
  createWhatsAppOutboundBase,
  DEFAULT_ACCOUNT_ID,
  formatWhatsAppConfigAllowFromEntries,
  listWhatsAppDirectoryGroupsFromConfig,
  listWhatsAppDirectoryPeersFromConfig,
  readStringParam,
  resolveWhatsAppGroupIntroHint,
  resolveWhatsAppGroupRequireMention,
  resolveWhatsAppGroupToolPolicy,
  resolveWhatsAppOutboundTarget,
  resolveWhatsAppHeartbeatRecipients,
  resolveWhatsAppMentionStripRegexes,
  WhatsAppConfigSchema,
  type ChannelMessageActionName,
  type ChannelPlugin,
} from "openclaw/plugin-sdk/whatsapp";
import { isWhatsAppGroupJid, normalizeWhatsAppTarget } from "openclaw/plugin-sdk/whatsapp";
// WhatsApp-specific imports from local extension code (moved from src/web/ and src/channels/plugins/)
import { resolveWhatsAppAccount, type ResolvedWhatsAppAccount } from "./accounts.js";
import {
  openArchiveDb,
  pruneOldMessages,
  archiveInboundMessage,
  archiveOutboundMessage,
  createWhatsAppArchiveTool,
} from "./archive/index.js";
import { persistAudioFile } from "./archive/media-persist.js";
import { looksLikeWhatsAppTargetId, normalizeWhatsAppMessagingTarget } from "./normalize.js";
import { getWhatsAppRuntime } from "./runtime.js";
import { whatsappSetupAdapter } from "./setup-core.js";
import {
  createWhatsAppPluginBase,
  loadWhatsAppChannelRuntime,
  whatsappSetupWizardProxy,
  WHATSAPP_CHANNEL,
} from "./shared.js";
import { collectWhatsAppStatusIssues } from "./status-issues.js";

function normalizeWhatsAppPayloadText(text: string | undefined): string {
  return (text ?? "").replace(/^(?:[ \t]*\r?\n)+/, "");
}

function parseWhatsAppExplicitTarget(raw: string) {
  const normalized = normalizeWhatsAppTarget(raw);
  if (!normalized) {
    return null;
  }
  return {
    to: normalized,
    chatType: isWhatsAppGroupJid(normalized) ? ("group" as const) : ("direct" as const),
  };
}

let archiveDb: DatabaseSync | null = null;

export const whatsappPlugin: ChannelPlugin<ResolvedWhatsAppAccount> = {
  ...createWhatsAppPluginBase({
    configSchema: buildChannelConfigSchema(WhatsAppConfigSchema),
    groups: {
      resolveRequireMention: resolveWhatsAppGroupRequireMention,
      resolveToolPolicy: resolveWhatsAppGroupToolPolicy,
      resolveGroupIntroHint: resolveWhatsAppGroupIntroHint,
    },
    setupWizard: whatsappSetupWizardProxy,
    setup: whatsappSetupAdapter,
    isConfigured: async (account) =>
      await getWhatsAppRuntime().channel.whatsapp.webAuthExists(account.authDir),
  }),
  agentTools: () => {
    const tools = [getWhatsAppRuntime().channel.whatsapp.createLoginTool()];
    if (archiveDb) {
      tools.push(createWhatsAppArchiveTool(archiveDb));
    }
    return tools;
  },
  pairing: {
    idLabel: "whatsappSenderId",
  },
  allowlist: {
    supportsScope: ({ scope }) => scope === "dm" || scope === "group" || scope === "all",
    readConfig: ({ cfg, accountId }) => {
      const account = resolveWhatsAppAccount({ cfg, accountId });
      return {
        dmAllowFrom: (account.allowFrom ?? []).map(String),
        groupAllowFrom: (account.groupAllowFrom ?? []).map(String),
        dmPolicy: account.dmPolicy,
        groupPolicy: account.groupPolicy,
      };
    },
    applyConfigEdit: buildAccountScopedAllowlistConfigEditor({
      channelId: "whatsapp",
      normalize: ({ values }) => formatWhatsAppConfigAllowFromEntries(values),
      resolvePaths: (scope) => ({
        readPaths: [[scope === "dm" ? "allowFrom" : "groupAllowFrom"]],
        writePath: [scope === "dm" ? "allowFrom" : "groupAllowFrom"],
      }),
    }),
  },
  mentions: {
    stripRegexes: ({ ctx }) => resolveWhatsAppMentionStripRegexes(ctx),
  },
  commands: {
    enforceOwnerForCommands: true,
    skipWhenConfigEmpty: true,
  },
  messaging: {
    normalizeTarget: normalizeWhatsAppMessagingTarget,
    parseExplicitTarget: ({ raw }) => parseWhatsAppExplicitTarget(raw),
    inferTargetChatType: ({ to }) => parseWhatsAppExplicitTarget(to)?.chatType,
    targetResolver: {
      looksLikeId: looksLikeWhatsAppTargetId,
      hint: "<E.164|group JID>",
    },
  },
  directory: {
    self: async ({ cfg, accountId }) => {
      const account = resolveWhatsAppAccount({ cfg, accountId });
      const { e164, jid } = (await loadWhatsAppChannelRuntime()).readWebSelfId(account.authDir);
      const id = e164 ?? jid;
      if (!id) {
        return null;
      }
      return {
        kind: "user",
        id,
        name: account.name,
        raw: { e164, jid },
      };
    },
    listPeers: async (params) => listWhatsAppDirectoryPeersFromConfig(params),
    listGroups: async (params) => listWhatsAppDirectoryGroupsFromConfig(params),
  },
  actions: {
    listActions: ({ cfg }) => {
      if (!cfg.channels?.whatsapp) {
        return [];
      }
      const gate = createActionGate(cfg.channels.whatsapp.actions);
      const actions = new Set<ChannelMessageActionName>();
      if (gate("reactions")) {
        actions.add("react");
      }
      if (gate("polls")) {
        actions.add("poll");
      }
      return Array.from(actions);
    },
    supportsAction: ({ action }) => action === "react",
    handleAction: async ({ action, params, cfg, accountId }) => {
      if (action !== "react") {
        throw new Error(`Action ${action} is not supported for provider ${WHATSAPP_CHANNEL}.`);
      }
      const messageId = readStringParam(params, "messageId", {
        required: true,
      });
      const emoji = readStringParam(params, "emoji", { allowEmpty: true });
      const remove = typeof params.remove === "boolean" ? params.remove : undefined;
      return await getWhatsAppRuntime().channel.whatsapp.handleWhatsAppAction(
        {
          action: "react",
          chatJid:
            readStringParam(params, "chatJid") ?? readStringParam(params, "to", { required: true }),
          messageId,
          emoji,
          remove,
          participant: readStringParam(params, "participant"),
          accountId: accountId ?? undefined,
          fromMe: typeof params.fromMe === "boolean" ? params.fromMe : undefined,
        },
        cfg,
      );
    },
  },
  outbound: {
    ...createWhatsAppOutboundBase({
      chunker: (text, limit) => getWhatsAppRuntime().channel.text.chunkText(text, limit),
      sendMessageWhatsApp: async (...args) =>
        await getWhatsAppRuntime().channel.whatsapp.sendMessageWhatsApp(...args),
      sendPollWhatsApp: async (...args) =>
        await getWhatsAppRuntime().channel.whatsapp.sendPollWhatsApp(...args),
      shouldLogVerbose: () => getWhatsAppRuntime().logging.shouldLogVerbose(),
      resolveTarget: ({ to, allowFrom, mode }) =>
        resolveWhatsAppOutboundTarget({ to, allowFrom, mode }),
    }),
    normalizePayload: ({ payload }) => ({
      ...payload,
      text: normalizeWhatsAppPayloadText(payload.text),
    }),
  },
  auth: {
    login: async ({ cfg, accountId, runtime, verbose }) => {
      const resolvedAccountId =
        accountId?.trim() || whatsappPlugin.config.defaultAccountId?.(cfg) || DEFAULT_ACCOUNT_ID;
      await (
        await loadWhatsAppChannelRuntime()
      ).loginWeb(Boolean(verbose), undefined, runtime, resolvedAccountId);
    },
  },
  heartbeat: {
    checkReady: async ({ cfg, accountId, deps }) => {
      if (cfg.web?.enabled === false) {
        return { ok: false, reason: "whatsapp-disabled" };
      }
      const account = resolveWhatsAppAccount({ cfg, accountId });
      const authExists = await (
        deps?.webAuthExists ?? (await loadWhatsAppChannelRuntime()).webAuthExists
      )(account.authDir);
      if (!authExists) {
        return { ok: false, reason: "whatsapp-not-linked" };
      }
      const listenerActive = deps?.hasActiveWebListener
        ? deps.hasActiveWebListener()
        : Boolean((await loadWhatsAppChannelRuntime()).getActiveWebListener());
      if (!listenerActive) {
        return { ok: false, reason: "whatsapp-not-running" };
      }
      return { ok: true, reason: "ok" };
    },
    resolveRecipients: ({ cfg, opts }) => resolveWhatsAppHeartbeatRecipients(cfg, opts),
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      connected: false,
      reconnectAttempts: 0,
      lastConnectedAt: null,
      lastDisconnect: null,
      lastMessageAt: null,
      lastEventAt: null,
      lastError: null,
    },
    collectStatusIssues: collectWhatsAppStatusIssues,
    buildChannelSummary: async ({ account, snapshot }) => {
      const authDir = account.authDir;
      const linked =
        typeof snapshot.linked === "boolean"
          ? snapshot.linked
          : authDir
            ? await (await loadWhatsAppChannelRuntime()).webAuthExists(authDir)
            : false;
      const authAgeMs =
        linked && authDir ? (await loadWhatsAppChannelRuntime()).getWebAuthAgeMs(authDir) : null;
      const self =
        linked && authDir
          ? (await loadWhatsAppChannelRuntime()).readWebSelfId(authDir)
          : { e164: null, jid: null };
      return {
        configured: linked,
        linked,
        authAgeMs,
        self,
        running: snapshot.running ?? false,
        connected: snapshot.connected ?? false,
        lastConnectedAt: snapshot.lastConnectedAt ?? null,
        lastDisconnect: snapshot.lastDisconnect ?? null,
        reconnectAttempts: snapshot.reconnectAttempts,
        lastMessageAt: snapshot.lastMessageAt ?? null,
        lastEventAt: snapshot.lastEventAt ?? null,
        lastError: snapshot.lastError ?? null,
      };
    },
    buildAccountSnapshot: async ({ account, runtime }) => {
      const linked = await (await loadWhatsAppChannelRuntime()).webAuthExists(account.authDir);
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: true,
        linked,
        running: runtime?.running ?? false,
        connected: runtime?.connected ?? false,
        reconnectAttempts: runtime?.reconnectAttempts,
        lastConnectedAt: runtime?.lastConnectedAt ?? null,
        lastDisconnect: runtime?.lastDisconnect ?? null,
        lastMessageAt: runtime?.lastMessageAt ?? null,
        lastEventAt: runtime?.lastEventAt ?? null,
        lastError: runtime?.lastError ?? null,
        dmPolicy: account.dmPolicy,
        allowFrom: account.allowFrom,
      };
    },
    resolveAccountState: ({ configured }) => (configured ? "linked" : "not linked"),
    logSelfId: ({ account, runtime, includeChannelPrefix }) => {
      void loadWhatsAppChannelRuntime().then((runtimeExports) =>
        runtimeExports.logWebSelfId(account.authDir, runtime, includeChannelPrefix),
      );
    },
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      const { e164, jid } = (await loadWhatsAppChannelRuntime()).readWebSelfId(account.authDir);
      const identity = e164 ? e164 : jid ? `jid ${jid}` : "unknown";
      ctx.log?.info(`[${account.accountId}] starting provider (${identity})`);

      type ArchiveCfg = {
        enabled?: boolean;
        path?: string;
        retentionDays?: number;
        persistAudio?: boolean;
      };
      const whatsappCfg = ctx.cfg?.channels?.whatsapp as
        | { accounts?: Record<string, { archive?: ArchiveCfg }>; archive?: ArchiveCfg }
        | undefined;
      const archiveCfg: ArchiveCfg | undefined =
        whatsappCfg?.accounts?.[account.accountId]?.archive ?? whatsappCfg?.archive;

      let onRawMessage:
        | ((raw: import("@whiskeysockets/baileys").proto.IWebMessageInfo, acctId: string) => void)
        | undefined;

      if (archiveCfg?.enabled) {
        const { resolveStateDir } = await import("openclaw/plugin-sdk/state-paths");
        const defaultDbPath = path.join(resolveStateDir(), "whatsapp", "archive.sqlite");
        const dbPath = archiveCfg.path ?? defaultDbPath;
        archiveDb = openArchiveDb(dbPath);
        ctx.log?.info(`[${account.accountId}] WhatsApp archive enabled at ${dbPath}`);

        const retentionDays = archiveCfg.retentionDays ?? 90;
        if (retentionDays > 0) {
          const audioDir = path.join(path.dirname(dbPath), "audio");
          const pruned = pruneOldMessages(archiveDb, retentionDays, audioDir);
          if (pruned > 0) {
            ctx.log?.info(
              `[${account.accountId}] Pruned ${pruned} archived messages older than ${retentionDays} days`,
            );
          }
        }

        const db = archiveDb;
        const shouldPersistAudio = archiveCfg.persistAudio !== false;
        const audioDir = shouldPersistAudio ? path.join(path.dirname(dbPath), "audio") : undefined;

        onRawMessage = (raw, acctId) => {
          try {
            archiveInboundMessage(db, raw, acctId);
          } catch (err) {
            ctx.log?.warn?.(`Archive inbound error: ${String(err)}`);
          }
        };

        if (shouldPersistAudio) {
          const { registerInternalHook: registerTranscribeHook } =
            await import("openclaw/plugin-sdk/hook-runtime");
          registerTranscribeHook("message:transcribed", (event) => {
            const tCtx = event.context as {
              channelId?: string;
              mediaPath?: string;
              messageId?: string;
              mediaType?: string;
            };
            if (
              tCtx.channelId !== "whatsapp" ||
              !tCtx.mediaPath ||
              !tCtx.mediaType?.startsWith("audio/")
            )
              return;
            try {
              const msgId = tCtx.messageId ?? `audio_${Date.now()}`;
              const destPath = persistAudioFile(tCtx.mediaPath, audioDir!, msgId);
              if (destPath && tCtx.messageId) {
                db.prepare("UPDATE whatsapp_messages SET media_path = ? WHERE message_id = ?").run(
                  destPath,
                  tCtx.messageId,
                );
              }
            } catch {
              // best-effort audio persistence
            }
          });
        }

        const { registerInternalHook } = await import("openclaw/plugin-sdk/hook-runtime");
        registerInternalHook("message:sent", (event) => {
          const hookCtx = event.context as {
            channelId?: string;
            to?: string;
            content?: string;
            accountId?: string;
            messageId?: string;
            isGroup?: boolean;
            groupId?: string;
            success?: boolean;
          };
          if (hookCtx.channelId !== "whatsapp" || !hookCtx.success) return;
          try {
            archiveOutboundMessage(db, {
              to: hookCtx.to ?? "",
              content: hookCtx.content ?? "",
              channelId: "whatsapp",
              accountId: hookCtx.accountId,
              messageId: hookCtx.messageId,
              isGroup: hookCtx.isGroup,
              groupId: hookCtx.groupId,
            });
          } catch (err) {
            ctx.log?.warn?.(`Archive outbound error: ${String(err)}`);
          }
        });

        // Schedule periodic pruning (every 24h)
        const retDays = archiveCfg.retentionDays ?? 90;
        if (retDays > 0) {
          const pruneInterval = setInterval(
            () => {
              try {
                const audioPruneDir = path.join(path.dirname(dbPath), "audio");
                pruneOldMessages(db, retDays, audioPruneDir);
              } catch {
                // best-effort
              }
            },
            24 * 60 * 60 * 1000,
          );
          pruneInterval.unref();
          ctx.abortSignal?.addEventListener("abort", () => clearInterval(pruneInterval), {
            once: true,
          });
        }
      } else {
        ctx.log?.info(
          `[${account.accountId}] WhatsApp archive is disabled. Set channels.whatsapp.accounts.${account.accountId}.archive.enabled = true to archive messages.`,
        );
      }

      return (await loadWhatsAppChannelRuntime()).monitorWebChannel(
        getWhatsAppRuntime().logging.shouldLogVerbose(),
        undefined,
        true,
        undefined,
        ctx.runtime,
        ctx.abortSignal,
        {
          statusSink: (next) => ctx.setStatus({ accountId: ctx.accountId, ...next }),
          accountId: account.accountId,
          onRawMessage,
        },
      );
    },
    loginWithQrStart: async ({ accountId, force, timeoutMs, verbose }) =>
      await (
        await loadWhatsAppChannelRuntime()
      ).startWebLoginWithQr({
        accountId,
        force,
        timeoutMs,
        verbose,
      }),
    loginWithQrWait: async ({ accountId, timeoutMs }) =>
      await (await loadWhatsAppChannelRuntime()).waitForWebLogin({ accountId, timeoutMs }),
    logoutAccount: async ({ account, runtime }) => {
      const cleared = await (
        await loadWhatsAppChannelRuntime()
      ).logoutWeb({
        authDir: account.authDir,
        isLegacyAuthDir: account.isLegacyAuthDir,
        runtime,
      });
      return { cleared, loggedOut: cleared };
    },
  },
};
