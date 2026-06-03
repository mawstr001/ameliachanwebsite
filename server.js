const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const CONTENT_FILE = path.join(__dirname, 'data', 'content.json');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const BACKUPS_DIR = path.join(__dirname, 'data', 'backups');
if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

// ── Multer — always memory storage; Cloudinary handled in route ───────────────
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── MongoDB persistence (optional — falls back to file when not set) ──────────
let _mongoCol = null;
async function initMongo() {
  if (!process.env.MONGODB_URI) return;
  try {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    _mongoCol = client.db('amelia').collection('content');
    // On startup pull latest content from MongoDB → overwrite local file
    const doc = await _mongoCol.findOne({ _id: 'main' });
    if (doc) {
      const { _id, ...content } = doc;
      fs.writeFileSync(CONTENT_FILE, JSON.stringify(content, null, 2), 'utf8');
      console.log('Content synced from MongoDB');
    }
    console.log('MongoDB connected');
  } catch (e) {
    console.error('MongoDB init failed:', e.message);
  }
}

// ── Content helpers ───────────────────────────────────────────────────────────
function readContent() {
  try { return JSON.parse(fs.readFileSync(CONTENT_FILE, 'utf8')); }
  catch (e) { return {}; }
}
function writeContent(data) {
  // Save rolling backup before every write (keep last 30)
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(BACKUPS_DIR, `content-${ts}.json`), fs.readFileSync(CONTENT_FILE));
    const backups = fs.readdirSync(BACKUPS_DIR).filter(f => f.endsWith('.json')).sort();
    if (backups.length > 30) backups.slice(0, backups.length - 30).forEach(f => fs.unlinkSync(path.join(BACKUPS_DIR, f)));
  } catch (_) {}
  fs.writeFileSync(CONTENT_FILE, JSON.stringify(data, null, 2), 'utf8');
  // Mirror to MongoDB so content survives redeployment
  if (_mongoCol) {
    _mongoCol.replaceOne({ _id: 'main' }, { _id: 'main', ...data }, { upsert: true })
      .catch(e => console.error('MongoDB write failed:', e.message));
  }
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
app.post('/admin/api/upload', requireAdmin, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  let url;
  if (process.env.CLOUDINARY_URL) {
    try {
      const cloudinary = require('cloudinary').v2;
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'amelia-chan', resource_type: 'image' },
          (err, r) => err ? reject(err) : resolve(r)
        );
        stream.end(req.file.buffer);
      });
      url = result.secure_url;
    } catch (e) {
      console.error('Cloudinary upload error:', e.message);
      return res.status(500).json({ error: 'Image upload failed: ' + e.message });
    }
  } else {
    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    const ext = path.extname(req.file.originalname);
    const filename = Date.now() + '-' + Math.round(Math.random() * 1e6) + ext;
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), req.file.buffer);
    url = '/uploads/' + filename;
  }
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
initMongo().then(() => {
  app.listen(PORT, () => {
    console.log(`Amelia Chan — server running at http://localhost:${PORT}`);
    console.log(`Admin: http://localhost:${PORT}/admin`);
  });
});
