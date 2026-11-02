// "Did the app open?" check for the iOS Naver button. The `nmap://` link either opens the app (this page goes
// hidden) or does nothing; if the page is still visible `ms` later, `go()` opens the web page instead.
// Pure: timers and page-visibility are injected so it runs in Node tests.
//
// Only one check is pending at a time: tapping the button again while one is waiting does not start another
// (two timers would open the web page twice), and a page that went hidden cancels the check for good, so the
// user returning from the Naver app is not pulled to a web page.
export function createFallbackGuard({ ms = 1500, setTimer = setTimeout, clearTimer = clearTimeout, isHidden, watchHide }) {
  let finishPending = null;

  return {
    isPending: () => finishPending !== null,
    /** -> true when a new check was started, false when one is already waiting. */
    arm(go) {
      if (finishPending) return false;
      let unwatch = () => {};
      let timer;
      const finish = () => {
        clearTimer(timer);
        unwatch();
        finishPending = null;
      };
      finishPending = finish;
      timer = setTimer(() => {
        const stillVisible = !isHidden();
        finish();
        if (stillVisible) go();
      }, ms);
      unwatch = watchHide(finish) ?? (() => {});
      return true;
    },
    cancel() {
      finishPending?.();
    },
  };
}
