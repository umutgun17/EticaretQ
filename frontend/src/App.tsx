import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/contexts/AuthContext'
import AppLayout from '@/components/layout/AppLayout'
import LoginPage from '@/pages/LoginPage'
import SignupPage from '@/pages/saas/SignupPage'
import ForgotPasswordPage from '@/pages/saas/ForgotPasswordPage'
import ResetPasswordPage from '@/pages/saas/ResetPasswordPage'
import BillingPage from '@/pages/saas/BillingPage'
import AdminSubscriptionsPage from '@/pages/saas/AdminSubscriptionsPage'
import HomePage from '@/pages/HomePage'
import ChannelsPage from '@/pages/ChannelsPage'
import UsersPage from '@/pages/UsersPage'
import UserActivityPage from '@/pages/UserActivityPage'
import SettingsPage from '@/pages/SettingsPage'
import ProfilePage from '@/pages/ProfilePage'
import CrmProductsPage from '@/pages/crm/CrmProductsPage'
import CrmProductDetailPage from '@/pages/crm/CrmProductDetailPage'
import CrmOrdersPage from '@/pages/crm/CrmOrdersPage'
import CrmOrderDetailPage from '@/pages/crm/CrmOrderDetailPage'
import CrmCustomersPage from '@/pages/crm/CrmCustomersPage'
import CrmCustomerDetailPage from '@/pages/crm/CrmCustomerDetailPage'
import CrmReviewsPage from '@/pages/crm/CrmReviewsPage'
import CrmReviewDetailPage from '@/pages/crm/CrmReviewDetailPage'
import PriceComparisonPage from '@/pages/crm/PriceComparisonPage'
import CrmFavoritesPage from '@/pages/crm/CrmFavoritesPage'
import CrmStockAlertsPage from '@/pages/crm/CrmStockAlertsPage'
import CrmOrderDelaysPage from '@/pages/crm/CrmOrderDelaysPage'
import ReviewWidgetSettingsPage from '@/pages/ReviewWidgetSettingsPage'
import ShippingWidgetSettingsPage from '@/pages/ShippingWidgetSettingsPage'
import AnnounceWidgetPage from '@/pages/AnnounceWidgetPage'
import ReportsReturnAnalysisPage from '@/pages/reports/ReportsReturnAnalysisPage'
import PublicReturnPage from '@/pages/returns/PublicReturnPage'
import ReturnsPage from '@/pages/returns/ReturnsPage'
import ReturnDetailPage from '@/pages/returns/ReturnDetailPage'
import ReturnPayoutsPage from '@/pages/returns/ReturnPayoutsPage'
import ReturnsReportPage from '@/pages/returns/ReturnsReportPage'
import ReturnsSmsPage from '@/pages/returns/ReturnsSmsPage'
import ReturnsInsightsPage from '@/pages/returns/ReturnsInsightsPage'
import ReturnsSettingsPage from '@/pages/returns/ReturnsSettingsPage'
import ReturnShortagePage from '@/pages/returns/ReturnShortagePage'
import WheelCampaignsPage from '@/pages/wheel/WheelCampaignsPage'
import WheelCampaignEditPage from '@/pages/wheel/WheelCampaignEditPage'
import WheelCampaignStatsPage from '@/pages/wheel/WheelCampaignStatsPage'
import SmartSearchPage from '@/pages/SmartSearchPage'
import CroOverviewPage from '@/pages/cro/CroOverviewPage'
import CroActionsPage from '@/pages/cro/CroActionsPage'
import CroAuditPage from '@/pages/cro/CroAuditPage'
import CroFilterPage from '@/pages/cro/CroFilterPage'
import CroBottomBarPage from '@/pages/cro/CroBottomBarPage'
import CroMenuPage from '@/pages/cro/CroMenuPage'
import CroHeroPage from '@/pages/cro/CroHeroPage'
import CroFlashPage from '@/pages/cro/CroFlashPage'
import CroGalleryPage from '@/pages/cro/CroGalleryPage'
import CroBadgesPage from '@/pages/cro/CroBadgesPage'
import CroNotFoundPage from '@/pages/cro/CroNotFoundPage'
import CroForYouPage from '@/pages/cro/CroForYouPage'
import CroWelcomePage from '@/pages/cro/CroWelcomePage'
import CroVariantPage from '@/pages/cro/CroVariantPage'
import CroCartPage from '@/pages/cro/CroCartPage'
import CroAppPromoPage from '@/pages/cro/CroAppPromoPage'
import CategoryIntelligencePage from '@/pages/CategoryIntelligencePage'
import MarketingOverviewPage from '@/pages/marketing/MarketingOverviewPage'
import AutomationsPage from '@/pages/marketing/AutomationsPage'
import AutomationDetailPage from '@/pages/marketing/AutomationDetailPage'
import SegmentsPage from '@/pages/marketing/SegmentsPage'
import CampaignsPage from '@/pages/marketing/CampaignsPage'
import CampaignDetailPage from '@/pages/marketing/CampaignDetailPage'
import MarketingAnalyticsPage from '@/pages/marketing/MarketingAnalyticsPage'
import MarketingSettingsPage from '@/pages/marketing/MarketingSettingsPage'
import IysPage from '@/pages/marketing/IysPage'
import Product360Page from '@/pages/marketing/Product360Page'
import MarketingTenantGuard from '@/components/marketing/MarketingTenantGuard'

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.VITE_ROUTER_BASE || '/'}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/kayit" element={<SignupPage />} />
          <Route path="/sifremi-unuttum" element={<ForgotPasswordPage />} />
          <Route path="/sifre-sifirla" element={<ResetPasswordPage />} />
          {/* Public — tenant müşterisi iade/iptal akışı (auth yok) */}
          <Route path="/iade/:slug" element={<PublicReturnPage />} />
          <Route element={<AppLayout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/crm/products" element={<CrmProductsPage />} />
            <Route path="/crm/products/:id" element={<CrmProductDetailPage />} />
            <Route path="/crm/orders" element={<CrmOrdersPage />} />
            <Route path="/crm/orders/:id" element={<CrmOrderDetailPage />} />
            <Route path="/crm/delays" element={<CrmOrderDelaysPage />} />
            <Route path="/crm/customers" element={<CrmCustomersPage />} />
            <Route path="/crm/customers/:id" element={<CrmCustomerDetailPage />} />
            <Route path="/crm/reviews" element={<CrmReviewsPage />} />
            <Route path="/crm/reviews/:id" element={<CrmReviewDetailPage />} />
            <Route path="/crm/price-comparison" element={<PriceComparisonPage />} />
            <Route path="/crm/favorites" element={<CrmFavoritesPage />} />
            <Route path="/crm/stock-alerts" element={<CrmStockAlertsPage />} />
            <Route path="/returns" element={<ReturnsPage />} />
            <Route path="/returns/report" element={<ReturnsReportPage />} />
            <Route path="/returns/payouts" element={<ReturnPayoutsPage />} />
            <Route path="/returns/sms" element={<ReturnsSmsPage />} />
            <Route path="/returns/insights" element={<ReturnsInsightsPage />} />
            <Route path="/returns/settings" element={<ReturnsSettingsPage />} />
            <Route path="/returns/shortage" element={<ReturnShortagePage key="shortage" />} />
            <Route path="/returns/returned" element={<ReturnShortagePage key="returned" mode="returned" />} />
            <Route path="/returns/:id" element={<ReturnDetailPage />} />
            <Route path="/wheel" element={<WheelCampaignsPage />} />
            <Route path="/wheel/:id" element={<WheelCampaignEditPage />} />
            <Route path="/wheel/:id/istatistik" element={<WheelCampaignStatsPage />} />
            <Route path="/search-insights" element={<SmartSearchPage />} />
            <Route path="/cro" element={<CroOverviewPage />} />
            <Route path="/cro/actions" element={<CroActionsPage />} />
            <Route path="/cro/audit" element={<CroAuditPage />} />
            <Route path="/cro/filter" element={<CroFilterPage />} />
            <Route path="/cro/bottombar" element={<CroBottomBarPage />} />
            <Route path="/cro/menu" element={<CroMenuPage />} />
            <Route path="/cro/hero" element={<CroHeroPage />} />
            <Route path="/cro/flash" element={<CroFlashPage />} />
            <Route path="/cro/gallery" element={<CroGalleryPage />} />
            <Route path="/cro/badges" element={<CroBadgesPage />} />
            <Route path="/cro/notfound" element={<CroNotFoundPage />} />
            <Route path="/cro/foryou" element={<CroForYouPage />} />
            <Route path="/cro/welcome" element={<CroWelcomePage />} />
            <Route path="/cro/variant" element={<CroVariantPage />} />
            <Route path="/cro/cart" element={<CroCartPage />} />
            <Route path="/cro/app" element={<CroAppPromoPage />} />
            <Route path="/shipping-widget" element={<ShippingWidgetSettingsPage />} />
            <Route path="/announce-widget" element={<AnnounceWidgetPage />} />
            <Route path="/category-intelligence" element={<CategoryIntelligencePage />} />
            <Route element={<MarketingTenantGuard />}>
              <Route path="/marketing" element={<MarketingOverviewPage />} />
              <Route path="/marketing/automations" element={<AutomationsPage />} />
              <Route path="/marketing/automations/:key" element={<AutomationDetailPage />} />
              <Route path="/marketing/segments" element={<SegmentsPage />} />
              <Route path="/marketing/campaigns" element={<CampaignsPage />} />
              <Route path="/marketing/campaigns/:id" element={<CampaignDetailPage />} />
              <Route path="/marketing/analytics" element={<MarketingAnalyticsPage />} />
              <Route path="/marketing/settings" element={<MarketingSettingsPage />} />
              <Route path="/marketing/iys" element={<IysPage />} />
              <Route path="/product-360/demo" element={<Product360Page />} />
            </Route>
            <Route path="/reports/returns" element={<ReportsReturnAnalysisPage />} />
            <Route path="/settings/review-widget" element={<ReviewWidgetSettingsPage />} />
            <Route path="/billing" element={<BillingPage />} />
            <Route path="/admin/subscriptions" element={<AdminSubscriptionsPage />} />
            <Route path="/settings/channels" element={<ChannelsPage />} />
            <Route path="/settings/users" element={<UsersPage />} />
            <Route path="/settings/users/activity" element={<UserActivityPage />} />
            <Route path="/settings/general" element={<SettingsPage />} />
            <Route path="/profile" element={<ProfilePage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
