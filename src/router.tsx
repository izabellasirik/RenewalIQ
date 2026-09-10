import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { AdminShell } from './components/layout/AdminShell';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { DashboardPage } from './pages/DashboardPage';
import { MarketFinderPage } from './pages/MarketFinderPage';
import { NewAccountPage } from './pages/NewAccountPage';
import { UploadPage } from './pages/UploadPage';
import { RiskProfilePage } from './pages/RiskProfilePage';
import { ReviewPage } from './pages/ReviewPage';
import { SubmissionAssistantPage } from './pages/SubmissionAssistantPage';
import { CarrierAppetitePage } from './pages/CarrierAppetitePage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { AdminAppetiteUpdatesPage } from './pages/AdminAppetiteUpdatesPage';
import { AdminFeedbackPage } from './pages/AdminFeedbackPage';
import { IntakeFormPage } from './pages/IntakeFormPage';
import { IntakeLinksPage } from './pages/IntakeLinksPage';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },
  // Deliberately outside AppShell and unauthenticated — an applicant opening this link has no
  // Renewal IQ login at all (see types/intake.ts / supabase/migrations/0004_intake_submissions.sql).
  { path: '/intake/:token', element: <IntakeFormPage /> },
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/market-finder', element: <MarketFinderPage /> },
      { path: '/analytics', element: <AnalyticsPage /> },
      { path: '/intake-links', element: <IntakeLinksPage /> },
      { path: '/accounts/new', element: <NewAccountPage /> },
      { path: '/accounts/:accountId/upload', element: <UploadPage /> },
      { path: '/accounts/:accountId/risk-profile', element: <RiskProfilePage /> },
      { path: '/accounts/:accountId/review', element: <ReviewPage /> },
      { path: '/accounts/:accountId/submission-assistant', element: <SubmissionAssistantPage /> },
      { path: '/accounts/:accountId/carrier-appetite', element: <CarrierAppetitePage /> },
    ],
  },
  {
    // Deliberately separate from AppShell — no broker Sidebar/TopBar. Reachable via a small,
    // discreet link in the broker Sidebar's footer (see Sidebar.tsx) or by going to /admin
    // directly. Real Supabase Auth + admin_users/RLS is the actual authorization boundary (see
    // AdminAuthGate and supabase/migrations), not the absence of a prominent nav item.
    element: <AdminShell />,
    children: [
      { path: '/admin', element: <AdminDashboardPage /> },
      { path: '/admin/appetite-updates', element: <AdminAppetiteUpdatesPage /> },
      { path: '/admin/feedback', element: <AdminFeedbackPage /> },
    ],
  },
]);
