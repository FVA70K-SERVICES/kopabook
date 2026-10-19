import { useEffect } from "react";
import Logo from "../components/Logo";

const BRAND = {
  emerald: "#003A34",
  gold: "#C9A06B",
  lightGold: "#F0D49A",
  cream: "#FAF6EE",
};

function CompanyIdentity() {
  return (
    <div style={{
      display: "flex", gap: 16, alignItems: "center",
      background: BRAND.emerald, borderRadius: "12px 12px 0 0",
      borderBottom: "4px solid " + BRAND.gold,
      padding: "20px 24px", margin: "-1px -1px 0",
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: 12, background: "#fff",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0, overflow: "hidden",
      }}>
        <Logo />
      </div>
      <div>
        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 1.5, color: BRAND.lightGold }}>
          FVA70K SERVICES
        </div>
        <div style={{ fontSize: 12, color: BRAND.gold, marginTop: 4, letterSpacing: 0.5 }}>
          BN 7813786 &nbsp;·&nbsp; TIN 31821490-0001
        </div>
        <div style={{ fontSize: 12, color: "#cfd8d4", marginTop: 4, lineHeight: 1.5 }}>
          Mama's Mart, Ibusa Road by ULO Junction, Asaba, Delta State, Nigeria<br />
          0814 239 5738 &nbsp;·&nbsp; info@kopabook.com
        </div>
      </div>
    </div>
  );
}

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
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <CompanyIdentity />
            <div style={{ padding: "28px 28px 36px" }}>
              <h2 style={{ color: BRAND.emerald, marginTop: 0, letterSpacing: 1 }}>{title}</h2>
              <p className="sub" style={{ borderBottom: "2px solid " + BRAND.cream, paddingBottom: 16 }}>
                Last updated: {updated}
              </p>
              {children}
              <div style={{ marginTop: 32, paddingTop: 20, borderTop: "2px solid " + BRAND.gold, fontSize: 13, color: "#6b7280" }}>
                <strong>FVA70K Services</strong> · BN 7813786 · TIN 31821490-0001<br />
                Mama's Mart, Ibusa Road by ULO Junction, Asaba, Delta State, Nigeria<br />
                info@kopabook.com · 0814 239 5738
              </div>
            </div>
          </div>
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
    <LegalShell title="TERMS OF SERVICE" updated="19 October 2026">
      <h3>1. Definitions and Interpretation</h3>
      <p>1.1 In these Terms:</p>
      <p>(a) <strong>"Company"</strong> means FVA70K Services, a business name duly registered with the Corporate Affairs Commission of Nigeria under BN 7813786 (registered 9 August 2024), proprietor Fortune Godson, TIN 31821490-0001;</p>
      <p>(b) <strong>"Service"</strong> means the KopaBook business record-keeping application and all related features;</p>
      <p>(c) <strong>"User"</strong> means any person who registers for or uses the Service;</p>
      <p>(d) <strong>"Business Data"</strong> means all records entered by the User into the Service, including products, sales, customers, debts, expenses, staff records and reports.</p>
      <p>1.2 By creating an account or using the Service, the User agrees to be bound by these Terms.</p>

      <h3>2. Nature of the Service</h3>
      <p>2.1 KopaBook is a record-keeping service. It enables the User to record sales, stock, debts, expenses and staff activity relating to the User's own business.</p>
      <p>2.2 The Service is not a payment processor. Every payment reflected in the Service is a record of money that changed hands outside the application, by cash, bank transfer, POS or other means under the User's control. The Company does not take, hold, transfer or process the User's customers' funds.</p>

      <h3>3. Accounts</h3>
      <p>3.1 The User shall provide accurate information upon registration and keep login credentials secure.</p>
      <p>3.2 The User is responsible for all activity conducted under the User's account.</p>
      <p>3.3 A single User may operate multiple businesses under one account, subject to the limits of the applicable plan.</p>

      <h3>4. Subscription Plans and Billing</h3>
      <p>4.1 The Company offers a <strong>Free</strong> plan (free of charge, within its stated limits) and paid plans: <strong>Starter</strong> at NGN 1,000 per month, <strong>Solo</strong> at NGN 5,000 per month, and <strong>Pro</strong> at NGN 10,000 per month, with yearly billing options at a discount.</p>
      <p>4.2 Paid subscriptions are billed in Nigerian naira through Paystack, the Company's payment provider. Subscriptions renew automatically for the billing period selected until cancelled.</p>
      <p>4.3 The User may view the current plan, usage and renewal date in the application's Settings at any time.</p>
      <p>4.4 The Company reserves the right to revise plan pricing upon reasonable notice; existing billing periods shall not be affected.</p>

      <h3>5. Fair Use</h3>
      <p>5.1 Each plan specifies limits on businesses, products, staff accounts and other usage. The recording of sales shall never be blocked on any plan.</p>
      <p>5.2 Where usage materially exceeds the applicable plan, the Company may contact the User to migrate to a suitable plan.</p>

      <h3>6. Ownership of Data</h3>
      <p>6.1 All Business Data belongs to the User. The Company claims no ownership over Business Data.</p>
      <p>6.2 The Company shall not sell Business Data and shall not disclose it except as set out in the Privacy Policy.</p>
      <p>6.3 The User may export Business Data from the application at any time.</p>

      <h3>7. Acceptable Use</h3>
      <p>The User shall not: (a) use the Service for any unlawful purpose; (b) attempt to gain unauthorised access to the Service or its systems; (c) resell or sublicense access to the Service without the Company's prior written consent; or (d) use the Service in a manner that harms others. Breach of this clause may result in suspension or termination of the account.</p>

      <h3>8. Availability and Liability</h3>
      <p>8.1 The Company shall use reasonable endeavours to maintain the availability of the Service but gives no warranty of uninterrupted operation.</p>
      <p>8.2 To the maximum extent permitted by law, the Company's aggregate liability arising out of the Service shall not exceed the subscription fees paid by the User in the twelve (12) months preceding the claim.</p>

      <h3>9. Termination</h3>
      <p>9.1 The User may cancel a subscription at any time; cancellation takes effect at the end of the current billing period.</p>
      <p>9.2 The Company may suspend or terminate accounts in breach of these Terms, upon notice where practicable.</p>
      <p>9.3 Upon termination, the User may request deletion of Business Data in accordance with the Privacy Policy.</p>

      <h3>10. Amendments</h3>
      <p>The Company may amend these Terms. Material amendments shall be notified within the application before taking effect; continued use thereafter constitutes acceptance.</p>

      <h3>11. Governing Law</h3>
      <p>These Terms are governed by the laws of the Federal Republic of Nigeria. Disputes shall first be addressed through good-faith negotiation, failing which through mediation in Delta State or Lagos State, Nigeria.</p>

      <h3>12. Contact</h3>
      <p>Enquiries concerning these Terms should be directed to FVA70K Services at info@kopabook.com, 0814 239 5738, or through the support links within the application.</p>
    </LegalShell>
  );
}

export function PrivacyPage() {
  return (
    <LegalShell title="PRIVACY POLICY" updated="19 October 2026">
      <h3>1. Data Controller</h3>
      <p>
        1.1 This Policy is issued by <strong>FVA70K Services</strong>, a business name duly
        registered with the Corporate Affairs Commission of Nigeria under BN 7813786
        (registered 9 August 2024), proprietor Fortune Godson, TIN 31821490-0001
        (the "Data Controller").
      </p>
      <p>1.2 The Data Controller processes personal data in accordance with the Nigeria Data Protection Act 2023.</p>

      <h3>2. Data Collected</h3>
      <p>2.1 The Data Controller collects only such data as is necessary for the operation of the Service:</p>
      <p>(a) <strong>Account data:</strong> name, email address and password (stored as a secure hash, never in plain text);</p>
      <p>(b) <strong>Business Data entered by the User:</strong> products, services, sales, customers, debts, expenses, staff, suppliers and shipments;</p>
      <p>(c) <strong>Billing data:</strong> plan, billing cycle and payment references from Paystack. Card details are processed exclusively by Paystack and are never visible to the Data Controller;</p>
      <p>(d) <strong>Technical data:</strong> logs necessary for security and reliability.</p>

      <h3>3. Purpose and Lawful Basis</h3>
      <p>3.1 Personal data is processed for the performance of the service contract (account administration, dashboards, billing), for the Data Controller's legitimate interests (security, service improvement), and, where applicable, on the basis of consent.</p>
      <p>3.2 Business Data is processed solely for the purpose of providing the Service to the User. It is never sold and never shared with advertisers.</p>

      <h3>4. Disclosure</h3>
      <p>4.1 Business Data is visible to the User's staff members strictly in accordance with their assigned roles.</p>
      <p>4.2 Infrastructure providers (hosting, database) process data on the Data Controller's behalf under strict contractual terms. Paystack receives the User's email address and payment amount for billing purposes.</p>
      <p>4.3 No other disclosure shall be made except as required by law or with the User's consent.</p>

      <h3>5. Data Subject Rights</h3>
      <p>5.1 In accordance with the Nigeria Data Protection Act 2023, the User is entitled to access, rectification, erasure and objection in respect of personal data.</p>
      <p>5.2 The User may view, correct and export data within the application at any time. Deletion requests shall be effected within thirty (30) days, save for records the Data Controller is required by law to retain, such as billing records.</p>
      <p>5.3 Requests should be directed to info@kopabook.com.</p>

      <h3>6. Security</h3>
      <p>Passwords are subject to secure hashing, traffic is encrypted in transit, and access to systems is restricted to authorised personnel. In the event of a personal data breach, affected Users shall be notified in accordance with applicable law.</p>

      <h3>7. Retention</h3>
      <p>Business Data is retained for the duration of the account. Upon closure and a deletion request, data is erased within thirty (30) days, except where retention is required by law.</p>

      <h3>8. Amendments</h3>
      <p>Material amendments to this Policy shall be notified within the application before taking effect.</p>

      <h3>9. Contact</h3>
      <p>Privacy enquiries: info@kopabook.com · 0814 239 5738.</p>
    </LegalShell>
  );
}

export function RefundPage() {
  return (
    <LegalShell title="REFUND POLICY" updated="19 October 2026">
      <h3>1. General</h3>
      <p>
        1.1 This Refund Policy is issued by <strong>FVA70K Services</strong> (BN 7813786) and
        forms part of the Terms of Service. Subscription payments are processed securely by
        Paystack.
      </p>

      <h3>2. Free Plan</h3>
      <p>2.1 The Free plan is provided free of charge; no refund obligation arises in respect thereof.</p>

      <h3>3. Yearly Plans: Seven-Day Refund</h3>
      <p>
        3.1 Where the User subscribes to a yearly plan (Starter, Solo or Pro) and notifies
        the Company within <strong>seven (7) days</strong> of payment, the Company shall
        refund the full subscription fee, without the User being required to give reasons.
      </p>

      <h3>4. Monthly Plans</h3>
      <p>
        4.1 Monthly subscription charges are non-refundable once the charge has been applied,
        the Service having been made available for the billing month.
      </p>
      <p>4.2 The User may cancel at any time; cancellation prevents the next renewal, and the paid plan remains active until the end of the month already paid for.</p>

      <h3>5. After the Refund Period</h3>
      <p>
        5.1 After the seven-day period in Clause 3, yearly subscription fees are
        non-refundable for the current billing period. Cancellation stops future renewals;
        the account retains the paid plan until the end of the paid period, then reverts to
        the Free plan. No Business Data is deleted by reason of cancellation.
      </p>

      <h3>6. Refund Procedure</h3>
      <p>
        6.1 Refund requests should be sent to info@kopabook.com or through the support links
        in the application, stating the account email address and payment reference.
      </p>
      <p>6.2 Approved refunds are returned through Paystack to the original payment method, ordinarily within five (5) to ten (10) business days.</p>

      <h3>7. Duplicate and Failed Charges</h3>
      <p>
        7.1 Where the User is charged twice for the same billing period, or charged without
        the plan activating, the User should notify the Company immediately; the duplicate
        charge shall be corrected or refunded.
      </p>
    </LegalShell>
  );
}
