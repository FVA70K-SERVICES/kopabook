import { useEffect, useState } from "react";
import Layout from "./components/Layout";
import { api, nav } from "./lib/api";
import {
  LandingPage, FeaturesPage, PricingPage, WaitlistPage, NotFoundPage,
} from "./pages/Marketing";
import { LoginPage, OwnerSetupPage, ForgotPasswordPage } from "./pages/Auth";
import DashboardPage from "./pages/Dashboard";
import ProductsPage from "./pages/Products";
import SalesPage from "./pages/Sales";
import ServicesPage from "./pages/Services";
import SuppliersPage from "./pages/Suppliers";
import ImportPage from "./pages/Import";
import ExpensesPage from "./pages/Expenses";
import CustomersPage from "./pages/Customers";
import DebtsPage from "./pages/Debts";
import MessagesPage from "./pages/Messages";
import ReportsPage from "./pages/Reports";
import StaffPage from "./pages/Staff";
import SettingsPage from "./pages/Settings";

function useSession() {
  const [state, setState] = useState({ loading: true, session: null });
  useEffect(() => {
    let active = true;
    api.me()
      .then((d) => { if (active) setState({ loading: false, session: d }); })
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
  if (path === "/waitlist") return <WaitlistPage />;
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

  if (path.startsWith("/app")) {
    if (!session) { nav("/login"); return null; }
    let page = <DashboardPage />;
    if (path === "/app/products") page = <ProductsPage session={session} />;
    else if (path === "/app/sales") page = <SalesPage />;
    else if (path === "/app/services") page = <ServicesPage session={session} />;
    else if (path === "/app/suppliers") page = <SuppliersPage session={session} />;
    else if (path === "/app/import") page = <ImportPage />;
    else if (path === "/app/expenses") page = <ExpensesPage session={session} />;
    else if (path === "/app/customers") page = <CustomersPage />;
    else if (path === "/app/debts") page = <DebtsPage />;
    else if (path === "/app/messages") page = <MessagesPage session={session} />;
    else if (path === "/app/reports") page = <ReportsPage />;
    else if (path === "/app/staff") page = <StaffPage session={session} />;
    else if (path === "/app/settings") page = <SettingsPage session={session} />;
    return <Layout session={session}>{page}</Layout>;
  }

  return <NotFoundPage />;
}

export default function App() {
  const { loading, session } = useSession();
  if (loading) return <div className="loading">Loading KopaBook...</div>;
  return <AppRoute session={session} />;
}
