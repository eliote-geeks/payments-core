import React, { useState, useEffect } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  Home, Wallet, Send, History as HistoryIcon, User, LifeBuoy,
  ShieldCheck, Moon, Sun, LogOut, Languages, Link2, TrendingUp,
  ChevronLeft, ChevronRight, ArrowDownToLine, ArrowLeftRight,
} from "lucide-react";
import { useI18n } from "../../context/I18nContext";
import { useTheme } from "../../context/ThemeContext";
import { useAuth } from "../../context/AuthContext";

const STORAGE_KEY = "kobo_sidebar_collapsed";

export const Sidebar = () => {
  const { t, lang, toggleLang } = useI18n();
  const { theme, toggle } = useTheme();
  const { logout, user } = useAuth();
  const navigate = useNavigate();

  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === "1"; }
    catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0"); }
    catch {}
  }, [collapsed]);

  const items = [
    { to: "/dashboard",     icon: Home,           label: t("nav.home") },
    { to: "/wallet",        icon: Wallet,         label: t("nav.wallet") },
    { to: "/transfer",      icon: Send,           label: t("nav.transfer") },
    { to: "/mobile-money",  icon: ArrowLeftRight, label: "Orange ↔ MTN" },
    { to: "/withdraw",      icon: ArrowDownToLine,label: t("nav.withdraw") },
    { to: "/history",       icon: HistoryIcon,    label: t("nav.history") },
    { to: "/payment-links", icon: Link2,          label: "Liens de paiement" },
    { to: "/earnings",      icon: TrendingUp,     label: "Mes gains" },
    { to: "/kyc",           icon: ShieldCheck,    label: t("nav.kyc") },
    { to: "/support",       icon: LifeBuoy,       label: t("nav.support") },
    { to: "/profile",       icon: User,           label: t("nav.profile") },
  ];

  const w = collapsed ? "w-[64px]" : "w-[220px]";

  return (
    <aside
      data-testid="sidebar"
      className={`hidden md:flex fixed left-0 top-0 h-screen ${w} bg-background border-r border-border z-30 flex-col transition-all duration-200 overflow-hidden`}
    >
      {/* Logo + toggle */}
      <div className={`flex items-center h-14 border-b border-border shrink-0 ${collapsed ? "justify-center px-0" : "px-4 justify-between"}`}>
        {!collapsed && (
          <NavLink to="/dashboard" className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
              <span className="font-bold text-white text-base">K</span>
            </div>
            <span className="font-bold text-lg tracking-tight">Kobo</span>
          </NavLink>
        )}
        {collapsed && (
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
            <span className="font-bold text-white text-base">K</span>
          </div>
        )}
        <button
          onClick={() => setCollapsed((v) => !v)}
          className={`h-7 w-7 rounded-md hover:bg-secondary flex items-center justify-center text-muted-foreground transition-colors ${collapsed ? "absolute right-1 top-3.5" : ""}`}
          title={collapsed ? "Ouvrir le menu" : "Réduire le menu"}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-2 flex flex-col gap-0.5 overflow-y-auto overflow-x-hidden">
        {items.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/dashboard"}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              `flex items-center gap-3 mx-2 rounded-lg transition-colors text-sm font-medium h-9
               ${collapsed ? "justify-center px-0 w-10 mx-auto" : "px-3"}
               ${isActive
                 ? "bg-primary/10 text-primary"
                 : "text-muted-foreground hover:bg-secondary hover:text-foreground"
               }`
            }
          >
            <Icon size={17} className="shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className={`py-3 border-t border-border flex flex-col gap-0.5 ${collapsed ? "items-center" : "px-2"}`}>
        <button
          onClick={toggleLang}
          title={collapsed ? (lang === "fr" ? "English" : "Français") : undefined}
          className={`flex items-center gap-3 h-9 rounded-lg hover:bg-secondary text-sm font-medium transition-colors text-muted-foreground hover:text-foreground
            ${collapsed ? "justify-center w-10" : "px-3 w-full"}`}
        >
          <Languages size={17} className="shrink-0" />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">{lang === "fr" ? "Français" : "English"}</span>
              <span className="text-xs uppercase">{lang === "fr" ? "EN" : "FR"}</span>
            </>
          )}
        </button>

        <button
          onClick={toggle}
          title={collapsed ? (theme === "dark" ? "Mode clair" : "Mode sombre") : undefined}
          className={`flex items-center gap-3 h-9 rounded-lg hover:bg-secondary text-sm font-medium transition-colors text-muted-foreground hover:text-foreground
            ${collapsed ? "justify-center w-10" : "px-3 w-full"}`}
        >
          {theme === "dark" ? <Sun size={17} className="shrink-0" /> : <Moon size={17} className="shrink-0" />}
          {!collapsed && (
            <>
              <span className="flex-1 text-left">{t("profile.theme")}</span>
              <span className="text-xs">{theme === "dark" ? "Dark" : "Light"}</span>
            </>
          )}
        </button>

        <button
          onClick={() => { logout(); navigate("/"); }}
          title={collapsed ? t("common.logout") : undefined}
          className={`flex items-center gap-3 h-9 rounded-lg hover:bg-destructive/10 hover:text-destructive text-sm font-medium transition-colors text-muted-foreground
            ${collapsed ? "justify-center w-10" : "px-3 w-full"}`}
        >
          <LogOut size={17} className="shrink-0" />
          {!collapsed && <span>{t("common.logout")}</span>}
        </button>
      </div>
    </aside>
  );
};

export const useSidebarWidth = () => {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === "1"; }
    catch { return false; }
  });

  useEffect(() => {
    const handler = () => {
      try { setCollapsed(localStorage.getItem(STORAGE_KEY) === "1"); }
      catch {}
    };
    window.addEventListener("storage", handler);
    // Poll every 300ms to catch same-tab changes
    const id = setInterval(handler, 300);
    return () => { window.removeEventListener("storage", handler); clearInterval(id); };
  }, []);

  return collapsed ? 64 : 220;
};
