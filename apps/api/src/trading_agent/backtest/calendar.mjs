// Market hours (Stage 14). Pure; time-zone maths uses the Intl tz data bundled with Node.
//
//   binance, mock : 24/7
//   upstox (NSE)  : Mon–Fri 09:15–15:30 Asia/Kolkata
//   alpaca (NYSE) : Mon–Fri 09:30–16:00 America/New_York (DST-aware)
// Exchange holidays are NOT built in: pass them as params.holidays (local YYYY-MM-DD).
// Half-days and auctions are not modelled.
import { SimError } from './errors.mjs';

const SESSIONS = Object.freeze({
  binance: null,
  mock: null,
  upstox: Object.freeze({ timeZone: 'Asia/Kolkata', open: 9 * 60 + 15, close: 15 * 60 + 30 }),
  alpaca: Object.freeze({ timeZone: 'America/New_York', open: 9 * 60 + 30, close: 16 * 60 }),
});
const formatters = new Map();
const WEEKDAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);

export function marketCalendar(venue, holidays = []) {
  if (!Object.hasOwn(SESSIONS, venue)) throw new SimError('CONFIG', `no market calendar for venue ${venue}`);
  const session = SESSIONS[venue];
  const closedDays = new Set(holidays);
  return Object.freeze({
    venue,
    alwaysOpen: session === null,
    /** True when the venue accepts orders at `ms` (session start inclusive, end exclusive). */
    isOpen(ms) {
      if (session === null) return true;
      const p = localParts(session.timeZone, ms);
      if (!WEEKDAYS.has(p.weekday) || closedDays.has(p.date)) return false;
      const minute = p.hour * 60 + p.minute;
      return minute >= session.open && minute < session.close;
    },
  });
}

function localParts(timeZone, ms) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    formatters.set(timeZone, f);
  }
  const parts = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { weekday: parts.weekday, date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}
