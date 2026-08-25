// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormEvent } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Category, PaymentMethod } from "../../../src/shared/api-types";
import { api } from "../../../src/web/api/client";
import { categoriesQueryKey, paymentMethodsQueryKey } from "../../../src/web/api/query-keys";
import { ResourceAssociationField } from "../../../src/web/components/ResourceAssociationField";
import { SettingsLayout } from "../../../src/web/features/settings/SettingsPages";
import i18n from "../../../src/web/i18n";

const existingCategory: Category = {
  id: "category-1",
  name: " Productivity ",
  color: "#2563EB",
  symbol: { type: "icon", value: "briefcase" },
  position: 0,
  createdAt: "2026-08-24T00:00:00.000Z",
  updatedAt: "2026-08-24T00:00:00.000Z",
};

beforeEach(async () => {
  await i18n.changeLanguage("en");
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => window.setTimeout(callback, 0),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderField({
  resources = [],
  error = null,
  loading = false,
  value = "",
  validationError,
  userId = "user-1",
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } }),
}: {
  resources?: Category[];
  error?: unknown;
  loading?: boolean;
  value?: string;
  validationError?: string;
  userId?: string;
  client?: QueryClient;
} = {}) {
  const onChange = vi.fn();
  const onRetry = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ResourceAssociationField
          id="category"
          kind="category"
          userId={userId}
          value={value}
          resources={resources}
          loading={loading}
          error={error}
          validationError={validationError}
          onChange={onChange}
          onRetry={onRetry}
          onPendingChange={() => undefined}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, onChange, onRetry };
}

describe("subscription resource association field", () => {
  it("shows saved, common, and create flows without leaving the subscription form", () => {
    renderField();
    const trigger = screen.getByRole("button", { name: "Category Choose category" });
    fireEvent.click(trigger);
    expect(
      screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent),
    ).toEqual(["Common categories", "Saved categories"]);
    expect(screen.getByRole("heading", { name: "Saved categories" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Common categories" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Entertainment" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create category" })).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("button", { name: "No category" })).toBeTruthy();
  });

  it("disables only the association field while its choices are loading", () => {
    renderField({ loading: true });
    expect(screen.getByRole("status").textContent).toContain("Loading Category choices");
    expect(screen.getByRole("button", { name: /Category/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Entertainment" })).toBeNull();
  });

  it("creates and immediately selects a custom category", async () => {
    const created: Category = {
      ...existingCategory,
      id: "category-custom",
      name: "Travel tools",
    };
    const create = vi.spyOn(api, "createCategory").mockResolvedValue(created);
    const { onChange } = renderField();

    fireEvent.click(screen.getByRole("button", { name: /Category/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create category" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Category name" }), {
      target: { value: created.name },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add and select" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(created.id));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ name: created.name, color: "#4f7cff", position: 0 }),
    );
  });

  it("does not submit the parent subscription form after creating a resource", async () => {
    const created: Category = {
      ...existingCategory,
      id: "category-inside-parent-form",
      name: "Created safely",
    };
    vi.spyOn(api, "createCategory").mockResolvedValue(created);
    const parentSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    const onChange = vi.fn();
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <form onSubmit={parentSubmit}>
            <ResourceAssociationField
              id="category"
              kind="category"
              userId="user-1"
              value=""
              resources={[]}
              loading={false}
              error={null}
              onChange={onChange}
              onRetry={() => undefined}
              onPendingChange={() => undefined}
            />
          </form>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Category/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create category" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Category name" }), {
      target: { value: created.name },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add and select" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(created.id));
    expect(parentSubmit).not.toHaveBeenCalled();
  });

  it("waits for an in-flight resource query to be cancelled before creating", async () => {
    const created: Category = {
      ...existingCategory,
      id: "category-after-cancel",
      name: "After cancel",
    };
    let releaseCancellation: (() => void) | undefined;
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const cancel = vi.spyOn(client, "cancelQueries").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseCancellation = resolve;
        }),
    );
    const create = vi.spyOn(api, "createCategory").mockResolvedValue(created);
    const { onChange } = renderField({ client });

    fireEvent.click(screen.getByRole("button", { name: /Category/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create category" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Category name" }), {
      target: { value: created.name },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add and select" }));

    await waitFor(() =>
      expect(cancel).toHaveBeenCalledWith({ queryKey: categoriesQueryKey("user-1") }),
    );
    expect(create).not.toHaveBeenCalled();
    releaseCancellation?.();
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(created.id));
    expect(create).toHaveBeenCalledOnce();
  });

  it("prevents Enter in resource search from submitting the parent form", () => {
    renderField();
    fireEvent.click(screen.getByRole("button", { name: /Category/ }));
    const search = screen.getByRole("searchbox");
    expect(fireEvent.keyDown(search, { key: "Enter", code: "Enter" })).toBe(false);
  });

  it("associates a server validation error with the picker trigger", () => {
    renderField({ validationError: "Choose a category that still exists." });
    const trigger = screen.getByRole("button", { name: /Category/ });
    const error = screen.getByText("Choose a category that still exists.");
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
    expect(trigger.getAttribute("aria-describedby")).toBe(error.id);
  });

  it("cancels an unsaved resource draft without writing", () => {
    const create = vi.spyOn(api, "createCategory");
    renderField();
    fireEvent.click(screen.getByRole("button", { name: /Category/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create category" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("omits a common choice when a normalized saved category already exists", () => {
    const create = vi.spyOn(api, "createCategory");
    const { onChange } = renderField({ resources: [existingCategory] });
    fireEvent.click(screen.getByRole("button", { name: /Category/ }));
    const productivityOptions = screen.getAllByRole("button", { name: "Productivity" });
    expect(productivityOptions).toHaveLength(1);
    fireEvent.click(productivityOptions[0]!);
    expect(onChange).toHaveBeenCalledWith(existingCategory.id);
    expect(create).not.toHaveBeenCalled();
  });

  it("creates a common category without changing another user's cache", async () => {
    const created: Category = {
      ...existingCategory,
      id: "category-2",
      name: "Movies",
      position: 1,
    };
    vi.spyOn(api, "createCategory").mockResolvedValue(created);
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    client.setQueryData(categoriesQueryKey("other-user"), [existingCategory]);
    const { onChange } = renderField({ client });

    fireEvent.click(screen.getByRole("button", { name: /Category/ }));
    fireEvent.click(screen.getByRole("button", { name: "Entertainment" }));
    expect(screen.getByRole("dialog", { name: "Create category" })).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Category name" }), {
      target: { value: "Movies" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add and select" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(created.id));
    expect(client.getQueryData<Category[]>(categoriesQueryKey("user-1"))).toEqual([created]);
    expect(client.getQueryData<Category[]>(categoriesQueryKey("other-user"))).toEqual([
      existingCategory,
    ]);
  });

  it("reviews, creates, caches, and selects a payment method preset", async () => {
    const created: PaymentMethod = {
      id: "payment-1",
      name: "Travel Visa",
      kind: "card",
      label: "•••• 4242",
      symbol: { type: "icon", value: "brand_visa" },
      position: 0,
      createdAt: "2026-08-24T00:00:00.000Z",
      updatedAt: "2026-08-24T00:00:00.000Z",
    };
    vi.spyOn(api, "createPaymentMethod").mockResolvedValue(created);
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const onChange = vi.fn();

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ResourceAssociationField
            id="payment-method"
            kind="payment-method"
            userId="user-1"
            value=""
            resources={[]}
            loading={false}
            error={null}
            onChange={onChange}
            onRetry={() => undefined}
            onPendingChange={() => undefined}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Payment method/ }));
    expect(screen.getByRole("heading", { name: "Common payment methods" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Visa" }));
    expect(screen.getByRole("dialog", { name: "Create payment method" })).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: created.name },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /^Safe display label/ }), {
      target: { value: created.label },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add and select" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(created.id));
    expect(client.getQueryData<PaymentMethod[]>(paymentMethodsQueryKey("user-1"))).toEqual([
      created,
    ]);
  });

  it("keeps an edited preset draft open after a create error and allows retry", async () => {
    const created: Category = {
      ...existingCategory,
      id: "category-3",
      name: "Kept draft",
    };
    vi.spyOn(api, "createCategory")
      .mockRejectedValueOnce(new Error("temporary create failure"))
      .mockResolvedValueOnce(created);
    const { onChange } = renderField();

    fireEvent.click(screen.getByRole("button", { name: /Category/ }));
    fireEvent.click(screen.getByRole("button", { name: "Entertainment" }));
    const nameInput = screen.getByRole("textbox", { name: "Category name" });
    fireEvent.change(nameInput, { target: { value: created.name } });
    fireEvent.click(screen.getByRole("button", { name: "Add and select" }));

    expect(await screen.findByText("temporary create failure")).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Category name" }).value).toBe(
      created.name,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add and select" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(created.id));
  });

  it("shows a field-level error and retry action without presenting None as loaded data", () => {
    const { onRetry } = renderField({ error: new Error("offline") });
    expect(screen.getByText("Category choices could not be loaded.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Category/ }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("does not present a detached association id as None", () => {
    renderField({ value: "deleted-category" });
    expect(screen.getByText("Current selection preserved until choices reload")).toBeTruthy();
  });
});

describe("settings return to subscription form", () => {
  it("offers a validated Back action and carries it between settings sections", () => {
    const returnTo = "/subscriptions/new?from=%2Fdashboard";
    render(
      <MemoryRouter initialEntries={[`/settings/categories?from=${encodeURIComponent(returnTo)}`]}>
        <Routes>
          <Route path="/settings" element={<SettingsLayout />}>
            <Route path="categories" element={<div>Category settings content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Back" }).getAttribute("href")).toBe(returnTo);
    expect(screen.getByRole("link", { name: "Profile" }).getAttribute("href")).toBe(
      `/settings/profile?from=${encodeURIComponent(returnTo)}`,
    );
  });

  it("rejects an external return destination", () => {
    render(
      <MemoryRouter initialEntries={["/settings/categories?from=https%3A%2F%2Fevil.test"]}>
        <Routes>
          <Route path="/settings" element={<SettingsLayout />}>
            <Route path="categories" element={<div>Category settings content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByRole("link", { name: "Back" })).toBeNull();
    expect(screen.getByRole("link", { name: "Profile" }).getAttribute("href")).toBe(
      "/settings/profile",
    );
  });
});
