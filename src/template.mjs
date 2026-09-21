// A tiny template language for citation-style lines.
//
//   {field}            insert a value (HTML-escaped; *italics* inside data values are honoured)
//   {field|filter|…}   filters: list (A, B, and C), link (wrap in <a> if the entry has a url/doi)
//   [ … ]              optional group: dropped entirely if any {field} inside it is empty
//   * … *              italics
//   \x                 literal x (use \[ \{ \* to print those characters)
//
// Example:  "{title|link}. [With {collaborators|list}. ]{place}. [{when}.]"

export const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Escape, then turn *x* in data into <em>x</em>.
export const inline = (s) => esc(s).replace(/\*([^*]+)\*/g, '<em>$1</em>');

// ---------- parsing ----------

function parse(src) {
  let i = 0;

  function nodes(closer) {
    const out = [];
    let text = '';
    const flush = () => {
      if (text) out.push({ t: 'text', v: text });
      text = '';
    };
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') {
        text += src[i + 1] ?? '';
        i += 2;
      } else if (c === closer) {
        i++;
        flush();
        return out;
      } else if (c === '{') {
        flush();
        const end = src.indexOf('}', i);
        if (end < 0) throw new Error(`unclosed { in template: ${src}`);
        const [name, ...filters] = src.slice(i + 1, end).split('|').map((s) => s.trim());
        out.push({ t: 'field', name, filters });
        i = end + 1;
      } else if (c === '[') {
        flush();
        i++;
        out.push({ t: 'group', children: nodes(']') });
      } else if (c === '*') {
        flush();
        i++;
        out.push({ t: 'em', children: nodes('*') });
      } else {
        text += c;
        i++;
      }
    }
    if (closer) throw new Error(`unclosed ${closer === ']' ? '[' : closer} in template: ${src}`);
    flush();
    return out;
  }

  return nodes(null);
}

// ---------- evaluation ----------

// "A", "A and B", "A, B, and C" — or "A; B; and C" when any item itself contains a comma,
// so a name like "Digital Democracies Institute, Simon Fraser University" stays one item.
const listJoin = (arr) => {
  if (arr.length <= 1) return arr.join('');
  const sep = arr.some((s) => s.includes(',')) ? '; ' : ', ';
  return arr.length === 2 ? arr.join(' and ') : `${arr.slice(0, -1).join(sep)}${sep}and ${arr.at(-1)}`;
};

function field(node, ctx) {
  let v = ctx[node.name];
  const isEmpty = (x) => x == null || x === '' || (Array.isArray(x) && x.length === 0);
  if (isEmpty(v)) return { out: '', missing: true };
  // raw-stage filters
  for (const f of node.filters) {
    if (f === 'list') v = Array.isArray(v) ? listJoin(v.map(String)) : String(v);
    else if (f !== 'link') throw new Error(`unknown filter "${f}"`);
  }
  if (Array.isArray(v)) v = listJoin(v.map(String));
  let html = inline(v);
  // html-stage filters
  if (node.filters.includes('link') && ctx.__url) html = `<a href="${esc(ctx.__url)}">${html}</a>`;
  return { out: html, missing: false };
}

function run(nodes, ctx) {
  let out = '';
  let missing = false;
  for (const n of nodes) {
    if (n.t === 'text') out += esc(n.v);
    else if (n.t === 'field') {
      const r = field(n, ctx);
      out += r.out;
      missing ||= r.missing;
    } else if (n.t === 'group') {
      const r = run(n.children, ctx);
      if (!r.missing) out += r.out;
    } else if (n.t === 'em') {
      const r = run(n.children, ctx);
      if (r.missing) missing = true;
      else if (r.out) out += `<em>${r.out}</em>`;
    }
  }
  return { out, missing };
}

// Tidy punctuation collisions such as "Really?." or "Inc.." after substitution.
const tidy = (s) =>
  s
    .replace(/([.?!])((?:<\/[a-z]+>|[”’"])*)\.(?=\s|$)/g, '$1$2')
    // American style: a period after a closing double quote goes inside it
    .replace(/”((?:<\/[a-z]+>)*)\.(?=\s|$)/g, '.”$1')
    .replace(/,\s*\./g, '.')
    .replace(/\s+/g, ' ')
    .trim();

const cache = new Map();
export function render(template, ctx) {
  if (!cache.has(template)) cache.set(template, parse(template));
  return tidy(run(cache.get(template), ctx).out);
}
