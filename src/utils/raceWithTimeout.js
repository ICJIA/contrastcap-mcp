/**
 * Race a promise against a timer, clearing the timer as soon as either side
 * settles. A leaked timeout pins the event loop and keeps short-lived
 * processes (the CLI) alive until it fires — up to AUDIT_TIMEOUT after the
 * results have already been printed.
 */
export function raceWithTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
