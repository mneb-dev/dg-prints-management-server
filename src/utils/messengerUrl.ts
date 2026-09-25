const FACEBOOK_HOSTS = ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com'];
const MESSENGER_HOSTS = ['messenger.com', 'www.messenger.com'];

/** Hosts a shop Messenger link may point at (before conversion). */
export const MESSENGER_LINK_HOSTS = ['m.me', ...FACEBOOK_HOSTS, ...MESSENGER_HOSTS];

// First path segments on facebook.com that aren't a Page/username.
const RESERVED_FACEBOOK_PATHS = new Set(['pages', 'groups', 'events', 'watch', 'marketplace', 'share', 'sharer', 'login']);

/**
 * Turns a Facebook Page link into its m.me link, which opens a Messenger chat with the Page
 * (a plain Page link just shows the Page and ignores the shop's `?text=` message):
 * - facebook.com/profile.php?id=123   → m.me/123
 * - facebook.com/people/Name/123      → m.me/123
 * - facebook.com/dgprints             → m.me/dgprints
 * - messenger.com/t/dgprints          → m.me/dgprints
 * Anything else (including '' and links already on m.me) is returned unchanged.
 */
export function toMessengerUrl(link: string): string {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return link;
  }
  const segments = url.pathname.split('/').filter(Boolean);
  let target: string | undefined;

  if (FACEBOOK_HOSTS.includes(url.hostname)) {
    if (segments[0] === 'profile.php') target = url.searchParams.get('id') ?? undefined;
    else if (segments[0] === 'people' && segments[2]) target = segments[2];
    else if (segments.length === 1 && !RESERVED_FACEBOOK_PATHS.has(segments[0])) target = segments[0];
  } else if (MESSENGER_HOSTS.includes(url.hostname) && segments[0] === 't' && segments[1]) {
    target = segments[1];
  }

  return target && /^[\w.-]+$/.test(target) ? `https://m.me/${target}` : link;
}
