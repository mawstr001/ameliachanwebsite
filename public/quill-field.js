/* ============================================================
   QUILL FIELD — the Writings-style editor (HTML / WYSIWYG /
   Preview tabs) for formatted page text: the Home lead paragraph,
   the Bio paragraphs and the First Principles text.
   Used by the admin content forms (<textarea data-quill>) and by
   Edit Mode on the live pages. Needs Quill 2 (quill.js + snow css).
   The server cleans the result (rich-text.js) before saving.
   ============================================================ */
(function () {
  var TOOLBAR = [
    ['bold', 'italic', 'underline'],
    [{ size: ['small', false, 'large', 'huge'] }],
    [{ header: [2, 3, false] }],
    [{ align: [] }],
    ['blockquote'],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['link', 'image', 'video'],
    ['clean']
  ];

  var css =
    '.qf{display:flex;flex-direction:column}' +
    '.qf-tabs{display:flex;gap:4px}' +
    '.qf-tab{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-bottom:none;color:#8a9baa;' +
      'font:11px "JetBrains Mono",monospace;letter-spacing:.14em;text-transform:uppercase;padding:7px 16px;border-radius:4px 4px 0 0;cursor:pointer}' +
    '.qf-tab:hover{background:rgba(47,111,143,.2);color:#c0cdd6}' +
    '.qf-tab.active{background:rgba(47,111,143,.3);border-color:#2f6f8f;color:#83b4cb}' +
    '.qf-panel{display:none}.qf-panel.active{display:block}' +
    '.qf-html{display:block;width:100%;box-sizing:border-box;min-height:200px;resize:vertical;background:#0d1820;color:#e8e2d6;' +
      'border:1px solid rgba(255,255,255,.12);border-radius:0 0 4px 4px;padding:12px 14px;font:13px/1.6 "JetBrains Mono",monospace}' +
    '.qf .ql-toolbar.ql-snow{background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.12);border-bottom:none}' +
    '.qf .ql-toolbar.ql-snow .ql-stroke{stroke:#8a9baa}.qf .ql-toolbar.ql-snow .ql-fill{fill:#8a9baa}' +
    '.qf .ql-toolbar.ql-snow .ql-picker{color:#8a9baa}' +
    '.qf .ql-toolbar.ql-snow button:hover .ql-stroke,.qf .ql-toolbar.ql-snow .ql-active .ql-stroke{stroke:#83b4cb}' +
    '.qf .ql-toolbar.ql-snow button:hover .ql-fill,.qf .ql-toolbar.ql-snow .ql-active .ql-fill{fill:#83b4cb}' +
    '.qf .ql-toolbar.ql-snow .ql-picker-options{background:#112230;border-color:#2f6f8f}' +
    '.qf .ql-container.ql-snow{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:0 0 4px 4px;' +
      'color:#e8e2d6;font:17px/1.6 "EB Garamond",Georgia,serif}' +
    '.qf .ql-editor{min-height:170px}.qf .ql-editor a{color:#d8b872}' +
    '.qf .ql-editor img{max-width:100%}.qf .ql-editor .ql-video{width:100%;aspect-ratio:16/9;height:auto}' +
    '.qf .ql-snow .ql-tooltip{z-index:5}' +
    '.qf-preview{min-height:170px;background:#efe8d8;color:#4a4236;padding:22px 26px;border-radius:0 0 4px 4px;' +
      'font:19px/1.6 "EB Garamond",Georgia,serif}' +
    '.qf-note{font:11px/1.5 system-ui,sans-serif;color:#7b8794;margin-top:6px}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // Older plain-text content (with typed line breaks) becomes one paragraph.
  function toEditorHTML(html) {
    // Scripts and styles typed into the HTML tab are dropped, not turned into text.
    html = (html || '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
    if (!/<(p|div|h[1-6]|ul|ol|blockquote|iframe|img)\b/i.test(html)) {
      html = '<p>' + html.replace(/\r?\n/g, '<br>') + '</p>';
    }
    return html;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function create(initialHTML, opts) {
    opts = opts || {};
    if (!window.Quill) throw new Error('Quill is not loaded');
    var wrap = el('div', 'qf');
    var tabs = el('div', 'qf-tabs');
    var names = ['HTML', 'WYSIWYG', 'Preview'];
    var tabBtns = {};
    names.forEach(function (n) {
      var b = el('button', 'qf-tab', n);
      b.type = 'button';
      tabBtns[n] = b;
      tabs.appendChild(b);
    });
    var pHtml = el('div', 'qf-panel');
    var html = el('textarea', 'qf-html');
    html.spellcheck = false;
    pHtml.appendChild(html);
    var pWys = el('div', 'qf-panel active');
    var editorDiv = el('div');
    pWys.appendChild(editorDiv);
    var pPrev = el('div', 'qf-panel');
    var preview = el('div', 'qf-preview rich');
    pPrev.appendChild(preview);
    wrap.appendChild(tabs);
    wrap.appendChild(pHtml);
    wrap.appendChild(pWys);
    wrap.appendChild(pPrev);
    wrap.appendChild(el('div', 'qf-note',
      'Tip: the HTML tab edits the code directly. Scripts, styles and unsupported tags are removed when you save.'));

    var quill = new Quill(editorDiv, {
      theme: 'snow',
      bounds: wrap,
      modules: { toolbar: { container: TOOLBAR, handlers: { image: imageHandler, video: videoHandler } } },
      placeholder: opts.placeholder || 'Write here…'
    });
    quill.clipboard.dangerouslyPasteHTML(toEditorHTML(initialHTML), 'silent');

    function imageHandler() {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.addEventListener('change', function () {
        var file = input.files[0];
        if (!file) return;
        var fd = new FormData();
        fd.append('image', file);
        fetch('/admin/api/upload', { method: 'POST', body: fd })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (!d.ok || !d.url) { alert('Image upload failed.'); return; }
            var range = quill.getSelection(true);
            quill.insertEmbed(range.index, 'image', d.url, 'user');
            quill.setSelection(range.index + 1, 'silent');
          })
          .catch(function () { alert('Image upload failed.'); });
      });
      input.click();
    }

    function videoHandler() {
      var url = prompt('YouTube video URL:');
      if (!url) return;
      var m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/);
      if (!m) { alert('Could not find a YouTube video ID in that URL.'); return; }
      var range = quill.getSelection(true);
      quill.insertEmbed(range.index, 'video', 'https://www.youtube.com/embed/' + m[1], 'user');
      quill.setSelection(range.index + 1, 'silent');
    }

    // current = the editing tab whose content is authoritative (HTML or
    // WYSIWYG); visible = the tab on screen (may be Preview).
    var current = 'WYSIWYG', visible = 'WYSIWYG';
    function value() {
      if (current === 'HTML') return html.value;
      var v = quill.root.innerHTML;
      return v === '<p><br></p>' ? '' : v;
    }
    function show(name) {
      if (name === visible) return;
      var v = value();
      if (name === 'HTML' && current !== 'HTML') html.value = v;
      if (name === 'WYSIWYG' && current === 'HTML') quill.clipboard.dangerouslyPasteHTML(toEditorHTML(html.value), 'silent');
      if (name === 'Preview') preview.innerHTML = v;
      names.forEach(function (n) { tabBtns[n].classList.toggle('active', n === name); });
      [pHtml, pWys, pPrev].forEach(function (p, i) { p.classList.toggle('active', names[i] === name); });
      visible = name;
      if (name !== 'Preview') current = name;
    }
    names.forEach(function (n) { tabBtns[n].addEventListener('click', function () { show(n); }); });
    tabBtns.WYSIWYG.classList.add('active');

    var api = { el: wrap, quill: quill, getHTML: value };
    if (opts.onChange) {
      quill.on('text-change', function () { opts.onChange(value()); });
      html.addEventListener('input', function () { opts.onChange(value()); });
    }
    return api;
  }

  // Swap a <textarea data-quill> in an admin form for the editor; the
  // textarea keeps the current HTML so the form submits as before.
  function enhance(textarea) {
    var ed = create(textarea.value, { onChange: function (v) { textarea.value = v; } });
    textarea.style.display = 'none';
    textarea.parentNode.insertBefore(ed.el, textarea.nextSibling);
    if (textarea.form) textarea.form.addEventListener('submit', function () { textarea.value = ed.getHTML(); });
    return ed;
  }

  window.QuillField = { create: create, enhance: enhance };

  // If the editor can't load (e.g. the Quill CDN is unreachable), each box
  // stays a plain HTML textarea, so saving still works.
  function init() {
    Array.prototype.forEach.call(document.querySelectorAll('textarea[data-quill]'), function (ta) {
      try { enhance(ta); } catch (e) { console.warn('Formatted editor unavailable, showing HTML:', e.message); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
