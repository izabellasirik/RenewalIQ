import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { AdminShell } from './components/layout/AdminShell';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { DashboardPage } from './pages/DashboardPage';
import { TodaysPlatePage } from './pages/TodaysPlatePage';
import { AccountWorkspacePage } from './pages/AccountWorkspacePage';
import { MarketFinderPage } from './pages/MarketFinderPage';
import { NewAccountPage } from './pages/NewAccountPage';
import { UploadPage } from './pages/UploadPage';
import { RiskProfilePage } from './pages/RiskProfilePage';
import { LimitsCoveragePage } from './pages/LimitsCoveragePage';
import { SubmissionAssistantPage } from './pages/SubmissionAssistantPage';
import { CarrierAppetitePage } from './pages/CarrierAppetitePage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { AdminAppetiteUpdatesPage } from './pages/AdminAppetiteUpdatesPage';
import { AdminFeedbackPage } from './pages/AdminFeedbackPage';
import { IntakeFormPage } from './pages/IntakeFormPage';
import { IntakeLinksPage } from './pages/IntakeLinksPage';
import { RequireBrokerAuth } from './components/layout/RequireBrokerAuth';
import { ProfileGate } from './components/profile/ProfileGate';
import { InvitePage } from './pages/InvitePage';
import { TeamPage } from './pages/TeamPage';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },
  // Deliberately outside AppShell and unauthenticated — an applicant opening this link has no
  // Renewal IQ login at all (see types/intake.ts / supabase/migrations/0004_intake_submissions.sql).
  { path: '/intake/:token', element: <IntakeFormPage /> },
  // An agency invitation link — works signed out (sign up / sign in from here) and signed in (join).
  { path: '/invite/:token', element: <InvitePage /> },
  {
    // Signed-out visitors are sent to /login (see RequireBrokerAuth).
    element: (
      <RequireBrokerAuth>
        <ProfileGate>
          <AppShell />
        </ProfileGate>
      </RequireBrokerAuth>
    ),
    children: [
      { path: '/', element: <DashboardPage /> },
      { path: '/today', element: <TodaysPlatePage /> },
      // Old link to the accounts list, from when Today's Plate was the home page.
      { path: '/accounts', element: <Navigate to="/" replace /> },
      { path: '/market-finder', element: <MarketFinderPage /> },
      { path: '/analytics', element: <AnalyticsPage /> },
      { path: '/intake-links', element: <IntakeLinksPage /> },
      { path: '/team', element: <TeamPage /> },
      { path: '/accounts/new', element: <NewAccountPage /> },
      { path: '/accounts/:accountId', element: <AccountWorkspacePage /> },
      { path: '/accounts/:accountId/upload', element: <UploadPage /> },
      { path: '/accounts/:accountId/risk-profile', element: <RiskProfilePage /> },
      { path: '/accounts/:accountId/limits-coverage', element: <LimitsCoveragePage /> },
      { path: '/accounts/:accountId/submission-assistant', element: <SubmissionAssistantPage /> },
      { path: '/accounts/:accountId/carrier-appetite', element: <CarrierAppetitePage /> },
    ],
  },
  {
    // Deliberately separate from AppShell — no broker Sidebar/TopBar. Reached by going to /admin
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
