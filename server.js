const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// When DATA_DIR is set (Render persistent disk), all mutable files live there.
// Locally, fall back to the in-repo data/ folder and public/uploads/.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const CONTENT_FILE = path.join(DATA_DIR, 'content.json');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const UPLOADS_DIR = process.env.DATA_DIR
  ? path.join(DATA_DIR, 'uploads')
  : path.join(__dirname, 'public', 'uploads');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');

[BACKUPS_DIR, UPLOADS_DIR, SESSIONS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// Seed content.json onto a fresh disk from the bundled default. This is the
// only time the bundled data/content.json is used: once the live file exists,
// code updates never overwrite it.
if (!fs.existsSync(CONTENT_FILE)) {
  fs.copyFileSync(path.join(__dirname, 'data', 'content.json'), CONTENT_FILE);
}

// ── Multer ────────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ── Content helpers ───────────────────────────────────────────────────────────
// Text that used to be hard-coded in the templates. Filled in underneath the
// stored content so an existing content.json picks these up without losing
// anything, and the first edit writes them into the file.
const CONTENT_DEFAULTS = {
  home: {
    method: {
      label: 'The Method',
      heading: 'The First Principles Violin System',
      cta: 'Explore the method →',
      p1Title: 'Biomechanics',
      p1Desc: 'Movement optimised for efficiency and power — reducing tension, preventing injury.',
      p2Title: 'Acoustics',
      p2Desc: 'The science of sound: how string, wood, and bow create true intonation and tone.',
      p3Title: 'Cognition',
      p3Desc: 'Score analysis and focus that make consistent, expressive performance possible.'
    }
  },
  firstPrinciples: {
    fundamentalsLabel: 'The Fundamentals',
    method1Label: 'Biomechanics in Action',
    method1Desc: 'Optimise every movement and posture for efficiency and power — reducing tension and preventing injury.',
    method2Label: 'Fundamental Acoustics',
    method2Desc: 'The science of sound production: how string, wood, and bow pressure create true intonation and tone.',
    method3Label: 'Mental Cognition',
    method3Desc: 'Score analysis, mental mapping, and focus that ensure consistent, expressive performance.'
  },
  site: {
    copyright: '© 2026 Amelia Chan · Violinist'
  },
  pages: {
    recordings: { label: 'Recordings', heading: 'Recordings', eyebrow: 'Hover to play' },
    writings: { label: 'Archive', heading: 'The Archive', eyebrow: 'Technique · Structure · Practice' }
  }
};

function fillDefaults(target, defaults) {
  Object.entries(defaults).forEach(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!target[k] || typeof target[k] !== 'object') target[k] = {};
      fillDefaults(target[k], v);
    } else if (target[k] === undefined) {
      target[k] = v;
    }
  });
  return target;
}

// One-time text changes shipped with a code update. Each runs once, at
// startup, and is recorded in content.json's _migrations list so it never
// runs again — after that the saved text is only ever changed by an admin.
// Each one only replaces untouched old defaults, so customised text is kept.
const MIGRATIONS = [
  ['2026-09-rename-writings-to-archive', c => {
    const w = c.pages && c.pages.writings;
    if (w && w.label === 'Writings') w.label = 'Archive';
    if (w && w.heading === 'Notes on the first principles.') w.heading = 'The Archive';
  }],
  ['2026-09-recordings-heading', c => {
    const r = c.pages && c.pages.recordings;
    if (r && r.heading === 'Selected performances.') r.heading = 'Recordings';
  }]
];

function readContent() {
  let c;
  try { c = JSON.parse(fs.readFileSync(CONTENT_FILE, 'utf8')); }
  catch (e) { c = {}; }
  // Only fills keys that are missing; never replaces saved text.
  return fillDefaults(c, CONTENT_DEFAULTS);
}
function writeContent(data) {
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(BACKUPS_DIR, `content-${ts}.json`), fs.readFileSync(CONTENT_FILE));
    const backups = fs.readdirSync(BACKUPS_DIR).filter(f => f.endsWith('.json')).sort();
    if (backups.length > 30) backups.slice(0, backups.length - 30).forEach(f => fs.unlinkSync(path.join(BACKUPS_DIR, f)));
  } catch (_) {}
  fs.writeFileSync(CONTENT_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Write every piece of editable text into content.json so the file holds
// all of it, and apply any one-time migrations that haven't run yet.
// Existing saved text is never replaced.
(function prepareContentFile() {
  let stored;
  try { stored = JSON.parse(fs.readFileSync(CONTENT_FILE, 'utf8')); }
  catch (e) {
    console.error('content.json could not be read — leaving it untouched:', e.message);
    return;
  }
  const before = JSON.stringify(stored);
  fillDefaults(stored, CONTENT_DEFAULTS);
  const done = Array.isArray(stored._migrations) ? stored._migrations : [];
  MIGRATIONS.forEach(([id, run]) => {
    if (done.includes(id)) return;
    run(stored);
    done.push(id);
  });
  stored._migrations = done;
  if (JSON.stringify(stored) !== before) writeContent(stored);
})();

if (!process.env.DATA_DIR && process.env.NODE_ENV === 'production') {
  console.warn('WARNING: DATA_DIR is not set, so site content is stored inside the app folder (' +
    CONTENT_FILE + ') and a redeploy or git pull could replace it. Set DATA_DIR to a folder outside the app.');
}

function deepSet(obj, keyPath, value) {
  const keys = keyPath.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    // handle array notation like recordings[0]
    const k = keys[i];
    const arrMatch = k.match(/^(\w+)\[(\d+)\]$/);
    if (arrMatch) {
      const arr = arrMatch[1], idx = parseInt(arrMatch[2]);
      if (!cur[arr]) cur[arr] = [];
      if (!cur[arr][idx]) cur[arr][idx] = {};
      cur = cur[arr][idx];
    } else {
      if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
      cur = cur[k];
    }
  }
  const lastKey = keys[keys.length - 1];
  const arrMatch = lastKey.match(/^(\w+)\[(\d+)\]$/);
  if (arrMatch) {
    const arr = arrMatch[1], idx = parseInt(arrMatch[2]);
    if (!cur[arr]) cur[arr] = [];
    cur[arr][idx] = value;
  } else {
    cur[lastKey] = value;
  }
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1); // needed for secure cookies behind Render/Nginx proxy
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  store: new FileStore({ path: SESSIONS_DIR, ttl: 7 * 24 * 3600, reapInterval: 3600 }),
  secret: process.env.SESSION_SECRET || 'amelia-chan-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax' }
}));

const SITE_URL = (process.env.SITE_URL || 'https://ameliachanviolin.com').replace(/\/$/, '');

// Pass isAdmin and siteUrl to all templates
app.use((req, res, next) => {
  res.locals.isAdmin = !!req.session.isAdmin;
  res.locals.siteUrl = SITE_URL;
  next();
});

// ── Auth middleware ───────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (req.session.isAdmin) return next();
  res.redirect('/admin/login');
}

// ── Public routes ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const c = readContent();
  res.render('index', { site: c.site, home: c.home, page: 'home' });
});

app.get('/bio', (req, res) => {
  const c = readContent();
  res.render('bio', { site: c.site, bio: c.bio, press: c.press, page: 'bio' });
});

app.get('/first-principles', (req, res) => {
  const c = readContent();
  res.render('first-principles', {
    site: c.site,
    fp: c.firstPrinciples,
    writings: c.writings,
    page: 'first-principles'
  });
});

app.get('/writings', (req, res) => {
  const c = readContent();
  res.render('writings', { site: c.site, writings: c.writings, pageText: c.pages.writings, page: 'writings' });
});

// Individual essay pages
app.get('/writings/:slug', (req, res) => {
  const c = readContent();
  const essay = c.writings.find(w => w.slug === req.params.slug);
  if (!essay) return res.status(404).send('Essay not found');
  const idx = c.writings.indexOf(essay);
  const prev = idx > 0 ? c.writings[idx - 1] : null;
  const next = idx < c.writings.length - 1 ? c.writings[idx + 1] : null;
  res.render('essay', { site: c.site, essay, prev, next, page: 'writings' });
});

app.get('/recordings', (req, res) => {
  const c = readContent();
  res.render('recordings', { site: c.site, recordings: c.recordings, pageText: c.pages.recordings, page: 'recordings' });
});

// ── Admin auth routes ─────────────────────────────────────────────────────────
app.get('/admin/login', (req, res) => {
  if (req.session.isAdmin) return res.redirect('/admin');
  res.render('admin/login', { error: null });
});

app.post('/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.redirect('/admin');
  }
  res.render('admin/login', { error: 'Incorrect password.' });
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

// ── Admin dashboard ───────────────────────────────────────────────────────────
app.get('/admin', requireAdmin, (req, res) => {
  res.render('admin/dashboard', {});
});

// ── Admin: Writings ───────────────────────────────────────────────────────────
app.get('/admin/writings', requireAdmin, (req, res) => {
  const c = readContent();
  res.render('admin/writings', { writings: c.writings, saved: req.query.saved });
});

app.post('/admin/writings', requireAdmin, (req, res) => {
  const c = readContent();
  const { title, category, link, date } = req.body;
  const num = String(c.writings.length + 1).padStart(2, '0');
  // Newest first — the list is kept in reverse-chronological order
  c.writings.unshift({
    id: 'writing-' + Date.now(),
    number: num,
    title: title || 'Untitled',
    category: category || '',
    link: link || '#',
    date: date || ''
  });
  writeContent(c);
  res.redirect('/admin/writings?saved=1');
});

// Essay editor (full body edit)
app.get('/admin/writings/:id/edit', requireAdmin, (req, res) => {
  const c = readContent();
  const essay = c.writings.find(w => w.id === req.params.id);
  if (!essay) return res.redirect('/admin/writings');
  res.render('admin/essay-edit', { essay, saved: req.query.saved });
});

app.post('/admin/writings/:id/update', requireAdmin, (req, res) => {
  const c = readContent();
  const idx = c.writings.findIndex(w => w.id === req.params.id);
  if (idx !== -1) {
    // Generate slug from number if not set
    const slug = req.body.slug || c.writings[idx].slug || `essay-${req.body.number || c.writings[idx].number}`;
    c.writings[idx] = { ...c.writings[idx], ...req.body, slug };
    writeContent(c);
  }
  // If saving from essay editor, stay on editor; otherwise back to list
  const from = req.body._from || 'list';
  if (from === 'editor') return res.redirect(`/admin/writings/${req.params.id}/edit?saved=1`);
  res.redirect('/admin/writings?saved=1');
});

app.post('/admin/writings/:id/delete', requireAdmin, (req, res) => {
  const c = readContent();
  c.writings = c.writings.filter(w => w.id !== req.params.id);
  writeContent(c);
  res.redirect('/admin/writings');
});

// ── Admin: Recordings ─────────────────────────────────────────────────────────
app.get('/admin/recordings', requireAdmin, (req, res) => {
  const c = readContent();
  res.render('admin/recordings', { recordings: c.recordings, saved: req.query.saved });
});

app.post('/admin/recordings', requireAdmin, (req, res) => {
  const c = readContent();
  const { title, ensemble, link } = req.body;
  c.recordings.push({
    id: 'rec-' + Date.now(),
    title: title || 'Untitled',
    ensemble: ensemble || '',
    link: link || '#',
    image: ''
  });
  writeContent(c);
  res.redirect('/admin/recordings?saved=1');
});

app.post('/admin/recordings/:id/update', requireAdmin, (req, res) => {
  const c = readContent();
  const idx = c.recordings.findIndex(r => r.id === req.params.id);
  if (idx !== -1) {
    c.recordings[idx] = { ...c.recordings[idx], ...req.body };
    writeContent(c);
  }
  res.redirect('/admin/recordings?saved=1');
});

app.post('/admin/recordings/:id/delete', requireAdmin, (req, res) => {
  const c = readContent();
  c.recordings = c.recordings.filter(r => r.id !== req.params.id);
  writeContent(c);
  res.redirect('/admin/recordings');
});

// ── Admin: Press ──────────────────────────────────────────────────────────────
app.get('/admin/press', requireAdmin, (req, res) => {
  const c = readContent();
  res.render('admin/press', { press: c.press, saved: req.query.saved });
});

app.post('/admin/press', requireAdmin, (req, res) => {
  const c = readContent();
  const { quote, source, highlight, featured } = req.body;
  // unfeature others if this is featured
  if (featured === 'on') c.press.forEach(p => { p.featured = false; });
  c.press.push({
    id: 'press-' + Date.now(),
    quote: quote || '',
    source: source || '',
    highlight: highlight || '',
    featured: featured === 'on'
  });
  writeContent(c);
  res.redirect('/admin/press?saved=1');
});

app.post('/admin/press/:id/update', requireAdmin, (req, res) => {
  const c = readContent();
  const idx = c.press.findIndex(p => p.id === req.params.id);
  if (idx !== -1) {
    const isFeatured = req.body.featured === 'on';
    if (isFeatured) c.press.forEach(p => { p.featured = false; });
    c.press[idx] = {
      ...c.press[idx],
      quote: req.body.quote || c.press[idx].quote,
      source: req.body.source || c.press[idx].source,
      highlight: req.body.highlight !== undefined ? req.body.highlight : c.press[idx].highlight,
      featured: isFeatured
    };
    writeContent(c);
  }
  res.redirect('/admin/press?saved=1');
});

app.post('/admin/press/:id/delete', requireAdmin, (req, res) => {
  const c = readContent();
  c.press = c.press.filter(p => p.id !== req.params.id);
  writeContent(c);
  res.redirect('/admin/press');
});

// ── Admin: Version history / rollback ─────────────────────────────────────────
app.get('/admin/history', requireAdmin, (req, res) => {
  const backups = fs.readdirSync(BACKUPS_DIR)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse()
    .map(f => {
      const stat = fs.statSync(path.join(BACKUPS_DIR, f));
      return { filename: f, size: stat.size, date: stat.mtime };
    });
  res.render('admin/history', { backups, restored: req.query.restored });
});

app.post('/admin/history/restore/:filename', requireAdmin, (req, res) => {
  const safe = path.basename(req.params.filename);
  const src = path.join(BACKUPS_DIR, safe);
  if (!fs.existsSync(src)) return res.redirect('/admin/history');
  // Backup current before restore
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(BACKUPS_DIR, `content-${ts}.json`), fs.readFileSync(CONTENT_FILE));
  } catch (_) {}
  fs.copyFileSync(src, CONTENT_FILE);
  res.redirect('/admin/history?restored=1');
});

// ── Admin: Images ─────────────────────────────────────────────────────────────
app.get('/admin/images', requireAdmin, (req, res) => {
  const c = readContent();
  res.render('admin/images', { content: c, saved: req.query.saved });
});

// ── Admin API: update content key ─────────────────────────────────────────────
app.post('/admin/api/update', requireAdmin, (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'key required' });
  try {
    const c = readContent();
    deepSet(c, key, value);
    writeContent(c);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Admin API: upload image ───────────────────────────────────────────────────
app.post('/admin/api/upload', requireAdmin, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const url = '/uploads/' + req.file.filename;
  if (req.body.key) {
    try {
      const c = readContent();
      deepSet(c, req.body.key, url);
      writeContent(c);
    } catch (e) {}
  }
  res.json({ ok: true, url });
});

// ── Admin: Content Page Editors ──────────────────────────────────────────────
const CONTENT_PAGES = ['home', 'bio', 'first-principles', 'site'];

app.get('/admin/content/:page', requireAdmin, (req, res) => {
  if (!CONTENT_PAGES.includes(req.params.page)) return res.redirect('/admin');
  const c = readContent();
  res.render('admin/content-' + req.params.page, {
    home: c.home, bio: c.bio, fp: c.firstPrinciples, site: c.site,
    saved: req.query.saved === '1'
  });
});

app.post('/admin/content/:page', requireAdmin, (req, res) => {
  if (!CONTENT_PAGES.includes(req.params.page)) return res.redirect('/admin');
  const c = readContent();
  Object.entries(req.body).forEach(([key, val]) => {
    if (key) deepSet(c, key, String(val));
  });
  writeContent(c);
  res.redirect('/admin/content/' + req.params.page + '?saved=1');
});

// ── Sitemap ───────────────────────────────────────────────────────────────────
app.get('/sitemap.xml', (req, res) => {
  const c = readContent();
  const base = SITE_URL;
  const now = new Date().toISOString().split('T')[0];

  const staticPages = [
    { path: '/',                 priority: '1.0', freq: 'weekly' },
    { path: '/bio',              priority: '0.9', freq: 'monthly' },
    { path: '/first-principles', priority: '0.9', freq: 'monthly' },
    { path: '/writings',         priority: '0.8', freq: 'weekly' },
    { path: '/recordings',       priority: '0.7', freq: 'monthly' },
  ];

  const essayPages = (c.writings || [])
    .filter(w => w.slug)
    .map(w => ({ path: '/writings/' + w.slug, priority: '0.7', freq: 'monthly', lastmod: w.date || now }));

  const allPages = [...staticPages, ...essayPages];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allPages.map(p => `  <url>
    <loc>${base}${p.path}</loc>
    <lastmod>${p.lastmod || now}</lastmod>
    <changefreq>${p.freq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

  res.set('Content-Type', 'application/xml');
  res.send(xml);
});

// ── Robots ────────────────────────────────────────────────────────────────────
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(`User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${SITE_URL}/sitemap.xml\n`);
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Amelia Chan — server running at http://localhost:${PORT}`);
  console.log(`Admin: http://localhost:${PORT}/admin`);
});
