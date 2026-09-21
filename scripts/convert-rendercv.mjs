// One-off converter: cv.yaml (RenderCV-style) -> entries.json + profile.json
// Usage: node scripts/convert-rendercv.mjs [input.yaml]
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'yaml';

const input = process.argv[2] ?? 'cv.yaml';
const { cv } = parse(readFileSync(input, 'utf8'));
const S = cv.sections;

const warnings = [];
const warn = (msg) => warnings.push(msg);

// ---------- helpers ----------

const slug = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const DATE_RE = /^\d{4}(-\d{2}(-\d{2})?)?$/;

// Returns { date, end_date? } from either date / start_date / end_date
// (including "2026-04/2026-05" range strings).
function dates(src, label) {
  let date, end_date;
  if (src.date != null) {
    const s = String(src.date);
    if (s.includes('/')) [date, end_date] = s.split('/');
    else date = s;
  } else if (src.start_date != null) {
    date = String(src.start_date);
    end_date = src.end_date != null ? String(src.end_date) : undefined;
  }
  if (date && end_date === date) end_date = undefined;
  for (const d of [date, end_date]) {
    if (d && d !== 'present' && !DATE_RE.test(d)) warn(`${label}: odd date "${d}"`);
  }
  return { date, end_date };
}

const splitNames = (s) =>
  s
    .split(/,\s*|\s+and\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ''));

// Straight -> curly quotes and apostrophes.
function curly(s) {
  return s
    .replace(/(^|[\s(\[—–‘])"/g, '$1“')
    .replace(/"/g, '”')
    .replace(/(^|[\s(\[—–“])'/g, '$1‘')
    .replace(/'/g, '’');
}

// ---------- locations ----------

const CA_REGIONS = new Set('AB BC MB NB NS NT NU ON PE QC SK YT'.split(' '));
const US_REGIONS = new Set(
  'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '),
);
// Two-letter country codes as they appear in the source (note: NL = Netherlands here)
const COUNTRIES = {
  UK: 'United Kingdom', IT: 'Italy', FR: 'France', SE: 'Sweden', SI: 'Slovenia',
  HR: 'Croatia', MX: 'Mexico', ES: 'Spain', NL: 'Netherlands',
};
// Two-part strings ending in a country where the first part is a venue, not a city
const VENUE_ONLY_WITH_COUNTRY = new Set(['University of Edinburgh, UK']);

// "Venue, City, ST" -> { venue, city, region, country }
function loc(str, label) {
  if (!str) return {};
  let text = str.replace(/\s+/g, ' ').trim();
  // "…, Brooklyn, NY (hosted by the Processing Foundation)" -> note
  let note;
  const np = text.match(/^(.+, [A-Z]{2}) \((.+)\)$/);
  if (np) {
    text = np[1];
    note = np[2];
  }
  const parts = text.split(', ');
  const last = parts.at(-1);
  let rest = parts.slice(0, -1);
  let region, country, city, venue;

  if (parts.length > 1 && CA_REGIONS.has(last)) {
    region = last;
    country = 'Canada';
    city = rest.pop();
  } else if (parts.length > 1 && US_REGIONS.has(last)) {
    region = last;
    country = 'United States';
    city = rest.pop();
  } else if (parts.length > 1 && COUNTRIES[last]) {
    country = COUNTRIES[last];
    if (VENUE_ONLY_WITH_COUNTRY.has(text)) {
      venue = rest.join(', ');
      rest = [];
    } else {
      city = rest.pop();
    }
  } else {
    // No recognisable region/country: keep whole string as the venue
    if (parts.length > 1 && /^[A-Z]{2,3}$/.test(last)) warn(`${label}: unrecognised region/country "${last}" in "${text}"`);
    return { venue: text };
  }
  if (rest.length) venue = rest.join(', ');
  return clean({ venue, city, region, country, note });
}

// ---------- entry builders ----------

const entries = [];

function add(type, src, fields, label, idHint) {
  const { date, end_date } = dates(src, label);
  entries.push({
    _idHint: idHint,
    ...clean({ type, hidden: false, date, end_date, ...fields, url: src.url }),
  });
}

// education
for (const e of S.education) {
  add('education', e, {
    institution: e.institution,
    ...loc(e.location, `education/${e.institution}`),
    degree: e.degree,
    area: e.area,
    highlights: e.highlights,
  }, `education/${e.institution}`, e.institution);
}

// teaching_experience is folded into appointments as courses_taught
const norm = (c) => c.toUpperCase().replace(/\.\d+$/, '').replace(/\s+/g, ' ').trim();
const teaching = S.teaching_experience.map((e) => {
  const m = e.name.match(/^([^:]+): (.+)$/);
  if (!m) warn(`course: no "code: title" in "${e.name}"`);
  return { code: m?.[1], title: m?.[2] ?? e.name, institution: e.location };
});
const usedCourses = new Set();

// academic appointments
// Existing course hints ("Sessional Instructor: ART 311, ..." or highlights) set which
// courses belong to which appointment and their order; titles/codes come from teaching.
const apptCountByInstitution = Object.groupBy(S.academic_appointments, (a) => a.company);
for (const e of S.academic_appointments) {
  let title = e.position;
  const hints = [...(e.highlights ?? [])];
  const m = title.match(/^([^:]+): (.+)$/);
  if (m) {
    title = m[1];
    hints.push(m[2]);
  }
  let courses;
  if (hints.length) {
    courses = hints.map((h) => {
      const code = norm(h.split(/[:,]/)[0]);
      const found = teaching.find((t) => t.institution === e.company && norm(t.code) === code);
      if (!found) warn(`appointment ${e.company}: no teaching entry for "${h}"`);
      return found;
    }).filter(Boolean);
  } else {
    if (apptCountByInstitution[e.company].length > 1) warn(`appointment ${e.company}: ambiguous course assignment`);
    courses = teaching.filter((t) => t.institution === e.company);
  }
  courses.forEach((c) => usedCourses.add(c));
  add('appointment', e, {
    title,
    institution: e.company,
    ...loc(e.location, `appointment/${e.company}`),
    courses_taught: courses.length ? courses.map(({ code, title }) => ({ code, title })) : undefined,
  }, `appointment/${e.company}`, e.company);
}
for (const t of teaching) if (!usedCourses.has(t)) warn(`course not attached to any appointment: ${t.code} (${t.institution})`);

// exhibitions: parse the summary string into structured fields
const EXH_RE =
  /^(?<medium>.+?) \((?<credit>Sole artist|Collaboration with .+?)\)(?:, curated by (?<curators1>.+?))?(?:; (?<event>.+?))?\. Created (?<created>[\d-]+)\.$/;
const TITLE_OVERRIDES = { 'garden (stylized with a leading hashtag)': '#garden' };

for (const e of S.exhibitions) {
  const label = `exhibition/${e.name} (${e.date})`;
  const m = e.summary?.replace(/\s+/g, ' ').match(EXH_RE);
  if (!m) warn(`${label}: could not parse summary: ${e.summary}`);
  const g = m?.groups ?? {};
  let event = g.event;
  let curators = g.curators1;
  const ev = event?.match(/^(.+?), curated by (.+)$/);
  if (ev) {
    event = ev[1];
    curators = ev[2];
  }
  const collab = g.credit?.match(/^Collaboration with (.+)$/);
  const title = TITLE_OVERRIDES[e.name] ?? e.name;
  if (title === '#garden' && event === 'garden') event = '#garden';
  add('exhibition', e, {
    // slug drops trailing parentheticals, e.g. "How to Improve the World (You Will…)"
    work: slug(title.replace(/\s*\(.*\)$/, '')),
    title,
    medium: g.medium,
    collaborators: collab ? splitNames(collab[1]) : undefined,
    event,
    curators: curators ? splitNames(curators) : undefined,
    created: g.created,
    ...loc(e.location, label),
    summary: m ? undefined : e.summary,
  }, label, title.replace(/\s*\(.*\)$/, ''));
}

// grants & awards
for (const e of S.grants_awards_and_scholarships) {
  add('grant', e, { title: e.name, funder: e.summary }, `grant/${e.name}`, e.name);
}

// publications
for (const e of S.peer_reviewed_publications) {
  if (e.doi && !/^10\.\d{4,9}\/\S+$/.test(e.doi)) warn(`publication "${e.title}": odd DOI "${e.doi}"`);
  add('publication', e, {
    title: e.title,
    authors: e.authors,
    journal: e.journal,
    doi: e.doi,
  }, `publication/${e.title}`, e.title);
}

// conference presentations
for (const e of S.conference_presentations) {
  add('presentation', e, {
    title: e.name.replace(/\s+/g, ' '),
    role: e.summary,
    ...loc(e.location, `presentation/${e.name}`),
  }, `presentation/${e.name}`, e.name);
}

// residencies & fellowships
for (const e of S.selected_residencies_and_research_fellowships) {
  add('residency', e, { title: e.name, ...loc(e.location, `residency/${e.name}`) }, `residency/${e.name}`, e.name);
}

// invited talks & workshops
for (const e of S.selected_invited_speaking_engagements_and_workshops) {
  add('talk', e, { title: e.name, ...loc(e.location, `talk/${e.name}`) }, `talk/${e.name}`, e.name);
}

// juries, research & service
for (const e of S.selected_juries_research_and_service_activities) {
  add('service', e, { title: e.name, ...loc(e.location, `service/${e.name}`) }, `service/${e.name}`, e.name);
}

// reviews, publicity & scholarly mentions
for (const e of S.selected_reviews_publicity_and_scholarly_mentions) {
  add('review', e, { title: e.name.replace(/\s+/g, ' '), source: e.summary }, `review/${e.name}`, e.name);
}

// skills: undated, alphabetical by label
for (const e of [...S.skills_and_expertise].sort((a, b) => a.label.localeCompare(b.label))) {
  add('skill', e, { label: e.label, details: e.details.replace(/\s+/g, ' ') }, `skill/${e.label}`, e.label);
}

// ---------- ids ----------

const seen = new Map();
for (const e of entries) {
  const base = [e.type, e.date ?? '', slug(e._idHint ?? '')].filter(Boolean).join('-');
  const n = (seen.get(base) ?? 0) + 1;
  seen.set(base, n);
  e.id = n === 1 ? base : `${base}-${n}`;
}

// ---------- typography: curly quotes in all free text ----------

// Accents lost when the source was scraped from the Word document
const ACCENTS = [
  ['Universite du Quebec a Montreal', 'Université du Québec à Montréal'],
  ['Societe des Arts Technologiques', 'Société des Arts Technologiques'],
  ['Galerija Klovicevi dvori', 'Galerija Klovićevi dvori'],
  ['Queretaro', 'Querétaro'],
  ['de maniere alternative', 'de manière alternative'],
  ['Medias Sociaux', 'Médias Sociaux'],
  ['Jean-Rene Leblanc', 'Jean-René Leblanc'],
];
const accentHits = new Map(ACCENTS.map(([from]) => [from, 0]));
function restoreAccents(s) {
  for (const [from, to] of ACCENTS) {
    if (s.includes(from)) {
      accentHits.set(from, accentHits.get(from) + s.split(from).length - 1);
      s = s.replaceAll(from, to);
    }
  }
  return s;
}

const NO_TYPOGRAPHY = new Set(['id', 'url', 'doi', 'date', 'end_date', 'type', 'work']);
let curled = 0;
function typeset(v, key) {
  if (typeof v === 'string') {
    if (NO_TYPOGRAPHY.has(key)) return v;
    const out = curly(restoreAccents(v));
    if (out !== v) curled++;
    const opens = (out.match(/“/g) ?? []).length;
    const closes = (out.match(/”/g) ?? []).length;
    if (opens !== closes) warn(`unbalanced quotes: ${out}`);
    return out;
  }
  if (Array.isArray(v)) return v.map((x) => typeset(x, key));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeset(x, k)]));
  return v;
}

// id first, drop internal hint
const out = entries.map(({ _idHint, id, ...rest }) => typeset({ id, ...rest }));

// ---------- consistency checks ----------

for (const [from, n] of accentHits) if (n === 0) warn(`accent fix matched nothing: "${from}"`);

const byWork = Map.groupBy(out.filter((e) => e.work), (e) => e.work);
for (const [work, list] of byWork) {
  for (const key of ['title', 'medium', 'created', 'url']) {
    const vals = new Set(list.map((e) => e[key] ?? '(none)'));
    if (vals.size > 1) warn(`work "${work}": inconsistent ${key}: ${[...vals].join(' | ')}`);
  }
  const collabs = new Set(list.map((e) => JSON.stringify(e.collaborators ?? [])));
  if (collabs.size > 1) warn(`work "${work}": inconsistent collaborators`);
}
const ids = new Set(out.map((e) => e.id));
if (ids.size !== out.length) warn('duplicate ids');

// ---------- write ----------

writeFileSync('entries.json', JSON.stringify(out, null, 2) + '\n');
writeFileSync(
  'profile.json',
  JSON.stringify({ name: cv.name, email: cv.email, phone: cv.phone, website: cv.website }, null, 2) + '\n',
);

const counts = Object.entries(Object.groupBy(out, (e) => e.type)).map(([t, l]) => `${t}: ${l.length}`);
console.log(`Wrote ${out.length} entries -> entries.json`);
console.log(counts.join('\n'));
console.log(`Works with multiple showings: ${[...byWork].filter(([, l]) => l.length > 1).length} of ${byWork.size}`);
console.log(`With url: ${out.filter((e) => e.url).length}`);
console.log(`Strings given curly quotes: ${curled}`);
if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const w of warnings) console.log(' -', w);
}
