import { CONTACT_EMAIL } from '../../../shared/site';

export const LAST_UPDATED = '16 November 2026';

export function PrivacyContent() {
  return (
    <>
      <h2>The short version</h2>
      <p>
        Fifteen stores only what it needs to run your account: your email address, your settings, your categories
        and your log. We do not use analytics, advertising or third-party trackers, and we do not sell or share your
        data. Your password never reaches our server in usable form. You can export everything or delete your account
        yourself at any time in <a href="/app/settings">Settings</a>. The rest of this page explains the details.
      </p>

      <h2>Who is responsible</h2>
      <p>
        The controller for your data is: <strong>[Operator name and postal address — to be added before launch]</strong>.
        You can reach us at {CONTACT_EMAIL}.
      </p>
      <p>
        Fifteen is a small project. We are not required to appoint a data protection officer and have not done so.
      </p>

      <h2>What Fifteen does</h2>
      <p>
        While you are tracking, Fifteen asks &ldquo;What did you just do?&rdquo; every 15 minutes (you can change the
        interval). You tap a category. Fifteen draws your day as a coloured timeline, shows gaps for unlogged time, and
        produces a daily report with a Focus Score, time wasted and a trend.
      </p>

      <h2>What we store</h2>
      <p>This is the data kept on our server for each account.</p>
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>What it is</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Email address</td>
            <td>Your login. It is used to sign you in and for nothing else: no newsletters, no marketing.</td>
            <td>Running your account</td>
          </tr>
          <tr>
            <td>Password</td>
            <td>
              Never sent to or stored on our server. Your browser derives a key from it (PBKDF2). The server stores
              only a salted hash of that derived key.
            </td>
            <td>Logging you in</td>
          </tr>
          <tr>
            <td>Recovery code</td>
            <td>Stored only as a hash.</td>
            <td>Resetting a forgotten password</td>
          </tr>
          <tr>
            <td>Settings</td>
            <td>
              Check-in interval, workday days and hours, report time, the time your day ends, waking hours, time
              zone, theme, sound on or off.
            </td>
            <td>Running the service the way you set it up</td>
          </tr>
          <tr>
            <td>Categories</td>
            <td>The categories you create: name, colour and type.</td>
            <td>Running the service</td>
          </tr>
          <tr>
            <td>Your log</td>
            <td>
              For each entry: date, start time, duration, category and an optional short tag you may type. Also the
              start and end times of tracking sessions.
            </td>
            <td>Running the service</td>
          </tr>
          <tr>
            <td>Push subscription</td>
            <td>
              Only if you turn on notifications: the address issued by your browser&rsquo;s push service.
            </td>
            <td>Sending reminders (with your consent)</td>
          </tr>
          <tr>
            <td>Session records</td>
            <td>A hash of your session token, its creation time and its expiry time.</td>
            <td>Keeping you logged in, security</td>
          </tr>
          <tr>
            <td>Sign-in protection</td>
            <td>
              A count of recent failed log-in attempts and, if the account is temporarily locked, the time the lock
              ends.
            </td>
            <td>Stopping password guessing</td>
          </tr>
        </tbody>
      </table>
      <p>
        <strong>Tags are free text and you decide what goes in them.</strong> Please do not put sensitive information
        there, such as health details, other people&rsquo;s names or anything confidential.
      </p>
      <p>
        <strong>The recovery code matters.</strong> It is what resets a forgotten password. Because we never hold your
        password in a form we can read, we cannot restore access to an account without it.
      </p>

      <h2>What we do not collect</h2>
      <ul>
        <li>No analytics and no advertising.</li>
        <li>No tracking and no third-party cookies.</li>
        <li>No third-party fonts or scripts. Fonts are hosted by Fifteen itself.</li>
        <li>No location and no contacts.</li>
        <li>No fingerprinting of your device by Fifteen. The bot check described below is the one exception.</li>
        <li>No selling or sharing of your data.</li>
      </ul>
      <p>
        IP addresses are not stored in Fifteen&rsquo;s database. They are processed briefly for rate limiting and abuse
        prevention, and by our hosting provider as part of normal operation. Our own error logs contain no personal
        data.
      </p>

      <h2>Cookies and local storage</h2>
      <p>
        Fifteen sets exactly one cookie: a strictly necessary first-party session cookie named{' '}
        <strong>__Host-fifteen</strong>. It is HttpOnly, Secure and SameSite=Lax. It lasts 30 days and is renewed while
        you use the app. Because it is strictly necessary, we do not show a consent banner.
      </p>
      <p>
        Your browser&rsquo;s local storage is used only for on-device preferences, such as your theme and whether
        notifications are switched on in this browser. The demo runs entirely in your browser, and nothing you do in it
        is sent to us.
      </p>

      <h2>Suggestions (auto-fill)</h2>
      <p>
        Fifteen suggests a likely category based on your own past entries. In the app this is computed on your device
        from your own history. The shortcut buttons on a notification are picked on our server from the same log. None
        of this involves profiling with legal or similarly significant effects, or automated decision-making in the
        sense of Article 22 GDPR. No AI model is trained on user data.
      </p>

      <h2>Who processes your data</h2>
      <h3>Cloudflare</h3>
      <p>
        Cloudflare, Inc. hosts the application (Cloudflare Workers) and the database (Cloudflare D1). The database is
        located in Western Europe. Cloudflare acts as our processor. It may process technical request data, such as
        your IP address, on its global network. For transfers outside the EU and EEA, Cloudflare relies on its Data
        Processing Addendum, including Standard Contractual Clauses, and on its EU–U.S. Data Privacy Framework
        certification.
      </p>
      <h3>Cloudflare Turnstile</h3>
      <p>
        To keep automated sign-ups and password guessing out, Cloudflare Turnstile may run on the sign-up, log-in
        and recovery forms. To tell people from bots it looks at technical signals from your browser and device, such
        as your IP address and browser characteristics. Cloudflare states that it uses this information only to detect
        bots and not for advertising. Turnstile does not run anywhere else in Fifteen.
      </p>
      <h3>Browser push services</h3>
      <p>
        If you opt in to notifications, they pass through your browser vendor&rsquo;s push service: Google (Chrome),
        Mozilla, Apple or Microsoft. The pushes we send are empty wake-up signals with no content about your day. The
        app then fetches what to show directly from Fifteen.
      </p>
      <p>There are no other recipients of your data.</p>

      <h2>Why we may process your data (legal bases)</h2>
      <ul>
        <li>
          <strong>Contract, Art. 6(1)(b) GDPR:</strong> running your account and the service.
        </li>
        <li>
          <strong>Legitimate interests, Art. 6(1)(f) GDPR:</strong> security, rate limiting, and abuse and bot
          prevention.
        </li>
        <li>
          <strong>Consent, Art. 6(1)(a) GDPR:</strong> push notifications. You can withdraw consent at any time by
          turning notifications off in <a href="/app/settings">Settings</a> or in your browser.
        </li>
      </ul>

      <h2>How long we keep data</h2>
      <p>
        We keep your data until you delete it or delete your account. Deleting your account (Settings, then Account,
        then Delete account) erases your account, settings, categories, log, tracking sessions, push subscriptions and
        sessions from the live database immediately. Database backups kept by our hosting provider roll off within 30
        days. Sessions expire after 30 days without use.
      </p>

      <h2>Your rights</h2>
      <p>
        You have the right to access, rectification, erasure, restriction, data portability and objection. You can
        withdraw consent at any time. You also have the right to lodge a complaint with a supervisory authority. In the
        EU, that is your local data protection authority.
      </p>
      <p>Two of these you can do yourself:</p>
      <ul>
        <li>
          <strong>Export my data</strong> (Settings, then Account) downloads your account details, settings, categories
          and log as a JSON file.
        </li>
        <li>
          <strong>Delete account</strong> (Settings, then Account) erases everything, as described above.
        </li>
      </ul>
      <p>
        For anything else, write to {CONTACT_EMAIL}. We will reply within one month.
      </p>

      <h2>Security</h2>
      <p>We keep things simple and try to be honest about it. What we do:</p>
      <ul>
        <li>Encrypted connections (HTTPS).</li>
        <li>Your password never leaves your device in usable form.</li>
        <li>Session tokens are stored only as hashes.</li>
        <li>A strict Content Security Policy.</li>
        <li>Rate limiting and account lockout.</li>
        <li>Minimal data, so there is less to lose.</li>
      </ul>
      <p>No system is perfectly secure, and we cannot promise otherwise.</p>

      <h2>Children</h2>
      <p>
        Fifteen is not directed at children. You must be at least 16 to use it.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        If we make material changes, we will announce them in the app. The date at the top of this page shows the latest
        version. See also our <a href="/terms">Terms of Service</a>.
      </p>

      <h2>Contact</h2>
      <p>Questions about privacy: {CONTACT_EMAIL}.</p>
    </>
  );
}
