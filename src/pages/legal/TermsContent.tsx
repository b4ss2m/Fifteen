import { CONTACT_EMAIL } from '../../../shared/site';

export const LAST_UPDATED = '16 November 2026';

export function TermsContent() {
  return (
    <>
      <h2>What Fifteen is</h2>
      <p>
        Fifteen is a small web app for auditing your time. While you are tracking, it asks you at regular intervals what
        you just did, and turns your answers into a timeline and a daily report. By using Fifteen you agree to these
        terms.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You must be at least 16 years old.</li>
        <li>One account is for one person.</li>
        <li>Keep your password and your recovery code safe.</li>
      </ul>
      <p>
        <strong>There is no email reset.</strong> If you lose both your password and your recovery code, your account
        cannot be recovered. We have no way to do it for you.
      </p>

      <h2>Your data</h2>
      <p>
        Your data stays yours. You can export it or delete it at any time in <a href="/app/settings">Settings</a>. How
        we handle it is described in our <a href="/privacy">Privacy Policy</a>.
      </p>

      <h2>Acceptable use</h2>
      <p>Please do not:</p>
      <ul>
        <li>try to break, overload or scrape the service;</li>
        <li>try to access or interfere with other people&rsquo;s accounts;</li>
        <li>create accounts automatically;</li>
        <li>use the service to do anything unlawful.</li>
      </ul>

      <h2>Availability</h2>
      <p>
        Fifteen is provided free of charge and &ldquo;as is&rdquo;. It may change or be discontinued. Where practical, we
        will give reasonable notice and a chance to export your data first.
      </p>

      <h2>Liability</h2>
      <p>
        To the extent permitted by law, we are not liable for indirect loss, such as lost profits or lost data you
        did not export. Nothing in these terms limits liability that cannot be limited by law, for example liability
        for intent or gross negligence, or your statutory consumer rights.
      </p>

      <h2>Ending your use</h2>
      <p>
        You can delete your account at any time in <a href="/app/settings">Settings</a>. We may suspend accounts that
        abuse the service.
      </p>

      <h2>Changes to these terms</h2>
      <p>
        If we make material changes, we will announce them in the app. The date at the top of this page shows the latest
        version. If you keep using Fifteen after a change, the new terms apply.
      </p>

      <h2>Governing law</h2>
      <p>
        <strong>[Governing law and place of jurisdiction — to be determined]</strong>. This does not take away any
        mandatory consumer protections that apply where you live.
      </p>

      <h2>Contact</h2>
      <p>Questions about these terms: {CONTACT_EMAIL}.</p>
    </>
  );
}
