import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router';
import HomeOrStorePage from '@/pages/HomeOrStorePage';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import RouteFallback from '@/components/ui/RouteFallback';

const LoginPage = lazy(() => import('@/pages/LoginPage'));
const ResellerLoginPage = lazy(() => import('@/pages/ResellerLoginPage'));
const AgentLoginPage = lazy(() => import('@/pages/AgentLoginPage'));
const AdminLoginPage = lazy(() => import('@/pages/AdminLoginPage'));
const RegisterPage = lazy(() => import('@/pages/RegisterPage'));
const VerifyOtpPage = lazy(() => import('@/pages/VerifyOtpPage'));
const ForgotPasswordPage = lazy(() => import('@/pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('@/pages/ResetPasswordPage'));
const PaymentCallbackPage = lazy(() => import('@/pages/PaymentCallbackPage'));

const AdminDashboard = lazy(() => import('@/pages/admin/AdminDashboard'));
const AdminAgentsPage = lazy(() => import('@/pages/admin/AdminAgentsPage'));
const AdminPackagesPage = lazy(() => import('@/pages/admin/AdminPackagesPage'));
const AdminOrdersPage = lazy(() => import('@/pages/admin/AdminOrdersPage'));
const AdminComplaintsPage = lazy(() => import('@/pages/admin/AdminComplaintsPage'));
const AdminResellersPage = lazy(() => import('@/pages/admin/AdminResellersPage'));
const AdminWithdrawalsPage = lazy(() => import('@/pages/admin/AdminWithdrawalsPage'));
const AdminSettingsPage = lazy(() => import('@/pages/admin/AdminSettingsPage'));
const AdminCheckersPage = lazy(() => import('@/pages/admin/AdminCheckersPage'));
const AdminSearchPage = lazy(() => import('@/pages/admin/AdminSearchPage'));

const AgentDashboard = lazy(() => import('@/pages/agent/AgentDashboard'));
const AgentPurchasePage = lazy(() => import('@/pages/agent/AgentPurchasePage'));
const AgentAfaPage = lazy(() => import('@/pages/agent/AgentAfaPage'));
const AgentCheckerPage = lazy(() => import('@/pages/agent/AgentCheckerPage'));
const AgentBulkPage = lazy(() => import('@/pages/agent/AgentBulkPage'));
const AgentWalletPage = lazy(() => import('@/pages/agent/AgentWalletPage'));
const AgentApiPage = lazy(() => import('@/pages/agent/AgentApiPage'));
const AgentOrdersPage = lazy(() => import('@/pages/agent/AgentOrdersPage'));
const AgentComplaintsPage = lazy(() => import('@/pages/agent/AgentComplaintsPage'));

const ResellerDashboard = lazy(() => import('@/pages/reseller/ResellerDashboard'));
const ResellerPricesPage = lazy(() => import('@/pages/reseller/ResellerPricesPage'));
const ResellerStorePage = lazy(() => import('@/pages/reseller/ResellerStorePage'));
const ResellerWithdrawalsPage = lazy(() => import('@/pages/reseller/ResellerWithdrawalsPage'));
const ResellerOrdersPage = lazy(() => import('@/pages/reseller/ResellerOrdersPage'));
const ResellerComplaintsPage = lazy(() => import('@/pages/reseller/ResellerComplaintsPage'));
const ResellerSubResellersPage = lazy(() => import('@/pages/reseller/ResellerSubResellersPage'));
const ResellerSubResellerPricesPage = lazy(() => import('@/pages/reseller/ResellerSubResellerPricesPage'));
const ResellerDefaultSubResellerPricesPage = lazy(() =>
  import('@/pages/reseller/ResellerDefaultSubResellerPricesPage')
);

const StoreCheckerPage = lazy(() => import('@/pages/store/StoreCheckerPage'));
const StoreCheckerSuccessPage = lazy(() => import('@/pages/store/StoreCheckerSuccessPage'));
const StoreAfaPage = lazy(() => import('@/pages/store/StoreAfaPage'));
const StorePurchasePage = lazy(() => import('@/pages/store/StorePurchasePage'));
const StoreHomePage = lazy(() => import('@/pages/store/StoreHomePage'));
const SubResellerRegisterPage = lazy(() => import('@/pages/store/SubResellerRegisterPage'));
const LegacyStoreBuyRedirect = lazy(() =>
  import('@/pages/store/StoreSlugRedirect').then((m) => ({ default: m.LegacyStoreBuyRedirect }))
);
const VerifyPage = lazy(() => import('@/pages/store/VerifyPage'));

const SessionTimeout = lazy(() => import('@/components/auth/SessionTimeout'));

function Lazy({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

export default function App() {
  return (
    <>
      <Suspense fallback={null}>
        <SessionTimeout />
      </Suspense>
      <Routes>
        <Route path="/" element={<HomeOrStorePage />} />
        <Route path="/buy/:network" element={<Lazy><LegacyStoreBuyRedirect /></Lazy>} />
        <Route path="/login" element={<Lazy><LoginPage /></Lazy>} />
        <Route path="/login/reseller" element={<Lazy><ResellerLoginPage /></Lazy>} />
        <Route path="/login/agent" element={<Lazy><AgentLoginPage /></Lazy>} />
        <Route path="/login/dealer" element={<Navigate to="/login/agent" replace />} />
        <Route path="/login/admin" element={<Lazy><AdminLoginPage /></Lazy>} />
        <Route path="/register" element={<Lazy><RegisterPage /></Lazy>} />
        <Route path="/verify-otp" element={<Lazy><VerifyOtpPage /></Lazy>} />
        <Route path="/forgot-password" element={<Lazy><ForgotPasswordPage /></Lazy>} />
        <Route path="/reset-password" element={<Lazy><ResetPasswordPage /></Lazy>} />
        <Route path="/payment/callback" element={<Lazy><PaymentCallbackPage /></Lazy>} />

        <Route path="/admin" element={<Lazy><ProtectedRoute role="admin"><AdminDashboard /></ProtectedRoute></Lazy>} />
        <Route path="/admin/agents" element={<Lazy><ProtectedRoute role="admin"><AdminAgentsPage /></ProtectedRoute></Lazy>} />
        <Route path="/admin/packages" element={<Lazy><ProtectedRoute role="admin"><AdminPackagesPage /></ProtectedRoute></Lazy>} />
        <Route path="/admin/checkers" element={<Lazy><ProtectedRoute role="admin"><AdminCheckersPage /></ProtectedRoute></Lazy>} />
        <Route path="/admin/search" element={<Lazy><ProtectedRoute role="admin"><AdminSearchPage /></ProtectedRoute></Lazy>} />
        <Route path="/admin/orders" element={<Lazy><ProtectedRoute role="admin"><AdminOrdersPage /></ProtectedRoute></Lazy>} />
        <Route path="/admin/complaints" element={<Lazy><ProtectedRoute role="admin"><AdminComplaintsPage /></ProtectedRoute></Lazy>} />
        <Route path="/admin/resellers" element={<Lazy><ProtectedRoute role="admin"><AdminResellersPage /></ProtectedRoute></Lazy>} />
        <Route path="/admin/withdrawals" element={<Lazy><ProtectedRoute role="admin"><AdminWithdrawalsPage /></ProtectedRoute></Lazy>} />
        <Route path="/admin/settings" element={<Lazy><ProtectedRoute role="admin"><AdminSettingsPage /></ProtectedRoute></Lazy>} />

        <Route path="/agent" element={<Lazy><ProtectedRoute role="agent"><AgentDashboard /></ProtectedRoute></Lazy>} />
        <Route path="/agent/purchase" element={<Lazy><ProtectedRoute role="agent"><AgentPurchasePage /></ProtectedRoute></Lazy>} />
        <Route path="/agent/checker" element={<Lazy><ProtectedRoute role="agent"><AgentCheckerPage /></ProtectedRoute></Lazy>} />
        <Route path="/agent/afa" element={<Lazy><ProtectedRoute role="agent"><AgentAfaPage /></ProtectedRoute></Lazy>} />
        <Route path="/agent/bulk" element={<Lazy><ProtectedRoute role="agent"><AgentBulkPage /></ProtectedRoute></Lazy>} />
        <Route path="/agent/wallet" element={<Lazy><ProtectedRoute role="agent"><AgentWalletPage /></ProtectedRoute></Lazy>} />
        <Route path="/agent/api" element={<Lazy><ProtectedRoute role="agent"><AgentApiPage /></ProtectedRoute></Lazy>} />
        <Route path="/agent/orders" element={<Lazy><ProtectedRoute role="agent"><AgentOrdersPage /></ProtectedRoute></Lazy>} />
        <Route path="/agent/complaints" element={<Lazy><ProtectedRoute role="agent"><AgentComplaintsPage /></ProtectedRoute></Lazy>} />
        <Route path="/dealer" element={<Navigate to="/agent" replace />} />
        <Route path="/dealer/*" element={<Navigate to="/agent" replace />} />
        <Route path="/admin/dealers" element={<Navigate to="/admin/agents" replace />} />

        <Route path="/reseller" element={<Lazy><ProtectedRoute role="reseller"><ResellerDashboard /></ProtectedRoute></Lazy>} />
        <Route path="/reseller/store" element={<Lazy><ProtectedRoute role="reseller"><ResellerStorePage /></ProtectedRoute></Lazy>} />
        <Route path="/reseller/prices" element={<Lazy><ProtectedRoute role="reseller"><ResellerPricesPage /></ProtectedRoute></Lazy>} />
        <Route path="/reseller/withdrawals" element={<Lazy><ProtectedRoute role="reseller"><ResellerWithdrawalsPage /></ProtectedRoute></Lazy>} />
        <Route path="/reseller/orders" element={<Lazy><ProtectedRoute role="reseller"><ResellerOrdersPage /></ProtectedRoute></Lazy>} />
        <Route path="/reseller/complaints" element={<Lazy><ProtectedRoute role="reseller"><ResellerComplaintsPage /></ProtectedRoute></Lazy>} />
        <Route path="/reseller/sub-resellers" element={<Lazy><ProtectedRoute role="reseller"><ResellerSubResellersPage /></ProtectedRoute></Lazy>} />
        <Route path="/reseller/sub-resellers/default-prices" element={<Lazy><ProtectedRoute role="reseller"><ResellerDefaultSubResellerPricesPage /></ProtectedRoute></Lazy>} />
        <Route path="/reseller/sub-resellers/:childId/prices" element={<Lazy><ProtectedRoute role="reseller"><ResellerSubResellerPricesPage /></ProtectedRoute></Lazy>} />

        <Route path="/store/:slug" element={<Lazy><StoreHomePage /></Lazy>} />
        <Route path="/store/:slug/become-reseller" element={<Lazy><SubResellerRegisterPage /></Lazy>} />
        <Route path="/store/:slug/checker" element={<Lazy><StoreCheckerPage /></Lazy>} />
        <Route path="/store/:slug/checker/success" element={<Lazy><StoreCheckerSuccessPage /></Lazy>} />
        <Route path="/store/:slug/afa" element={<Lazy><StoreAfaPage /></Lazy>} />
        <Route path="/store/:slug/buy/:network" element={<Lazy><StorePurchasePage /></Lazy>} />
        <Route path="/store/:slug/verify" element={<Lazy><VerifyPage /></Lazy>} />
      </Routes>
    </>
  );
}
