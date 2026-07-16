export const WHATSAPP_HEALTH_STATE = Object.freeze({
  BOOTING: 'BOOTING',
  CONNECTING: 'CONNECTING',
  WAITING_QR: 'WAITING_QR',
  AUTHENTICATING: 'AUTHENTICATING',
  CONNECTED_UNVERIFIED: 'CONNECTED_UNVERIFIED',
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  QUARANTINED: 'QUARANTINED',
  STOPPED: 'STOPPED',
});

const PAGE_BINDING_NAME = 'onKingdoomPageInboundSignal';
const PAGE_MONITOR_KEY = '__kingdoomInboundMonitor';
const INTERNAL_MESSAGE_TYPES = ['e2e_notification', 'gp2'];

function toIso(value) {
  return Number.isFinite(value) ? new Date(value).toISOString() : null;
}

function toTimestamp(value) {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function createWhatsappHealthTracker({
  now = () => Date.now(),
  stabilityWindowMs = 60_000,
  requiredProbeSuccesses = 3,
  failureLimit = 3,
  initialTelemetry = {},
} = {}) {
  let state = WHATSAPP_HEALTH_STATE.BOOTING;
  let reason = 'startup';
  let confidence = 'none';
  let socketState = null;
  let connectedAt = null;
  let healthySince = null;
  let lastProbeAt = null;
  let lastProbeError = '';
  let lastInboundAt = toTimestamp(initialTelemetry.lastInboundAt);
  let lastSuccessfulReplyAt = toTimestamp(initialTelemetry.lastSuccessfulReplyAt);
  let lastOutboundAt = toTimestamp(initialTelemetry.lastOutboundAt);
  let lastOutboundAckAt = toTimestamp(initialTelemetry.lastOutboundAckAt);
  let consecutiveProbeSuccesses = 0;
  let consecutiveProbeFailures = 0;

  function snapshot() {
    return {
      state,
      reason,
      confidence,
      socketState,
      connectedAt: toIso(connectedAt),
      healthySince: toIso(healthySince),
      lastProbeAt: toIso(lastProbeAt),
      lastProbeError: lastProbeError || null,
      lastInboundAt: toIso(lastInboundAt),
      lastSuccessfulReplyAt: toIso(lastSuccessfulReplyAt),
      lastOutboundAt: toIso(lastOutboundAt),
      lastOutboundAckAt: toIso(lastOutboundAckAt),
      consecutiveProbeSuccesses,
      consecutiveProbeFailures,
      requiredProbeSuccesses,
      failureLimit,
      stabilityWindowMs,
    };
  }

  function markUnavailable(nextState, nextReason, nextSocketState = null) {
    state = nextState;
    reason = nextReason;
    confidence = 'none';
    socketState = nextSocketState;
    connectedAt = null;
    healthySince = null;
    consecutiveProbeSuccesses = 0;
    consecutiveProbeFailures = 0;
    lastProbeError = '';
    return snapshot();
  }

  function markConnected(nextReason = 'ready') {
    const at = now();
    socketState = 'CONNECTED';
    connectedAt ??= at;
    if (state !== WHATSAPP_HEALTH_STATE.HEALTHY) {
      state = WHATSAPP_HEALTH_STATE.CONNECTED_UNVERIFIED;
      healthySince = null;
      confidence = 'socket';
    }
    reason = nextReason;
    consecutiveProbeSuccesses = 0;
    consecutiveProbeFailures = 0;
    lastProbeError = '';
    return snapshot();
  }

  function recordProbe({ ok, socketState: nextSocketState, reason: nextReason = '', error = '' }) {
    const at = now();
    lastProbeAt = at;
    socketState = nextSocketState || socketState || 'UNKNOWN';

    if (!ok) {
      state = WHATSAPP_HEALTH_STATE.DEGRADED;
      reason = nextReason || 'functional_probe_failed';
      confidence = 'none';
      healthySince = null;
      consecutiveProbeSuccesses = 0;
      consecutiveProbeFailures += 1;
      lastProbeError = String(error || nextReason || 'functional probe failed');
      return snapshot();
    }

    connectedAt ??= at;
    consecutiveProbeFailures = 0;
    consecutiveProbeSuccesses += 1;
    lastProbeError = '';
    reason = nextReason || 'functional_probe_ok';
    confidence = 'active_probe';

    if (state !== WHATSAPP_HEALTH_STATE.HEALTHY) {
      state = WHATSAPP_HEALTH_STATE.CONNECTED_UNVERIFIED;
    }

    if (
      consecutiveProbeSuccesses >= requiredProbeSuccesses &&
      at - connectedAt >= stabilityWindowMs
    ) {
      state = WHATSAPP_HEALTH_STATE.HEALTHY;
      healthySince ??= at;
    }

    return snapshot();
  }

  function markInbound() {
    const at = now();
    lastInboundAt = at;
    connectedAt ??= at;
    healthySince ??= at;
    state = WHATSAPP_HEALTH_STATE.HEALTHY;
    reason = 'real_inbound_traffic';
    confidence = 'real_traffic';
    socketState = 'CONNECTED';
    consecutiveProbeSuccesses = Math.max(consecutiveProbeSuccesses, requiredProbeSuccesses);
    consecutiveProbeFailures = 0;
    lastProbeError = '';
    return snapshot();
  }

  function markOutbound() {
    lastOutboundAt = now();
    return snapshot();
  }

  function markReply() {
    lastSuccessfulReplyAt = now();
    return snapshot();
  }

  function markOutboundAck() {
    const at = now();
    lastOutboundAckAt = at;
    lastSuccessfulReplyAt = at;
    return snapshot();
  }

  function markQuarantined(nextReason) {
    state = WHATSAPP_HEALTH_STATE.QUARANTINED;
    reason = nextReason || 'recovery_budget_exhausted';
    confidence = 'none';
    healthySince = null;
    return snapshot();
  }

  return {
    snapshot,
    markUnavailable,
    markConnected,
    recordProbe,
    markInbound,
    markOutbound,
    markReply,
    markOutboundAck,
    markQuarantined,
    isHealthy: () => state === WHATSAPP_HEALTH_STATE.HEALTHY,
    hasReachedFailureLimit: () => consecutiveProbeFailures >= failureLimit,
    hasSustainedHealth: (durationMs) =>
      state === WHATSAPP_HEALTH_STATE.HEALTHY &&
      Number.isFinite(healthySince) &&
      now() - healthySince >= durationMs,
  };
}

async function ensurePageInboundMonitor(page, onPageInboundSignal) {
  const bindingExists = await page.evaluate(
    (bindingName) => typeof window[bindingName] === 'function',
    PAGE_BINDING_NAME
  );

  if (!bindingExists) {
    try {
      await page.exposeFunction(PAGE_BINDING_NAME, onPageInboundSignal);
    } catch (error) {
      if (!/already exists|already registered/i.test(String(error?.message ?? error))) {
        throw error;
      }
    }
  }

  return page.evaluate(
    (bindingName, monitorKey, ignoredTypes) => {
      const socket = window.require?.('WAWebSocketModel')?.Socket;
      const messages = window.require?.('WAWebCollections')?.Msg;
      const bridgeReady = typeof window.onAddMessageEvent === 'function';
      const probeBindingReady = typeof window[bindingName] === 'function';
      const collectionReady = Boolean(messages && typeof messages.on === 'function');

      if (collectionReady && probeBindingReady) {
        const currentMonitor = window[monitorKey];
        if (!currentMonitor || currentMonitor.collection !== messages) {
          if (currentMonitor?.collection && currentMonitor?.listener) {
            currentMonitor.collection.off?.('add', currentMonitor.listener);
          }

          const listener = (message) => {
            if (!message?.isNewMsg) return;
            const signalInbound = (candidate) => {
              const type = String(candidate?.type ?? '').toLowerCase();
              const rawId = candidate?.id;
              const remote = String(rawId?.remote?._serialized ?? rawId?.remote ?? '');
              const messageId = String(rawId?._serialized ?? rawId?.id ?? '');
              if (
                !messageId ||
                rawId?.fromMe ||
                candidate?.isStatusV3 ||
                remote === 'status@broadcast' ||
                ignoredTypes.includes(type) ||
                type === 'revoked'
              ) {
                return;
              }

              Promise.resolve(window[bindingName](messageId)).catch(() => undefined);
            };

            if (String(message.type ?? '').toLowerCase() === 'ciphertext') {
              message.once?.('change:type', signalInbound);
              return;
            }

            signalInbound(message);
          };

          messages.on('add', listener);
          window[monitorKey] = { collection: messages, listener };
        } else {
          // Keep the independent observer attached if WhatsApp reset collection listeners in place.
          messages.off?.('add', currentMonitor.listener);
          messages.on('add', currentMonitor.listener);
        }
      }

      return {
        socketState: String(socket?.state ?? 'UNKNOWN').toUpperCase(),
        wwebjsReady: typeof window.WWebJS !== 'undefined',
        bridgeReady,
        probeBindingReady,
        collectionReady,
        monitorReady: Boolean(window[monitorKey]?.collection === messages),
      };
    },
    PAGE_BINDING_NAME,
    PAGE_MONITOR_KEY,
    INTERNAL_MESSAGE_TYPES
  );
}

function withTimeout(promise, timeoutMs) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`functional probe timeout after ${timeoutMs}ms`)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

export async function probeWhatsappClient(client, {
  timeoutMs = 10_000,
  activePresenceProbe = true,
  activeNetworkProbe = false,
  onPageInboundSignal = () => undefined,
} = {}) {
  try {
    return await withTimeout((async () => {
      if (!client?.info || !client?.pupPage || client.pupPage.isClosed()) {
        return {
          ok: false,
          socketState: 'UNAVAILABLE',
          reason: 'browser_or_client_unavailable',
          error: 'WhatsApp browser or client is unavailable',
        };
      }

      const socketState = String(await client.getState() ?? 'UNKNOWN').trim().toUpperCase();
      const page = await ensurePageInboundMonitor(client.pupPage, onPageInboundSignal);
      const structureReady =
        page.wwebjsReady &&
        page.bridgeReady &&
        page.probeBindingReady &&
        page.collectionReady &&
        page.monitorReady;

      if (socketState !== 'CONNECTED' || page.socketState !== 'CONNECTED' || !structureReady) {
        return {
          ok: false,
          socketState,
          reason: !structureReady ? 'message_bridge_unavailable' : `socket_${socketState.toLowerCase()}`,
          error: !structureReady
            ? 'The WhatsApp message bridge is not fully attached'
            : `WhatsApp socket is ${socketState}`,
          page,
        };
      }

      if (activePresenceProbe) {
        try {
          await client.sendPresenceAvailable();
        } catch {
          // Presence is a keepalive hint; the network query below is the authoritative active probe.
        }
      }
      if (activeNetworkProbe) {
        const ownNumber = String(client.info?.wid?.user ?? '').trim();
        if (!ownNumber) {
          return {
            ok: false,
            socketState,
            reason: 'linked_account_identity_missing',
            error: 'WhatsApp client has no linked account identity',
            page,
          };
        }
        if (!(await client.getNumberId(ownNumber))) {
          return {
            ok: false,
            socketState,
            reason: 'linked_account_not_confirmed',
            error: 'WhatsApp active network query did not confirm the linked account',
            page,
          };
        }
      }

      return {
        ok: true,
        socketState,
        reason: activeNetworkProbe
          ? 'active_network_probe_ok'
          : activePresenceProbe
            ? 'active_presence_probe_ok'
            : 'structural_probe_ok',
        error: '',
        page,
      };
    })(), timeoutMs);
  } catch (error) {
    return {
      ok: false,
      socketState: 'CHECK_ERROR',
      reason: 'functional_probe_error',
      error: String(error?.message ?? error),
    };
  }
}

export function chooseFunctionalRecoveryAction({
  reattachAttempted,
  recoveryAttempts,
  authInvalidated = false,
}) {
  if (!reattachAttempted) return 'reattach';
  if (recoveryAttempts <= 0) return 'restart';
  if (authInvalidated && recoveryAttempts === 1) return 'reset-auth';
  return 'quarantine';
}
