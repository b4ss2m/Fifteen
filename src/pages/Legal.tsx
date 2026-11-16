import type { ReactNode } from 'react';
import { Logo, ThemeToggle } from '../components/ui';
import { Link } from '../lib/router';
import { LAST_UPDATED as PRIVACY_UPDATED, PrivacyContent } from './legal/PrivacyContent';
import { LAST_UPDATED as TERMS_UPDATED, TermsContent } from './legal/TermsContent';

function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="legal">
      <header className="legal-nav">
        <Link href="/" aria-label="Fifteen home">
          <Logo />
        </Link>
        <nav>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <ThemeToggle />
        </nav>
      </header>
      <main className="prose">
        <p className="eyebrow">Last updated {updated}</p>
        <h1>{title}</h1>
        {children}
      </main>
    </div>
  );
}

export const Privacy = () => (
  <LegalPage title="Privacy Policy" updated={PRIVACY_UPDATED}>
    <PrivacyContent />
  </LegalPage>
);

export const Terms = () => (
  <LegalPage title="Terms of Service" updated={TERMS_UPDATED}>
    <TermsContent />
  </LegalPage>
);
