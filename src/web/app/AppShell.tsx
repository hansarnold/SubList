import {
  IconCategory,
  IconCreditCard,
  IconHome,
  IconListDetails,
  IconPlus,
  IconSettings,
} from "@tabler/icons-react";
import clsx from "clsx";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";

const primaryNavigation = [
  { to: "/dashboard", labelKey: "nav.overview", icon: IconHome },
  { to: "/categories", labelKey: "nav.categories", icon: IconCategory },
  { to: "/subscriptions", labelKey: "nav.subscriptions", icon: IconCreditCard },
] as const;

function NavigationLink({
  to,
  label,
  icon: Icon,
  mobile = false,
}: {
  to: string;
  label: string;
  icon: typeof IconHome;
  mobile?: boolean;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        clsx(mobile ? "mobile-nav__link" : "sidebar__link", isActive && "is-active")
      }
    >
      <Icon size={mobile ? 22 : 21} stroke={1.8} aria-hidden="true" />
      <span>{label}</span>
    </NavLink>
  );
}

export function AppShell() {
  const { t } = useTranslation();
  const location = useLocation();
  const addReturn = location.pathname.startsWith("/subscriptions")
    ? "/subscriptions"
    : location.pathname;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {t("app.skipToContent")}
      </a>
      <aside className="sidebar" aria-label={t("app.primaryNavigation")}>
        <Link to="/dashboard" className="brand">
          <span className="brand__mark" aria-hidden="true">
            <IconListDetails size={23} stroke={2.1} />
          </span>
          <span>{t("app.name")}</span>
        </Link>
        <nav className="sidebar__nav">
          {primaryNavigation.map(({ to, labelKey, icon }) => (
            <NavigationLink key={to} to={to} label={t(labelKey)} icon={icon} />
          ))}
        </nav>
        <div className="sidebar__bottom">
          <Link
            className="button button--primary sidebar__add"
            to={`/subscriptions/new?from=${encodeURIComponent(addReturn)}`}
          >
            <IconPlus size={22} aria-hidden="true" />
            {t("app.addSubscription")}
          </Link>
          <NavigationLink to="/settings" label={t("nav.settings")} icon={IconSettings} />
        </div>
      </aside>

      <header className="mobile-header">
        <Link to="/dashboard" className="brand brand--mobile">
          <span className="brand__mark" aria-hidden="true">
            <IconListDetails size={20} />
          </span>
          <span>{t("app.name")}</span>
        </Link>
        <Link
          className="icon-button mobile-header__add"
          to={`/subscriptions/new?from=${encodeURIComponent(addReturn)}`}
          aria-label={t("app.addSubscription")}
        >
          <IconPlus size={23} />
        </Link>
      </header>

      <main id="main-content" className="app-content" tabIndex={-1}>
        <Outlet />
      </main>

      <nav className="mobile-nav" aria-label={t("app.primaryNavigation")}>
        {primaryNavigation.map(({ to, labelKey, icon }) => (
          <NavigationLink key={to} to={to} label={t(labelKey)} icon={icon} mobile />
        ))}
        <NavigationLink to="/settings" label={t("nav.settings")} icon={IconSettings} mobile />
      </nav>
    </div>
  );
}
