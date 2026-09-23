// Builds the CV from entries.json + profile.json + cv.config.yaml.
//   node src/build.mjs [--config cv.config.yaml] [--pdf]
// Outputs (see config `output`): dist/index.html (+ cv.css, fonts/) and, with --pdf, dist/cv.pdf.
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { columnLabel, whenText, comparator, formatStamp } from './dates.mjs';
import { render, esc, inline } from './template.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const root = process.cwd();
const configPath = flag('--config') ?? 'cv.config.yaml';
const config = parseYaml(readFileSync(configPath, 'utf8'));
const entries = JSON.parse(readFileSync(config.data?.entries ?? 'entries.json', 'utf8'));
const profile = JSON.parse(readFileSync(config.data?.profile ?? 'profile.json', 'utf8'));

const fmt = config.formats ?? {};
const known = new Set(entries.map((e) => e.type));
const warnings = [];

// ---------- entry context for templates ----------

function place(e) {
  const p = fmt.place ?? {};
  const parts = p.parts ?? ['venue', 'city', 'region', 'country'];
  const omit = new Set(p.omit_countries ?? []);
  return parts
    .map((k) => e[k])
    .filter((v, i) => v && !(parts[i] === 'country' && omit.has(v)))
    .join(', ');
}

const effectiveUrl = (e) => e.url ?? (e.doi ? `https://doi.org/${e.doi}` : undefined);

function ctxFor(e) {
  const c = { ...e, place: place(e), when: whenText(e, fmt.date), __url: effectiveUrl(e) };
  // an event that only repeats the entry's own title (e.g. "#garden") adds nothing to the line
  if (c.event && c.event === c.title) delete c.event;
  return c;
}

// ---------- selecting and sorting ----------

const matches = (e, where) =>
  Object.entries(where).every(([k, v]) => (Array.isArray(v) ? v.includes(e[k]) : e[k] === v));

function sorter(spec) {
  if (!spec || spec === 'none') return () => 0;
  const [field, dir = 'asc'] = spec.split(/\s+/);
  if (field === 'date' || field === 'end') return comparator(spec);
  const sign = dir === 'desc' ? -1 : 1;
  return (a, b) => sign * String(a[field] ?? '').localeCompare(String(b[field] ?? ''));
}

function select(sec) {
  for (const t of sec.types ?? []) if (!known.has(t)) warnings.push(`section "${sec.heading}": no entries of type "${t}"`);
  let list = entries.filter((e) => !e.hidden && (sec.types ?? []).includes(e.type));
  if (sec.where) list = list.filter((e) => matches(e, sec.where));
  list = [...list].sort(sorter(sec.sort ?? 'date desc'));
  if (sec.limit) list = list.slice(0, sec.limit);
  return list;
}

// ---------- layouts ----------

const dateCell = (e, sec) => `<div class="date">${esc(columnLabel(e, sec.date_column, fmt.date))}</div>`;

const layouts = {
  // date | main | side, with an optional italic note line under main
  'three-column'(list, sec) {
    return list
      .map((e) => {
        const c = ctxFor(e);
        const note = sec.columns?.note ? render(sec.columns.note, c) : '';
        return (
          `<div class="entry entry--three">${dateCell(e, sec)}` +
          `<div class="main">${render(sec.columns.main, c)}</div>` +
          `<div class="side">${render(sec.columns.side, c)}</div>` +
          (note ? `<div class="note">${note}</div>` : '') +
          `</div>`
        );
      })
      .join('\n');
  },

  // date | one flowing citation paragraph, with an optional italic note paragraph
  citation(list, sec) {
    return list
      .map((e) => {
        const c = ctxFor(e);
        const note = sec.note ? render(sec.note, c) : '';
        return (
          `<div class="entry">${dateCell(e, sec)}<div class="text">` +
          `<p>${render(sec.template, c)}</p>` +
          (note ? `<p class="note">${note}</p>` : '') +
          `</div></div>`
        );
      })
      .join('\n');
  },

  // undated items under a subheading per group (e.g. courses by institution)
  'grouped-list'(list, sec) {
    let items = list;
    if (sec.expand) {
      items = list.flatMap((parent) =>
        (parent[sec.expand] ?? []).map((item) => ({ ...item, institution: parent.institution, city: parent.city, region: parent.region })),
      );
    }
    const groups = Map.groupBy(items, (i) => i[sec.group_by]);
    return [...groups]
      .map(
        ([name, group]) =>
          `<h3>${inline(name)}</h3>\n<ul class="list">` +
          group.map((i) => `<li>${render(sec.template, ctxFor(i))}</li>`).join('') +
          `</ul>`,
      )
      .join('\n');
  },

  // "Label. Details…" paragraphs
  definition(list, sec) {
    return list
      .map((e) => {
        const c = ctxFor(e);
        return `<div class="entry entry--definition"><p><strong>${render(sec.term, c)}.</strong> ${render(sec.text, c)}</p></div>`;
      })
      .join('\n');
  },
};

function renderBody(sec) {
  const layout = layouts[sec.layout];
  if (!layout) throw new Error(`section "${sec.heading}": unknown layout "${sec.layout}"`);
  return layout(select(sec), sec);
}

function renderSection(sec) {
  let body;
  if (sec.subsections) {
    body = sec.subsections
      .map((sub) => {
        const merged = { ...sec, ...sub, subsections: undefined };
        const inner = renderBody(merged);
        return inner ? `<h3>${inline(sub.heading)}</h3>\n${inner}` : '';
      })
      .join('\n');
  } else {
    body = renderBody(sec);
  }
  if (!body.trim()) {
    warnings.push(`section "${sec.heading}" has no visible entries; skipped`);
    return '';
  }
  return `<section class="section">\n<h2>${inline(sec.heading)}</h2>\n${body}\n</section>`;
}

// ---------- masthead ----------

function currentAppointment() {
  return entries
    .filter((e) => e.type === 'appointment' && !e.hidden && e.end_date === 'present')
    .sort(comparator('date desc'))[0];
}

function mastheadLeft() {
  const spec = config.header?.left ?? 'current_appointment';
  if (Array.isArray(spec)) return spec.map(esc);
  const a = currentAppointment();
  if (!a) {
    warnings.push('header.left: no current appointment (end_date "present") found');
    return [];
  }
  // "Pratt Institute, School of Information" -> unit first, university last
  return [a.title, ...a.institution.split(', ').reverse()].map(esc);
}

function mastheadRight() {
  const items = config.header?.right ?? ['address', 'email'];
  const lines = [];
  for (const item of items) {
    if (item === 'address') lines.push(...(profile.address ?? []).map(esc));
    else if (item === 'email' && profile.email) lines.push(`<a href="mailto:${esc(profile.email)}">${esc(profile.email)}</a>`);
    else if (item === 'phone' && profile.phone) lines.push(`<a href="tel:${esc(profile.phone.replace(/[^+\d]/g, ''))}">${esc(profile.phone)}</a>`);
    else if (item === 'website' && profile.website) lines.push(`<a href="${esc(profile.website)}">${esc(profile.website.replace(/^https?:\/\//, ''))}</a>`);
    else if (!['address', 'email', 'phone', 'website'].includes(item)) lines.push(esc(item));
  }
  return lines;
}

function masthead() {
  const doc = config.document ?? {};
  const upd = doc.updated?.show ? `<p class="updated">updated ${formatStamp(new Date(), doc.updated.format)}</p>` : '';
  const pdf = config.output?.pdf ? `<a class="pdf-link" href="${esc(config.output.pdf)}">PDF</a>` : '';
  return `<header class="masthead">
<h1>${esc(profile.name)}</h1>
${doc.subtitle ? `<p class="subtitle">${esc(doc.subtitle)}</p>` : ''}
${upd}
<div class="contact">
<div class="contact-left">${mastheadLeft().join('<br>')}</div>
<div class="contact-right">${mastheadRight().join('<br>')}</div>
</div>
${pdf}
</header>`;
}

// ---------- page ----------

function cssVars() {
  const s = config.style ?? {};
  const map = {
    '--font-size': s.font_size,
    '--line-height': s.line_height,
    '--date-col': s.date_column,
    '--main-col': s.main_column,
    '--entry-gap': s.entry_gap,
    '--font-body': s.font_family,
  };
  return Object.entries(map)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v};`)
    .join(' ');
}

function page() {
  const doc = config.document ?? {};
  const title = doc.title ?? `${profile.name} – Curriculum Vitae`;
  const sections = (config.sections ?? []).map(renderSection).filter(Boolean).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="cv.css">
<style>:root { ${cssVars()} }${config.style?.page_margin ? ` @page { margin: ${config.style.page_margin}; }` : ''}</style>
</head>
<body>
<main class="cv">
${masthead()}
${sections}
</main>
</body>
</html>
`;
}

// ---------- write ----------

const outDir = resolve(root, config.output?.dir ?? 'dist');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, config.output?.html ?? 'index.html'), page());
cpSync(resolve(root, 'src/cv.css'), join(outDir, 'cv.css'));
cpSync(resolve(root, 'fonts'), join(outDir, 'fonts'), { recursive: true });
if (existsSync(resolve(root, 'press-clippings'))) cpSync(resolve(root, 'press-clippings'), join(outDir, 'press-clippings'), { recursive: true });

const visible = entries.filter((e) => !e.hidden).length;
console.log(`Built ${config.output?.html ?? 'index.html'}: ${visible} visible of ${entries.length} entries`);
for (const w of warnings) console.warn('warning:', w);

// ---------- PDF ----------

if (args.includes('--pdf')) {
  const { chromium } = await import('playwright-core');
  const candidates = [
    process.env.CHROME_PATH,
    config.output?.chrome,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  const executablePath = candidates.find((p) => existsSync(p));
  if (!executablePath) throw new Error('No Chrome/Chromium found. Set CHROME_PATH or output.chrome in the config.');

  const browser = await chromium.launch({ executablePath });
  const pg = await browser.newPage();
  await pg.goto(pathToFileURL(join(outDir, config.output?.html ?? 'index.html')).href);
  await pg.emulateMedia({ media: 'print' });
  await pg.evaluate(() => document.fonts.ready);
  const pdfPath = join(outDir, config.output?.pdf ?? 'cv.pdf');
  await pg.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true, tagged: true, outline: true });
  await browser.close();
  console.log(`Wrote ${pdfPath}`);
}
