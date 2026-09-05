import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "@/App.css";
import { ThemeProvider } from "./context/ThemeContext";
import { I18nProvider } from "./context/I18nContext";
import { AuthProvider } from "./context/AuthContext";
import { AppLayout } from "./components/layout/AppLayout";
import { ProtectedRoute } from "./components/common/ProtectedRoute";
import { Toaster } from "./components/ui/sonner";
import Landing from "./pages/Landing";
import AuthPage from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Wallet from "./pages/Wallet";
import Transfer from "./pages/Transfer";
import MobileMoneyBridge from "./pages/MobileMoneyBridge";
import History from "./pages/History";
import Kyc from "./pages/Kyc";
import Support from "./pages/Support";
import Profile from "./pages/Profile";
import CryptoDeposit from "./pages/CryptoDeposit";
import CryptoWithdraw from "./pages/CryptoWithdraw";
import CryptoHelp from "./pages/CryptoHelp";
import FiatDeposit from "./pages/FiatDeposit";
import FiatWithdraw from "./pages/FiatWithdraw";
import AdminPanel from "./pages/AdminPanel";
import PayLink from "./pages/PayLink";
import PaymentLinksPage from "./pages/PaymentLinks";
import PaymentLinkDetail from "./pages/PaymentLinkDetail";
import EarningsPage from "./pages/EarningsPage";
import Terms from "./pages/Terms";
import Refund from "./pages/Refund";
import ApiDocs from "./pages/ApiDocs";

function App() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/auth" element={<Navigate to="/login" replace />} />
              <Route path="/login" element={<AuthPage mode="login" />} />
              <Route path="/signup" element={<AuthPage mode="signup" />} />
              <Route
                element={
                  <ProtectedRoute>
                    <AppLayout />
                  </ProtectedRoute>
                }
              >
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/wallet" element={<Wallet />} />
                <Route path="/transfer" element={<Transfer />} />
                <Route path="/mobile-money" element={<MobileMoneyBridge />} />
                <Route path="/withdraw" element={<FiatWithdraw />} />
                <Route path="/fiat-withdraw" element={<FiatWithdraw />} />
                <Route path="/history" element={<History />} />
                <Route path="/kyc" element={<Kyc />} />
                <Route path="/support" element={<Support />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/crypto-deposit" element={<CryptoDeposit />} />
                <Route path="/crypto-withdraw" element={<CryptoWithdraw />} />
                <Route path="/crypto-help" element={<CryptoHelp />} />
                <Route path="/fiat-deposit" element={<FiatDeposit />} />
                <Route path="/payment-links" element={<PaymentLinksPage />} />
                <Route path="/payment-links/:id" element={<PaymentLinkDetail />} />
                <Route path="/earnings" element={<EarningsPage />} />
              </Route>
              <Route path="/k-ops" element={<AdminPanel />} />
              <Route path="/pay/:linkId" element={<PayLink />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/refund" element={<Refund />} />
              <Route path="/developers" element={<ApiDocs />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
          <Toaster position="top-center" richColors />
        </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}

export default App;
