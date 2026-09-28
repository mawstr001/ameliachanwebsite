// ── Rich text ─────────────────────────────────────────────────────────────────
// Some fields (e.g. the Bio paragraphs) can carry simple formatting from the
// admin editor: bold, italic, underline, line breaks and font size. This
// cleans that HTML down to exactly those, so nothing else — scripts, links,
// event handlers, stray styles — can reach the page.

const RICH_KEYS = new Set([
  'bio.introPara1',
  'bio.introPara2',
  'bio.teacherPara1',
  'firstPrinciples.body'
]);

const INLINE = new Set(['b', 'strong', 'i', 'em', 'u']);
const SIZE = /font-size\s*:\s*(\d{1,3}(?:\.\d{1,3})?)(em|rem|px|%)/i;

function escapeText(t) {
  return t.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sanitizeRich(input) {
  const s = String(input == null ? '' : input);
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = tagRe.exec(s))) {
    out += escapeText(s.slice(last, m.index));
    last = tagRe.lastIndex;
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (INLINE.has(tag)) {
      out += closing ? `</${tag}>` : `<${tag}>`;
    } else if (tag === 'span') {
      if (closing) { out += '</span>'; continue; }
      const size = SIZE.exec(m[3]);
      out += size ? `<span style="font-size:${size[1]}${size[2].toLowerCase()}">` : '<span>';
    } else if (tag === 'br') {
      out += '<br>';
    } else if ((tag === 'div' || tag === 'p') && !closing && out) {
      // Block breaks from the editor become line breaks, since the text is
      // shown inside a <p> on the page, which can't contain blocks.
      out += '<br>';
    }
    // Anything else is dropped; its text content is kept.
  }
  out += escapeText(s.slice(last));
  return out;
}

module.exports = { RICH_KEYS, sanitizeRich };
