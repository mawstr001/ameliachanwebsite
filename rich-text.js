// ── Rich text ─────────────────────────────────────────────────────────────────
// Some fields (e.g. the Bio paragraphs) can carry simple formatting from the
// admin editor: bold, italic, underline, line breaks and font size. This
// cleans that HTML down to exactly those, so nothing else — scripts, links,
// event handlers, stray styles — can reach the page.
//
// "Block" fields (shown in a <div>, e.g. the First Principles text) also allow
// alignment and a small set of structural tags that can be typed in the HTML
// view: paragraphs, headings, lists, quotes, rules and links.

// Formatted fields and what each allows beyond bold / italic / underline /
// size: links (web, email and on-site only) and, for fields shown in a <div>,
// block structure and alignment.
const RICH_FIELDS = {
  'bio.introPara1': { links: true },
  'bio.introPara2': { links: true },
  'bio.teacherPara1': { links: true },
  'home.left.blurb': { links: true },
  'firstPrinciples.body': { blocks: true, links: true }
};
const RICH_KEYS = new Set(Object.keys(RICH_FIELDS));

const INLINE = new Set(['b', 'strong', 'i', 'em', 'u']);
const BLOCK = new Set(['div', 'p', 'h2', 'h3', 'h4', 'blockquote', 'ul', 'ol', 'li']);
const ALIGNABLE = new Set(['div', 'p', 'h2', 'h3', 'h4', 'blockquote', 'li']);
const SIZE = /font-size\s*:\s*(\d{1,3}(?:\.\d{1,3})?)(em|rem|px|%)/i;
const ALIGN = /text-align\s*:\s*(left|center|right|justify)/i;
const HREF = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;
const TARGET_BLANK = /\btarget\s*=\s*["']?_blank/i;

function escapeText(t) {
  return t.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safeHref(attrs) {
  const m = HREF.exec(attrs);
  if (!m) return null;
  const url = (m[1] ?? m[2] ?? m[3] ?? '').trim();
  // Only web, email and on-site links — never javascript: or data: URLs.
  if (!/^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(url)) return null;
  return url.replace(/&(?!(?:amp|lt|gt|quot|#\d+|#x[0-9a-f]+);)/gi, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function sanitizeRich(input, opts = {}) {
  const blocks = !!opts.blocks;
  const links = blocks || !!opts.links;
  // Code and style blocks are removed together with their contents.
  const s = String(input == null ? '' : input)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = tagRe.exec(s))) {
    out += escapeText(s.slice(last, m.index));
    last = tagRe.lastIndex;
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3];
    if (INLINE.has(tag)) {
      out += closing ? `</${tag}>` : `<${tag}>`;
    } else if (tag === 'span') {
      if (closing) { out += '</span>'; continue; }
      const size = SIZE.exec(attrs);
      out += size ? `<span style="font-size:${size[1]}${size[2].toLowerCase()}">` : '<span>';
    } else if (tag === 'br') {
      out += '<br>';
    } else if (blocks && BLOCK.has(tag)) {
      if (closing) { out += `</${tag}>`; continue; }
      const align = ALIGNABLE.has(tag) && ALIGN.exec(attrs);
      out += align ? `<${tag} style="text-align:${align[1].toLowerCase()}">` : `<${tag}>`;
    } else if (blocks && tag === 'hr') {
      if (!closing) out += '<hr>';
    } else if (links && tag === 'a') {
      if (closing) { out += '</a>'; continue; }
      const href = safeHref(attrs);
      if (!href) { out += '<a>'; continue; }
      out += TARGET_BLANK.test(attrs)
        ? `<a href="${href}" target="_blank" rel="noopener">`
        : `<a href="${href}">`;
    } else if (!blocks && (tag === 'div' || tag === 'p') && !closing && out) {
      // Block breaks from the editor become line breaks, since the text is
      // shown inside a <p> on the page, which can't contain blocks.
      out += '<br>';
    }
    // Anything else is dropped; its text content is kept.
  }
  out += escapeText(s.slice(last));
  return out;
}

// Clean a value for a content key: rich keys are sanitised, others untouched.
function cleanForKey(key, value) {
  if (!RICH_KEYS.has(key)) return value;
  return sanitizeRich(value, RICH_FIELDS[key]);
}

module.exports = { RICH_KEYS, RICH_FIELDS, sanitizeRich, cleanForKey };
