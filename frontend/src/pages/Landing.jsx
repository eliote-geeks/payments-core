import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Menu, X, ArrowRight, ShieldCheck, Zap, Globe2,
  Send, Wallet, Bitcoin, Smartphone, Building2, Languages, Moon, Sun,
  CheckCircle2, MessageCircle, TrendingUp, Lock, RefreshCw, CreditCard,
  ArrowLeftRight, Users, Star,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { useI18n } from "../context/I18nContext";
import { useTheme } from "../context/ThemeContext";
import { useAuth } from "../context/AuthContext";

const NAV_LINKS = [
  { id: "features", label_fr: "Fonctionnalités", label_en: "Features" },
  { id: "how", label_fr: "Comment ça marche", label_en: "How it works" },
  { id: "rates", label_fr: "Tarifs", label_en: "Pricing" },
  { id: "faq", label_fr: "FAQ", label_en: "FAQ" },
];

export default function Landing() {
  const { lang, toggleLang } = useI18n();
  const { theme, toggle } = useTheme();
  const { isAuthed } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState(null);

  const isFr = lang === "fr";
  const t = (fr, en) => (isFr ? fr : en);

  const goLogin = () => navigate("/login");
  const goSignup = () => navigate("/signup");
  const goDashboard = () => navigate("/dashboard");

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="landing-page">

      {/* ── NAVBAR ─────────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-background/85 backdrop-blur-md border-b border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2" data-testid="landing-logo">
            <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
              <span className="font-display font-bold text-white text-lg">K</span>
            </div>
            <span className="font-display font-bold text-xl tracking-tight">Kobo</span>
          </Link>

          <nav className="hidden md:flex items-center gap-7">
            {NAV_LINKS.map((l) => (
              <a key={l.id} href={`#${l.id}`} data-testid={`landing-nav-${l.id}`}
                className="text-sm font-medium text-muted-foreground hover:text-foreground transition-base">
                {isFr ? l.label_fr : l.label_en}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-1">
            <button onClick={toggleLang} data-testid="landing-lang-toggle"
              className="h-9 px-2.5 rounded-md hover:bg-secondary flex items-center gap-1 text-xs font-semibold uppercase transition-base">
              <Languages size={14} />{lang}
            </button>
            <button onClick={toggle} data-testid="landing-theme-toggle"
              className="h-9 w-9 rounded-md hover:bg-secondary flex items-center justify-center transition-base" aria-label="toggle theme">
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            {isAuthed ? (
              <Button onClick={goDashboard} data-testid="landing-go-dashboard"
                className="bg-primary hover:bg-primary/90 rounded-md text-primary-foreground ml-1 hidden sm:inline-flex">
                {t("Mon compte", "My account")} <ArrowRight size={14} className="ml-1" />
              </Button>
            ) : (
              <>
                <button onClick={goLogin} data-testid="landing-login-btn"
                  className="text-sm font-medium text-muted-foreground hover:text-foreground px-3 py-2 hidden sm:inline-flex transition-base">
                  {t("Connexion", "Sign in")}
                </button>
                <Button onClick={goSignup}
                  className="bg-primary hover:bg-primary/90 rounded-md text-primary-foreground ml-1 hidden sm:inline-flex">
                  {t("Créer un compte", "Get started")}
                </Button>
              </>
            )}
            <button type="button" className="md:hidden h-9 w-9 rounded-md hover:bg-secondary flex items-center justify-center"
              onClick={() => setMenuOpen((v) => !v)} data-testid="landing-mobile-menu-btn" aria-label="open menu">
              {menuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <div className="md:hidden border-t border-border bg-surface" data-testid="landing-mobile-menu">
            <div className="px-4 py-4 flex flex-col gap-1">
              {NAV_LINKS.map((l) => (
                <a key={l.id} href={`#${l.id}`} onClick={() => setMenuOpen(false)}
                  className="px-3 py-2.5 rounded-md hover:bg-secondary text-sm font-medium">
                  {isFr ? l.label_fr : l.label_en}
                </a>
              ))}
              <div className="flex gap-2 mt-2">
                <Button onClick={isAuthed ? goDashboard : goLogin} variant="outline" className="flex-1">
                  {isAuthed ? t("Mon compte", "My account") : t("Connexion", "Sign in")}
                </Button>
                {!isAuthed && (
                  <Button onClick={goSignup} className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground">
                    {t("Créer un compte", "Get started")}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </header>

      {/* ── HERO ───────────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="absolute -top-32 -right-32 h-[520px] w-[520px] rounded-full bg-primary/8 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-40 -left-40 h-[420px] w-[420px] rounded-full bg-primary/5 blur-3xl pointer-events-none" />

        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-12 pb-16 sm:pt-20 sm:pb-24 grid md:grid-cols-2 gap-10 items-center relative">
          <div className="space-y-6">
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                {t("Fintech Camerounaise", "Cameroonian Fintech")}
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 text-xs font-semibold">
                <CheckCircle2 size={11} /> {t("Compte 100% gratuit", "100% free account")}
              </span>
            </div>

            <h1 className="font-display font-bold tracking-tight text-4xl sm:text-5xl lg:text-6xl leading-[1.05]">
              {t("Gérez votre argent", "Manage your money")}
              <br />
              <span className="text-primary">{t("au Cameroun", "in Cameroon")}</span>
              <br />
              {t("et partout.", "from anywhere.")}
            </h1>

            <p className="text-base sm:text-lg text-muted-foreground max-w-xl">
              {t(
                "Kobo réunit virement bancaire, Mobile Money et crypto dans un seul portefeuille. Gérez FCFA, EUR, USD, BTC et USDT — avec des frais transparents et un support réel.",
                "Kobo brings bank transfers, Mobile Money and crypto into one wallet. Manage FCFA, EUR, USD, BTC and USDT — with transparent fees and real support."
              )}
            </p>

            <div className="flex flex-col sm:flex-row gap-3">
              <Button onClick={isAuthed ? goDashboard : goSignup} data-testid="hero-cta-primary"
                className="bg-primary hover:bg-primary/90 rounded-md h-12 px-6 text-primary-foreground text-base">
                {isAuthed ? t("Aller au tableau de bord", "Go to dashboard") : t("Créer mon compte", "Create my account")}
                <ArrowRight size={16} className="ml-1" />
              </Button>
              <a href="#how">
                <Button variant="outline" data-testid="hero-cta-secondary" className="rounded-md h-12 px-6 border-border w-full sm:w-auto">
                  {t("Voir comment ça marche", "How it works")}
                </Button>
              </a>
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-2 pt-2 text-xs text-muted-foreground">
              {[
                t("✓ Inscription en 2 minutes", "✓ Sign up in 2 minutes"),
                t("✓ FCFA · EUR · USD · BTC · USDT", "✓ FCFA · EUR · USD · BTC · USDT"),
                t("✓ Frais affichés avant envoi", "✓ Fees shown before sending"),
              ].map((l) => <span key={l} className="font-medium">{l}</span>)}
            </div>
          </div>

          {/* Hero phone mockup */}
          <div className="relative mx-auto w-full max-w-sm">
            <div className="absolute inset-0 bg-primary rounded-[32px] rotate-3 opacity-15 blur-2xl" />
            <div className="relative rounded-[32px] border border-border bg-surface shadow-2xl overflow-hidden">
              {/* Status bar */}
              <div className="bg-primary text-white px-6 pt-5 pb-8">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-white/70 font-medium">{t("Solde total", "Total balance")}</span>
                  <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded-full text-white/80">Kobo</span>
                </div>
                <p className="font-display text-3xl font-bold tabular-nums">1 520 000 FCFA</p>
                <p className="text-white/60 text-xs mt-0.5">≈ 2 317 EUR · 2 670 USD</p>
                <div className="mt-4 flex gap-2 flex-wrap">
                  {["FCFA", "EUR", "USD", "USDT", "BTC"].map((c, i) => (
                    <span key={c} className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${i === 0 ? "bg-white text-primary" : "bg-white/15 text-white"}`}>{c}</span>
                  ))}
                </div>
              </div>

              <div className="p-5 -mt-5">
                {/* Action icons */}
                <div className="grid grid-cols-4 gap-2 mb-5">
                  {[
                    { Icon: Send, label: t("Envoyer", "Send") },
                    { Icon: ArrowLeftRight, label: t("Transférer", "Transfer") },
                    { Icon: Bitcoin, label: "Crypto" },
                    { Icon: Building2, label: t("Banque", "Bank") },
                  ].map(({ Icon, label }) => (
                    <div key={label} className="flex flex-col items-center gap-1.5 p-2 rounded-lg bg-secondary">
                      <span className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center"><Icon size={16} /></span>
                      <span className="text-[10px] font-medium text-center leading-tight">{label}</span>
                    </div>
                  ))}
                </div>

                {/* Recent transactions */}
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">{t("Transactions récentes", "Recent transactions")}</p>
                <div className="space-y-2.5">
                  {[
                    { label: t("Virement entrant EUR", "Incoming SEPA transfer"), sub: "SEPA · EUR → FCFA", amount: "+320 000 FCFA", color: "text-green-500", bg: "bg-green-500/10" },
                    { label: t("Envoi à Paul N.", "Sent to Paul N."), sub: "P2P · FCFA", amount: "−45 000 FCFA", color: "text-foreground", bg: "bg-primary/10" },
                    { label: t("Dépôt USDT TRC20", "USDT TRC20 deposit"), sub: "Crypto · USDT", amount: "+85 000 FCFA", color: "text-green-500", bg: "bg-orange-500/10" },
                  ].map((tx, i) => (
                    <div key={i} className="flex items-center gap-2.5">
                      <span className={`h-8 w-8 rounded-full ${tx.bg} text-primary shrink-0 flex items-center justify-center`}>
                        <Send size={11} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{tx.label}</p>
                        <p className="text-[10px] text-muted-foreground">{tx.sub}</p>
                      </div>
                      <span className={`text-xs font-semibold tabular-nums shrink-0 ${tx.color}`}>{tx.amount}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Floating badge */}
            <div className="absolute -bottom-4 -right-4 bg-background border border-border rounded-2xl shadow-lg px-4 py-3 flex items-center gap-2">
              <ShieldCheck size={18} className="text-green-500" />
              <div>
                <p className="text-xs font-semibold">{t("KYC vérifié", "KYC verified")}</p>
                <p className="text-[10px] text-muted-foreground">{t("Retraits débloqués", "Withdrawals unlocked")}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── STATS BAR ─────────────────────────────────────────────────────────── */}
      <section className="border-y border-border bg-secondary/30 py-8">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
          {[
            { value: "5", unit: t("devises", "currencies"), label: "FCFA · EUR · USD · USDT · BTC" },
            { value: "1,5%", unit: t("frais P2P max", "max P2P fee"), label: t("Affichés avant envoi", "Shown before sending") },
            { value: "24h", unit: t("délai KYC", "KYC turnaround"), label: t("Vérification d'identité", "Identity verification") },
            { value: "2 min", unit: t("inscription", "sign-up"), label: t("Aucune paperasse", "No paperwork") },
          ].map((s) => (
            <div key={s.unit} className="space-y-0.5">
              <p className="font-display text-2xl sm:text-3xl font-bold text-primary">{s.value} <span className="text-lg">{s.unit}</span></p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── FEATURES ──────────────────────────────────────────────────────────── */}
      <section id="features" className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <div className="text-center mb-12">
          <span className="text-xs font-semibold uppercase tracking-widest text-primary">{t("Fonctionnalités", "Features")}</span>
          <h2 className="font-display text-3xl sm:text-4xl font-bold mt-2">
            {t("Tout votre argent, un seul Kobo.", "All your money, one Kobo.")}
          </h2>
          <p className="text-muted-foreground mt-3 max-w-xl mx-auto text-sm">
            {t("Un compte pour gérer Mobile Money, virements bancaires, crypto et transferts internationaux.", "One account for Mobile Money, bank transfers, crypto and international remittances.")}
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            {
              Icon: Smartphone,
              title: t("Mobile Money", "Mobile Money"),
              desc: t("Retraits MTN & Orange Money en quelques minutes. Frais de 1,5% affichés avant confirmation.", "MTN & Orange Money withdrawals in minutes. 1.5% fee shown before confirming."),
              tag: t("MTN · Orange", "MTN · Orange"),
            },
            {
              Icon: Building2,
              title: t("Virement bancaire SEPA", "SEPA Bank Transfer"),
              desc: t("Déposez en EUR ou USD par virement SEPA depuis votre banque. Crédit sous 1 à 3 jours ouvrés.", "Deposit EUR or USD via SEPA transfer from your bank. Credited in 1–3 business days."),
              tag: "EUR · USD",
            },
            {
              Icon: Bitcoin,
              title: t("Crypto intégrée", "Crypto built-in"),
              desc: t("Bitcoin (BTC) et USDT (TRC20) dans le même portefeuille que vos FCFA.", "Bitcoin (BTC) and USDT (TRC20) in the same wallet as your FCFA."),
              tag: "BTC · USDT",
            },
            {
              Icon: ArrowLeftRight,
              title: t("Transferts internationaux", "International Transfers"),
              desc: t("Envoyez EUR, USD ou GBP depuis l'étranger, recevez en FCFA au Cameroun.", "Send EUR, USD or GBP from abroad, receive FCFA in Cameroon."),
              tag: t("EUR/USD → FCFA", "EUR/USD → FCFA"),
            },
            {
              Icon: ShieldCheck,
              title: t("KYC & Conformité", "KYC & Compliance"),
              desc: t("Vérification d'identité rapide pour débloquer retraits, virements et limites plus élevées.", "Quick identity verification to unlock withdrawals, bank transfers and higher limits."),
              tag: t("2 niveaux", "2 levels"),
            },
            {
              Icon: Lock,
              title: t("Sécurité renforcée", "Enhanced Security"),
              desc: t("Code PIN, sessions actives, codes de récupération et authentification par OTP à chaque connexion.", "PIN code, active sessions, recovery codes and OTP authentication on every sign-in."),
              tag: t("OTP · PIN · Codes", "OTP · PIN · Codes"),
            },
          ].map(({ Icon, title, desc, tag }) => (
            <div key={title} className="rounded-xl bg-surface border border-border p-6 hover:-translate-y-0.5 hover:border-primary/40 transition-base group" data-testid={`feature-${title}`}>
              <div className="flex items-start justify-between mb-4">
                <span className="h-11 w-11 rounded-lg bg-primary/10 text-primary inline-flex items-center justify-center group-hover:bg-primary group-hover:text-white transition-base"><Icon size={20} /></span>
                <span className="text-[10px] font-semibold bg-secondary text-muted-foreground px-2 py-0.5 rounded-full">{tag}</span>
              </div>
              <h3 className="font-display font-semibold text-lg">{title}</h3>
              <p className="text-sm text-muted-foreground mt-1.5">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ──────────────────────────────────────────────────────── */}
      <section id="how" className="bg-secondary/40 border-y border-border py-16 sm:py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <span className="text-xs font-semibold uppercase tracking-widest text-primary">{t("Comment ça marche", "How it works")}</span>
            <h2 className="font-display text-3xl sm:text-4xl font-bold mt-2">{t("Prêt en 3 étapes.", "Ready in 3 steps.")}</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6 relative">
            <div className="hidden md:block absolute top-8 left-1/3 right-1/3 h-px bg-primary/20" />
            {[
              {
                n: "01",
                icon: Users,
                title: t("Créez votre compte", "Create your account"),
                desc: t("Renseignez votre email et votre nom. Validez avec le code OTP reçu dans votre boîte mail. Aucun mot de passe à retenir.", "Enter your email and full name. Verify with the OTP code sent to your inbox. No password to remember."),
              },
              {
                n: "02",
                icon: CreditCard,
                title: t("Approvisionnez", "Top up"),
                desc: t("Déposez par virement bancaire (EUR/USD), dépôt crypto (USDT/BTC) ou par Mobile Money (FCFA). Votre solde apparaît en temps réel.", "Deposit via bank transfer (EUR/USD), crypto (USDT/BTC) or Mobile Money (FCFA). Your balance updates in real time."),
              },
              {
                n: "03",
                icon: TrendingUp,
                title: t("Transférez & retirez", "Transfer & withdraw"),
                desc: t("Envoyez à un utilisateur Kobo en quelques secondes, ou retirez vers votre compte bancaire ou Mobile Money.", "Send to a Kobo user in seconds, or withdraw to your bank or Mobile Money account."),
              },
            ].map((s) => (
              <div key={s.n} className="relative rounded-xl bg-surface border border-border p-6 z-10">
                <div className="flex items-center gap-3 mb-4">
                  <span className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0"><s.icon size={18} /></span>
                  <span className="font-display text-4xl font-bold text-primary/20">{s.n}</span>
                </div>
                <h3 className="font-display font-semibold text-xl mb-2">{s.title}</h3>
                <p className="text-sm text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TRUST SECTION ─────────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
        <div className="grid md:grid-cols-2 gap-6">
          {/* Security card */}
          <div className="rounded-2xl bg-surface border border-border p-8 space-y-4">
            <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <Lock size={22} />
            </div>
            <h3 className="font-display text-xl font-bold">{t("Votre sécurité avant tout", "Your security first")}</h3>
            <p className="text-sm text-muted-foreground">
              {t(
                "Chaque connexion est protégée par OTP. Votre compte dispose d'un code PIN à 6 chiffres, de codes de récupération d'urgence, et d'un journal de sessions actives.",
                "Every sign-in is protected by OTP. Your account has a 6-digit PIN, emergency recovery codes, and an active session log."
              )}
            </p>
            <div className="grid grid-cols-2 gap-3 pt-2">
              {[
                { icon: ShieldCheck, label: t("OTP à chaque connexion", "OTP on every sign-in") },
                { icon: Lock, label: t("Code PIN 6 chiffres", "6-digit PIN code") },
                { icon: RefreshCw, label: t("Codes de récupération", "Recovery codes") },
                { icon: Zap, label: t("Anti-fraude automatique", "Auto fraud detection") },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-2 text-xs font-medium">
                  <Icon size={13} className="text-primary shrink-0" />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Support card */}
          <div className="rounded-2xl bg-primary text-white p-8 space-y-4 relative overflow-hidden">
            <div className="absolute -right-8 -bottom-8 h-40 w-40 rounded-full bg-white/10" />
            <div className="absolute right-20 top-4 h-20 w-20 rounded-full bg-white/5" />
            <div className="relative">
              <div className="h-12 w-12 rounded-xl bg-white/20 text-white flex items-center justify-center mb-4">
                <MessageCircle size={22} />
              </div>
              <h3 className="font-display text-xl font-bold">{t("Support humain + IA", "Human + AI support")}</h3>
              <p className="text-sm text-white/80 mt-2">
                {t(
                  "Assistant IA intégré pour réponses instantanées, et tickets de support traités par notre équipe en moins de 24h. En français et en anglais.",
                  "Built-in AI assistant for instant answers, plus support tickets handled by our team in under 24h. In French and English."
                )}
              </p>
              <div className="mt-5 flex items-center gap-3">
                <div className="flex -space-x-2">
                  {["#3B5BF6", "#6B7280", "#10B981"].map((c, i) => (
                    <div key={i} className="h-8 w-8 rounded-full border-2 border-primary flex items-center justify-center text-[10px] font-bold text-white" style={{ background: c }}>
                      {["KA", "MB", "SN"][i]}
                    </div>
                  ))}
                </div>
                <div>
                  <div className="flex gap-0.5 mb-0.5">
                    {[...Array(5)].map((_, i) => <Star key={i} size={10} fill="white" className="text-white" />)}
                  </div>
                  <p className="text-xs text-white/70">{t("Support noté 4,8/5", "Support rated 4.8/5")}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── RATES ─────────────────────────────────────────────────────────────── */}
      <section id="rates" className="max-w-4xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <div className="text-center mb-10">
          <span className="text-xs font-semibold uppercase tracking-widest text-primary">{t("Tarifs", "Pricing")}</span>
          <h2 className="font-display text-3xl sm:text-4xl font-bold mt-2">{t("Simple. Transparent.", "Simple. Transparent.")}</h2>
          <p className="text-sm text-muted-foreground mt-2">{t("Aucuns frais cachés. Les frais sont toujours affichés avant confirmation.", "No hidden fees. Fees are always shown before confirmation.")}</p>
        </div>
        <div className="rounded-xl bg-surface border border-border overflow-hidden" data-testid="rates-table">
          {[
            { k: t("Transfert P2P Kobo → Kobo", "Kobo P2P transfer"), v: t("1,5% (min 100 FCFA)", "1.5% (min 100 FCFA)"), highlight: false },
            { k: t("Retrait Mobile Money (MTN/Orange)", "Mobile Money withdrawal (MTN/Orange)"), v: t("1,5% (min 100 FCFA)", "1.5% (min 100 FCFA)"), highlight: false },
            { k: t("Virement bancaire sortant", "Outgoing bank transfer"), v: t("Selon montant (affiché avant)", "By amount (shown upfront)"), highlight: false },
            { k: t("Dépôt Mobile Money", "Mobile Money deposit"), v: t("Gratuit", "Free"), highlight: true },
            { k: t("Dépôt virement bancaire (EUR/USD)", "Bank transfer deposit (EUR/USD)"), v: t("Gratuit", "Free"), highlight: true },
            { k: t("Dépôt crypto (USDT/BTC)", "Crypto deposit (USDT/BTC)"), v: t("Gratuit", "Free"), highlight: true },
            { k: t("Retrait crypto", "Crypto withdrawal"), v: t("Frais réseau uniquement", "Network fee only"), highlight: false },
          ].map((r, i) => (
            <div key={r.k} className={`flex items-center justify-between p-5 ${i < 6 ? "border-b border-border" : ""}`}>
              <span className="font-medium text-sm">{r.k}</span>
              <span className={`font-semibold tabular-nums text-sm ${r.highlight ? "text-green-600 dark:text-green-400" : "text-primary"}`}>{r.v}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3 text-center">
          {t("* Les frais exacts sont toujours affichés avant validation de chaque opération.", "* Exact fees are always shown before confirming any operation.")}
        </p>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────────────── */}
      <section id="faq" className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <div className="text-center mb-10">
          <span className="text-xs font-semibold uppercase tracking-widest text-primary">FAQ</span>
          <h2 className="font-display text-3xl sm:text-4xl font-bold mt-2">{t("Vos questions, nos réponses.", "Your questions, our answers.")}</h2>
        </div>
        <div className="space-y-2">
          {[
            {
              q: t("Comment créer un compte Kobo ?", "How do I create a Kobo account?"),
              a: t("Rendez-vous sur koboonline.com, cliquez sur 'Créer un compte', entrez votre email, votre nom complet et votre date de naissance. Vous recevrez un code OTP par email pour activer votre compte. Aucun mot de passe nécessaire.", "Go to koboonline.com, click 'Create an account', enter your email, full name and date of birth. You'll receive an OTP code by email to activate your account. No password needed."),
            },
            {
              q: t("Comment déposer de l'argent ?", "How do I deposit money?"),
              a: t("Vous pouvez déposer via virement bancaire SEPA (EUR/USD), en crypto (USDT TRC20 ou BTC), ou en FCFA via Mobile Money. Allez dans 'Portefeuille > Déposer' et suivez les instructions selon votre méthode préférée.", "You can deposit via SEPA bank transfer (EUR/USD), crypto (USDT TRC20 or BTC), or FCFA via Mobile Money. Go to 'Wallet > Deposit' and follow the instructions for your preferred method."),
            },
            {
              q: t("Comment retirer mes fonds ?", "How do I withdraw my funds?"),
              a: t("Les retraits FCFA se font par Mobile Money (MTN ou Orange) ou virement bancaire (KYC requis). Les retraits crypto (USDT/BTC) nécessitent une adresse wallet. Les frais sont affichés avant confirmation.", "FCFA withdrawals are done via Mobile Money (MTN or Orange) or bank transfer (KYC required). Crypto withdrawals (USDT/BTC) require a wallet address. Fees are shown before confirming."),
            },
            {
              q: t("Qu'est-ce que le KYC et pourquoi le faire ?", "What is KYC and why do it?"),
              a: t("La vérification d'identité (KYC) est requise pour débloquer les retraits et les virements bancaires. Elle consiste à soumettre une pièce d'identité (CNI ou passeport) et un selfie. La validation prend 1 à 24 heures.", "Identity verification (KYC) is required to unlock withdrawals and bank transfers. It involves submitting an ID document (national ID or passport) and a selfie. Validation takes 1 to 24 hours."),
            },
            {
              q: t("Comment récupérer mon compte si je n'ai plus accès à mon email ?", "How do I recover my account without email access?"),
              a: t("Kobo dispose d'un système de codes de récupération d'urgence (format KOBO-XXXX-XXXX). Générez-les dans Profil > Sécurité > Codes de secours et conservez-les précieusement. Ils permettent de vous connecter même sans accès à votre email.", "Kobo has an emergency recovery code system (format KOBO-XXXX-XXXX). Generate them in Profile > Security > Recovery codes and keep them safe. They let you sign in even without email access."),
            },
            {
              q: t("Les transferts internationaux sont-ils disponibles ?", "Are international transfers available?"),
              a: t("Oui. Vous pouvez recevoir des virements en EUR, USD ou GBP depuis l'étranger, qui seront convertis en FCFA sur votre compte Kobo. Allez dans 'Transfert > International' pour obtenir les instructions de virement.", "Yes. You can receive transfers in EUR, USD or GBP from abroad, converted to FCFA on your Kobo account. Go to 'Transfer > International' for wire transfer instructions."),
            },
          ].map((item, i) => (
            <div key={i} className="rounded-xl bg-surface border border-border overflow-hidden" data-testid={`landing-faq-${i}`}>
              <button
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className="w-full text-left p-5 flex items-center justify-between gap-4"
              >
                <span className="font-medium text-sm">{item.q}</span>
                <span className={`text-primary transition-transform duration-200 shrink-0 ${openFaq === i ? "rotate-45" : ""} text-xl leading-none`}>+</span>
              </button>
              {openFaq === i && (
                <div className="px-5 pb-5">
                  <p className="text-sm text-muted-foreground leading-relaxed">{item.a}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────────────────── */}
      <section className="px-4 sm:px-6 pb-20">
        <div className="max-w-5xl mx-auto rounded-2xl bg-primary text-white p-8 sm:p-12 relative overflow-hidden">
          <div className="absolute -right-20 -bottom-20 h-72 w-72 rounded-full bg-white/10" />
          <div className="absolute right-32 top-6 h-24 w-24 rounded-full bg-white/5" />
          <div className="relative grid md:grid-cols-[1fr_auto] gap-6 items-center">
            <div>
              <h2 className="font-display text-3xl sm:text-4xl font-bold leading-tight">
                {t("Prêt à essayer Kobo ?", "Ready to try Kobo?")}
              </h2>
              <p className="text-white/85 mt-2 max-w-lg">
                {t("Créez votre compte gratuitement en 2 minutes et commencez à gérer votre argent sans frontières.", "Create your free account in 2 minutes and start managing your money without borders.")}
              </p>
              <div className="flex flex-wrap items-center gap-4 mt-4 text-sm text-white/80">
                <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={14} />{t("Sans frais cachés", "No hidden fees")}</span>
                <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={14} />{t("Gratuit à l'ouverture", "Free to open")}</span>
                <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={14} />{t("Support en français", "French support")}</span>
              </div>
            </div>
            <Button onClick={isAuthed ? goDashboard : goSignup} data-testid="cta-bottom"
              className="bg-white hover:bg-white/90 text-primary rounded-md h-12 px-6 font-semibold text-base shrink-0">
              {isAuthed ? t("Mon compte", "My account") : t("Commencer maintenant", "Get started now")}
              <ArrowRight size={16} className="ml-1" />
            </Button>
          </div>
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────────────────────── */}
      <footer className="border-t border-border py-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-md bg-primary flex items-center justify-center">
                <span className="font-display font-bold text-white text-sm">K</span>
              </div>
              <span className="font-display font-semibold text-foreground">Kobo</span>
              <span>· © 2026 · {t("Fintech Cameroun", "Cameroon Fintech")}</span>
            </div>
            <div className="flex items-center flex-wrap justify-center gap-5">
              <a href="#features" className="hover:text-foreground transition-base">{t("Fonctionnalités", "Features")}</a>
              <a href="#rates" className="hover:text-foreground transition-base">{t("Tarifs", "Pricing")}</a>
              <a href="#faq" className="hover:text-foreground transition-base">FAQ</a>
              <Link to="/terms" className="hover:text-foreground transition-base">{t("CGU", "Terms")}</Link>
              <Link to="/refund" className="hover:text-foreground transition-base">{t("Remboursements", "Refunds")}</Link>
              <a href="mailto:service@koboonline.com" className="hover:text-foreground transition-base">service@koboonline.com</a>
              <Link to="/login" className="hover:text-foreground transition-base" data-testid="footer-login">
                {t("Connexion", "Sign in")}
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
