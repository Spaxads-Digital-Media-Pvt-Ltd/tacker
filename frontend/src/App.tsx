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
const AdvertisersBulkEdit = lazy(() => import('./pages/admin/AdvertisersBulkEdit'));
const AdvertiserDetail = lazy(() => import('./pages/admin/AdvertiserDetail'));
const Publishers = lazy(() => import('./pages/admin/Publishers'));
const PublisherDetail = lazy(() => import('./pages/admin/PublisherDetail'));
const Offers = lazy(() => import('./pages/admin/Offers'));
const OfferDetail = lazy(() => import('./pages/admin/OfferDetail'));
const OfferCreate = lazy(() => import('./pages/admin/OfferCreate'));
const OfferEdit = lazy(() => import('./pages/admin/OfferEdit'));
const OffersBulkEdit = lazy(() => import('./pages/admin/OffersBulkEdit'));
const PublisherEdit = lazy(() => import('./pages/admin/PublisherEdit'));
const PublishersBulkEdit = lazy(() => import('./pages/admin/PublishersBulkEdit'));
const PostbacksManage = lazy(() => import('./pages/admin/PostbacksManage'));
const PostbackForm = lazy(() => import('./pages/admin/PostbackForm'));
const TiersManage = lazy(() => import('./pages/admin/TiersManage'));
const TierForm = lazy(() => import('./pages/admin/TierForm'));
const TierDetail = lazy(() => import('./pages/admin/TierDetail'));
const ApplicationsManage = lazy(() => import('./pages/admin/ApplicationsManage'));
const QuestionnaireForm = lazy(() => import('./pages/admin/QuestionnaireForm'));
const TrafficBlockingManage = lazy(() => import('./pages/admin/TrafficBlockingManage'));
const TrafficBlockingForm = lazy(() => import('./pages/admin/TrafficBlockingForm'));
const TrafficSourcesManage = lazy(() => import('./pages/admin/TrafficSourcesManage'));
const TrafficSourceForm = lazy(() => import('./pages/admin/TrafficSourceForm'));
const AdjustmentsManage = lazy(() => import('./pages/admin/AdjustmentsManage'));
const AdjustmentForm = lazy(() => import('./pages/admin/AdjustmentForm'));
const CouponCodesManage = lazy(() => import('./pages/admin/CouponCodesManage'));
const CouponCodeForm = lazy(() => import('./pages/admin/CouponCodeForm'));
const CouponCodeImport = lazy(() => import('./pages/admin/CouponCodeImport'));
const PartnerInvoicesManage = lazy(() => import('./pages/admin/PartnerInvoicesManage'));
const PartnerInvoiceForm = lazy(() => import('./pages/admin/PartnerInvoiceForm'));
const PartnerInvoiceDetail = lazy(() => import('./pages/admin/PartnerInvoiceDetail'));
const LinkTemplatesManage = lazy(() => import('./pages/admin/LinkTemplatesManage'));
const LinkTemplateForm = lazy(() => import('./pages/admin/LinkTemplateForm'));
const PostbackControlsManage = lazy(() => import('./pages/admin/PostbackControlsManage'));
const PostbackControlForm = lazy(() => import('./pages/admin/PostbackControlForm'));
const AdvertiserInvoicesManage = lazy(() => import('./pages/admin/AdvertiserInvoicesManage'));
const AdvertiserInvoiceForm = lazy(() => import('./pages/admin/AdvertiserInvoiceForm'));
const AdvertiserInvoiceDetail = lazy(() => import('./pages/admin/AdvertiserInvoiceDetail'));
const TieredCommissionsManage = lazy(() => import('./pages/admin/TieredCommissionsManage'));
const TieredCommissionForm = lazy(() => import('./pages/admin/TieredCommissionForm'));
const AdvertiserEdit = lazy(() => import('./pages/admin/AdvertiserEdit'));
const TrackingDomains = lazy(() => import('./pages/admin/TrackingDomains'));
const Networks = lazy(() => import('./pages/super-admin/Networks'));
const Subscriptions = lazy(() => import('./pages/super-admin/Subscriptions'));
const Usage = lazy(() => import('./pages/super-admin/Usage'));
const PublisherOffers = lazy(() => import('./pages/portal/PublisherOffers'));
const AdvertiserOffers = lazy(() => import('./pages/portal/AdvertiserOffers'));
const PublisherEarnings = lazy(() => import('./pages/portal/PublisherEarnings'));
const ApiKeys = lazy(() => import('./pages/portal/ApiKeys'));
const ReportView = lazy(() => import('./pages/ReportView'));
const Reports = lazy(() => import('./pages/admin/Reports'));
const OfferReport = lazy(() => import('./pages/admin/OfferReport'));
const PartnerReport = lazy(() => import('./pages/admin/PartnerReport'));
const AdvertiserReport = lazy(() => import('./pages/admin/AdvertiserReport'));
const SmartLinkReport = lazy(() => import('./pages/admin/SmartLinkReport'));
const DailyReport = lazy(() => import('./pages/admin/DailyReport'));
const HourlyReport = lazy(() => import('./pages/admin/HourlyReport'));
const ImpressionReport = lazy(() => import('./pages/admin/ImpressionReport'));
const ClickReport = lazy(() => import('./pages/admin/ClickReport'));
const ConversionReport = lazy(() => import('./pages/admin/ConversionReport'));
const EventReport = lazy(() => import('./pages/admin/EventReport'));
const PacingReport = lazy(() => import('./pages/admin/PacingReport'));
const ClickToConversionTimeReport = lazy(() => import('./pages/admin/ClickToConversionTimeReport'));
const PartnerPostbackReport = lazy(() => import('./pages/admin/PartnerPostbackReport'));
const AdvertiserPostbackReport = lazy(() => import('./pages/admin/AdvertiserPostbackReport'));
const PartnerReferralsReport = lazy(() => import('./pages/admin/PartnerReferralsReport'));
const CustomMetricsManage = lazy(() => import('./pages/admin/CustomMetricsManage'));
const ProductsReport = lazy(() => import('./pages/admin/ProductsReport'));
const RefundsReport = lazy(() => import('./pages/admin/RefundsReport'));
const ConversionImportsManage = lazy(() => import('./pages/admin/ConversionImportsManage'));
const SavedScheduledReports = lazy(() => import('./pages/admin/SavedScheduledReports'));
const AddConversion = lazy(() => import('./pages/admin/AddConversion'));
const Analytics = lazy(() => import('./pages/admin/Analytics'));
const Marketplace = lazy(() => import('./pages/admin/Marketplace'));
const MarketplaceProfile = lazy(() => import('./pages/admin/MarketplaceProfile'));
const MarketplaceProfileEdit = lazy(() => import('./pages/admin/MarketplaceProfileEdit'));
const MarketplaceConnections = lazy(() => import('./pages/admin/MarketplaceConnections'));
const CommunicationHub = lazy(() => import('./pages/admin/CommunicationHub'));
const CustomerValue = lazy(() => import('./pages/admin/CustomerValue'));
const CustomerValueRuleForm = lazy(() => import('./pages/admin/CustomerValueRuleForm'));
const CustomerValueDataPoints = lazy(() => import('./pages/admin/CustomerValueDataPoints'));
const CustomerValueConversionEvents = lazy(() => import('./pages/admin/CustomerValueConversionEvents'));
const TrafficHealth = lazy(() => import('./pages/admin/TrafficHealth'));
const TrafficHealthDomainDetail = lazy(() => import('./pages/admin/TrafficHealthDomainDetail'));
const SmartLinks = lazy(() => import('./pages/admin/SmartLinks'));
const SmartLinkForm = lazy(() => import('./pages/admin/SmartLinkForm'));
const SmartLinkDetail = lazy(() => import('./pages/admin/SmartLinkDetail'));
const Integrations = lazy(() => import('./pages/admin/Integrations'));
const Invoices = lazy(() => import('./pages/admin/Invoices'));
const Alerts = lazy(() => import('./pages/admin/Alerts'));
const Automation = lazy(() => import('./pages/admin/Automation'));
const Investigator = lazy(() => import('./pages/admin/Investigator'));
const InvestigatorDetail = lazy(() => import('./pages/admin/InvestigatorDetail'));
const ControlCenter = lazy(() => import('./pages/admin/ControlCenter'));
const AiOps = lazy(() => import('./pages/admin/AiOps'));
const PublisherCreate = lazy(() => import('./pages/admin/PublisherCreate'));
const AdvertiserCreate = lazy(() => import('./pages/admin/AdvertiserCreate'));
const TagsManage = lazy(() => import('./pages/admin/TagsManage'));
const PostbackTestPage = lazy(() => import('./pages/admin/PostbackTestPage'));
const DebugPostbackPage = lazy(() => import('./pages/admin/DebugPostbackPage'));
const ProfilePage = lazy(() => import('./pages/admin/ProfilePage'));
const NotificationPreferences = lazy(() => import('./pages/admin/NotificationPreferences'));
const OfferTemplates = lazy(() => import('./pages/admin/OfferTemplates'));
const OfferTemplateForm = lazy(() => import('./pages/admin/OfferTemplateForm'));
const OfferTemplateDetail = lazy(() => import('./pages/admin/OfferTemplateDetail'));
const OfferGroups = lazy(() => import('./pages/admin/OfferGroups'));
const OfferGroupForm = lazy(() => import('./pages/admin/OfferGroupForm'));
const Creatives = lazy(() => import('./pages/admin/Creatives'));
const OfferGroupDetail = lazy(() => import('./pages/admin/OfferGroupDetail'));
const OfferTrafficControls = lazy(() => import('./pages/admin/OfferTrafficControls'));
const OfferTrafficControlForm = lazy(() => import('./pages/admin/OfferTrafficControlForm'));
const OfferCustomSettingsGlobal = lazy(() => import('./pages/admin/OfferCustomSettingsGlobal'));
const OfferSmartSwitch = lazy(() => import('./pages/admin/OfferSmartSwitch'));

function Loading() {
  return (
    <div className="grid h-full place-items-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-brand-600" />
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
          <Route path="/app/offers/bulk-edit" element={<OffersBulkEdit />} />
          <Route path="/app/offers/:id" element={<OfferDetail />} />
          <Route path="/app/offers/:id/edit" element={<OfferEdit />} />
          <Route path="/app/publishers" element={<Publishers />} />
          <Route path="/app/publishers/new" element={<PublisherCreate />} />
          <Route path="/app/publishers/bulk-edit" element={<PublishersBulkEdit />} />
          <Route path="/app/publishers/:id" element={<PublisherDetail />} />
          <Route path="/app/publishers/:id/edit" element={<PublisherEdit />} />
          <Route path="/app/advertisers" element={<Advertisers />} />
          <Route path="/app/advertisers/new" element={<AdvertiserCreate />} />
          <Route path="/app/advertisers/bulk-edit" element={<AdvertisersBulkEdit />} />
          <Route path="/app/advertisers/:id" element={<AdvertiserDetail />} />
          <Route path="/app/advertisers/:id/edit" element={<AdvertiserEdit />} />
          {/* Offers section pages */}
          <Route path="/app/offers-creatives" element={<Creatives />} />
          <Route path="/app/offers-deals" element={<NetworkListPage kind="deals" />} />
          <Route path="/app/offers-tags" element={<TagsManage />} />
          <Route path="/app/offers-templates" element={<OfferTemplates />} />
          <Route path="/app/offers-templates/add" element={<OfferTemplateForm />} />
          <Route path="/app/offers-templates/:id/edit" element={<OfferTemplateForm />} />
          <Route path="/app/offers-templates/:id" element={<OfferTemplateDetail />} />
          <Route path="/app/offers-groups" element={<OfferGroups />} />
          <Route path="/app/offers-groups/add" element={<OfferGroupForm />} />
          <Route path="/app/offers-groups/:id/edit" element={<OfferGroupForm />} />
          <Route path="/app/offers-groups/:id" element={<OfferGroupDetail />} />
          <Route path="/app/offers-traffic-controls" element={<OfferTrafficControls />} />
          <Route path="/app/offers-traffic-controls/add" element={<OfferTrafficControlForm />} />
          <Route path="/app/offers-traffic-controls/:id/edit" element={<OfferTrafficControlForm />} />
          <Route path="/app/offers-custom-settings" element={<OfferCustomSettingsGlobal />} />
          <Route path="/app/offers-smartswitch" element={<OfferSmartSwitch />} />
          {/* Affiliates section pages */}
          <Route path="/app/aff-postbacks" element={<PostbacksManage />} />
          <Route path="/app/aff-postbacks/new" element={<PostbackForm />} />
          <Route path="/app/aff-postbacks/:id/edit" element={<PostbackForm />} />
          <Route path="/app/aff-postback-test" element={<PostbackTestPage />} />
          <Route path="/app/aff-tiers" element={<TiersManage />} />
          <Route path="/app/aff-tiers/new" element={<TierForm />} />
          <Route path="/app/aff-tiers/:id/edit" element={<TierForm />} />
          <Route path="/app/aff-tiers/:id" element={<TierDetail />} />
          <Route path="/app/aff-applications" element={<ApplicationsManage />} />
          <Route path="/app/aff-applications/questionnaires/new" element={<QuestionnaireForm />} />
          <Route path="/app/aff-applications/questionnaires/:id/edit" element={<QuestionnaireForm />} />
          <Route path="/app/aff-traffic-blocking" element={<TrafficBlockingManage />} />
          <Route path="/app/aff-traffic-blocking/new" element={<TrafficBlockingForm />} />
          <Route path="/app/aff-traffic-blocking/:id/edit" element={<TrafficBlockingForm />} />
          <Route path="/app/aff-traffic-sources" element={<TrafficSourcesManage />} />
          <Route path="/app/aff-traffic-sources/new" element={<TrafficSourceForm />} />
          <Route path="/app/aff-traffic-sources/:id/edit" element={<TrafficSourceForm />} />
          <Route path="/app/aff-adjustments" element={<AdjustmentsManage />} />
          <Route path="/app/aff-adjustments/new" element={<AdjustmentForm />} />
          <Route path="/app/aff-adjustments/:id/edit" element={<AdjustmentForm />} />
          <Route path="/app/aff-coupons" element={<CouponCodesManage />} />
          <Route path="/app/aff-coupons/new" element={<CouponCodeForm />} />
          <Route path="/app/aff-coupons/import" element={<CouponCodeImport />} />
          <Route path="/app/aff-coupons/:id/edit" element={<CouponCodeForm />} />
          <Route path="/app/aff-invoices" element={<PartnerInvoicesManage />} />
          <Route path="/app/aff-invoices/new" element={<PartnerInvoiceForm />} />
          <Route path="/app/aff-invoices/:id/edit" element={<PartnerInvoiceForm />} />
          <Route path="/app/aff-invoices/:id" element={<PartnerInvoiceDetail />} />
          <Route path="/app/adv-link-templates" element={<LinkTemplatesManage />} />
          <Route path="/app/adv-link-templates/new" element={<LinkTemplateForm />} />
          <Route path="/app/adv-link-templates/:id/edit" element={<LinkTemplateForm />} />
          <Route path="/app/adv-postback-controls" element={<PostbackControlsManage />} />
          <Route path="/app/adv-postback-controls/new" element={<PostbackControlForm />} />
          <Route path="/app/adv-postback-controls/:id/edit" element={<PostbackControlForm />} />
          <Route path="/app/adv-invoices" element={<AdvertiserInvoicesManage />} />
          <Route path="/app/adv-invoices/new" element={<AdvertiserInvoiceForm />} />
          <Route path="/app/adv-invoices/:id/edit" element={<AdvertiserInvoiceForm />} />
          <Route path="/app/adv-invoices/:id" element={<AdvertiserInvoiceDetail />} />
          <Route path="/app/adv-tiered-commissions" element={<TieredCommissionsManage />} />
          <Route path="/app/adv-tiered-commissions/new" element={<TieredCommissionForm />} />
          <Route path="/app/adv-tiered-commissions/:id/edit" element={<TieredCommissionForm />} />
          <Route path="/app/aff-custom-fields" element={<CustomFieldsManage entityType="publisher" />} />
          <Route path="/app/aff-tags" element={<TagsManage />} />
          {/* Advertisers section pages */}
          <Route path="/app/adv-custom-fields" element={<CustomFieldsManage entityType="advertiser" />} />
          <Route path="/app/adv-tags" element={<TagsManage />} />
          <Route path="/app/adv-debug-postback" element={<DebugPostbackPage />} />
          <Route path="/app/domains" element={<TrackingDomains />} />
          <Route path="/app/traffic-health" element={<TrafficHealth />} />
          <Route path="/app/traffic-health/domains/:id" element={<TrafficHealthDomainDetail />} />
          <Route path="/app/reports" element={<Navigate to="/app/reports/offer" replace />} />
          <Route path="/app/reports/offer" element={<OfferReport />} />
          <Route path="/app/reports/partner" element={<PartnerReport />} />
          <Route path="/app/reports/advertiser" element={<AdvertiserReport />} />
          <Route path="/app/reports/smartlink" element={<SmartLinkReport />} />
          <Route path="/app/reports/daily" element={<DailyReport />} />
          <Route path="/app/reports/hourly" element={<HourlyReport />} />
          <Route path="/app/reports/impression" element={<ImpressionReport />} />
          <Route path="/app/reports/click" element={<ClickReport />} />
          <Route path="/app/reports/conversion" element={<ConversionReport />} />
          <Route path="/app/reports/event" element={<EventReport />} />
          <Route path="/app/reports/pacing" element={<PacingReport />} />
          <Route path="/app/reports/click-to-conversion-time" element={<ClickToConversionTimeReport />} />
          <Route path="/app/reports/partner-postback" element={<PartnerPostbackReport />} />
          <Route path="/app/reports/advertiser-postback" element={<AdvertiserPostbackReport />} />
          <Route path="/app/reports/partner-referrals" element={<PartnerReferralsReport />} />
          <Route path="/app/reports/custom-metrics" element={<CustomMetricsManage />} />
          <Route path="/app/reports/products" element={<ProductsReport />} />
          <Route path="/app/reports/refunds" element={<RefundsReport />} />
          <Route path="/app/reports/conversion-imports" element={<ConversionImportsManage />} />
          <Route path="/app/reports/saved-scheduled" element={<SavedScheduledReports />} />
          <Route path="/app/conversions/add" element={<AddConversion />} />
          <Route path="/app/reports/:type" element={<Reports />} />
          <Route path="/app/analytics" element={<Analytics />} />
          <Route path="/app/marketplace" element={<Marketplace />} />
          <Route path="/app/marketplace/profile" element={<MarketplaceProfile />} />
          <Route path="/app/marketplace/profile/edit" element={<MarketplaceProfileEdit />} />
          <Route path="/app/marketplace/connections" element={<MarketplaceConnections />} />
          <Route path="/app/communication-hub" element={<CommunicationHub />} />
          <Route path="/app/customer-value" element={<CustomerValue />} />
          <Route path="/app/customer-value/new" element={<CustomerValueRuleForm />} />
          <Route path="/app/customer-value/:id/edit" element={<CustomerValueRuleForm />} />
          <Route path="/app/customer-value/data-points" element={<CustomerValueDataPoints />} />
          <Route path="/app/customer-value/conversion-events" element={<CustomerValueConversionEvents />} />
          <Route path="/app/smart-links" element={<SmartLinks />} />
          <Route path="/app/smart-links/add" element={<SmartLinkForm />} />
          <Route path="/app/smart-links/:id/edit" element={<SmartLinkForm />} />
          <Route path="/app/smart-links/:id" element={<SmartLinkDetail />} />
          <Route path="/app/alerts" element={<Alerts />} />
          <Route path="/app/automation" element={<Automation />} />
          <Route path="/app/investigator" element={<Investigator />} />
          <Route path="/app/investigator/:id" element={<InvestigatorDetail />} />
          <Route path="/app/control-center" element={<ControlCenter />} />
          <Route path="/app/control-center/:tab" element={<ControlCenter />} />
          <Route path="/app/ai" element={<AiOps />} />
          <Route path="/app/profile" element={<ProfilePage />} />
          <Route path="/app/profile/notifications" element={<NotificationPreferences />} />
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
