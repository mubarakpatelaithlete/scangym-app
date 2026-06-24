/**
 * Shared time resolution utilities.
 * Consolidates the "anytime" resolution and end-time calculation logic
 * duplicated across booking.js and payment.js routes.
 */

/**
 * Resolve a raw time value: convert 'anytime' or empty to a sensible default,
 * then compute end time (start + 1 hour, capped at 23:xx).
 *
 * @param {string|null|undefined} time - Raw time input (e.g. "14:00", "anytime", null)
 * @returns {{ isAnytime: boolean, startTime: string, endTime: string, hours: number, displayTime: string }}
 */
function resolveTime(time) {
  const isAnytime = !time || time === 'anytime';
  let effectiveTime = time;

  if (isAnytime) {
    const nextHour = Math.min(new Date().getHours() + 1, 22);
    effectiveTime = String(nextHour).padStart(2, '0') + ':00';
  }

  const [hours, mins] = effectiveTime.split(':').map(Number);
  const endHour = Math.min(hours + 1, 23);
  const endTime = String(endHour).padStart(2, '0') + ':' + String(mins || 0).padStart(2, '0');

  return {
    isAnytime,
    hours,
    startTime: effectiveTime,
    endTime,
    displayTime: isAnytime ? 'Anytime today' : effectiveTime,
  };
}

module.exports = { resolveTime };
