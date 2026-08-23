import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { IconMapOff } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ApiError } from "../api/client";
import { PageMessage } from "../components/ui";
import { DashboardPage } from "../features/dashboard/DashboardPage";
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
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
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
      </BrowserRouter>
    </QueryClientProvider>
  );
}
