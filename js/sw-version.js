// Which build of the app this page runs: asks the service worker that controlled the page when it loaded (sw.js answers {type: 'version'}
// with its BUILD). Pure of the DOM; the navigator, the timer and the channel are injectable for tests.
//
// askVersion() -> Promise<string | null>: the BUILD, or null when no worker controls the page (first install, `?nosw=1`, no support), the
// worker did not answer within `ms` (a worker from before this message existed does not), or the answer was not a build. Never rejects.
// Ask once when the page loads: after a new worker has taken over, it would answer with the version the page is NOT running.
export function askVersion({ nav = globalThis.navigator, ms = 2000, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout, channel = () => new MessageChannel() } = {}) {
  const worker = nav?.serviceWorker?.controller;
  if (!worker || typeof worker.postMessage !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => {
    let timer = null;
    const done = (build) => { clearTimeoutFn(timer); resolve(build); };
    timer = setTimeoutFn(() => done(null), ms);
    try {
      const { port1, port2 } = channel();
      port1.onmessage = (event) => {
        const build = event?.data?.type === 'version' ? event.data.build : null;
        done(typeof build === 'string' && build.trim() !== '' ? build.trim() : null);
      };
      worker.postMessage({ type: 'version' }, [port2]);
    } catch {
      done(null);
    }
  });
}
