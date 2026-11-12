// Listing IDs is inexpensive compared with fetching every message's headers.
// Collect all pages first so the starting count covers the whole search result.
export async function discover(gmail, request, sender, savePage = () => {}) {
  const ids = new Set();
  const patterns = Array.isArray(sender) ? sender : [sender];
  // Gmail does not implement these glob semantics. Wildcards require a full
  // mailbox candidate scan so search cannot silently omit valid matches.
  const queries = patterns.some(pattern => pattern.includes('*'))
    ? ['in:anywhere -in:trash -in:drafts']
    : patterns.map(pattern => `in:anywhere -in:trash -in:drafts from:"${pattern}"`);
  for (const query of queries) {
  const pages = new Set();
  let pageToken;
  do {
    const { data } = await request(5, () => gmail.users.messages.list({
      userId: 'me',
      q: query,
      includeSpamTrash: true,
      maxResults: 500,
      pageToken,
    }));
    const pageIds = (data.messages || []).map(message => message.id);
    savePage(pageIds);
    for (const id of pageIds) ids.add(id);
    pageToken = data.nextPageToken;
    if (pageToken && pages.has(pageToken)) throw new Error('Gmail repeated a page token. Rerun the scan.');
    if (pageToken) pages.add(pageToken);
  } while (pageToken);
  }
  return ids;
}
