import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Menu, X, ArrowRight, ShieldCheck, Zap, Globe2,
  Send, Wallet, Bitcoin, Smartphone, Building2, Languages, Moon, Sun,
  CheckCircle2, MessageCircle,
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

  const isFr = lang === "fr";
  const t = (fr, en) => (isFr ? fr : en);

  const goLogin = () => navigate("/login");
  const goSignup = () => navigate("/signup");
  const goDashboard = () => navigate("/dashboard");

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="landing-page">
      {/* NAVBAR */}
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
              <a
                key={l.id}
                href={`#${l.id}`}
                data-testid={`landing-nav-${l.id}`}
                className="text-sm font-medium text-muted-foreground hover:text-foreground transition-base"
              >
                {isFr ? l.label_fr : l.label_en}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-1">
            <button
              onClick={toggleLang}
              data-testid="landing-lang-toggle"
              className="h-9 px-2.5 rounded-md hover:bg-secondary flex items-center gap-1 text-xs font-semibold uppercase transition-base"
            >
              <Languages size={14} />{lang}
            </button>
            <button
              onClick={toggle}
              data-testid="landing-theme-toggle"
              className="h-9 w-9 rounded-md hover:bg-secondary flex items-center justify-center transition-base"
              aria-label="toggle theme"
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            {isAuthed ? (
              <Button
                onClick={goDashboard}
                data-testid="landing-go-dashboard"
                className="bg-primary hover:bg-primary/90 rounded-md text-primary-foreground ml-1 hidden sm:inline-flex"
              >
                {t("Mon compte", "My account")} <ArrowRight size={14} className="ml-1" />
              </Button>
            ) : (
              <Button
                onClick={goLogin}
                data-testid="landing-login-btn"
                className="bg-primary hover:bg-primary/90 rounded-md text-primary-foreground ml-1 hidden sm:inline-flex"
              >
                {t("Connexion", "Sign in")}
              </Button>
            )}

            <button
              type="button"
              className="md:hidden h-9 w-9 rounded-md hover:bg-secondary flex items-center justify-center"
              onClick={() => setMenuOpen((v) => !v)}
              data-testid="landing-mobile-menu-btn"
              aria-label="open menu"
            >
              {menuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <div className="md:hidden border-t border-border bg-surface" data-testid="landing-mobile-menu">
            <div className="px-4 py-4 flex flex-col gap-1">
              {NAV_LINKS.map((l) => (
                <a
                  key={l.id}
                  href={`#${l.id}`}
                  onClick={() => setMenuOpen(false)}
                  className="px-3 py-2.5 rounded-md hover:bg-secondary text-sm font-medium"
                >
                  {isFr ? l.label_fr : l.label_en}
                </a>
              ))}
              <Button
                onClick={isAuthed ? goDashboard : goLogin}
                data-testid="landing-mobile-login-btn"
                className="mt-2 w-full bg-primary hover:bg-primary/90 rounded-md text-primary-foreground"
              >
                {isAuthed ? t("Mon compte", "My account") : t("Connexion", "Sign in")}
              </Button>
            </div>
          </div>
        )}
      </header>

      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="absolute -top-32 -right-32 h-[420px] w-[420px] rounded-full bg-primary/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-40 -left-40 h-[420px] w-[420px] rounded-full bg-primary/5 blur-3xl pointer-events-none" />

        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-12 pb-16 sm:pt-20 sm:pb-24 grid md:grid-cols-2 gap-10 items-center relative">
          <div className="space-y-6">
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-semibold uppercase tracking-widest">
              <Smartphone size={12} /> {t("MTN MoMo · Orange Money", "MTN MoMo · Orange Money")}
            </span>
            <h1 className="font-display font-bold tracking-tight text-4xl sm:text-5xl lg:text-6xl leading-[1.05]">
              {t("Envoyez de l'argent", "Send money")}
              <br />
              <span className="text-primary">{t("au Cameroun.", "to Cameroon.")}</span>
              <br />
              {t("Sans friction.", "Friction-free.")}
            </h1>
            <p className="text-base sm:text-lg text-muted-foreground max-w-xl">
              {t(
                "Kobo connecte Mobile Money, comptes bancaires et cryptos en un seul portefeuille. Transferts instantanés, frais transparents, support 24/7.",
                "Kobo brings together Mobile Money, bank accounts and crypto in a single wallet. Instant transfers, transparent fees, 24/7 support."
              )}
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                onClick={isAuthed ? goDashboard : goSignup}
                data-testid="hero-cta-primary"
                className="bg-primary hover:bg-primary/90 rounded-md h-12 px-6 text-primary-foreground text-base"
              >
                {isAuthed ? t("Aller au tableau de bord", "Go to dashboard") : t("Créer mon compte", "Create my account")}
                <ArrowRight size={16} className="ml-1" />
              </Button>
              <a href="#how">
                <Button
                  variant="outline"
                  data-testid="hero-cta-secondary"
                  className="rounded-md h-12 px-6 border-border w-full sm:w-auto"
                >
                  {t("Voir comment", "How it works")}
                </Button>
              </a>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2 pt-2 text-xs text-muted-foreground">
              {[
                t("✓ KYC en 2 minutes", "✓ KYC in 2 minutes"),
                t("✓ Frais dès 1,5%", "✓ Fees from 1.5%"),
                t("✓ FCFA · EUR · USD · BTC · USDT", "✓ FCFA · EUR · USD · BTC · USDT"),
              ].map((l) => <span key={l} className="font-medium">{l}</span>)}
            </div>
          </div>

          {/* Hero phone mockup */}
          <div className="relative mx-auto w-full max-w-sm">
            <div className="absolute inset-0 bg-primary rounded-[32px] rotate-3 opacity-15 blur-2xl" />
            <div className="relative rounded-[32px] border border-border bg-surface shadow-2xl overflow-hidden">
              <div className="bg-primary text-white p-6 pb-10">
                <p className="text-xs uppercase tracking-widest text-white/70">{t("Solde total", "Total balance")}</p>
                <p className="font-display text-3xl font-bold mt-1 tabular-nums">1 520 000 FCFA</p>
                <div className="mt-4 flex gap-2">
                  {["FCFA", "EUR", "USD"].map((c, i) => (
                    <span key={c} className={`px-3 py-1 rounded-full text-xs font-semibold ${i === 0 ? "bg-white text-primary" : "bg-white/15 text-white"}`}>{c}</span>
                  ))}
                </div>
              </div>
              <div className="p-5 -mt-6">
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { Icon: Send, label: t("Envoyer", "Send") },
                    { Icon: Wallet, label: t("Recevoir", "Receive") },
                    { Icon: Bitcoin, label: "Crypto" },
                    { Icon: Building2, label: t("Banque", "Bank") },
                  ].map(({ Icon, label }) => (
                    <div key={label} className="flex flex-col items-center gap-1.5 p-2 rounded-lg bg-secondary">
                      <span className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center"><Icon size={16} /></span>
                      <span className="text-[10px] font-medium text-center">{label}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-5 space-y-3">
                  {[
                    { label: "Dépôt MTN MoMo", amount: "+150 000 FCFA", color: "text-success" },
                    { label: "Envoi à Paul N.", amount: "−45 000 FCFA", color: "text-foreground" },
                    { label: "Reçu de Marie K.", amount: "+25 000 FCFA", color: "text-success" },
                  ].map((tx, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2.5">
                        <span className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center"><Send size={12} /></span>
                        <span className="font-medium">{tx.label}</span>
                      </div>
                      <span className={`font-semibold tabular-nums text-sm ${tx.color}`}>{tx.amount}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <div className="text-center mb-12">
          <span className="text-xs font-semibold uppercase tracking-widest text-primary">{t("Fonctionnalités", "Features")}</span>
          <h2 className="font-display text-3xl sm:text-4xl font-bold mt-2">
            {t("Tout votre argent, un seul Kobo.", "All your money, one Kobo.")}
          </h2>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { Icon: Smartphone, title: t("Mobile Money instantané", "Instant Mobile Money"), desc: t("Dépôts et retraits MTN & Orange en quelques secondes.", "Deposits and withdrawals on MTN & Orange in seconds.") },
            { Icon: Globe2, title: t("Multi-devises", "Multi-currency"), desc: t("FCFA, EUR, USD — convertissez au taux du jour.", "FCFA, EUR, USD — convert at today's rate.") },
            { Icon: Bitcoin, title: t("Crypto intégrée", "Crypto built-in"), desc: t("Bitcoin et USDT (TRC20/ERC20) dans le même portefeuille.", "Bitcoin and USDT (TRC20/ERC20) in the same wallet.") },
            { Icon: ShieldCheck, title: t("KYC 4 niveaux", "4-level KYC"), desc: t("Limites adaptées, vérification rapide, conformité totale.", "Tailored limits, quick verification, full compliance.") },
            { Icon: Zap, title: t("Frais transparents", "Transparent fees"), desc: t("Calculés avant chaque envoi, sans mauvaise surprise.", "Computed before every send — no surprises.") },
            { Icon: MessageCircle, title: t("Support 24/7", "24/7 support"), desc: t("Chat en direct en français et anglais, par de vrais humains.", "Live chat in French and English, by real humans.") },
          ].map(({ Icon, title, desc }) => (
            <div key={title} className="rounded-xl bg-surface border border-border p-6 hover:-translate-y-0.5 hover:border-primary/40 transition-base" data-testid={`feature-${title}`}>
              <span className="h-11 w-11 rounded-lg bg-primary/10 text-primary inline-flex items-center justify-center"><Icon size={20} /></span>
              <h3 className="font-display font-semibold text-lg mt-4">{title}</h3>
              <p className="text-sm text-muted-foreground mt-1.5">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="bg-secondary/40 border-y border-border py-16 sm:py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <span className="text-xs font-semibold uppercase tracking-widest text-primary">{t("Comment ça marche", "How it works")}</span>
            <h2 className="font-display text-3xl sm:text-4xl font-bold mt-2">{t("Trois étapes, c'est tout.", "Three steps, that's it.")}</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { n: "01", title: t("Créez votre compte", "Create your account"), desc: t("Numéro de téléphone, code par SMS, c'est parti.", "Phone number, code by SMS — done.") },
              { n: "02", title: t("Approvisionnez", "Top up"), desc: t("MTN MoMo, Orange Money, virement ou crypto.", "MTN MoMo, Orange Money, bank transfer or crypto.") },
              { n: "03", title: t("Envoyez & retirez", "Send & withdraw"), desc: t("Vers un numéro, un @username ou une banque.", "To a phone, a @username or a bank.") },
            ].map((s) => (
              <div key={s.n} className="relative rounded-xl bg-surface border border-border p-6">
                <span className="font-display text-5xl font-bold text-primary/15 absolute right-5 top-3">{s.n}</span>
                <h3 className="font-display font-semibold text-xl">{s.title}</h3>
                <p className="text-sm text-muted-foreground mt-2 max-w-xs">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* RATES */}
      <section id="rates" className="max-w-4xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <div className="text-center mb-10">
          <span className="text-xs font-semibold uppercase tracking-widest text-primary">{t("Tarifs", "Pricing")}</span>
          <h2 className="font-display text-3xl sm:text-4xl font-bold mt-2">{t("Simple. Transparent.", "Simple. Transparent.")}</h2>
        </div>
        <div className="rounded-xl bg-surface border border-border overflow-hidden divide-y divide-border" data-testid="rates-table">
          {[
            { k: t("Envoi vers un Kobo", "Send to a Kobo user"), v: t("Gratuit", "Free") },
            { k: t("Retrait MTN MoMo / Orange Money", "MTN MoMo / Orange Money withdrawal"), v: "1,5%" },
            { k: t("Virement bancaire", "Bank transfer"), v: t("2 € forfaitaires", "€2 flat") },
            { k: t("Retrait crypto (BTC / USDT)", "Crypto withdrawal (BTC / USDT)"), v: t("Frais réseau", "Network fee") },
            { k: t("Dépôt Mobile Money", "Mobile Money deposit"), v: t("Gratuit", "Free") },
          ].map((r) => (
            <div key={r.k} className="flex items-center justify-between p-5">
              <span className="font-medium text-sm">{r.k}</span>
              <span className="font-semibold text-primary tabular-nums">{r.v}</span>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <div className="text-center mb-10">
          <span className="text-xs font-semibold uppercase tracking-widest text-primary">FAQ</span>
          <h2 className="font-display text-3xl sm:text-4xl font-bold mt-2">{t("Vos questions, nos réponses.", "Your questions, our answers.")}</h2>
        </div>
        <div className="space-y-3">
          {[
            { q: t("Kobo est-il disponible hors du Cameroun ?", "Is Kobo available outside Cameroon?"), a: t("Oui, vous pouvez ouvrir un compte depuis tout pays prenant en charge nos préfixes téléphoniques. Les retraits Mobile Money restent CM uniquement.", "Yes, you can sign up from any country with supported phone prefixes. Mobile Money withdrawals remain CM-only.") },
            { q: t("Quelles cryptos sont supportées ?", "Which cryptos are supported?"), a: t("Bitcoin (BTC) et USDT (TRC20 / ERC20).", "Bitcoin (BTC) and USDT (TRC20 / ERC20).") },
            { q: t("Combien de temps pour vérifier mon KYC ?", "How long for KYC verification?"), a: t("Niveau 1 : instantané. Niveau 2 : sous 24h. Niveau 3 : sous 72h après envoi des documents.", "Level 1: instant. Level 2: within 24h. Level 3: within 72h after submitting documents.") },
            { q: t("Mon argent est-il en sécurité ?", "Is my money safe?"), a: t("Les fonds clients sont conservés sur des comptes ségrégués. Authentification à 2 facteurs et PIN obligatoires pour chaque transaction.", "Customer funds are held in segregated accounts. 2FA and PIN required for every transaction.") },
          ].map((item, i) => (
            <details key={i} className="rounded-xl bg-surface border border-border p-5 group" data-testid={`landing-faq-${i}`}>
              <summary className="font-medium cursor-pointer flex items-center justify-between list-none">
                <span>{item.q}</span>
                <span className="text-primary transition-transform group-open:rotate-45 text-xl leading-none">+</span>
              </summary>
              <p className="text-sm text-muted-foreground mt-3">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* CTA */}
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
                {t("Créez votre compte en 2 minutes et envoyez votre premier transfert dès maintenant.", "Create your account in 2 minutes and send your first transfer right now.")}
              </p>
              <div className="flex items-center gap-4 mt-4 text-sm text-white/80">
                <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={14} />{t("Sans frais cachés", "No hidden fees")}</span>
                <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={14} />{t("Annulable à tout moment", "Cancel anytime")}</span>
              </div>
            </div>
            <Button
              onClick={isAuthed ? goDashboard : goSignup}
              data-testid="cta-bottom"
              className="bg-white hover:bg-white/90 text-primary rounded-md h-12 px-6 font-semibold text-base"
            >
              {isAuthed ? t("Mon compte", "My account") : t("Commencer maintenant", "Get started")}
              <ArrowRight size={16} className="ml-1" />
            </Button>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-border py-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-primary flex items-center justify-center">
              <span className="font-display font-bold text-white text-sm">K</span>
            </div>
            <span className="font-display font-semibold text-foreground">Kobo</span>
            <span>· © 2026</span>
          </div>
          <div className="flex items-center gap-5">
            <a href="#features" className="hover:text-foreground transition-base">{t("Fonctionnalités", "Features")}</a>
            <a href="#rates" className="hover:text-foreground transition-base">{t("Tarifs", "Pricing")}</a>
            <a href="#faq" className="hover:text-foreground transition-base">FAQ</a>
            <Link to="/login" className="hover:text-foreground transition-base" data-testid="footer-login">
              {t("Connexion", "Sign in")}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
