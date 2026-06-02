/* ============================================================
   ADMIN BAR — Inline content editor for admin users
   ============================================================ */
(function () {
  if (!document.body.dataset.adminMode) return;

  // ── Inject admin bar ──────────────────────────────────────────────────────
  var bar = document.createElement('div');
  bar.id = 'admin-bar';
  bar.innerHTML =
    '<span class="admin-bar-brand">ADMIN</span>' +
    '<div class="admin-bar-center">' +
      '<button id="admin-edit-toggle" type="button">Edit Mode</button>' +
    '</div>' +
    '<div class="admin-bar-links">' +
      '<a href="/admin/writings">Writings</a>' +
      '<a href="/admin/recordings">Recordings</a>' +
      '<a href="/admin/press">Press</a>' +
      '<a href="/admin/images">Images</a>' +
      '<span class="admin-bar-sep"></span>' +
      '<a href="/admin/logout" class="logout">Logout</a>' +
    '</div>';
  document.body.appendChild(bar);

  var toggle = document.getElementById('admin-edit-toggle');
  var editMode = false;
  var activePopover = null;

  // ── Toggle edit mode ──────────────────────────────────────────────────────
  toggle.addEventListener('click', function () {
    editMode = !editMode;
    document.body.classList.toggle('admin-mode-on', editMode);
    toggle.textContent = editMode ? 'Editing ON' : 'Edit Mode';
    toggle.classList.toggle('editing', editMode);

    if (!editMode && activePopover) {
      closePopover();
    }

    // Disable clicks on anchor wrappers so edit clicks aren't intercepted
    var panels = document.querySelectorAll('a.home-panel, a.wr, a.rec');
    panels.forEach(function (el) {
      el.style.pointerEvents = editMode ? 'none' : '';
    });
  });

  // ── Edit element click handler ────────────────────────────────────────────
  document.addEventListener('click', function (e) {
    if (!editMode) return;

    // Close popover if click outside
    if (activePopover && !activePopover.contains(e.target)) {
      closePopover();
      return;
    }
    if (activePopover) return;

    var el = e.target.closest('[data-edit]');
    if (!el) return;

    e.preventDefault();
    e.stopPropagation();
    openPopover(el);
  }, true);

  // ── Keyboard: Escape closes popover ──────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && activePopover) {
      closePopover();
    }
  });

  // ── Open inline edit popover ──────────────────────────────────────────────
  function openPopover(el) {
    var key = el.dataset.edit;
    if (!key) return;

    var popover = document.createElement('div');
    popover.className = 'admin-edit-popover';

    var currentVal = el.innerText.trim();

    popover.innerHTML =
      '<div class="admin-edit-popover-label">' + escHtml(key) + '</div>' +
      '<textarea rows="3">' + escHtml(currentVal) + '</textarea>' +
      '<div class="admin-edit-popover-actions">' +
        '<button class="admin-popover-cancel" type="button">Cancel</button>' +
        '<button class="admin-popover-save" type="button">Save</button>' +
      '</div>';

    document.body.appendChild(popover);
    activePopover = popover;

    var textarea = popover.querySelector('textarea');
    textarea.focus();
    textarea.select();

    // Position near element
    positionPopover(popover, el);

    // Save
    popover.querySelector('.admin-popover-save').addEventListener('click', function () {
      var val = textarea.value;
      saveKey(key, val, function (ok) {
        if (ok) {
          el.innerText = val;
          closePopover();
        }
      });
    });

    // Save on Ctrl+Enter / Cmd+Enter
    textarea.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        popover.querySelector('.admin-popover-save').click();
      }
    });

    // Cancel
    popover.querySelector('.admin-popover-cancel').addEventListener('click', closePopover);
  }

  function closePopover() {
    if (activePopover) {
      activePopover.remove();
      activePopover = null;
    }
  }

  function positionPopover(popover, el) {
    var rect = el.getBoundingClientRect();
    var pw = 420;
    var ph = 160;
    var margin = 12;
    var vw = window.innerWidth;
    var vh = window.innerHeight - 54; // account for admin bar

    var top = rect.bottom + margin;
    var left = rect.left;

    // Flip if would go off bottom
    if (top + ph > vh) {
      top = rect.top - ph - margin;
    }
    // Clamp left
    if (left + pw > vw - margin) {
      left = vw - pw - margin;
    }
    if (left < margin) left = margin;
    // Clamp top
    if (top < margin) top = margin;

    popover.style.top = top + 'px';
    popover.style.left = left + 'px';
  }

  // ── Image upload for data-edit-image elements ─────────────────────────────
  document.addEventListener('click', function (e) {
    if (!editMode) return;
    var el = e.target.closest('[data-edit-image]');
    if (!el) return;
    var key = el.getAttribute('data-edit-image');
    if (!key) return;

    e.preventDefault();
    e.stopPropagation();

    // Create hidden file input
    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    fileInput.addEventListener('change', function () {
      var file = fileInput.files[0];
      if (!file) { fileInput.remove(); return; }
      uploadImage(file, key, function (url) {
        if (url) {
          // Update the image-slot src attribute
          el.setAttribute('src', url);
        }
        fileInput.remove();
      });
    });

    fileInput.click();
  }, true);

  // ── API calls ─────────────────────────────────────────────────────────────
  function saveKey(key, value, cb) {
    fetch('/admin/api/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: key, value: value })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) { cb(d.ok); })
      .catch(function () { cb(false); });
  }

  function uploadImage(file, key, cb) {
    var fd = new FormData();
    fd.append('image', file);
    if (key) fd.append('key', key);
    fetch('/admin/api/upload', { method: 'POST', body: fd })
      .then(function (r) { return r.json(); })
      .then(function (d) { cb(d.ok ? d.url : null); })
      .catch(function () { cb(null); });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
})();
