import { useEffect } from "react";
import Logo from "../components/Logo";

function LegalShell({ title, updated, children }) {
  useEffect(() => { window.scrollTo(0, 0); }, []);
  return (
    <div className="page">
      <nav className="mnav">
        <div className="wrap" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <a href="/" className="brand" aria-label="KopaBook home"><Logo /></a>
          <a href="/pricing" className="btn btn-secondary btn-sm">Back to site</a>
        </div>
      </nav>
      <section className="section">
        <div className="wrap" style={{ maxWidth: 760 }}>
          <h2>{title}</h2>
          <p className="sub">Last updated: {updated}</p>
          <div className="card">{children}</div>
        </div>
      </section>
      <footer className="mfooter">
        <div className="wrap">
          <div>
            <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="/refund">Refunds</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export function TermsPage() {
  return (
    <LegalShell title="Terms of Service" updated="16 October 2026">
      <h3>1. Who we are</h3>
      <p>
        KopaBook is a business record-keeping service owned and operated by{" "}
        <strong>FVA70K Services</strong> ("we", "us"). By creating an account or using
        KopaBook, you agree to these terms.
      </p>
      <h3>2. What KopaBook does</h3>
      <p>
        KopaBook is a record keeper, not a payment processor. It helps you record sales,
        stock, debts, expenses and staff activity for your own business. Every payment shown
        in the app is a record of money that changed hands outside the app, through cash,
        bank transfer, POS or another method you control. We never take, hold, move or
        process your customers' money.
      </p>
      <h3>3. Your account</h3>
      <p>
        You must provide accurate information when registering. You are responsible for
        keeping your password safe and for everything done under your account. One person
        may own several businesses under one account.
      </p>
      <h3>4. Plans and billing</h3>
      <p>
        The Free plan is free forever, within its stated limits. Paid plans (Starter and Pro)
        are billed monthly or yearly in Nigerian naira through our payment provider, Paystack.
        Your plan renews for the billing period you chose. You can see your current plan,
        usage and renewal date in Settings at any time.
      </p>
      <h3>5. Fair use and limits</h3>
      <p>
        Each plan states how many businesses, products, staff accounts and weekly sales it
        includes. Recording a sale is never blocked, on any plan. We may contact you if your
        usage far exceeds your plan, to move you to a plan that fits.
      </p>
      <h3>6. Your data</h3>
      <p>
        Your business records belong to you. We store them securely and never sell them.
        You can export your data from Settings. If you close your account, we delete your
        data on request, except records we must keep by law.
      </p>
      <h3>7. Acceptable use</h3>
      <p>
        You agree not to use KopaBook for anything illegal, to harm others, to try to break
        into the service, or to resell access to the service without our written permission.
        We may suspend accounts that break these rules.
      </p>
      <h3>8. Availability</h3>
      <p>
        We work to keep KopaBook running reliably, but we do not guarantee uninterrupted
        service. We are not liable for losses from downtime, except as required by law.
      </p>
      <h3>9. Changes</h3>
      <p>
        We may update these terms. If the changes matter to you, we will notify you in the
        app before they take effect. Continuing to use KopaBook after that means you accept
        the new terms.
      </p>
      <h3>10. Contact</h3>
      <p>
        For questions about these terms, contact FVA70K Services through the support links
        in the app.
      </p>
    </LegalShell>
  );
}

export function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" updated="16 October 2026">
      <h3>1. Who we are</h3>
      <p>
        KopaBook is owned and operated by <strong>FVA70K Services</strong>. This policy
        explains what data we collect and what we do with it.
      </p>
      <h3>2. What we collect</h3>
      <p>We collect only what the service needs to work:</p>
      <ul>
        <li><strong>Account data:</strong> your name, email address and password (stored as a secure hash, never in plain text).</li>
        <li><strong>Business records you enter:</strong> products, services, sales, customers, debts, expenses, staff, suppliers and shipments.</li>
        <li><strong>Billing data:</strong> your plan, billing cycle and payment references from Paystack. We never see or store your card details; Paystack handles those.</li>
        <li><strong>Technical data:</strong> basic logs needed for security and reliability.</li>
      </ul>
      <h3>3. What we do with it</h3>
      <p>
        We use your data to run your account, show your dashboards and reports, process
        your subscription, and keep the service secure. We do not sell your data, and we do
        not share it with advertisers.
      </p>
      <h3>4. Who else sees it</h3>
      <p>
        Your staff members see the parts of your business data their role permits, nothing more.
        Our infrastructure providers (hosting, database) store the data on our behalf under
        strict terms. Paystack sees your email and payment amount when you subscribe.
      </p>
      <h3>5. Your rights</h3>
      <p>
        You can view, correct and export your data from the app at any time. You can ask us
        to delete your account and data. We keep only what the law requires us to keep, such
        as billing records.
      </p>
      <h3>6. Security</h3>
      <p>
        Passwords are hashed, traffic is encrypted, and access to our systems is limited.
        No system is perfect, and we will notify you if a breach affects your data.
      </p>
      <h3>7. Changes</h3>
      <p>
        If this policy changes in a way that matters to you, we will notify you in the app.
      </p>
    </LegalShell>
  );
}

export function RefundPage() {
  return (
    <LegalShell title="Refund Policy" updated="16 October 2026">
      <h3>1. Who we are</h3>
      <p>
        KopaBook is owned and operated by <strong>FVA70K Services</strong>. Subscription
        payments are processed securely by Paystack.
      </p>
      <h3>2. Free plan</h3>
      <p>
        The Free plan costs nothing, so there is nothing to refund. You can use it for as
        long as you like.
      </p>
      <h3>3. Paid plans, 7-day promise</h3>
      <p>
        If you pay for Starter or Pro and change your mind within <strong>7 days</strong> of
        payment, contact us and we will refund you in full, no questions asked.
      </p>
      <h3>4. After 7 days</h3>
      <p>
        After the first 7 days, subscription fees are not refundable for the current billing
        period, because the service was available to you throughout. You can cancel at any
        time; cancellation stops the next renewal, and you keep your paid plan until the end
        of the period you already paid for. Your account then moves to the Free plan, and
        none of your business records are deleted.
      </p>
      <h3>5. How to request a refund</h3>
      <p>
        Contact FVA70K Services through the support links in the app with your account email
        and payment reference. Approved refunds are sent back through Paystack to the method
        you paid with, usually within 5 to 10 business days.
      </p>
      <h3>6. Failed or duplicate payments</h3>
      <p>
        If you were charged twice for the same period, or charged without your plan
        activating, contact us immediately and we will fix it or refund the extra charge.
      </p>
    </LegalShell>
  );
}
