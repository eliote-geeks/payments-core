import React, { useRef, useState, useEffect } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  Home, Wallet, Send, History as HistoryIcon,
  ChevronDown, Moon, Sun, Languages, LogOut,
  User, ArrowDownToLine, ShieldCheck, LifeBuoy, Link2,
  ArrowLeftRight,
} from "lucide-react";
import { useI18n } from "../../context/I18nContext";
import { useTheme } from "../../context/ThemeContext";
import { useAuth } from "../../context/AuthContext";
import { NotificationBell } from "../common/NotificationBell";

function useOutsideClick(ref, handler) {
  useEffect(() => {
    const listener = (e) => { if (ref.current && !ref.current.contains(e.target)) handler(); };
    document.addEventListener("mousedown", listener);
    return () => document.removeEventListener("mousedown", listener);
  }, [ref, handler]);
}

export const TopNavbar = () => {
  const { t, lang, toggleLang } = useI18n();
  const { theme, toggle } = useTheme();
  const { logout, user } = useAuth();
  const navigate = useNavigate();

  const [moreOpen, setMoreOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const moreRef = useRef(null);
  const userRef = useRef(null);

  useOutsideClick(moreRef, () => setMoreOpen(false));
  useOutsideClick(userRef, () => setUserOpen(false));

  const mainItems = [
    { to: "/dashboard", icon: Home, label: t("nav.home"), testId: "topnav-home" },
    { to: "/wallet", icon: Wallet, label: t("nav.wallet"), testId: "topnav-wallet" },
    { to: "/transfer", icon: Send, label: t("nav.transfer"), testId: "topnav-transfer" },
    { to: "/mobile-money", icon: ArrowLeftRight, label: "Orange ↔ MTN", testId: "topnav-mobile-money" },
    { to: "/history", icon: HistoryIcon, label: t("nav.history"), testId: "topnav-history" },
  ];

  const moreItems = [
    { to: "/payment-links", icon: Link2, label: "Liens de paiement" },
    { to: "/withdraw", icon: ArrowDownToLine, label: t("nav.withdraw") },
    { to: "/kyc", icon: ShieldCheck, label: t("nav.kyc") },
    { to: "/support", icon: LifeBuoy, label: t("nav.support") },
  ];

  const initials = (user?.fullName || user?.email || "K")[0].toUpperCase();
  const avatarSrc = user?.avatarDataUrl;

  const handleLogout = () => {
    setUserOpen(false);
    logout();
    navigate("/");
  };

  return (
    <header
      data-testid="top-navbar"
      className="hidden md:block sticky top-0 z-30 bg-background/85 backdrop-blur-md border-b border-border"
    >
      <div className="h-14 px-6 flex items-center gap-4 max-w-6xl mx-auto">
        {/* Logo */}
        <NavLink to="/dashboard" className="flex items-center gap-2 shrink-0 mr-2">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
            <span className="font-display font-bold text-white text-base">K</span>
          </div>
          <span className="font-display font-bold text-lg tracking-tight">Kobo</span>
        </NavLink>

        {/* Main nav */}
        <nav className="flex items-center gap-0.5">
          {mainItems.map(({ to, icon: Icon, label, testId }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/dashboard"}
              data-testid={testId}
              className={({ isActive }) =>
                `inline-flex items-center gap-1.5 px-3 py-2 rounded-md transition-base text-sm font-medium ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`
              }
            >
              <Icon size={15} />
              <span>{label}</span>
            </NavLink>
          ))}

          {/* More dropdown */}
          <div className="relative" ref={moreRef}>
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-md transition-base text-sm font-medium ${
                moreOpen ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              Plus
              <ChevronDown size={13} className={`transition-transform ${moreOpen ? "rotate-180" : ""}`} />
            </button>
            {moreOpen && (
              <div className="absolute top-full left-0 mt-1 w-48 bg-background border border-border rounded-xl shadow-lg py-1 z-50">
                {moreItems.map(({ to, icon: Icon, label }) => (
                  <NavLink
                    key={to}
                    to={to}
                    onClick={() => setMoreOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 px-4 py-2.5 text-sm transition-base ${
                        isActive ? "text-primary bg-primary/5" : "text-foreground hover:bg-secondary"
                      }`
                    }
                  >
                    <Icon size={15} className="text-muted-foreground" />
                    {label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        </nav>

        {/* Right side */}
        <div className="ml-auto flex items-center gap-1">
          {/* Lang */}
          <button
            type="button"
            onClick={toggleLang}
            data-testid="topnav-lang-toggle"
            className="h-8 px-2.5 rounded-md hover:bg-secondary transition-base flex items-center gap-1 text-xs font-semibold uppercase text-muted-foreground"
          >
            <Languages size={14} />
            {lang}
          </button>

          {/* Theme */}
          <button
            type="button"
            onClick={toggle}
            data-testid="topnav-theme-toggle"
            className="h-8 w-8 rounded-md hover:bg-secondary transition-base flex items-center justify-center text-muted-foreground"
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>

          {/* Notifications */}
          <NotificationBell />

          {/* User avatar dropdown */}
          <div className="relative ml-1" ref={userRef}>
            <button
              type="button"
              onClick={() => setUserOpen((v) => !v)}
              data-testid="topnav-user"
              className="h-8 w-8 rounded-full overflow-hidden bg-primary/10 text-primary flex items-center justify-center font-bold text-sm hover:ring-2 hover:ring-primary/40 transition-all"
            >
              {avatarSrc ? (
                <img src={avatarSrc} alt="" className="h-full w-full object-cover" />
              ) : (
                initials
              )}
            </button>
            {userOpen && (
              <div className="absolute top-full right-0 mt-1 w-52 bg-background border border-border rounded-xl shadow-lg py-1 z-50">
                <div className="px-4 py-2.5 border-b border-border">
                  <p className="text-sm font-semibold truncate">{user?.fullName || "Kobo"}</p>
                  <p className="text-xs text-muted-foreground truncate">{user?.email || user?.phone || ""}</p>
                </div>
                <NavLink
                  to="/profile"
                  onClick={() => setUserOpen(false)}
                  className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-secondary transition-base"
                >
                  <User size={14} className="text-muted-foreground" />
                  {t("nav.profile")}
                </NavLink>
                <button
                  type="button"
                  onClick={handleLogout}
                  data-testid="topnav-logout"
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-destructive hover:bg-destructive/5 transition-base"
                >
                  <LogOut size={14} />
                  {t("common.logout")}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
