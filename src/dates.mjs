// Partial ISO dates ("2026", "2026-04", "2026-04-15") -> sort keys and display strings.

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function parse(s) {
  if (s == null) return null;
  if (s === 'present') return { present: true };
  const [y, m, d] = String(s).split('-').map(Number);
  return { y, m: m || 0, d: d || 0 };
}

const key = (p) => (p ? p.y * 10000 + p.m * 100 + p.d : 0);

export const startKey = (e) => key(parse(e.date));
export const endKey = (e) => {
  const end = parse(e.end_date);
  if (!end) return startKey(e);
  return end.present ? Infinity : key(end);
};

// sort spec: "date desc" | "end desc" | "date asc" | "end asc"
export function comparator(spec = 'date desc') {
  const [field, dir = 'desc'] = spec.split(/\s+/);
  const sign = dir === 'asc' ? 1 : -1;
  const [primary, secondary] = field === 'end' ? [endKey, startKey] : [startKey, endKey];
  return (a, b) => {
    const cmp = (x, y) => (x === y ? 0 : x < y ? -1 : 1);
    return sign * cmp(primary(a), primary(b)) || sign * cmp(secondary(a), secondary(b));
  };
}

// The text for the date column.
//   mode "range": 2016–24, 2024– (ongoing), 2015 (single year)
//   mode "end":   completion year only
//   mode "start": start year only
export function columnLabel(e, mode = 'range', fmt = {}) {
  const start = parse(e.date);
  const end = parse(e.end_date);
  if (!start) return fmt.undated ?? 'n.d.';
  const dash = '–';
  if (mode === 'start' || !end) return String(start.y);
  if (end.present) return mode === 'end' ? `${start.y}${dash}` : `${start.y}${dash}`;
  if (mode === 'end') return String(end.y);
  if (end.y === start.y) return String(start.y);
  const sameCentury = Math.floor(end.y / 100) === Math.floor(start.y / 100);
  const endStr = fmt.range === 'full' || !sameCentury ? String(end.y) : String(end.y % 100).padStart(2, '0');
  return `${start.y}${dash}${endStr}`;
}

// Month/day text for use inside an entry: "May 28", "March 3–5", "March 30–April 2".
// Empty unless the date has a day: a month alone ("2017-08") or a year alone prints nothing,
// as does a multi-year or ongoing range (the year column already covers those).
export function whenText(e, fmt = {}) {
  const start = parse(e.date);
  const end = parse(e.end_date);
  if (!start || !start.m || !start.d) return '';
  const name = (m) => (fmt.months === 'short' ? MONTHS[m - 1].slice(0, 3) : MONTHS[m - 1]);
  const first = `${name(start.m)} ${start.d}`;
  if (end) {
    if (end.present || end.y !== start.y) return '';
    if (end.m && end.d && (end.m !== start.m || end.d !== start.d)) {
      return end.m === start.m ? `${first}–${end.d}` : `${first}–${name(end.m)} ${end.d}`;
    }
  }
  return first;
}

// "M/D/YY" style formatter for the "updated" stamp.
export function formatStamp(date, format = 'M/D/YY') {
  const parts = {
    YYYY: String(date.getFullYear()),
    YY: String(date.getFullYear() % 100).padStart(2, '0'),
    MM: String(date.getMonth() + 1).padStart(2, '0'),
    M: String(date.getMonth() + 1),
    DD: String(date.getDate()).padStart(2, '0'),
    D: String(date.getDate()),
  };
  return format.replace(/YYYY|YY|MM|M|DD|D/g, (t) => parts[t]);
}
