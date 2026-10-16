import { useEffect, useState } from "react";
import Layout from "./components/Layout";
import { api, nav, setCurrency } from "./lib/api";
import {
  LandingPage, FeaturesPage, PricingPage, WaitlistPage, NotFoundPage,
  HotelsLandingPage, AboutPage, FaqPage,
} from "./pages/Marketing";
import { TermsPage, PrivacyPage, RefundPage } from "./pages/Legal";
import { LoginPage, OwnerSetupPage, ForgotPasswordPage, ResetPasswordPage } from "./pages/Auth";
import RegisterPage from "./pages/Register";
import { SaleReceiptPage, HotelReceiptPage } from "./pages/Receipt";
import DashboardPage from "./pages/Dashboard";
import ProductsPage from "./pages/Products";
import SalesPage from "./pages/Sales";
import ServicesPage from "./pages/Services";
import SuppliersPage from "./pages/Suppliers";
import ImportPage from "./pages/Import";
import ExpensesPage from "./pages/Expenses";
import CustomersPage from "./pages/Customers";
import CustomerDetailPage from "./pages/CustomerDetail";
import HotelsPage from "./pages/Hotels";
import DebtsPage from "./pages/Debts";
import MessagesPage from "./pages/Messages";
import ReportsPage from "./pages/Reports";
import StaffPage from "./pages/Staff";
import SettingsPage from "./pages/Settings";
import ActivityPage from "./pages/Activity";
import AdminPage from "./pages/Admin";
import { NAV_MODULES, modulesForRole } from "./lib/businessTypes";

function useSession() {
  const [state, setState] = useState({ loading: true, session: null });
  useEffect(() => {
    let active = true;
    api.me()
      .then((d) => {
        if (active) {
          setCurrency(d.business?.currency);
          setState({ loading: false, session: d });
        }
      })
      .catch(() => { if (active) setState({ loading: false, session: null }); });
    return () => { active = false; };
  }, []);
  return state;
}

function AppRoute({ session }) {
  const path = window.location.pathname;

  if (path === "/") return <LandingPage />;
  if (path === "/features") return <FeaturesPage />;
  if (path === "/pricing") return <PricingPage />;
  if (path === "/about") return <AboutPage />;
  if (path === "/faq") return <FaqPage />;
  if (path === "/terms") return <TermsPage />;
  if (path === "/privacy") return <PrivacyPage />;
  if (path === "/refund") return <RefundPage />;
  if (path === "/waitlist") return <WaitlistPage />;
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
  if (path === "/owner-setup") {
    if (session) { nav("/app/dashboard"); return null; }
    return <OwnerSetupPage />;
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
    return <SaleReceiptPage saleId={path.split("/")[4]} />;
  }
  if (path.startsWith("/app/receipt/hotel/")) {
    if (!session) { nav("/login"); return null; }
    return <HotelReceiptPage bookingId={path.split("/")[4]} />;
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
    else if (path === "/app/settings") page = <SettingsPage session={session} />;
    else if (path === "/app/admin") page = <AdminPage />;
    else if (path === "/app/activity") page = <ActivityPage session={session} />;
    // Staff see only their role's workspace, even by direct link.
    const roleModules = modulesForRole(session.business?.role);
    if (roleModules) {
      const mod = NAV_MODULES[Object.keys(NAV_MODULES).find((p) => path === p || path.startsWith(p + "/")) || ""];
      if (mod && !roleModules.includes(mod)) {
        page = (
          <div className="card">
            <h2>Not available for your role</h2>
            <p className="hint">Your role ({session.business?.role}) does not include this section. Ask the business owner if you need access.</p>
          </div>
        );
      }
    }
    return <Layout session={session}>{page}</Layout>;
  }

  return <NotFoundPage />;
}

export default function App() {
  const { loading, session } = useSession();
  if (loading) return <div className="loading">Loading KopaBook...</div>;
  return <AppRoute session={session} />;
}
