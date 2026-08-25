import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { IconMapOff } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ApiError, api } from "../api/client";
import { LoadingPage, PageMessage, QueryError } from "../components/ui";
import { CategoriesPage } from "../features/categories/CategoriesPage";
import { DashboardPage } from "../features/dashboard/DashboardPage";
import { WelcomePage } from "../features/onboarding/WelcomePage";
import {
  CategorySettingsPage,
  DataSettingsPage,
  PaymentMethodSettingsPage,
  ProfileSettingsPage,
  SettingsLayout,
} from "../features/settings/SettingsPages";
import { SubscriptionDetailPage } from "../features/subscriptions/SubscriptionDetailPage";
import { SubscriptionFormPage } from "../features/subscriptions/SubscriptionFormPage";
import { SubscriptionsPage } from "../features/subscriptions/SubscriptionsPage";
import { setLanguage } from "../i18n";
import { AppShell } from "./AppShell";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) =>
        !(error instanceof ApiError && [401, 404].includes(error.status)) && failureCount < 1,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: false },
  },
});

function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <PageMessage
      icon={<IconMapOff size={25} />}
      title={t("detail.notFoundTitle")}
      body={t("detail.notFoundBody")}
    />
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <OnboardingGate />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

function OnboardingGate() {
  const location = useLocation();
  const { i18n } = useTranslation();
  const sessionQuery = useQuery({ queryKey: ["session"], queryFn: api.session });
  const [syncedLocaleKey, setSyncedLocaleKey] = useState<string | null>(null);
  const sessionUser = sessionQuery.data?.user;
  const profileLocale =
    sessionUser?.onboardingCompletedAt === null ? null : sessionUser?.interfaceLocale;
  const profileLocaleKey =
    profileLocale && sessionUser
      ? `${sessionUser.id}:${sessionUser.onboardingCompletedAt}:${profileLocale}`
      : null;

  useEffect(() => {
    if (!profileLocale || !profileLocaleKey) return;
    let active = true;
    void setLanguage(profileLocale).then(() => {
      if (active) setSyncedLocaleKey(profileLocaleKey);
    });
    return () => {
      active = false;
    };
  }, [i18n, profileLocale, profileLocaleKey]);

  if (sessionQuery.isPending) return <LoadingPage variant="form" />;
  if (sessionQuery.isError) {
    return <QueryError error={sessionQuery.error} onRetry={() => void sessionQuery.refetch()} />;
  }
  if (profileLocaleKey && syncedLocaleKey !== profileLocaleKey) {
    return <LoadingPage variant="form" />;
  }

  const onWelcomeRoute = location.pathname.replace(/\/+$/, "") === "/welcome";
  const onboardingComplete = sessionQuery.data.user.onboardingCompletedAt !== null;
  if (!onboardingComplete && !onWelcomeRoute) return <Navigate to="/welcome" replace />;
  if (onboardingComplete && onWelcomeRoute) return <Navigate to="/dashboard" replace />;

  return (
    <Routes>
      <Route path="welcome" element={<WelcomePage />} />
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="subscriptions" element={<SubscriptionsPage />} />
        <Route path="subscriptions/new" element={<SubscriptionFormPage />} />
        <Route path="subscriptions/:subscriptionId" element={<SubscriptionDetailPage />} />
        <Route path="subscriptions/:subscriptionId/edit" element={<SubscriptionFormPage />} />
        <Route path="settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="profile" replace />} />
          <Route path="profile" element={<ProfileSettingsPage />} />
          <Route path="categories" element={<CategorySettingsPage />} />
          <Route path="payment-methods" element={<PaymentMethodSettingsPage />} />
          <Route path="data" element={<DataSettingsPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
