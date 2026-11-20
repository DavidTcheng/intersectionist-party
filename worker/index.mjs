const safetyHeaders = {
  'Content-Security-Policy': "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex',
};

const notices = {
  joined: 'Your membership is active.',
  saved: 'Your email preference was updated.',
  suspended: 'Membership is suspended and idea emails are off.',
  resumed: 'Your membership is active again. Idea emails are off.',
  left: 'Your membership record was deleted.',
  published: 'The idea is visible to active members.',
  invalid: 'Check the form fields and try again.',
  emailRequested: 'If your email address can receive messages, a sign-in link will arrive shortly.',
  emailUnavailable: 'Sign-in links are temporarily unavailable. Try again later.',
  draftPrepared: 'Your individual draft is ready to review.',
  emailSent: 'The idea email was accepted for delivery.',
  notDue: 'This member is no longer eligible for this idea email.',
  emailRejected: 'The email provider declined the message. You can try again.',
  emailUncertain: 'Delivery could not be confirmed. The contact interval still applies.',
};

function page(content, status = 200, referrerPolicy = safetyHeaders['Referrer-Policy']) {
  return new Response(content, {
    status,
    headers: { ...safetyHeaders, 'Referrer-Policy': referrerPolicy, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' },
  });
}

function transition(path, sessionCookie) {
  const headers = { ...safetyHeaders, Location: path, 'Cache-Control': 'private, no-store' };
  if (sessionCookie) headers['Set-Cookie'] = sessionCookie;
  return new Response(null, { status: 303, headers });
}

function missing() {
  return new Response('Page not found', { status: 404, headers: { ...safetyHeaders, 'Cache-Control': 'no-store' } });
}

function noticeAt(url) {
  const value = url.searchParams.get('notice');
  return Object.hasOwn(notices, value) ? notices[value] : null;
}

function readAsset(asset, method) {
  const cache = asset.type.startsWith('text/html') ? 'public, max-age=0, must-revalidate' : 'public, max-age=300';
  const headers = { ...safetyHeaders, 'Content-Type': asset.type, 'Cache-Control': cache };
  delete headers['X-Robots-Tag'];
  const body = method === 'HEAD' ? null : Uint8Array.from(atob(asset.base64), character => character.charCodeAt(0));
  return new Response(body, { headers });
}

async function visitor(request) {
  // Trust these headers only in a build served through the authenticated Sites gateway.
  if (!trustSitesIdentity) return null;
  const identity = request.headers.get('oai-authenticated-user-id')?.trim();
  if (!identity) return null;
  const email = normalizedEmail(request.headers.get('oai-authenticated-user-email'));
  const bytes = new TextEncoder().encode(identity);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return { accountId: hex(new Uint8Array(hash)), email };
}

async function postFields(request, url) {
  if (request.headers.get('Origin') !== url.origin) return null;
  if (!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded')) return null;
  if (Number(request.headers.get('Content-Length')) > 16000) return null;
  const body = await request.text();
  return body.length > 16000 ? null : new URLSearchParams(body);
}

async function changeMembership(db, user, fields) {
  const action = fields.get('action');
  const now = new Date().toISOString();
  const rate = fields.get('contact_rate') ?? (fields.get('email_updates') === '1' ? 'weekly' : 'off');
  if (['join', 'preferences'].includes(action) && !['off', 'weekly', 'daily'].includes(rate)) return 'invalid';
  const email = rate === 'off' ? null : user.email;
  const enabled = Number(email !== null);
  const token = email ? privateToken() : null;
  const storedRate = rate === 'daily' ? 'daily' : 'weekly';

  if (action === 'join') {
    const result = await db.prepare(
      `INSERT INTO members (account_id, status, email_updates, email, unsubscribe_token, joined_at, updated_at, contact_rate)
       VALUES (?, 'active', ?, ?, ?, ?, ?, ?) ON CONFLICT(account_id) DO NOTHING`
    ).bind(user.accountId, enabled, email, token, now, now, storedRate).run();
    return result.meta.changes ? 'joined' : null;
  }

  if (action === 'preferences') {
    const result = await db.prepare(
      `UPDATE members
       SET unsubscribe_token = CASE WHEN email_updates = 1 AND email = ? THEN unsubscribe_token ELSE ? END,
           email_updates = ?, email = ?, updated_at = ?, contact_rate = ?
       WHERE account_id = ? AND status = 'active'`
    ).bind(email, token, enabled, email, now, storedRate, user.accountId).run();
    return result.meta.changes ? 'saved' : null;
  }

  if (action === 'suspend' || action === 'resume') {
    const status = action === 'suspend' ? 'suspended' : 'active';
    const expected = status === 'active' ? 'suspended' : 'active';
    const result = await db.prepare(
      'UPDATE members SET status = ?, email_updates = 0, email = NULL, unsubscribe_token = NULL, updated_at = ? WHERE account_id = ? AND status = ?'
    ).bind(status, now, user.accountId, expected).run();
    return result.meta.changes ? (action === 'suspend' ? 'suspended' : 'resumed') : null;
  }

  if (action === 'leave') {
    await deleteEmailAccount(db, user.accountId);
    return 'left';
  }

  return 'invalid';
}

async function latestIdeas(db) {
  const out = await db.prepare(
    'SELECT id, title, body, published_at FROM ideas ORDER BY published_at DESC, id DESC LIMIT 50'
  ).all();
  return out.results;
}

async function memberRoute(request, url, env, user, emailSession, isOrganizer) {
  const db = env.DB;
  const member = user ? await db.prepare(
    `SELECT status, joined_at AS joinedAt,
            CASE WHEN email_updates = 1 THEN contact_rate ELSE 'off' END AS contactRate
     FROM members WHERE account_id = ?`
  ).bind(user.accountId).first() : null;
  if (request.method === 'POST') {
    if (!emailSession && !member) return transition('/membership');
    const fields = await postFields(request, url);
    if (!fields) return page('This membership change could not be verified.', 403);
    if (fields.get('action') === 'join' && !emailSession) return transition('/membership');
    const result = await changeMembership(db, user, fields);
    const clearCookie = result === 'left' && emailSession ? await endEmailSession(request, env) : null;
    return transition(result ? '/membership?notice=' + result : '/membership', clearCookie);
  }

  const ideas = member?.status === 'active' ? await latestIdeas(db) : [];
  return page(renderMembership({
    signedIn: Boolean(emailSession || member), member, ideas, isOrganizer, canEmail: Boolean(user?.email),
    notice: noticeAt(url), emailSignInReady: emailSignInReady(env), emailSession: Boolean(emailSession),
  }));
}

function ideaMessage(idea, recipient, origin) {
  return {
    subject: 'Intersectionist Party idea: ' + idea.title,
    text: [
      idea.body,
      'This idea is still in development.',
      'Member ideas and preferences: ' + origin + '/membership',
      'Stop idea emails: ' + origin + '/unsubscribe?token=' + recipient.unsubscribe_token,
      'The Intersectionist Party',
    ].join('\r\n\r\n'),
  };
}

const dueForIdea = `
  m.status = 'active' AND m.email_updates = 1
  AND NOT EXISTS (
    SELECT 1 FROM idea_email_deliveries d
    WHERE d.account_id = m.account_id
      AND (d.idea_id = ? OR d.created_at > ? - CASE m.contact_rate WHEN 'daily' THEN 86400 ELSE 604800 END)
  )
`;

async function dispatchIdea(env, idea, recipient, origin) {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: 'Bearer ' + env.RESEND_API_KEY.trim(),
        'Content-Type': 'application/json',
        'Idempotency-Key': 'intersectionist-idea/' + idea.id + '/' + recipient.account_id,
      },
      body: JSON.stringify({
        from: env.MEMBERSHIP_EMAIL_FROM.trim(),
        to: [recipient.email],
        ...ideaMessage(idea, recipient, origin),
      }),
    });
    if (response.ok) return 'emailSent';
    if ([400, 401, 403, 422, 429].includes(response.status)) return 'emailRejected';
  } catch {
    // Preserve the contact interval when the provider could have accepted the request.
  }
  return 'emailUncertain';
}

async function renderOrganizerPage(env, id, notice, preparedDraft) {
  const db = env.DB;
  const ideas = await latestIdeas(db);
  const selectedIdea = ideas.find(idea => idea.id === id)
    ?? (id ? await db.prepare('SELECT id, title, body, published_at FROM ideas WHERE id = ?').bind(id).first() : null);
  const recipients = selectedIdea
    ? (await db.prepare(`
      SELECT m.account_id AS accountId, m.email FROM members AS m
      WHERE ${dueForIdea} ORDER BY m.email, m.account_id
    `).bind(id, unixTime()).all()).results
    : [];
  return page(renderOrganizer({ ideas, selectedIdea, recipients, preparedDraft, notice, automaticEmail: emailSignInReady(env) }));
}

async function contactMember(url, env, fields) {
  const db = env.DB;
  const action = fields.get('action');
  const email = action === 'email';
  const id = fields.get('idea_id') ?? '';
  const account = fields.get('account_id') ?? '';
  if (email !== emailSignInReady(env) || !/^[a-f0-9-]{36}$/.test(id) || !/^(email_)?[a-f0-9]{64}$/.test(account)) {
    return transition('/organize?notice=invalid');
  }
  const idea = await db.prepare('SELECT id, title, body FROM ideas WHERE id = ?').bind(id).first();
  if (!idea) return transition('/organize?notice=invalid');
  const returnPath = '/organize?idea=' + id + '&notice=';
  const now = unixTime();
  const reservation = await db.prepare(`
    INSERT INTO idea_email_deliveries (idea_id, account_id, created_at, status)
    SELECT ?, m.account_id, ?, ? FROM members AS m WHERE m.account_id = ? AND ${dueForIdea}
    ON CONFLICT (idea_id, account_id) DO NOTHING RETURNING account_id
  `).bind(id, now, email ? 'sending' : 'prepared', account, id, now).first();
  if (!reservation) return transition(returnPath + 'notDue');

  const recipient = await db.prepare(`
    SELECT account_id, email, unsubscribe_token FROM members
    WHERE account_id = ? AND status = 'active' AND email_updates = 1
  `).bind(account).first();
  const release = () => db.prepare('DELETE FROM idea_email_deliveries WHERE idea_id = ? AND account_id = ?')
    .bind(id, account).run();
  if (!recipient) {
    await release();
    return transition(returnPath + 'notDue');
  }
  const origin = configuredOrigin(env) ?? url.origin;
  if (!email) {
    const message = ideaMessage(idea, recipient, origin);
    const address = encodeURIComponent(recipient.email).replaceAll('%40', '@');
    const draftHref = 'mailto:' + address + '?subject=' + encodeURIComponent(message.subject)
      + '&body=' + encodeURIComponent(message.text);
    return renderOrganizerPage(env, id, notices.draftPrepared, { email: recipient.email, draftHref });
  }

  const result = await dispatchIdea(env, idea, recipient, origin);
  if (result === 'emailRejected') await release();
  if (result === 'emailSent') {
    await db.prepare("UPDATE idea_email_deliveries SET status = 'sent' WHERE idea_id = ? AND account_id = ?")
      .bind(id, account).run();
  }
  return transition(returnPath + result);
}

async function organizerRoute(request, url, env) {
  const db = env.DB;
  if (request.method === 'POST') {
    const fields = await postFields(request, url);
    if (!fields) return page('This organizer change could not be verified.', 403);
    const action = fields.get('action');
    if (action === 'draft' || action === 'email') return contactMember(url, env, fields);
    const title = fields.get('title')?.trim() ?? '';
    const body = fields.get('body')?.trim() ?? '';
    if (action !== 'publish' || !title || title.length > 100 ||
        title.includes('\n') || title.includes('\r') || !body || body.length > 1800) {
      return transition('/organize?notice=invalid');
    }
    const id = crypto.randomUUID();
    await db.prepare('INSERT INTO ideas VALUES (?, ?, ?, ?) ON CONFLICT(title, body) DO NOTHING')
      .bind(id, title, body, new Date().toISOString()).run();
    const existing = await db.prepare('SELECT id FROM ideas WHERE title = ? AND body = ?').bind(title, body).first();
    return transition('/organize?idea=' + existing.id + '&notice=published');
  }

  return renderOrganizerPage(env, url.searchParams.get('idea'), noticeAt(url));
}

async function unsubscribeRoute(request, url, db) {
  if (request.method === 'POST') {
    const fields = await postFields(request, url);
    if (!fields) return page('This preference change could not be verified.', 403);
    const token = fields.get('token') ?? '';
    if (tokenPattern.test(token)) {
      await db.prepare(
        'UPDATE members SET email_updates = 0, email = NULL, unsubscribe_token = NULL, updated_at = ? WHERE email = (SELECT email FROM members WHERE unsubscribe_token = ?)'
      ).bind(new Date().toISOString(), token).run();
    }
    return transition('/unsubscribe?done=1');
  }

  const token = url.searchParams.get('token') ?? '';
  const done = url.searchParams.get('done') === '1';
  const member = !done && tokenPattern.test(token)
    ? await db.prepare('SELECT 1 AS active FROM members WHERE unsubscribe_token = ?').bind(token).first()
    : null;
  return page(renderUnsubscribe({ token: member ? token : '', done, valid: Boolean(member) }), 200, 'origin');
}

async function emailSignInRoute(request, url, env, route) {
  const confirm = route === '/email-signin/confirm';
  if (request.method !== 'POST') {
    if (!confirm) return transition('/membership');
    const token = url.searchParams.get('token') ?? '';
    return page(renderEmailConfirmation({ token, valid: tokenPattern.test(token) }), 200, 'origin');
  }

  const fields = await postFields(request, url);
  if (!fields) return page('This sign-in request could not be verified.', 403);
  if (route === '/email-signout') return transition('/membership', await endEmailSession(request, env));
  if (confirm) {
    const verified = await redeemEmailLink(env, fields.get('token'), await visitor(request));
    return verified
      ? transition('/membership', verified.sessionCookie)
      : page(renderEmailConfirmation({ valid: false }), 400, 'origin');
  }
  const result = await requestEmailLink(request, url, env, fields);
  const notice = result === 'invalid' ? 'invalid' : result === 'unavailable' ? 'emailUnavailable' : 'emailRequested';
  return transition('/membership?notice=' + notice);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const route = url.pathname === '/' ? '/' : url.pathname.replace(/\/$/, '');
    const reads = request.method === 'GET' || request.method === 'HEAD';
    if (Object.hasOwn(staticAssets, route)) return reads ? readAsset(staticAssets[route], request.method) : missing();
    if (!reads && request.method !== 'POST') return missing();
    if (route === '/privacy') {
      const emailReady = emailSignInReady(env);
      return reads ? page(renderPrivacy({ emailSignInReady: emailReady, automaticEmail: emailReady })) : missing();
    }

    try {
      if (route === '/unsubscribe') return await unsubscribeRoute(request, url, env.DB);
      if (['/email-signin', '/email-signin/confirm', '/email-signout'].includes(route)) {
        return await emailSignInRoute(request, url, env, route);
      }
      if (!['/membership', '/organize'].includes(route)) return missing();
      const emailSession = await readEmailSession(request, env);
      const user = emailSession ?? await visitor(request);
      const isOrganizer = Boolean(user?.email && user.email === normalizedEmail(env.ORGANIZER_EMAIL));
      if (route === '/organize') return isOrganizer ? await organizerRoute(request, url, env) : missing();
      return await memberRoute(request, url, env, user, emailSession, isOrganizer);
    } catch {
      return page('This page is temporarily unavailable. Please try again.', 503);
    }
  },
};
