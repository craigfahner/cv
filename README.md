# CV builder

Generates a CV as a **PDF** (with live hyperlinks) and as a **static web page** from one set of data and one config file.

```
entries.json ─┐
profile.json  ├─► filter hidden ─► sort / group ─► HTML ─┬─► dist/index.html   (website)
cv.config.yaml┘                                          └─► dist/cv.pdf       (printed from that HTML by Chrome)
```

## Rebuild

Run these from the repository root (the folder containing `package.json`).

Build the PDF and the website:

```bash
npm run pdf
```

Build the website only (no Chrome needed):

```bash
npm run build
```

Output goes to `dist/`: `index.html`, `cv.css`, `fonts/`, and `cv.pdf`. The whole `dist/` folder can be published as a static site.

Open the results:

```bash
open dist/cv.pdf
```

```bash
open dist/index.html
```

Preview the site over HTTP at <http://localhost:8765>:

```bash
python3 -m http.server 8765 --directory dist
```

### Requirements

- **Node.js 21 or newer** (developed on v23; the build uses `Object.groupBy`).
- **Google Chrome** in `/Applications`, used only for the PDF. If it lives elsewhere:

  ```bash
  CHROME_PATH="/path/to/chrome" npm run pdf
  ```

- **`node_modules/`**. Install the dependencies once after cloning (and again if the folder is ever deleted):

  ```bash
  npm install
  ```

### Building from another config

Different configs give different CVs (for example a short version) from the same data:

```bash
node src/build.mjs --config cv.short.yaml --pdf
```

Add `--pdf` to also produce the PDF; leave it off for the website only.

## Automatic publishing (GitHub Pages)

`.github/workflows/pages.yml` rebuilds the website and PDF and publishes both to GitHub Pages whenever a push to `main` changes something that affects the output: `entries.json`, `profile.json`, `cv.config.yaml`, `src/`, `fonts/`, `package.json`, `package-lock.json`, or the workflow itself. You can also run it by hand from the repository's **Actions** tab (**Run workflow**).

The site is served at `https://<your-username>.github.io/<repo-name>/` and the PDF at `.../cv.pdf`.

**One-time setup:** in the repository, go to **Settings → Pages** and set **Source** to **GitHub Actions**. Until that is set, the deploy step fails.

Notes:

- Everything published is public on the web (the address in the header included). Keep `phone` out of `header.right` unless you want it shown.
- Pages on a *private* repository needs a paid GitHub plan.
- The "updated" date uses the New York time zone (`TZ` in the workflow), not the runner's UTC.
- The runner prints the PDF with the Google Chrome preinstalled on GitHub's Ubuntu images. Pagination can differ very slightly from a local build if the Chrome versions differ.

## Everyday editing

| To… | Edit |
|---|---|
| add or change an entry | `entries.json` |
| leave an entry out | set `"hidden": true` on it |
| change sections, order, sorting, line formats | `cv.config.yaml` |
| change name, email, phone, address, website | `profile.json` |

Then rebuild. The "updated" date in the header is stamped automatically with the build date.

If a build prints `warning:` lines, they usually mean a section has no visible entries or names a `type` that no entry has.

## Data: `entries.json`

A flat array of objects, in any order (sorting happens at build time). Every entry has:

| Key | Meaning |
|---|---|
| `id` | unique identifier (convention: `type-date-slug`) |
| `type` | which kind of entry it is (see below) |
| `hidden` | `true` leaves it out of every output |
| `date` | partial ISO date: `"2026"`, `"2026-04"`, or `"2026-04-15"` |
| `end_date` | optional; same format, or `"present"` for ongoing |
| `url` | optional; if present the entry's title becomes a hyperlink, if absent there is no link |

A `doi` (publications) links to `https://doi.org/<doi>` when there is no `url`; an explicit `url` wins. Text values may contain `*italics*`. Use curly quotes (“ ” ‘ ’) and en dashes (–) directly; JSON is UTF-8, so no escaping is needed.

Type-specific keys:

| `type` | Keys |
|---|---|
| `education` | `degree`, `area`, `institution`, `highlights[]`, location |
| `appointment` | `title`, `institution`, location, `courses_taught[]` (each `{ "code", "title" }`) |
| `exhibition` | `work`, `title`, `medium`, `collaborators[]`, `event`, `curators[]`, `created`, location |
| `grant` | `title`, `funder` |
| `publication` | `title`, `authors[]`, `source`, `doi` |
| `software` | `title`, `authors[]`, `version`, `language` |
| `presentation` | `title`, `role`, location, `note` |
| `residency`, `talk`, `service` | `title`, location |
| `internal_service` | `role`, `title`, `institution` |
| `review` | `title`, `source` |
| `skill` | `label`, `details` (undated) |

**Location** keys, all optional: `venue`, `city`, `region` (state or province), `country` (full name). The config decides which parts print and can hide countries such as Canada and the United States.

**`work`** is a slug shared by every showing of the same artwork (for example `"enter-the-ring"`), so showings can be grouped later.

## Config: `cv.config.yaml`

Sections print in the order listed. Each one sets a heading, which `types` it pulls, a `sort`, a `layout`, and a line `template`. The comments at the top of the file describe the options; in short:

**Layouts**

- `three-column`: year, then main text, then a second column (education, appointments)
- `citation`: year, then one flowing line (most sections)
- `grouped-list`: undated items under a subheading per group (teaching, taken from each appointment's `courses_taught`)
- `definition`: bold label followed by text (skills)

**Sorting**: `date desc` (start date), `end desc`, `date asc`, or a field name such as `label asc`.

**Date column**: `date_column: range` (2016–24), `end` (completion year only), or `start`.

**Subsections**: a section can carry `subsections`, each with a `heading` and a `where` filter, for example `where: { role: [Panelist, Panel chair] }`.

**Line templates**

| Syntax | Meaning |
|---|---|
| `{field}` | insert a value |
| `{field\|list}` | "A, B, and C" (uses semicolons if any item contains a comma) |
| `{title\|link}` | link the value if the entry has a url or doi |
| `[ ... ]` | optional group; dropped if any field inside is empty |
| `*text*` | italics |
| `\[` `\]` `\{` `\*` | literal characters |

Also available in every template: `{place}` (venue, city, region, and country when not omitted) and `{when}` (month and day, such as "May 28" or "March 3–5"). `{when}` is empty unless the entry's date includes a day, so a date like `"2017-08"` prints nothing beyond the year in the date column.

Example:

```yaml
template: "*{title|link}*[, {created}]. {medium}[, with {collaborators|list}]. {place}. [{when}.]"
```

## Layout of the project

```
entries.json         CV data
profile.json         name and contact details
cv.config.yaml       what appears, in what order, in what format
src/build.mjs        loads data + config, renders HTML, prints the PDF
src/dates.mjs        date sorting and formatting
src/template.mjs     the line-template language
src/cv.css           print and screen styles
fonts/               Source Serif 4 (SIL Open Font License), bundled so builds work offline
dist/                generated output
scripts/             one-off converter from the original RenderCV YAML (see below)
```

## Notes

- `scripts/convert-rendercv.mjs` produced the first `entries.json` from `cv.yaml`. It is obsolete: `entries.json` has been edited by hand since, and re-running the converter would overwrite those edits.
- `node_modules/` is generated by `npm install` and normally belongs in `.gitignore`.
