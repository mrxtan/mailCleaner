import addressparser from 'nodemailer/lib/addressparser/index.js';

// Search narrows candidates. The parsed From header decides the exact match.
// Multiple senders, groups, drafts and already-trashed messages are skipped.
export function matchesSender(message, sender) {
  if (message.labelIds?.some(label => ['TRASH', 'DRAFT'].includes(label))) return false;
  const from = (message.payload?.headers || []).filter(header => header.name.toLowerCase() === 'from');
  if (from.length !== 1 || typeof from[0].value !== 'string') return false;
  const addresses = addressparser(from[0].value);
  if (addresses.length !== 1 || !addresses[0].address) return false;
  const address = addresses[0].address.toLowerCase();
  return Array.isArray(sender) ? sender.some(pattern => pattern.test(address)) : address === sender;
}
