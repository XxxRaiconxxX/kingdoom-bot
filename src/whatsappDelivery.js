export const NOTIFICATION_CONTEXT_RETRY_DELAY_MS = 5 * 60 * 1000;

export function isTransientWhatsappDeliveryError(error) {
  const message = String(error?.message ?? error).toLowerCase();
  return [
    'execution context was destroyed',
    'most likely because of a navigation',
    'target closed',
    'session closed',
    'protocol error',
    "cannot read properties of undefined (reading 'getchat')",
  ].some((fragment) => message.includes(fragment));
}
