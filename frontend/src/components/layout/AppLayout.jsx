import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import { BottomNavbar } from "./BottomNavbar";
import { MobileHeader } from "./MobileHeader";
import { TopNavbar } from "./TopNavbar";
import { Onboarding } from "../Onboarding";
import { FloatingChatbot } from "../common/FloatingChatbot";

const TITLES = {
  "/dashboard": "Kobo",
  "/wallet": "Portefeuille",
  "/transfer": "Transfert",
  "/mobile-money": "Orange ↔ MTN",
  "/withdraw": "Retrait",
  "/crypto-withdraw": "Retrait Crypto",
  "/history": "Historique",
  "/kyc": "Vérification",
  "/support": "Support",
  "/profile": "Profil",
};

export const AppLayout = () => {
  const { pathname } = useLocation();
  const title = TITLES[pathname] || "Kobo";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MobileHeader title={title} />
      <TopNavbar />
      <main
        data-testid="main-content"
        className="pb-20 md:pb-0 min-h-screen"
      >
        <div key={pathname} className="px-4 py-4 sm:px-6 md:px-8 md:py-8 max-w-5xl mx-auto page-enter">
          <Outlet />
        </div>
      </main>
      <BottomNavbar />
      <Onboarding />
      <FloatingChatbot />
    </div>
  );
};
