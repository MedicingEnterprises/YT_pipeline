/** All planned dates are minute-precision wall-clock strings in the current
 * workspace timezone. Instants (job timestamps/durations) remain UTC ISO values.
 * At DST gaps a job becomes due at the first observed wall minute after its slot;
 * repeated fall-back minutes are claimed once using the queue's persisted key. */
export const DEFAULT_TIMEZONE = 'UTC'
export function isTime(value: unknown): value is string { return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) }
export function isDateTime(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false
  const [year, month, day, hour, minute] = value.match(/\d+/g)!.map(Number)
  return year >= 1900 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate() && hour <= 23 && minute <= 59
}
export function wallTimeNow(timezone: string, instant = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant)
  const get = (type: string) => parts.find(part => part.type === type)!.value
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}
export const workspaceToday = (timezone: string, now = new Date()) => wallTimeNow(timezone, now).slice(0, 10)
// UTC is a display/calendar arithmetic carrier here, not a reinterpretation of
// the planned slot as an instant. Never parse a wall date in the PC timezone.
export const calendarDate = (date: string) => new Date(`${date.slice(0, 10)}T12:00:00Z`)
export const calendarKey = (date: Date) => date.toISOString().slice(0, 10)
export function addDays(date: string, days: number): string { const result = calendarDate(date); result.setUTCDate(result.getUTCDate() + days); return calendarKey(result) }
export function formatWallTime(value: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }).format(new Date(`${value.length === 10 ? `${value}T12:00` : value}Z`))
}
export function isDue(value: string, timezone: string, now: number): boolean { return isDateTime(value) && value <= wallTimeNow(timezone, new Date(now)) }
