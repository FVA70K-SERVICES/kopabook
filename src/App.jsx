import { useEffect, useState, lazy, Suspense } from "react";
import Layout from "./components/Layout";
import InstallPrompt from "./components/InstallPrompt";
import { api, nav, setCurrency } from "./lib/api";
// Speed (2026-11-06): the main bundle used to carry every page, so a
// cold open downloaded the landing page, the auth pages, the receipt
// pages and all fourteen app sections before the PIN screen could even
// render (1,033 kB minified). Only the Dashboard stays eager: it is
// the screen behind the lock and must be ready the moment the PIN
// lands. Every other page loads on demand; the Suspense fallback in
// App() covers the public routes and the one in the /app branch covers
// the sections. Named page exports go through a small adapter so
// lazy() still gets a default export.
const lazyNamed = (loader, name) => lazy(() => loader().then((m) => ({ default: m[name] })));
const LandingPage = lazyNamed(() => import("./pages/Marketing"), "LandingPage");
const FeaturesPage = lazyNamed(() => import("./pages/Marketing"), "FeaturesPage");
const PricingPage = lazyNamed(() => import("./pages/Marketing"), "PricingPage");
const NotFoundPage = lazyNamed(() => import("./pages/Marketing"), "NotFoundPage");
const HotelsLandingPage = lazyNamed(() => import("./pages/Marketing"), "HotelsLandingPage");
const AboutPage = lazyNamed(() => import("./pages/Marketing"), "AboutPage");
const FaqPage = lazyNamed(() => import("./pages/Marketing"), "FaqPage");
const DownloadPage = lazyNamed(() => import("./pages/Marketing"), "DownloadPage");
const TermsPage = lazyNamed(() => import("./pages/Legal"), "TermsPage");
const PrivacyPage = lazyNamed(() => import("./pages/Legal"), "PrivacyPage");
const RefundPage = lazyNamed(() => import("./pages/Legal"), "RefundPage");
const LoginPage = lazyNamed(() => import("./pages/Auth"), "LoginPage");
const ForgotPasswordPage = lazyNamed(() => import("./pages/Auth"), "ForgotPasswordPage");
const ResetPasswordPage = lazyNamed(() => import("./pages/Auth"), "ResetPasswordPage");
const RegisterPage = lazy(() => import("./pages/Register"));
const ProjectJoinPage = lazy(() => import("./pages/ProjectJoin"));
const SaleReceiptPage = lazyNamed(() => import("./pages/Receipt"), "SaleReceiptPage");
const HotelReceiptPage = lazyNamed(() => import("./pages/Receipt"), "HotelReceiptPage");
import DashboardPage from "./pages/Dashboard";
const ProductsPage = lazy(() => import("./pages/Products"));
const SalesPage = lazy(() => import("./pages/Sales"));
const ServicesPage = lazy(() => import("./pages/Services"));
const SuppliersPage = lazy(() => import("./pages/Suppliers"));
const ImportPage = lazy(() => import("./pages/Import"));
const ExpensesPage = lazy(() => import("./pages/Expenses"));
const CustomersPage = lazy(() => import("./pages/Customers"));
const CustomerDetailPage = lazy(() => import("./pages/CustomerDetail"));
const HotelsPage = lazy(() => import("./pages/Hotels"));
const DebtsPage = lazy(() => import("./pages/Debts"));
const MessagesPage = lazy(() => import("./pages/Messages"));
const ReportsPage = lazy(() => import("./pages/Reports"));
const HistoryPage = lazy(() => import("./pages/History"));
const StaffPage = lazy(() => import("./pages/Staff"));
const ProjectsPage = lazy(() => import("./pages/Projects"));
const SettingsPage = lazy(() => import("./pages/Settings"));
const ActivityPage = lazy(() => import("./pages/Activity"));
const NotebookPage = lazy(() => import("./pages/Notebook"));
const CalculatorPage = lazy(() => import("./pages/Calculator"));
const AdminPage = lazy(() => import("./pages/Admin"));
const ChatPage = lazy(() => import("./pages/Chat"));
import { NAV_MODULES, modulesForRole, modulesForType } from "./lib/businessTypes";
import { AppLockGate } from "./components/AppLock";
import { applyRouteSeo } from "./lib/seo";

import EntranceGate, { GATE_MIN_MS } from "./components/EntranceGate";

// The gate's small branded fallback for lazily loaded pages. The old
// fallback was the bare ".loading" spinner over live content; a chunk
// load after the gate is a short, honest wait, so it shows the logo
// and a line of text and no spinner.
function PageFallback({ label }) {
  return (
    <div className="kb-page-loading" role="status" aria-live="polite">
      <img src="/logo.png" alt="" className="kb-page-loading-logo" />
      <p>{label}</p>
    </div>
  );
}

function useSession() {
  // status: "ok" (signed in), "signed-out" (the server said 401 — a
  // definite signed-out), "unknown" (any other failure: network blip,
  // timeout, 5xx). Only a definite 401 ever routes to sign-in. An
  // ambiguous failure holds the gate with a retry instead of dumping
  // a signed-in user to the sign-in screen and, on the next sign-in,
  // into a different business's books.
  const [state, setState] = useState({ loading: true, session: null, status: "unknown" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    // Warm the app-lock state in parallel with the session fetch: the
    // gate's own GET then hits the in-flight / cached response (see
    // api.js) instead of starting a second serial round trip after
    // me() resolves. Fire-and-forget; the gate owns the result, and a
    // signed-out 401 here is expected and ignored.
    api.get("/api/auth/app-lock").catch(() => {});
    api.me()
      .then((d) => {
        if (active) {
          setCurrency(d.business?.currency);
          setState({ loading: false, session: d, status: "ok" });
          // Tell Kopa Bot who is logged in (business copilot mode)
          try {
            if (d.user && d.business && window.setFVAChatOwner) {
              window.setFVAChatOwner({
                businessId: d.business.id,
                userId: d.user.id,
                userName: d.user.name,
                userRole: d.business.role || 'owner',
                isPlatformAdmin: !!d.user.isPlatformAdmin
              });
            }
          } catch (e) {}
        }
      })
      .catch((err) => {
        if (active) {
          const signedOut = !!(err && err.status === 401);
          setState({ loading: false, session: null, status: signedOut ? "signed-out" : "unknown" });
        }
      });
    return () => { active = false; };
  }, [attempt]);
  return { ...state, retry: () => { setState({ loading: true, session: null, status: "unknown" }); setAttempt((a) => a + 1); } };
}

function AppRoute({ session }) {
  const path = window.location.pathname;
  // SEO: each public route gets its own title, description and
  // canonical (see src/lib/seo.js). App and auth routes are left
  // alone, and unknown paths get the not-found title.
  useEffect(() => { applyRouteSeo(path); }, [path]);

  // A signed-in cold start at "/" goes straight to the Dashboard.
  // Before this fix AppRoute returned the marketing landing page for
  // "/" regardless of session, so a signed-in user opening the app
  // cold saw the landing page first (the 23 Nov video, ~42s).
  if (path === "/") {
    if (session) { nav("/app/dashboard"); return null; }
    return <LandingPage />;
  }
  if (path === "/features") return <FeaturesPage />;
  if (path === "/pricing") return <PricingPage />;
  if (path === "/about") return <AboutPage />;
  if (path === "/faq") return <FaqPage />;
  if (path === "/download") return <DownloadPage />;
  if (path === "/terms") return <TermsPage />;
  if (path === "/privacy") return <PrivacyPage />;
  if (path === "/refund") return <RefundPage />;
  if (path === "/waitlist") { nav("/register"); return null; }
  if (path === "/hotels") return <HotelsLandingPage />;
  if (path === "/hotels/register") {
    if (session) { nav("/app/hotels"); return null; }
    return <RegisterPage preset="hotel" />;
  }
  if (path === "/register") {
    if (session) { nav("/app/dashboard"); return null; }
    return <RegisterPage />;
  }
  if (path === "/login") {
    if (session) { nav("/app/dashboard"); return null; }
    return <LoginPage />;
  }
  if (path === "/forgot-password") {
    if (session) { nav("/app/dashboard"); return null; }
    return <ForgotPasswordPage />;
  }
  if (path === "/reset-password") {
    if (session) { nav("/app/dashboard"); return null; }
    return <ResetPasswordPage />;
  }

  if (path.startsWith("/app/receipt/sale/")) {
    if (!session) { nav("/login"); return null; }
    return (
      <AppLockGate session={session}>
        <SaleReceiptPage saleId={path.split("/")[4]} />
      </AppLockGate>
    );
  }
  if (path.startsWith("/app/receipt/hotel/")) {
    if (!session) { nav("/login"); return null; }
    return (
      <AppLockGate session={session}>
        <HotelReceiptPage bookingId={path.split("/")[4]} />
      </AppLockGate>
    );
  }

  // Project invite join link: public page, works signed out too.
  if (path.startsWith("/app/projects/join/")) {
    const token = path.split("/")[4] || "";
    return (
      <Suspense fallback={<PageFallback label="Opening invite…" />}>
        <ProjectJoinPage token={token} session={session} />
      </Suspense>
    );
  }

  if (path.startsWith("/app")) {
    if (!session) { nav("/login"); return null; }
    let page = <DashboardPage />;
    if (path === "/app/products") page = <ProductsPage session={session} />;
    else if (path === "/app/sales") page = <SalesPage session={session} />;
    else if (path === "/app/services") page = <ServicesPage session={session} />;
    else if (path === "/app/suppliers") page = <SuppliersPage session={session} />;
    else if (path === "/app/import") page = <ImportPage />;
    else if (path === "/app/expenses") page = <ExpensesPage session={session} />;
    else if (path.startsWith("/app/customers/")) page = <CustomerDetailPage customerId={path.split("/")[3]} session={session} />;
    else if (path === "/app/customers") page = <CustomersPage />;
    else if (path === "/app/hotels") page = <HotelsPage session={session} />;
    else if (path === "/app/debts") page = <DebtsPage />;
    else if (path === "/app/messages") page = <MessagesPage session={session} />;
    else if (path === "/app/reports") page = <ReportsPage />;
    else if (path === "/app/staff") page = <StaffPage session={session} />;
    else if (path === "/app/projects") page = <ProjectsPage session={session} />;
    else if (path === "/app/settings") page = <SettingsPage session={session} />;
    else if (path === "/app/admin") page = <AdminPage />;
    else if (path === "/app/activity") page = <ActivityPage session={session} />;
    else if (path === "/app/history") page = <HistoryPage session={session} />;
    else if (path === "/app/notebook") page = <NotebookPage session={session} />;
    else if (path === "/app/calculator") page = <CalculatorPage />;
    else if (path === "/app/chat") page = <ChatPage side="home" session={session} />;
    else if (path === "/app/chat/ai") page = <ChatPage side="ai" session={session} />;
    else if (path === "/app/chat/support") page = <ChatPage side="support" session={session} />;
    else if (path === "/app/chat/admin") page = <ChatPage side="admin" session={session} />;
    // Staff see only their role's workspace, even by direct link.
    // Business types only see the modules that fit them, even by direct link
    // (e.g. Hotels never opens for a provision store).
    const roleModules = modulesForRole(session.business?.role);
    // Projects is universal (see modulesForType): never type-blocked.
    const orgModules = modulesForType(session.business?.business_type);
    const mod = NAV_MODULES[Object.keys(NAV_MODULES).find((p) => path === p || path.startsWith(p + "/")) || ""];
    if (mod && roleModules && !roleModules.includes(mod)) {
      page = (
        <div className="card">
          <h2>Not available for your role</h2>
          <p className="hint">Your role ({session.business?.role}) does not include this section. Ask the business owner if you need access.</p>
        </div>
      );
    } else if (mod && !orgModules.includes(mod)) {
      page = (
        <div className="card">
          <h2>Not available for this business</h2>
          <p className="hint">This section is not part of your business type.</p>
        </div>
      );
    }
    return (
      <AppLockGate session={session}>
        <Layout session={session}>
          <Suspense fallback={<PageFallback label="Loading section…" />}>
            <div id="main">{page}</div>
          </Suspense>
        </Layout>
      </AppLockGate>
    );
  }

  return <NotFoundPage />;
}

function gateReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export default function App() {
  const { loading, session, status, retry } = useSession();
  // Gate pacing, from first render (near navigation start). The gate
  // shows until BOTH the session check has settled AND the 1400ms
  // minimum has run — unless the check itself is slow, in which case
  // the gate adds zero delay, or reduced motion is on, in which case
  // there is no wait at all. An ambiguous failure never auto-advances:
  // the gate holds with Try again (retry() re-runs the check; the
  // minimum is already spent by then, so a good retry exits at once).
  const [gateT0] = useState(() => {
    try { return performance.now(); } catch { return 0; }
  });
  const [gateDone, setGateDone] = useState(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => setSlow(true), GATE_MIN_MS);
    return () => clearTimeout(t);
  }, [loading]);
  useEffect(() => {
    if (loading) return;
    if (status === "unknown") return;
    if (gateReducedMotion()) { setGateDone(true); return; }
    let remain = 0;
    try { remain = GATE_MIN_MS - (performance.now() - gateT0); } catch { remain = 0; }
    if (remain <= 0) { setGateDone(true); return; }
    const t = setTimeout(() => setGateDone(true), remain);
    return () => clearTimeout(t);
  }, [loading, status, gateT0]);
  const failed = !loading && status === "unknown";
  if (loading || !gateDone) {
    return (
      <EntranceGate
        slow={slow && loading}
        failed={failed}
        onRetry={() => { setGateDone(false); setSlow(false); retry(); }}
      />
    );
  }
  // One Suspense boundary for the lazily loaded pages (public routes
  // and receipts); the /app branch has its own below. The install
  // prompt mounts here, outside the route, so it can appear on the
  // landing page as well as inside the app.
  return (
    <Suspense fallback={<PageFallback label="Loading KopaBook…" />}>
      <AppRoute session={session} />
      <InstallPrompt />
    </Suspense>
  );
}

