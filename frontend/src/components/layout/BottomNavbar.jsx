import React from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Home, Wallet, Send, History as HistoryIcon, User, Menu, ShieldCheck, LifeBuoy, ChevronRight, Link2, ArrowLeftRight } from "lucide-react";
import { useI18n } from "../../context/I18nContext";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../ui/sheet";

export const BottomNavbar = () => {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = React.useState(false);

  const items = [
    { to: "/dashboard", icon: Home, label: t("nav.home"), testId: "nav-home" },
    { to: "/wallet", icon: Wallet, label: t("nav.wallet"), testId: "nav-wallet" },
    { to: "/mobile-money", icon: ArrowLeftRight, label: "Orange↔MTN", testId: "nav-mobile-money" },
    { to: "/history", icon: HistoryIcon, label: t("nav.history"), testId: "nav-history" },
    { to: "/more", icon: Menu, label: "Plus", testId: "nav-more" },
  ];

  return (
    <>
      <nav
        data-testid="bottom-navbar"
        className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-surface border-t border-border z-40 flex items-center justify-around px-2 pb-[env(safe-area-inset-bottom)]"
      >
        {items.map(({ to, icon: Icon, label, testId }) => {
          const isMore = to === "/more";
          const active =
            !isMore &&
            (pathname === to ||
              (to !== "/dashboard" && pathname.startsWith(to)) ||
              (to === "/dashboard" && pathname === "/dashboard"));
          return isMore ? (
            <button
              key={to}
              type="button"
              onClick={() => setMoreOpen(true)}
              data-testid={testId}
              className="flex flex-col items-center justify-center flex-1 h-full gap-0.5 relative transition-base"
            >
              <Icon size={22} className="text-muted-foreground" strokeWidth={2} />
              <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
            </button>
          ) : (
            <NavLink
              key={to}
              to={to}
              data-testid={testId}
              className="flex flex-col items-center justify-center flex-1 h-full gap-0.5 relative transition-base"
            >
              <Icon size={22} className={active ? "text-primary" : "text-muted-foreground"} strokeWidth={active ? 2.4 : 2} />
              <span className={`text-[11px] font-medium ${active ? "text-primary" : "text-muted-foreground"}`}>
                {label}
              </span>
              {active && <span className="absolute top-1 h-1 w-1 rounded-full bg-primary" />}
            </NavLink>
          );
        })}
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="right" className="w-72 p-0 flex flex-col" data-testid="more-sidebar">
          <SheetHeader className="px-5 pt-6 pb-4 border-b border-border">
            <SheetTitle className="font-display text-base">Menu</SheetTitle>
          </SheetHeader>
          <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
            {[
              { to: "/profile", icon: User, label: t("nav.profile") },
              { to: "/transfer", icon: Send, label: t("nav.transfer") },
              { to: "/payment-links", icon: Link2, label: "Liens de paiement" },
              { to: "/withdraw", icon: Send, label: t("nav.withdraw") },
              { to: "/kyc", icon: ShieldCheck, label: t("nav.kyc") },
              { to: "/support", icon: LifeBuoy, label: t("nav.support") },
            ].map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => setMoreOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-3 rounded-lg transition-base ${
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-foreground hover:bg-secondary"
                  }`
                }
              >
                <Icon size={20} className="shrink-0" strokeWidth={2} />
                <span className="text-sm font-medium flex-1">{label}</span>
                <ChevronRight size={15} className="text-muted-foreground" />
              </NavLink>
            ))}
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
};
