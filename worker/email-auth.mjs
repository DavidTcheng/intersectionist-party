const defaultSiteOrigin = 'https://intersectionist-party.davidtcheng.chatgpt.site';
const cookieName = '__Host-party-email-session';
const cookieAttributes = 'Path=/; HttpOnly; Secure; SameSite=Lax';
const linkLifetime = 20 * 60;
const sessionLifetime = 30 * 24 * 60 * 60;
const rateWindow = 60 * 60;
const tokenPattern = /^[a-f0-9]{64}$/;
const encoder = new TextEncoder();

function unixTime() {
  return Math.floor(Date.now() / 1000);
}

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

function privateToken() {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

async function tokenHash(token) {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(token)));
}

function normalizedEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(email)) return null;
  if (/[\x00-\x1f\x7f]/.test(email)) return null;
  return email;
}

function configuredOrigin(env) {
  try {
    const url = new URL(env.MEMBERSHIP_SITE_ORIGIN || defaultSiteOrigin);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function emailSignInReady(env) {
  return Boolean(env.DB && env.RESEND_API_KEY?.trim() && env.MEMBERSHIP_EMAIL_FROM?.trim()
    && env.MEMBERSHIP_RATE_SECRET?.trim() && configuredOrigin(env));
}

function sessionToken(request) {
  const cookies = request.headers.get('Cookie') || '';
  for (const cookie of cookies.split(';')) {
    const trimmed = cookie.trim();
    if (!trimmed.startsWith(cookieName + '=')) continue;
    const value = trimmed.slice(cookieName.length + 1);
    return tokenPattern.test(value) ? value : null;
  }
  return null;
}

export async function readEmailSession(request, env) {
  const token = sessionToken(request);
  if (!token) return null;
  return env.DB.prepare(`
    SELECT accounts.account_id AS accountId, accounts.email
    FROM party_email_sessions AS sessions
    JOIN party_email_accounts AS accounts ON accounts.account_id = sessions.account_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).bind(await tokenHash(token), unixTime()).first();
}

async function takeRateSlot(db, secret, email, clientIp, now) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const fingerprint = async value => hex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
  const [emailKey, ipKey] = await Promise.all([fingerprint(`email:${email}`), fingerprint(`ip:${clientIp}`)]);
  const cutoff = now - rateWindow;
  const limits = await db.prepare(`
    WITH buckets (rate_key, max_requests) AS (VALUES (?, 3), (?, 15))
    INSERT INTO party_email_rate_limits (rate_key, window_start, request_count)
    SELECT rate_key, ?, 1 FROM buckets
    WHERE NOT EXISTS (
      SELECT 1 FROM buckets AS checking
      JOIN party_email_rate_limits AS previous ON previous.rate_key = checking.rate_key
      WHERE previous.window_start > ? AND previous.request_count >= checking.max_requests
    )
    ON CONFLICT(rate_key) DO UPDATE SET
      window_start = CASE WHEN party_email_rate_limits.window_start <= ?
        THEN excluded.window_start ELSE party_email_rate_limits.window_start END,
      request_count = CASE WHEN party_email_rate_limits.window_start <= ?
        THEN 1 ELSE party_email_rate_limits.request_count + 1 END
    RETURNING rate_key
  `).bind(emailKey, ipKey, now, cutoff, cutoff, cutoff).all();
  return limits.results.length === 2;
}

async function removeExpired(db, now) {
  await db.batch([
    db.prepare(`DELETE FROM party_email_links WHERE token_hash IN (
      SELECT token_hash FROM party_email_links WHERE expires_at <= ? LIMIT 100
    )`).bind(now),
    db.prepare(`DELETE FROM party_email_sessions WHERE token_hash IN (
      SELECT token_hash FROM party_email_sessions WHERE expires_at <= ? LIMIT 100
    )`).bind(now),
    db.prepare(`DELETE FROM party_email_rate_limits WHERE rate_key IN (
      SELECT rate_key FROM party_email_rate_limits WHERE window_start <= ? LIMIT 100
    )`).bind(now - rateWindow),
  ]);
}

export async function requestEmailLink(request, url, env, fields) {
  const email = normalizedEmail(fields.get('email'));
  if (!email || request.headers.get('Origin') !== url.origin) return 'invalid';
  if (!emailSignInReady(env)) return 'unavailable';

  const db = env.DB;
  let pendingHash;
  try {
    const now = unixTime();
    const clientIp = request.headers.get('CF-Connecting-IP')?.trim() || 'unknown';
    if (!await takeRateSlot(db, env.MEMBERSHIP_RATE_SECRET, email, clientIp, now)) return 'limited';
    await removeExpired(db, now);

    const token = privateToken();
    pendingHash = await tokenHash(token);
    const link = new URL('/email-signin/confirm', configuredOrigin(env));
    link.searchParams.set('token', token);
    await db.prepare('INSERT INTO party_email_links (token_hash, email, expires_at) VALUES (?, ?, ?)')
      .bind(pendingHash, email, now + linkLifetime).run();

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: 'Bearer ' + env.RESEND_API_KEY.trim(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.MEMBERSHIP_EMAIL_FROM.trim(),
        to: [email],
        subject: 'Sign in to the Intersectionist Party',
        text: `Open this link to sign in to the Intersectionist Party. It expires in 20 minutes and can be used once.\n\n${link.href}\n\nIf you did not request this link, you can ignore the email.`,
      }),
    });
    if (response.ok) return 'sent';
  } catch {
    // Keep credentials, addresses, and the provider response out of logs.
  }

  if (pendingHash) {
    try {
      await db.prepare('DELETE FROM party_email_links WHERE token_hash = ?').bind(pendingHash).run();
    } catch {
      // An unreachable database may leave the short-lived link until cleanup.
    }
  }
  return 'unavailable';
}

async function legacyAccountId(db, email, legacyUser) {
  if (legacyUser?.accountId && normalizedEmail(legacyUser.email) === email) {
    const legacyMember = await db.prepare('SELECT account_id FROM members WHERE account_id = ?')
      .bind(legacyUser.accountId).first();
    if (legacyMember) return legacyMember.account_id;
  }
  const legacyMembers = await db.prepare(`
    SELECT account_id FROM members WHERE email_updates = 1 AND email = ? COLLATE NOCASE LIMIT 2
  `).bind(email).all();
  return legacyMembers.results.length === 1 ? legacyMembers.results[0].account_id : null;
}

async function accountForEmail(db, email, now, legacyUser) {
  const existing = db.prepare('SELECT account_id FROM party_email_accounts WHERE email = ?').bind(email);
  let account = await existing.first();
  if (account) return account.account_id;

  const legacyId = await legacyAccountId(db, email, legacyUser);
  const fallbackId = 'email_' + privateToken();
  const insert = db.prepare(`
    INSERT INTO party_email_accounts (account_id, email, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING
  `);
  await insert.bind(legacyId || fallbackId, email, now).run();
  account = await existing.first();
  if (!account && legacyId) {
    await insert.bind(fallbackId, email, now).run();
    account = await existing.first();
  }
  return account?.account_id || null;
}

export async function redeemEmailLink(env, token, legacyUser = null) {
  if (typeof token !== 'string' || !tokenPattern.test(token)) return null;
  const db = env.DB;
  const now = unixTime();
  const link = await db.prepare('DELETE FROM party_email_links WHERE token_hash = ? AND expires_at > ? RETURNING email')
    .bind(await tokenHash(token), now).first();
  if (!link) return null;

  const accountId = await accountForEmail(db, link.email, now, legacyUser);
  if (!accountId) return null;
  const session = privateToken();
  await db.prepare('INSERT INTO party_email_sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)')
    .bind(await tokenHash(session), accountId, now + sessionLifetime).run();
  const sessionCookie = `${cookieName}=${session}; ${cookieAttributes}; Max-Age=${sessionLifetime}`;
  return { sessionCookie, email: link.email, accountId };
}

export async function endEmailSession(request, env) {
  const token = sessionToken(request);
  if (token) {
    await env.DB.prepare('DELETE FROM party_email_sessions WHERE token_hash = ?').bind(await tokenHash(token)).run();
  }
  return `${cookieName}=; ${cookieAttributes}; Max-Age=0`;
}

export async function deleteEmailAccount(db, accountId) {
  await db.batch([
    db.prepare('DELETE FROM party_email_links WHERE email = (SELECT email FROM party_email_accounts WHERE account_id = ?)').bind(accountId),
    db.prepare('DELETE FROM party_email_accounts WHERE account_id = ?').bind(accountId),
    db.prepare('DELETE FROM members WHERE account_id = ?').bind(accountId),
  ]);
}
