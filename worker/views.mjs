const escapeCharacters = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'long',
  timeZone: 'America/Los_Angeles',
});

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => escapeCharacters[character]);
}

function formatDate(date) {
  const parsed = new Date(date);
  if (!date || Number.isNaN(parsed.getTime())) return '';
  return `<time datetime="${parsed.toISOString()}">${dateFormatter.format(parsed)}</time>`;
}

function layout(title, currentPath, content) {
  const links = [['/', 'Home'], ['/membership', 'Membership'], ['/privacy', 'Privacy']];
  const nav = links.map(([path, label]) => {
    const current = path === currentPath ? ' aria-current="page"' : '';
    return `<a href="${path}"${current}>${label}</a>`;
  }).join('\n        ');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#203b34">
  <meta name="robots" content="noindex">
  <title>${escapeHtml(title)} | The Intersectionist Party</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <div class="shell header-layout">
      <a class="wordmark" href="/" aria-label="The Intersectionist Party home">
        <span class="mark" aria-hidden="true"></span>
        <span>The Intersectionist Party</span>
      </a>
      <nav aria-label="Main navigation">
        ${nav}
      </nav>
    </div>
  </header>
  <main id="main" class="shell member-page">
    <h1>${escapeHtml(title)}</h1>
    ${content}
  </main>
  <footer class="site-footer">
    <div class="shell footer-layout">
      <a class="wordmark" href="/" aria-label="The Intersectionist Party home">
        <span class="mark" aria-hidden="true"></span>
        <span>The Intersectionist Party</span>
      </a>
      <a href="/privacy">Privacy policy</a>
    </div>
  </footer>
</body>
</html>`;
}

function renderNotice(notice) {
  if (!notice) return '';
  const message = typeof notice === 'string' ? notice : notice.message;
  return message ? `<p class="notice" role="status">${escapeHtml(message)}</p>` : '';
}

function emailRateFields(rate = 'off') {
  const options = [
    ['off', 'Off'],
    ['weekly', 'At most once a week'],
    ['daily', 'At most once a day'],
  ];
  const selected = options.some(([value]) => value === rate) ? rate : 'off';
  return `<label class="field" for="contact-rate">Idea email frequency</label>
    <select id="contact-rate" name="contact_rate" aria-describedby="contact-rate-help">
      ${options.map(([value, label]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`).join('\n      ')}
    </select>
    <small id="contact-rate-help">Weekly means at most one idea email every seven days. Daily means at most one every 24 hours.</small>`;
}

function membershipAction(action, label) {
  return `<form method="post" action="/membership">
    <input type="hidden" name="action" value="${escapeHtml(action)}">
    <button type="submit" class="button button-secondary">${escapeHtml(label)}</button>
  </form>`;
}

function renderIdeaList(ideas, organizer = false) {
  if (!ideas.length) return '<p>No ideas have been published yet.</p>';
  return `<ul class="idea-list">${ideas.map(idea => {
    const href = `/organize?${new URLSearchParams({ idea: idea.id })}`;
    const title = escapeHtml(idea.title);
    const heading = organizer ? `<a href="${escapeHtml(href)}">${title}</a>` : title;
    const body = organizer ? '' : `<p class="idea-body">${escapeHtml(idea.body)}</p>`;
    const publishedAt = formatDate(idea.published_at);
    return `<li><article>
      <h3>${heading}</h3>
      ${publishedAt}
      ${body}
    </article></li>`;
  }).join('\n')}</ul>`;
}

export function renderMembership({
  signedIn, member, ideas = [], isOrganizer, canEmail, notice, emailSignInReady = false, emailSession = false,
  ideaId, returnPath = '/membership',
}) {
  const status = renderNotice(notice);
  if (!signedIn) {
    const chatGPTSignIn = trustSitesIdentity
      ? `<div class="member-actions">
        <a href="/signin-with-chatgpt?return_to=${encodeURIComponent(returnPath)}" target="_top" class="button button-secondary">Sign in with ChatGPT</a>
      </div>
      <p>A free ChatGPT account works.</p>`
      : '';
    const emailSignIn = emailSignInReady
      ? `<form method="post" action="/email-signin${ideaId ? '?idea=' + encodeURIComponent(ideaId) : ''}" class="member-form">
        <label class="field" for="sign-in-email">Email address</label>
        <input id="sign-in-email" name="email" type="email" autocomplete="email" maxlength="254" required aria-describedby="sign-in-email-help">
        <small id="sign-in-email-help">We store this address for sign-in. You can choose separately whether to get emails about ideas. <a href="/privacy">Privacy policy</a></small>
        <button type="submit" class="button button-secondary">Email me a sign-in link</button>
      </form>`
      : '';
    const signInAvailable = trustSitesIdentity || emailSignInReady;
    return layout('Membership', '/membership', `${status}
    <section class="member-card" aria-labelledby="join-heading">
      <h2 id="join-heading">Join the Intersectionist Party</h2>
      ${signInAvailable ? '<p>Sign in to join, read ideas in development, and choose whether to get idea emails.</p>' : '<p>Email sign-in is being set up.</p>'}
      ${chatGPTSignIn}
      ${emailSignIn}
    </section>`);
  }

  const signOut = emailSession
    ? `<form method="post" action="/email-signout">
        <button type="submit" class="button button-secondary">Sign out</button>
      </form>`
    : '<a href="/signout-with-chatgpt?return_to=%2Fmembership" target="_top">Sign out</a>';
  const accountLinks = `<div class="member-actions account-links">
    ${isOrganizer ? '<a href="/organize">Organizer tools</a>' : ''}
    ${signOut}
  </div>`;
  if (!member) {
    return layout('Membership', '/membership', `${status}
    <section class="member-card" aria-labelledby="join-heading">
      <h2 id="join-heading">Join the Intersectionist Party</h2>
      <form method="post" action="${escapeHtml(returnPath)}" class="member-form">
        <input type="hidden" name="action" value="join">
        ${canEmail ? emailRateFields() : ''}
        <button type="submit" class="button button-secondary">Join the party</button>
      </form>
    </section>
    ${accountLinks}`);
  }

  const suspended = member.status !== 'active';
  const joinedAt = formatDate(member.joinedAt);
  const joined = joinedAt ? `<p>Member since ${joinedAt}.</p>` : '';
  const rate = member.contactRate ?? 'off';
  const saveEmailPreferences = `<form method="post" action="/membership" class="member-form">
    <input type="hidden" name="action" value="preferences">
    ${canEmail ? emailRateFields(rate) : '<input type="hidden" name="contact_rate" value="off">'}
    <button type="submit" class="button button-secondary">${canEmail ? 'Save email preference' : 'Stop email updates'}</button>
  </form>`;
  const emailPreferences = canEmail || rate !== 'off' || member.emailUpdates
    ? saveEmailPreferences
    : '<p>Email updates are unavailable for this account.</p>';
  const controls = suspended
    ? `<p>Suspension pauses your access to member ideas and stops email updates. You can resume at any time. Idea emails stay off until you opt in again.</p>
       <div class="member-actions">${membershipAction('resume', 'Resume membership')}</div>`
    : `${emailPreferences}
       <p>Suspending your membership pauses access to member ideas and stops email updates. You can resume and opt in again later.</p>
       <div class="member-actions">${membershipAction('suspend', 'Suspend membership')}</div>`;
  const memberIdeas = suspended ? '' : `<section class="member-card" aria-labelledby="member-ideas">
    <h2 id="member-ideas">${ideaId ? 'Idea in development' : 'Ideas in development'}</h2>
    ${ideaId && ideas.length === 0 ? '<p>This idea is unavailable.</p>' : renderIdeaList(ideas)}
    ${ideaId ? '<p><a href="/membership">Browse all member ideas</a></p>' : ''}
  </section>`;
  return layout('Membership', '/membership', `${status}
    ${ideaId ? memberIdeas : ''}
    <section class="member-card" aria-labelledby="membership-status">
      <h2 id="membership-status">${suspended ? 'Membership suspended' : 'Active membership'}</h2>
      ${joined}
      ${controls}
      <details>
        <summary>Leave the party</summary>
        <p>Leaving stops email updates and deletes your membership record. You can join again later.</p>
        <div class="member-actions">${membershipAction('leave', 'Leave and delete membership')}</div>
      </details>
    </section>
    ${ideaId ? '' : memberIdeas}
    ${accountLinks}`);
}

function recipientList(recipients, ideaId, automaticEmail) {
  if (!recipients.length) return '<p>No members are currently eligible for this idea email.</p>';
  const action = automaticEmail ? 'email' : 'draft';
  const label = automaticEmail ? 'Send idea email' : 'Prepare draft';
  return `<ul class="idea-list">${recipients.map(({ email, accountId }) => `<li>
    <form method="post" action="/organize" class="member-actions">
      <input type="hidden" name="action" value="${action}">
      <input type="hidden" name="idea_id" value="${escapeHtml(ideaId)}">
      <input type="hidden" name="account_id" value="${escapeHtml(accountId)}">
      <span>${escapeHtml(email)}</span>
      <button type="submit" class="button button-secondary" aria-label="${label} to ${escapeHtml(email)}">${label}</button>
    </form>
  </li>`).join('\n')}</ul>`;
}

export function renderOrganizer({
  ideas = [], selectedIdea, recipients = [], preparedDraft, shareLink, automaticEmail = false, notice,
}) {
  const draftHref = preparedDraft?.draftHref;
  const draft = !automaticEmail && typeof draftHref === 'string' && /^mailto:[^\r\n]+$/i.test(draftHref)
    ? `<p><a href="${escapeHtml(draftHref)}">Open draft for ${escapeHtml(preparedDraft.email)}</a></p>`
    : '';
  const selected = selectedIdea ? `<section class="member-card" aria-labelledby="share-title">
    <h2 id="share-title">Share this idea</h2>
    <p>Copy the member link and share it through your chosen channel. Active members can open it after signing in.</p>
    <div class="member-form">
      <label for="share-link">Member link</label>
      <input id="share-link" type="url" value="${escapeHtml(shareLink)}" readonly>
    </div>
  </section>
  <section class="member-card" aria-labelledby="drafts-title">
    <h2 id="drafts-title">Email this idea</h2>
    <h3>${escapeHtml(selectedIdea.title)}</h3>
    <p>Only active members who opted in and are due for an update appear here. Weekly members can receive at most one idea email every seven days, and daily members at most one every 24 hours.</p>
    ${automaticEmail ? '' : '<p>Preparing a draft starts the contact interval. Open the draft in your email app to review and send it.</p>'}
    ${draft}
    ${recipientList(recipients, selectedIdea.id, automaticEmail)}
  </section>` : '';
  return layout('Organizer tools', '/organize', `${renderNotice(notice)}
    <section class="member-card" aria-labelledby="publish-heading">
      <h2 id="publish-heading">Publish an idea</h2>
      <p>Active members can read published ideas on the membership page. The organizer chooses which idea emails to send after publication.</p>
      <form method="post" action="/organize" class="member-form">
        <input type="hidden" name="action" value="publish">
        <label class="field" for="idea-title">Title</label>
        <input id="idea-title" name="title" type="text" maxlength="100" required>
        <label class="field" for="idea-body">Idea</label>
        <textarea id="idea-body" name="body" rows="7" maxlength="1800" required></textarea>
        <button type="submit" class="button button-secondary">Publish to members</button>
      </form>
    </section>
    ${selected}
    <section class="member-card" aria-labelledby="published-ideas">
      <h2 id="published-ideas">Published ideas</h2>
      ${renderIdeaList(ideas, true)}
    </section>`);
}

export function renderEmailConfirmation({ token, valid, ideaId, returnPath = '/membership' }) {
  const content = valid && token
    ? `<p>Confirm to sign in and open the membership page.</p>
    <form method="post" action="/email-signin/confirm${ideaId ? '?idea=' + encodeURIComponent(ideaId) : ''}" class="member-form">
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      <button type="submit" class="button button-secondary">Confirm sign-in</button>
    </form>`
    : `<p>This sign-in link is invalid or has expired. <a href="${escapeHtml(returnPath)}">Request a new link</a>.</p>`;
  return layout('Confirm email sign-in', '/membership', `<div class="member-card">${content}</div>`);
}

export function renderUnsubscribe({ token, done, valid }) {
  let content;
  if (done) {
    content = '<p>You’re unsubscribed from Intersectionist Party idea emails.</p><p>You can change your email preference on the <a href="/membership">membership page</a>.</p>';
  } else if (valid && token) {
    content = `<p>To stop emails about new ideas, confirm below.</p>
    <form method="post" action="/unsubscribe" class="member-form">
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      <button type="submit" class="button button-secondary">Unsubscribe from emails</button>
    </form>`;
  } else {
    content = '<p>This unsubscribe link is invalid or has expired. You can change your email preference on the <a href="/membership">membership page</a>.</p>';
  }
  return layout('Unsubscribe', '/unsubscribe', `<div class="member-card">${content}</div>`);
}

export function renderPrivacy({ emailSignInReady = false, automaticEmail = false } = {}) {
  const chatGPTSignIn = trustSitesIdentity
    ? '<p>When you sign in with ChatGPT, OpenAI supplies an account identifier and, when available, an email address. We store an identifier derived from your account ID to recognize your membership. If you opt in to idea emails, we also store your address for those updates.</p>'
    : '';
  const emailSignIn = emailSignInReady
    ? '<p>When you sign in by email, we store the email address used for your sign-in and use it to deliver sign-in links. Your optional idea-email preference is stored separately.</p>'
    : '';
  const signInProviders = emailSignInReady
    ? '<p>An email delivery provider processes the address needed to deliver your sign-in link.</p>'
    : '';
  return layout('Privacy policy', '/privacy', `<p>Effective <time datetime="2026-11-20">November 20, 2026</time></p>
    <section class="member-card" aria-labelledby="privacy-data">
      <h2 id="privacy-data">Sign-in and membership</h2>
      <p>The Intersectionist Party operates this site. We record your membership status, preferences, and the dates you join or make changes.</p>
      ${chatGPTSignIn}
      ${emailSignIn}
      <p>Other visitors and members cannot see your name, email address, or membership status.</p>
    </section>
    <section class="member-card" aria-labelledby="privacy-email">
      <h2 id="privacy-email">Optional email updates</h2>
      <p>Idea emails are off by default. If you opt in, we use your email address to send updates about ideas in development. You can choose at most one update every seven days or at most one every 24 hours. Each idea email includes an unsubscribe link.</p>
      <p>The organizer can see opted-in addresses that are eligible for an update. ${automaticEmail ? 'An email delivery provider processes addresses for updates sent from the site.' : 'The organizer can open an individual draft after choosing to prepare a manual email.'}</p>
    </section>
    <section class="member-card" aria-labelledby="privacy-controls">
      <h2 id="privacy-controls">Your choices</h2>
      <p>You can change your email frequency, suspend membership, or leave on the <a href="/membership">membership page</a>. Turning off emails or suspending membership removes your address from the site’s idea-email list. Resuming membership leaves idea emails off until you opt in again. Leaving deletes your membership record from the site. Emails already sent remain in the sender’s and recipient’s mailboxes. You can rejoin later.</p>
    </section>
    <section class="member-card" aria-labelledby="privacy-feedback">
      <h2 id="privacy-feedback">GPT and opinion gathering</h2>
      <p>When we invite you to give feedback, we’ll say before you take part whether GPT will ask the questions or process your responses. Read <a href="/#gpt-disclosure">how we use GPT</a> to explore ideas and report what we learn.</p>
    </section>
    <section class="member-card" aria-labelledby="privacy-providers">
      <h2 id="privacy-providers">Service providers</h2>
      <p>Hosting and infrastructure providers operate the systems that serve the site and store membership records.</p>
      ${signInProviders}
      ${trustSitesIdentity ? '<p>For how OpenAI handles ChatGPT sign-in, see its <a href="https://openai.com/policies/privacy-policy/">privacy policy</a>.</p>' : ''}
    </section>`);
}
