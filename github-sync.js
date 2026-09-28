// ── GitHub sync ───────────────────────────────────────────────────────────────
// Render's free instances have no persistent disk: every deploy, restart or
// spin-down wipes files written at runtime. To keep admin edits, every save
// is committed to the GitHub repo (data/content.json and public/uploads/*),
// and on startup the latest content is pulled back from GitHub.
//
// Configure with environment variables:
//   GITHUB_TOKEN   fine-grained token with "Contents: read and write" on the repo
//   GITHUB_REPO    owner/name            (default mawstr001/ameliachanwebsite)
//   GITHUB_BRANCH  branch to commit to   (default main)
//
// Commit messages carry [skip render] so a save doesn't trigger a redeploy.

const fs = require('fs');

const TOKEN = (process.env.GITHUB_TOKEN || '').trim();
const REPO = process.env.GITHUB_REPO || 'mawstr001/ameliachanwebsite';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const CONTENT_PATH = 'data/content.json';
const UPLOADS_PATH = 'public/uploads';
const SKIP = ' [skip render]';
const API = process.env.GITHUB_API_URL || 'https://api.github.com';

const status = {
  configured: !!TOKEN,
  ready: false,        // true once startup pull succeeded; pushes wait for it
  lastSaved: null,
  lastError: null,
  // Names only (never values) of env vars that look like a misspelt token
  // setting, shown on the dashboard to help spot a typo in Render.
  similarNames: Object.keys(process.env).filter(k => k !== 'GITHUB_TOKEN' && /github|token/i.test(k)),
  tokenSetButBlank: process.env.GITHUB_TOKEN !== undefined && !TOKEN
};

function api(path, opts = {}) {
  return fetch(`${API}/repos/${REPO}/contents/${path}`, {
    // Never let a slow GitHub hold up startup or a save indefinitely.
    signal: AbortSignal.timeout(10000),
    ...opts,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'amelia-chan-site',
      ...(opts.headers || {})
    }
  });
}

async function getFile(path) {
  const r = await api(`${path}?ref=${encodeURIComponent(BRANCH)}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub read ${path}: ${r.status}`);
  const j = await r.json();
  // Files over 1MB come back without inline content; fetch the raw bytes.
  if (!j.content && j.download_url) {
    const raw = await api(`${path}?ref=${encodeURIComponent(BRANCH)}`, {
      headers: { Accept: 'application/vnd.github.raw+json' }
    });
    if (!raw.ok) throw new Error(`GitHub read ${path}: ${raw.status}`);
    return { sha: j.sha, content: Buffer.from(await raw.arrayBuffer()) };
  }
  return { sha: j.sha, content: Buffer.from(j.content || '', 'base64') };
}

async function putFile(path, buf, message) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await getFile(path);
    if (existing && existing.content.equals(buf)) return; // already up to date
    const r = await api(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: message + SKIP,
        content: buf.toString('base64'),
        branch: BRANCH,
        ...(existing ? { sha: existing.sha } : {})
      })
    });
    if (r.ok) return;
    // 409/422: the file changed between read and write — re-read and retry.
    if (r.status !== 409 && r.status !== 422) {
      throw new Error(`GitHub save ${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    }
  }
  throw new Error(`GitHub save ${path}: kept conflicting, gave up`);
}

// Saves run one at a time, in order.
let chain = Promise.resolve();
function enqueue(fn) {
  chain = chain.then(fn).then(
    () => { status.lastSaved = new Date(); status.lastError = null; },
    e => { status.lastError = e.message; console.error('GitHub sync:', e.message); }
  );
  return chain;
}

// Startup: pull the latest content from GitHub into the local content file.
// Retries a few times; if GitHub can't be reached, pushes stay off so stale
// local content can never overwrite newer content in the repo.
async function pullContent(contentFile, { keepLocal = false } = {}) {
  if (!status.configured) return;
  if (keepLocal) {
    // Content on a persistent disk is the master copy; GitHub is a backup.
    status.ready = true;
    console.log('GitHub sync: using saved content on the persistent disk; GitHub is a backup copy');
    return;
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const f = await getFile(CONTENT_PATH);
      if (f) {
        JSON.parse(f.content.toString('utf8')); // refuse to write broken JSON
        fs.writeFileSync(contentFile, f.content);
      }
      status.ready = true;
      console.log('GitHub sync: loaded latest content from ' + REPO + '@' + BRANCH);
      return;
    } catch (e) {
      status.lastError = 'Could not load content from GitHub (' + e.message + '). ' +
        'Edits made now will NOT be saved to GitHub — restart the service in Render and check again.';
      console.error('GitHub sync:', status.lastError);
      await new Promise(r => setTimeout(r, attempt * 2000));
    }
  }
}

// Content saves are batched: several quick edits become one commit.
let contentTimer = null;
function queueContent(contentFile, what) {
  if (!status.configured || !status.ready) return;
  clearTimeout(contentTimer);
  contentTimer = setTimeout(() => {
    enqueue(() => putFile(CONTENT_PATH, fs.readFileSync(contentFile), 'Admin: ' + (what || 'update site content')));
  }, 1500);
}

function commitUpload(localPath, filename) {
  if (!status.configured || !status.ready) return Promise.resolve();
  return enqueue(() => putFile(`${UPLOADS_PATH}/${filename}`, fs.readFileSync(localPath), 'Admin: upload image ' + filename));
}

// Fetch an uploaded image that isn't on this server's disk (e.g. after a
// restart) back from the repo. Returns true if it was saved to destPath.
async function fetchUpload(filename, destPath) {
  if (!status.configured) return false;
  const f = await getFile(`${UPLOADS_PATH}/${filename}`);
  if (!f) return false;
  fs.writeFileSync(destPath, f.content);
  return true;
}

// Step-by-step connection check for the admin dashboard. Reads only; never
// commits. Returns { ok, steps: [{ ok, text }] } in plain language.
async function check() {
  const steps = [];
  const add = (ok, text) => { steps.push({ ok, text }); return ok; };
  const done = () => ({ ok: steps.every(s => s.ok), steps });

  if (typeof fetch !== 'function') {
    add(false, `The server is running Node ${process.version}, which is too old. Node 20 or newer is needed — redeploy so Render picks up the version set in package.json.`);
    return done();
  }
  add(true, `Node ${process.version}`);
  if (!add(!!TOKEN, TOKEN ? 'GITHUB_TOKEN is set' : 'GITHUB_TOKEN is not set on this server (Render → Environment), or the site was not redeployed after adding it.')) return done();

  let r;
  try {
    r = await fetch(`${API}/repos/${REPO}`, {
      signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'amelia-chan-site' }
    });
  } catch (e) {
    add(false, 'Could not reach GitHub from the server: ' + e.message);
    return done();
  }
  if (r.status === 401) { add(false, 'GitHub rejected the token (401). It may be mistyped, expired or revoked — create a new one and paste it into Render.'); return done(); }
  if (r.status === 404 || r.status === 403) { add(false, `The token can't see ${REPO} (${r.status}). When creating the token, choose "Only select repositories" and pick ${REPO.split('/')[1]}. If the repo belongs to an organisation, the organisation may need to approve the token.`); return done(); }
  if (!r.ok) { add(false, `GitHub answered ${r.status} when looking up ${REPO}.`); return done(); }
  add(true, `Token can see ${REPO}`);
  const repo = await r.json();
  if (repo.permissions && !repo.permissions.push) {
    add(false, 'The token can read the repo but not write to it. Edit the token on GitHub: Repository permissions → Contents → "Read and write".');
    return done();
  }
  add(true, 'Token has write access');

  try {
    const f = await getFile(CONTENT_PATH);
    add(!!f, f ? `Found ${CONTENT_PATH} on branch ${BRANCH}` : `${CONTENT_PATH} not found on branch ${BRANCH}`);
  } catch (e) { add(false, e.message); }
  add(status.ready, status.ready ? 'Content was loaded from GitHub at startup, so saves are switched on'
    : 'Content was not loaded from GitHub at startup, so saves are switched off to protect newer content. Restart the service in Render once the steps above pass.');
  if (status.lastError) add(false, 'Last save error: ' + status.lastError);
  return done();
}

module.exports = { status, check, pullContent, queueContent, commitUpload, fetchUpload, REPO, BRANCH };
