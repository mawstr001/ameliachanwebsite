/* ============================================================
   RICH EDITOR — bold / italic / underline / font size toolbar
   Used by the admin Bio form and by Edit Mode on the live page.
   data-rich="links" adds a Link button and an HTML source view (e.g. the
   Home lead paragraph); data-rich="blocks" adds those plus left / centre /
   right alignment (e.g. the First Principles text).
   The server cleans the result (rich-text.js) before saving.
   ============================================================ */
(function () {
  var SIZES = [
    { label: 'Small', value: '0.85em' },
    { label: 'Normal', value: '' },
    { label: 'Large', value: '1.2em' },
    { label: 'Extra large', value: '1.45em' }
  ];

  var css =
    '.rte{border:1px solid rgba(154,123,51,.35);border-radius:3px;background:#2a251e}' +
    '.rte-bar{display:flex;flex-wrap:wrap;gap:4px;padding:6px;border-bottom:1px solid rgba(154,123,51,.25)}' +
    '.rte-bar button,.rte-bar select{font:13px/1 Georgia,serif;color:#e8e0d0;background:rgba(255,255,255,.06);' +
      'border:1px solid rgba(255,255,255,.12);border-radius:3px;padding:6px 9px;cursor:pointer;min-width:30px}' +
    '.rte-bar button:hover,.rte-bar select:hover{background:rgba(255,255,255,.14)}' +
    '.rte-bar button.on{background:#9a7b33;border-color:#9a7b33;color:#fff}' +
    '.rte-bar .sep{width:1px;background:rgba(255,255,255,.12);margin:0 4px}' +
    '.rte-area{min-height:140px;padding:11px 14px;color:#e8e0d0;font:17px/1.55 "EB Garamond",Georgia,serif;' +
      'white-space:pre-wrap;outline:none;overflow-wrap:anywhere}' +
    '.rte-area:focus{box-shadow:inset 0 0 0 1px #9a7b33}' +
    '.rte.blocks .rte-area{white-space:normal}' +
    '.rte-area a{color:#d8b872}' +
    '.rte-src{display:block;width:100%;min-height:220px;box-sizing:border-box;padding:11px 14px;border:0;outline:none;resize:vertical;' +
      'background:#1e1a15;color:#e8e0d0;font:13px/1.55 "JetBrains Mono",ui-monospace,monospace;white-space:pre-wrap}' +
    '.rte-bar button:disabled,.rte-bar select:disabled{opacity:.35;cursor:default}' +
    '.rte-bar .push{margin-left:auto}' +
    '.rte-note{font:11px/1.4 system-ui,sans-serif;color:#9d9280;padding:6px 10px;border-top:1px solid rgba(154,123,51,.2)}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  function btn(label, title, html) {
    var b = document.createElement('button');
    b.type = 'button';
    b.title = title;
    b.innerHTML = html || label;
    b.setAttribute('aria-label', title);
    return b;
  }

  // Tidy the editor's HTML: <font size> from execCommand becomes a span with
  // a real size, "Normal" spans are unwrapped, empty spans removed.
  function normalise(area) {
    // Only fonts already tagged with a size; execCommand fires 'input' before
    // the size change handler has had a chance to tag them.
    Array.prototype.slice.call(area.querySelectorAll('font[data-size]')).forEach(function (f) {
      var span = document.createElement('span');
      span.style.fontSize = f.getAttribute('data-size');
      while (f.firstChild) span.appendChild(f.firstChild);
      f.parentNode.replaceChild(span, f);
    });
    Array.prototype.slice.call(area.querySelectorAll('span')).forEach(function (s) {
      if (!s.style.fontSize || s.style.fontSize === '1em' || !s.textContent) {
        while (s.firstChild) s.parentNode.insertBefore(s.firstChild, s);
        s.parentNode.removeChild(s);
      }
    });
  }

  // Put each block / line break on its own line so the HTML view is readable.
  function prettify(html) {
    return html
      .replace(/(<br>)(?!\n)/g, '$1\n')
      .replace(/(<\/(div|p|h2|h3|h4|li|ul|ol|blockquote)>)(?!\n)/g, '$1\n')
      .replace(/(<(ul|ol)>)(?!\n)/g, '$1\n')
      .replace(/\n+$/, '');
  }
  // Undo prettify: in block fields raw newlines are only layout in the source.
  // Next to a tag they vanish; between words they become a space.
  function unprettify(html) {
    return html.replace(/>[ \t]*\n\s*/g, '>').replace(/\s*\n[ \t]*</g, '<').replace(/\s*\n\s*/g, ' ');
  }

  // Editor features for a data-rich / data-edit-rich attribute value.
  function optionsFor(kind) {
    if (kind === 'blocks') return { blocks: true, align: true, links: true, source: true };
    if (kind === 'links') return { links: true, source: true };
    return {};
  }

  function create(initialHTML, onChange, opts) {
    opts = opts || {};
    var wrap = document.createElement('div');
    wrap.className = 'rte' + (opts.blocks ? ' blocks' : '');
    var bar = document.createElement('div');
    bar.className = 'rte-bar';
    var area = document.createElement('div');
    area.className = 'rte-area';
    area.contentEditable = 'true';
    area.innerHTML = initialHTML || '';

    var bold = btn('B', 'Bold (Ctrl/Cmd+B)', '<b>B</b>');
    var italic = btn('I', 'Italic (Ctrl/Cmd+I)', '<i>I</i>');
    var under = btn('U', 'Underline (Ctrl/Cmd+U)', '<u>U</u>');
    var size = document.createElement('select');
    size.title = 'Font size';
    size.setAttribute('aria-label', 'Font size');
    size.innerHTML = '<option value="" disabled selected>Size</option>' +
      SIZES.map(function (s, i) { return '<option value="' + i + '">' + s.label + '</option>'; }).join('');
    var sep = document.createElement('span');
    sep.className = 'sep';
    var clear = btn('Clear', 'Remove formatting from the selected text', 'Clear');

    var tools = [bold, italic, under, sep, size, clear];
    var linkBtn = null;
    if (opts.links) {
      linkBtn = btn('Link', 'Add a link to the selected text, or remove the link the cursor is in', '&#128279; Link');
      tools.push(linkBtn);
    }
    var alignBtns = [];
    if (opts.align) {
      var sep2 = document.createElement('span');
      sep2.className = 'sep';
      tools.push(sep2);
      [['justifyLeft', 'Align left', '&#8676;'], ['justifyCenter', 'Centre', '&#8596;'], ['justifyRight', 'Align right', '&#8677;']]
        .forEach(function (a) {
          var b = btn(a[1], a[1] + ' (the line or selected lines)', a[2]);
          b.addEventListener('click', function () { exec(a[0]); });
          alignBtns.push([b, a[0]]);
          tools.push(b);
        });
    }
    var srcBtn = null, src = null, note = null, sourceMode = false;
    if (opts.source) {
      srcBtn = btn('HTML', 'Edit the HTML code', '&lt;/&gt; HTML');
      srcBtn.classList.add('push');
      tools.push(srcBtn);
      src = document.createElement('textarea');
      src.className = 'rte-src';
      src.spellcheck = false;
      src.style.display = 'none';
      note = document.createElement('div');
      note.className = 'rte-note';
      note.style.display = 'none';
      note.textContent = opts.blocks
        ? 'Allowed: b, i, u, strong, em, br, p, div, h2, h3, h4, ul, ol, li, blockquote, hr, ' +
          'links (a href), font-size and text-align styles. Anything else is removed when you save.'
        : 'Allowed: b, i, u, strong, em, br, links (a href) and font-size styles. ' +
          'Anything else is removed when you save (this text sits inside one paragraph).';
    }

    tools.forEach(function (el) { bar.appendChild(el); });
    wrap.appendChild(bar);
    wrap.appendChild(area);
    if (src) { wrap.appendChild(src); wrap.appendChild(note); }

    function changed() { normalise(area); if (onChange) onChange(area.innerHTML); refresh(); }
    function exec(cmd, val) { area.focus(); document.execCommand(cmd, false, val); changed(); }
    function refresh() {
      if (sourceMode) return;
      bold.classList.toggle('on', document.queryCommandState('bold'));
      italic.classList.toggle('on', document.queryCommandState('italic'));
      under.classList.toggle('on', document.queryCommandState('underline'));
      alignBtns.forEach(function (a) { a[0].classList.toggle('on', document.queryCommandState(a[1])); });
    }

    if (linkBtn) {
      linkBtn.addEventListener('click', function () {
        var sel = window.getSelection();
        if (!sel.rangeCount || !area.contains(sel.anchorNode)) { alert('Click in the text or select the words to link first.'); return; }
        var node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentNode;
        var inLink = node.closest && node.closest('a');
        if (inLink && area.contains(inLink) && sel.isCollapsed) {
          if (!confirm('Remove this link (' + inLink.getAttribute('href') + ')? The words stay.')) return;
          while (inLink.firstChild) inLink.parentNode.insertBefore(inLink.firstChild, inLink);
          inLink.parentNode.removeChild(inLink);
          changed();
          return;
        }
        if (sel.isCollapsed) { alert('Select the words you want to turn into a link.'); return; }
        var range = sel.getRangeAt(0).cloneRange();
        var url = prompt('Link address (https://…, mailto:…, or a page on this site such as /bio):', 'https://');
        if (!url) return;
        url = url.trim();
        if (!/^(https?:\/\/\S+|mailto:\S+|\/(?!\/)\S*|#\S*)$/i.test(url)) { alert('Please use a web address starting with https://, an email starting with mailto:, or a site page starting with /.'); return; }
        var newTab = /^https?:/i.test(url) && confirm('Open this link in a new tab?');
        sel.removeAllRanges();
        sel.addRange(range);
        area.focus();
        var marker = 'rte-link-' + Date.now();
        document.execCommand('createLink', false, marker);
        Array.prototype.forEach.call(area.querySelectorAll('a[href="' + marker + '"]'), function (a) {
          a.setAttribute('href', url);
          if (newTab) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); }
        });
        changed();
      });
    }

    if (srcBtn) {
      srcBtn.addEventListener('click', function () {
        sourceMode = !sourceMode;
        if (sourceMode) {
          normalise(area);
          // Typed / pasted line breaks become <br> so the HTML view keeps them.
          if (!opts.blocks && /\n/.test(area.innerHTML)) area.innerHTML = area.innerHTML.replace(/\r?\n/g, '<br>');
          src.value = prettify(area.innerHTML);
          area.style.display = 'none';
          src.style.display = note.style.display = '';
          src.focus();
        } else {
          area.innerHTML = unprettify(src.value);
          src.style.display = note.style.display = 'none';
          area.style.display = '';
          changed();
        }
        srcBtn.classList.toggle('on', sourceMode);
        srcBtn.innerHTML = sourceMode ? '&#10003; Done editing HTML' : '&lt;/&gt; HTML';
        tools.forEach(function (el) { if (el !== srcBtn && el.tagName !== 'SPAN') el.disabled = sourceMode; });
      });
      src.addEventListener('input', function () { if (onChange) onChange(unprettify(src.value)); });
    }

    // Keep the text selection when clicking toolbar buttons.
    bar.addEventListener('mousedown', function (e) { if (e.target.tagName !== 'SELECT') e.preventDefault(); });
    bold.addEventListener('click', function () { exec('bold'); });
    italic.addEventListener('click', function () { exec('italic'); });
    under.addEventListener('click', function () { exec('underline'); });
    clear.addEventListener('click', function () {
      exec('removeFormat');
      // removeFormat leaves our size spans alone; strip sizes inside the selection.
      var sel = window.getSelection();
      Array.prototype.slice.call(area.querySelectorAll('span')).forEach(function (s) {
        if (sel.rangeCount && sel.getRangeAt(0).intersectsNode(s)) s.style.fontSize = '';
      });
      changed();
    });

    var saved = null;
    size.addEventListener('focus', function () {
      var sel = window.getSelection();
      saved = sel.rangeCount && area.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
    });
    size.addEventListener('change', function () {
      var choice = SIZES[+size.value];
      size.selectedIndex = 0;
      if (!saved || saved.collapsed) { alert('Select some text first, then choose a size.'); return; }
      area.focus();
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(saved);
      document.execCommand('styleWithCSS', false, false);
      document.execCommand('fontSize', false, '7');
      Array.prototype.slice.call(area.querySelectorAll('font[size="7"]')).forEach(function (f) {
        f.setAttribute('data-size', choice.value || '1em');
      });
      changed();
    });

    // Enter makes a line break (the page shows these inside one paragraph).
    area.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); document.execCommand('insertLineBreak'); changed(); }
    });
    // Paste as plain text so formatting from Word or web pages doesn't come along.
    area.addEventListener('paste', function (e) {
      e.preventDefault();
      var text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
      changed();
    });
    area.addEventListener('input', changed);
    area.addEventListener('keyup', refresh);
    area.addEventListener('mouseup', refresh);

    return {
      el: wrap,
      area: area,
      getHTML: function () {
        if (sourceMode) return unprettify(src.value);
        normalise(area);
        return area.innerHTML;
      }
    };
  }

  // Swap a <textarea data-rich> for the editor, keeping the textarea in sync
  // so the form submits as before.
  function enhance(textarea) {
    var ed = create(textarea.value, function (html) { textarea.value = html; },
      optionsFor(textarea.getAttribute('data-rich')));
    textarea.style.display = 'none';
    textarea.parentNode.insertBefore(ed.el, textarea.nextSibling);
    return ed;
  }

  window.RichEditor = { create: create, enhance: enhance, optionsFor: optionsFor };

  document.addEventListener('DOMContentLoaded', function () {
    Array.prototype.forEach.call(document.querySelectorAll('textarea[data-rich]'), enhance);
  });
})();
