/** Public follow-up counters only; never stores a grant, cookie or command. */
export const PW_PAGE_BUDGET_SCRIPT = `
  var BUDGET_KEY = "radar:pw:budget:v1:";
  function unavailableBudget() {
    poll.cacheOK = false;
    poll.stopped = true;
    say("Status follow-up is unavailable. Use the application link.");
    return false;
  }
  function checkpointBudget() {
    if (!poll.cacheOK || poll.intentId === null) return false;
    try {
      window.sessionStorage.setItem(BUDGET_KEY + poll.intentId, JSON.stringify({
        startedAt: poll.startedAt, count: poll.count, manualAt: poll.manualAt,
        nextAt: poll.nextAt, stopped: poll.stopped }));
      return true;
    } catch (err) { return unavailableBudget(); }
  }
  function restoreBudget(intentId) {
    poll.intentId = intentId;
    poll.cacheOK = true;
    try {
      var raw = window.sessionStorage.getItem(BUDGET_KEY + intentId);
      if (raw !== null) {
        var saved = JSON.parse(raw);
        if (!saved || !Number.isSafeInteger(saved.startedAt) || saved.startedAt <= 0 || saved.startedAt > Date.now()
          || !Number.isSafeInteger(saved.count) || saved.count < 0 || saved.count > MAX_POLLS
          || !Number.isSafeInteger(saved.manualAt) || saved.manualAt < 0
          || !Number.isSafeInteger(saved.nextAt) || saved.nextAt < 0
          || typeof saved.stopped !== "boolean") return unavailableBudget();
        poll.startedAt = saved.startedAt;
        poll.count = saved.count;
        poll.manualAt = saved.manualAt;
        poll.nextAt = saved.nextAt;
        poll.restoredLease = saved.nextAt > Date.now();
        poll.stopped = saved.stopped;
      } else {
        poll.startedAt = Date.now(); poll.count = 0;
        poll.manualAt = 0; poll.nextAt = 0; poll.stopped = false; poll.restoredLease = false;
      }
      return checkpointBudget();
    } catch (err) { return unavailableBudget(); }
  }
`;
