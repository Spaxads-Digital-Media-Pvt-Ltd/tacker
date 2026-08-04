import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { ROLE_HOME } from './auth/roles';
import { AppShell } from './components/AppShell';
import { NetworkListPage } from './pages/admin/NetworkListPage';
import { CustomFieldsManage } from './pages/admin/CustomFieldsManage';

// Route-level code-splitting per portal (spec §3B): each page is its own lazy chunk.
const Login = lazy(() => import('./pages/Login'));
const DashboardHome = lazy(() => import('./pages/DashboardHome'));
const Advertisers = lazy(() => import('./pages/admin/Advertisers'));
const AdvertiserDetail = lazy(() => import('./pages/admin/AdvertiserDetail'));
const Publishers = lazy(() => import('./pages/admin/Publishers'));
const PublisherDetail = lazy(() => import('./pages/admin/PublisherDetail'));
const Offers = lazy(() => import('./pages/admin/Offers'));
const OfferDetail = lazy(() => import('./pages/admin/OfferDetail'));
const OfferCreate = lazy(() => import('./pages/admin/OfferCreate'));
const TrackingDomains = lazy(() => import('./pages/admin/TrackingDomains'));
const Networks = lazy(() => import('./pages/super-admin/Networks'));
const Subscriptions = lazy(() => import('./pages/super-admin/Subscriptions'));
const Usage = lazy(() => import('./pages/super-admin/Usage'));
const PublisherOffers = lazy(() => import('./pages/portal/PublisherOffers'));
const AdvertiserOffers = lazy(() => import('./pages/portal/AdvertiserOffers'));
const PublisherEarnings = lazy(() => import('./pages/portal/PublisherEarnings'));
const Payouts = lazy(() => import('./pages/admin/Payouts'));
const ApiKeys = lazy(() => import('./pages/portal/ApiKeys'));
const ReportView = lazy(() => import('./pages/ReportView'));
const Reports = lazy(() => import('./pages/admin/Reports'));
const Settings = lazy(() => import('./pages/admin/Settings'));
const SmartLinks = lazy(() => import('./pages/admin/SmartLinks'));
const SmartLinkDetail = lazy(() => import('./pages/admin/SmartLinkDetail'));
const Integrations = lazy(() => import('./pages/admin/Integrations'));
const Invoices = lazy(() => import('./pages/admin/Invoices'));
const Alerts = lazy(() => import('./pages/admin/Alerts'));
const AiOps = lazy(() => import('./pages/admin/AiOps'));
const PublisherCreate = lazy(() => import('./pages/admin/PublisherCreate'));
const AdvertiserCreate = lazy(() => import('./pages/admin/AdvertiserCreate'));
const TagsManage = lazy(() => import('./pages/admin/TagsManage'));
const PostbackTestPage = lazy(() => import('./pages/admin/PostbackTestPage'));
const DebugPostbackPage = lazy(() => import('./pages/admin/DebugPostbackPage'));
const ProfilePage = lazy(() => import('./pages/admin/ProfilePage'));

function Loading() {
  return (
    <div className="grid h-full place-items-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" />
    </div>
  );
}

function RootRedirect() {
  const { session } = useAuth();
  return <Navigate to={session ? ROLE_HOME[session.role] : '/login'} replace />;
}

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* Super Admin */}
        <Route element={<ProtectedRoute allow="super_admin"><AppShell /></ProtectedRoute>}>
          <Route path="/admin" element={<DashboardHome />} />
          <Route path="/admin/networks" element={<Networks />} />
          <Route path="/admin/subscriptions" element={<Subscriptions />} />
          <Route path="/admin/usage" element={<Usage />} />
        </Route>

        {/* Admin / Network */}
        <Route element={<ProtectedRoute allow="admin"><AppShell /></ProtectedRoute>}>
          <Route path="/app" element={<DashboardHome />} />
          <Route path="/app/offers" element={<Offers />} />
          <Route path="/app/offers/new" element={<OfferCreate />} />
          <Route path="/app/offers/:id" element={<OfferDetail />} />
          <Route path="/app/publishers" element={<Publishers />} />
          <Route path="/app/publishers/new" element={<PublisherCreate />} />
          <Route path="/app/publishers/:id" element={<PublisherDetail />} />
          <Route path="/app/advertisers" element={<Advertisers />} />
          <Route path="/app/advertisers/new" element={<AdvertiserCreate />} />
          <Route path="/app/advertisers/:id" element={<AdvertiserDetail />} />
          {/* Offers section pages */}
          <Route path="/app/offers-access" element={<NetworkListPage kind="access" />} />
          <Route path="/app/offers-creatives" element={<NetworkListPage kind="creatives" />} />
          <Route path="/app/offers-coupons" element={<NetworkListPage kind="coupons" />} />
          <Route path="/app/offers-deals" element={<NetworkListPage kind="deals" />} />
          <Route path="/app/offers-tags" element={<TagsManage />} />
          {/* Affiliates section pages */}
          <Route path="/app/aff-postbacks" element={<NetworkListPage kind="postbacks" />} />
          <Route path="/app/aff-postback-test" element={<PostbackTestPage />} />
          <Route path="/app/aff-custom-fields" element={<CustomFieldsManage entityType="publisher" />} />
          <Route path="/app/aff-tags" element={<TagsManage />} />
          {/* Advertisers section pages */}
          <Route path="/app/adv-custom-fields" element={<CustomFieldsManage entityType="advertiser" />} />
          <Route path="/app/adv-tags" element={<TagsManage />} />
          <Route path="/app/adv-debug-postback" element={<DebugPostbackPage />} />
          <Route path="/app/domains" element={<TrackingDomains />} />
          <Route path="/app/reports" element={<Navigate to="/app/reports/offer" replace />} />
          <Route path="/app/reports/:type" element={<Reports />} />
          <Route path="/app/smart-links" element={<SmartLinks />} />
          <Route path="/app/smart-links/:id" element={<SmartLinkDetail />} />
          <Route path="/app/payouts" element={<Payouts />} />
          <Route path="/app/alerts" element={<Alerts />} />
          <Route path="/app/ai" element={<AiOps />} />
          <Route path="/app/settings" element={<Settings />} />
          <Route path="/app/profile" element={<ProfilePage />} />
          <Route path="/app/api-keys" element={<ApiKeys basePath="/api/keys" />} />
          <Route path="/app/integrations" element={<Integrations />} />
          <Route path="/app/invoices" element={<Invoices />} />
        </Route>

        {/* Publisher portal */}
        <Route element={<ProtectedRoute allow="publisher"><AppShell /></ProtectedRoute>}>
          <Route path="/publisher" element={<DashboardHome />} />
          <Route path="/publisher/offers" element={<PublisherOffers />} />
          <Route path="/publisher/stats" element={<ReportView title="Stats" subtitle="Your clicks, conversions, CR, payout, EPC — your data only." basePath="/api/portal/publisher/stats" groupByOptions={['offer', 'country', 'device', 'day']} />} />
          <Route path="/publisher/earnings" element={<PublisherEarnings />} />
          <Route path="/publisher/api-keys" element={<ApiKeys basePath="/api/portal/publisher/keys" />} />
        </Route>

        {/* Advertiser portal */}
        <Route element={<ProtectedRoute allow="advertiser"><AppShell /></ProtectedRoute>}>
          <Route path="/advertiser" element={<DashboardHome />} />
          <Route path="/advertiser/offers" element={<AdvertiserOffers />} />
          <Route path="/advertiser/stats" element={<ReportView title="Stats" subtitle="Your offers’ clicks, conversions, CR, revenue — your data only." basePath="/api/portal/advertiser/stats" groupByOptions={['offer', 'country', 'device', 'day']} />} />
          <Route path="/advertiser/api-keys" element={<ApiKeys basePath="/api/portal/advertiser/keys" />} />
        </Route>

        <Route path="/" element={<RootRedirect />} />
        <Route path="*" element={<RootRedirect />} />
      </Routes>
    </Suspense>
  );
}
