const express = require('express');
const session = require('express-session');
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

[BACKUPS_DIR, UPLOADS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// Seed content.json onto a fresh disk from the bundled default
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
function readContent() {
  try { return JSON.parse(fs.readFileSync(CONTENT_FILE, 'utf8')); }
  catch (e) { return {}; }
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
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'amelia-chan-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Pass isAdmin to all templates
app.use((req, res, next) => {
  res.locals.isAdmin = !!req.session.isAdmin;
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
  res.render('writings', { site: c.site, writings: c.writings, page: 'writings' });
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
  res.render('recordings', { site: c.site, recordings: c.recordings, page: 'recordings' });
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
  const { title, category, link } = req.body;
  const num = String(c.writings.length + 1).padStart(2, '0');
  c.writings.push({
    id: 'writing-' + Date.now(),
    number: num,
    title: title || 'Untitled',
    category: category || '',
    link: link || '#'
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

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Amelia Chan — server running at http://localhost:${PORT}`);
  console.log(`Admin: http://localhost:${PORT}/admin`);
});
