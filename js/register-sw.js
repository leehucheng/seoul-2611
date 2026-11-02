// Registers the service worker (../sw.js) so the app opens without a network.
//
// Escape hatch for development: on localhost, `?nosw=1` registers nothing and removes the worker and the seoul-* caches left
// by an earlier visit, so a page always runs the files on disk (the worker serves cached files first).
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** 'register' | 'remove' | 'none' for this address (`loc` = {hostname, search}). */
export function swPlan(loc, supported) {
  if (!supported) return 'none';
  const nosw = new URLSearchParams(loc.search).get('nosw') === '1';
  return nosw && LOCAL_HOSTS.has(loc.hostname) ? 'remove' : 'register';
}

export async function registerServiceWorker({ nav = globalThis.navigator, loc = globalThis.location, cacheStorage = globalThis.caches } = {}) {
  const plan = swPlan(loc, Boolean(nav) && 'serviceWorker' in nav);
  try {
    if (plan === 'register') {
      await nav.serviceWorker.register(new URL('../sw.js', import.meta.url).href); // next to index.html, so its scope is the whole app
    } else if (plan === 'remove') {
      for (const reg of await nav.serviceWorker.getRegistrations()) await reg.unregister();
      for (const name of (await cacheStorage?.keys()) ?? []) if (name.startsWith('seoul-')) await cacheStorage.delete(name);
    }
  } catch (e) {
    console.warn('service worker:', e); // the app works without it; it just needs a network
  }
  return plan;
}
