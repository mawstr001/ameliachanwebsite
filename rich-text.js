// ── Rich text ─────────────────────────────────────────────────────────────────
// Formatted page text (the Home lead paragraph, the Bio paragraphs and the
// First Principles text) is edited with the Writings-style Quill editor. This
// cleans that HTML down to what the editor produces, so nothing else —
// scripts, event handlers, other sites' embeds, stray styles — reaches the
// page. Anything not allowed is dropped; its text is kept.

const RICH_KEYS = new Set([
  'home.left.blurb',
  'bio.introPara1',
  'bio.introPara2',
  'bio.teacherPara1',
  'firstPrinciples.body'
]);

const SIMPLE = new Set(['p', 'b', 'strong', 'i', 'em', 'u', 's', 'h2', 'h3', 'h4',
  'blockquote', 'ol', 'ul', 'li', 'span', 'div']);
// Quill formatting classes (alignment, size, indent, video).
const CLASS_OK = /^ql-(align-(center|right|justify)|size-(small|large|huge)|indent-[1-8]|video)$/;
// Inline styles from earlier content (size and alignment only).
const SIZE = /font-size\s*:\s*(\d{1,3}(?:\.\d{1,3})?)(em|rem|px|%)/i;
const ALIGN = /text-align\s*:\s*(left|center|right|justify)/i;
const LIST = /\bdata-list\s*=\s*["']?(bullet|ordered)/i;
const TARGET_BLANK = /\btarget\s*=\s*["']?_blank/i;

function attr(attrs, name) {
  const m = new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'>]+))', 'i').exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
}

function escapeAttr(v) {
  return v.replace(/&(?!(?:amp|lt|gt|quot|#\d+|#x[0-9a-f]+);)/gi, '&amp;')
    .replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeText(t) {
  return t.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Links: web, email and on-site only — never javascript: or data: URLs.
function safeHref(v) {
  v = (v || '').trim();
  return /^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(v) ? escapeAttr(v) : null;
}
// Images: uploaded to this site, or https.
function safeImg(v) {
  v = (v || '').trim();
  return /^(\/uploads\/[\w.-]+|https:\/\/[^\s"'<>]+)$/i.test(v) ? escapeAttr(v) : null;
}
// Embedded video: YouTube only.
function safeVideo(v) {
  const m = /^https:\/\/www\.youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{11})(?:\?[\w=&;.-]*)?$/.exec((v || '').trim());
  return m ? 'https://www.youtube.com/embed/' + m[1] : null;
}

function classes(attrs) {
  const c = (attr(attrs, 'class') || '').split(/\s+/).filter(x => CLASS_OK.test(x));
  return c.length ? ` class="${c.join(' ')}"` : '';
}

function sanitizeRich(input) {
  // Code, style and plugin blocks are removed together with their contents.
  // An iframe's own tag is kept for checking below (only YouTube survives).
  const s = String(input == null ? '' : input)
    .replace(/<(script|style|object|embed|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/iframe\s*>/gi, '')
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

    if (SIMPLE.has(tag)) {
      if (closing) { out += `</${tag}>`; continue; }
      let extra = classes(attrs);
      const styles = [];
      const size = SIZE.exec(attrs);
      if (size) styles.push(`font-size:${size[1]}${size[2].toLowerCase()}`);
      const align = ALIGN.exec(attrs);
      if (align && tag !== 'span') styles.push(`text-align:${align[1].toLowerCase()}`);
      if (styles.length) extra += ` style="${styles.join(';')}"`;
      if (tag === 'li') { const l = LIST.exec(attrs); if (l) extra += ` data-list="${l[1].toLowerCase()}"`; }
      out += `<${tag}${extra}>`;
    } else if (tag === 'br') {
      out += '<br>';
    } else if (tag === 'hr') {
      if (!closing) out += '<hr>';
    } else if (tag === 'a') {
      if (closing) { out += '</a>'; continue; }
      const href = safeHref(attr(attrs, 'href'));
      if (!href) { out += '<a>'; continue; }
      out += TARGET_BLANK.test(attrs)
        ? `<a href="${href}" target="_blank" rel="noopener">`
        : `<a href="${href}">`;
    } else if (tag === 'img') {
      const src = safeImg(attr(attrs, 'src'));
      if (src && !closing) out += `<img src="${src}" alt="${escapeAttr(attr(attrs, 'alt') || '')}">`;
    } else if (tag === 'iframe') {
      const src = safeVideo(attr(attrs, 'src'));
      if (src && !closing) out += `<iframe class="ql-video" src="${src}" frameborder="0" allowfullscreen></iframe>`;
    }
    // Anything else is dropped; its text content is kept.
  }
  out += escapeText(s.slice(last));
  return out;
}

// Clean a value for a content key: rich keys are sanitised, others untouched.
function cleanForKey(key, value) {
  return RICH_KEYS.has(key) ? sanitizeRich(value) : value;
}

module.exports = { RICH_KEYS, sanitizeRich, cleanForKey };
