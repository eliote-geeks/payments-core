import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Wallet, Send, Shield, Building2, Lock, Globe2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { CountrySelector } from "../components/common/CountrySelector";
import { PinInput } from "../components/common/PinInput";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { useI18n } from "../context/I18nContext";
import { useTheme } from "../context/ThemeContext";
import { useAuth } from "../context/AuthContext";
import { COUNTRIES } from "../countries";
import { toast } from "sonner";
import { Moon, Sun, Languages } from "lucide-react";
import { loginOrRegisterNeeded, register, startOtp, submitUnblockAppeal, verifyOtp } from "../api/auth";
import { recoverWithCode } from "../api/user";

export default function AuthPage({ mode = "login" }) {
  const { t, lang, toggleLang } = useI18n();
  const { theme, toggle } = useTheme();
  const { login } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState("email");
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [form, setForm] = useState({ fullName: "", dob: "", country: "CM", phone: "" });
  const [challengeId, setChallengeId] = useState(null);
  const [verificationToken, setVerificationToken] = useState(null);
  const [recoverMode, setRecoverMode] = useState(false);
  const [recoverEmail, setRecoverEmail] = useState("");
  const [recoverCode, setRecoverCode] = useState("");
  const [recoverLoading, setRecoverLoading] = useState(false);
  const [appealMsg, setAppealMsg] = useState("");
  const [appealLoading, setAppealLoading] = useState(false);
  const [appealRef, setAppealRef] = useState(null);

  useEffect(() => {
    setStep("email");
    setChallengeId(null);
    setVerificationToken(null);
    setOtp("");
    setOtpVerified(false);
    setIsVerifyingOtp(false);
  }, [mode]);

  const handleSendOtp = async (e) => {
    e.preventDefault();
    if (!email.includes("@") || email.length < 5) {
      toast.error(lang === "fr" ? "Adresse email invalide" : "Invalid email address");
      return;
    }
    try {
      const res = await startOtp(email.trim().toLowerCase());
      setChallengeId(res.challenge_id);
      setVerificationToken(null);
      setStep("otp");
      setOtpVerified(false);
      setIsVerifyingOtp(false);
      toast.success(lang === "fr" ? "Code envoyé par email" : "Code sent by email");
      if (res.dev_code) toast.message("DEV OTP: " + res.dev_code);
    } catch (err) {
      toast.error(lang === "fr" ? "Impossible d'envoyer le code" : "Failed to send code");
    }
  };

  const handleResendOtp = async () => {
    if (!email.includes("@")) return;
    try {
      const res = await startOtp(email.trim().toLowerCase());
      setChallengeId(res.challenge_id);
      setVerificationToken(null);
      setOtpVerified(false);
      setIsVerifyingOtp(false);
      toast.success(lang === "fr" ? "Code renvoyé" : "Code resent");
      if (res.dev_code) toast.message("DEV OTP: " + res.dev_code);
    } catch {
      toast.error(lang === "fr" ? "Impossible de renvoyer" : "Failed to resend");
    }
  };

  const handleVerifyOtp = async (code) => {
    if (otpVerified || isVerifyingOtp) return;
    if (!challengeId) {
      toast.error(lang === "fr" ? "Recommence l'envoi du code" : "Please resend the code");
      return;
    }
    try {
      setIsVerifyingOtp(true);
      const verification = await verifyOtp(challengeId, code);
      setVerificationToken(verification.verification_token);
      setOtp(code);
      setOtpVerified(true);
      const res = await loginOrRegisterNeeded(
        email.trim().toLowerCase(),
        challengeId,
        verification.verification_token,
      );

      if (mode === "signup") {
        if (res.needs_register) setStep("register");
        else {
          toast.message(lang === "fr" ? "Compte déjà existant. Connexion..." : "Account already exists. Signing in...");
          login(res.user, res.token, res.session_id);
          navigate("/dashboard");
        }
        return;
      }

      if (res.needs_register) {
        toast.message(lang === "fr" ? "Aucun compte trouvé. Crée un compte." : "No account found. Create one.");
        setStep("register");
      } else {
        login(res.user, res.token, res.session_id);
        navigate("/dashboard");
      }
    } catch (err) {
      if (err?.response?.status === 403 && err?.response?.data?.detail === "account_blocked") {
        setStep("blocked");
      } else {
        toast.error(lang === "fr" ? "Code incorrect" : "Wrong code");
      }
      setOtpVerified(false);
      setOtp("");
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  const handleAppeal = async (e) => {
    e.preventDefault();
    if (appealMsg.trim().length < 10) {
      toast.error(lang === "fr" ? "Message trop court (10 caractères min)" : "Message too short (10 chars min)");
      return;
    }
    setAppealLoading(true);
    try {
      const res = await submitUnblockAppeal(email.trim().toLowerCase(), appealMsg.trim());
      setAppealRef(res.reference);
    } catch {
      toast.error(lang === "fr" ? "Envoi échoué. Réessayez." : "Failed to send. Please retry.");
    } finally {
      setAppealLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!form.fullName || !form.dob) {
      toast.error(lang === "fr" ? "Remplissez tous les champs" : "Fill all fields");
      return;
    }
    // Validation âge minimum 18 ans
    const birthDate = new Date(form.dob);
    const today = new Date();
    const age = today.getFullYear() - birthDate.getFullYear() -
      (today < new Date(today.getFullYear(), birthDate.getMonth(), birthDate.getDate()) ? 1 : 0);
    if (isNaN(age) || age < 18) {
      toast.error(lang === "fr" ? "Vous devez avoir au moins 18 ans pour vous inscrire" : "You must be at least 18 years old to register");
      return;
    }
    if (age > 120) {
      toast.error(lang === "fr" ? "Date de naissance invalide" : "Invalid date of birth");
      return;
    }
    const dial = COUNTRIES.find((c) => c.code === form.country)?.dial || "";
    const rawPhone = form.phone.trim().replace(/\s/g, "");
    const fullPhone = rawPhone ? (rawPhone.startsWith("+") ? rawPhone : `${dial}${rawPhone}`) : "";
    try {
      const res = await register({
        email: email.trim().toLowerCase(),
        full_name: form.fullName,
        dob: form.dob,
        country: form.country,
        phone: fullPhone || undefined,
        challenge_id: challengeId,
        verification_token: verificationToken,
      });
      login(
        { ...res.user, fullName: res.user.fullName || form.fullName, dob: form.dob, country: form.country, email },
        res.token,
        res.session_id
      );
      navigate("/dashboard");
    } catch {
      toast.error(lang === "fr" ? "Inscription impossible" : "Registration failed");
    }
  };

  const handleRecover = async (e) => {
    e?.preventDefault();
    if (!recoverEmail.includes("@") || !recoverCode.trim()) {
      toast.error(lang === "fr" ? "Email et code requis" : "Email and code required");
      return;
    }
    setRecoverLoading(true);
    try {
      const res = await recoverWithCode(recoverEmail.trim().toLowerCase(), recoverCode.trim().toUpperCase());
      login(res.user, res.token);
      navigate("/dashboard");
    } catch (err) {
      toast.error(err?.response?.data?.detail || (lang === "fr" ? "Email ou code incorrect" : "Invalid email or code"));
    } finally {
      setRecoverLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <div className="md:w-1/2 bg-primary text-white p-8 md:p-14 flex flex-col justify-between relative overflow-hidden">
        <div className="absolute -right-20 -bottom-20 h-72 w-72 rounded-full bg-white/10" />
        <div className="absolute right-24 top-10 h-32 w-32 rounded-full bg-white/5" />
        <div className="absolute left-10 bottom-20 h-20 w-20 rounded-full bg-white/5" />

        <div className="flex items-center gap-2 relative z-10">
          <div className="h-10 w-10 rounded-lg bg-white flex items-center justify-center">
            <span className="font-display font-bold text-primary text-xl">K</span>
          </div>
          <span className="font-display font-bold text-2xl">Kobo</span>
        </div>

        <div className="relative z-10 mt-10 md:mt-0">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 text-white/90 text-xs font-medium mb-4">
            <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
            {lang === "fr" ? "Fintech Camerounaise · 2026" : "Cameroonian Fintech · 2026"}
          </div>
          <h1 className="font-display text-3xl md:text-4xl font-bold leading-tight">
            {t("auth.welcome")}
          </h1>
          <p className="text-white/80 mt-3 max-w-md text-sm leading-relaxed">
            {lang === "fr"
              ? "Gérez FCFA, EUR, USD, BTC et USDT dans un seul portefeuille sécurisé. Mobile Money, virement bancaire et crypto — tout en un."
              : "Manage FCFA, EUR, USD, BTC and USDT in one secure wallet. Mobile Money, bank transfers and crypto — all in one."}
          </p>

          <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-md">
            {[
              { icon: Send,      k: lang === "fr" ? "Mobile Money" : "Mobile Money", sub: "MTN · Orange" },
              { icon: Building2, k: lang === "fr" ? "Virement SEPA" : "SEPA Transfer", sub: "EUR · USD" },
              { icon: Wallet,    k: "Crypto", sub: "BTC · USDT" },
              { icon: Globe2,    k: lang === "fr" ? "International" : "International", sub: "EUR → FCFA" },
              { icon: Shield,    k: "KYC", sub: lang === "fr" ? "< 24h" : "< 24h" },
              { icon: Lock,      k: lang === "fr" ? "Sécurité" : "Security", sub: "OTP · PIN" },
            ].map(({ icon: Icon, k, sub }) => (
              <div key={k} className="bg-white/10 backdrop-blur-sm rounded-xl p-3 flex flex-col items-start gap-1.5">
                <Icon size={18} className="text-white/90" />
                <span className="text-xs font-semibold leading-none">{k}</span>
                <span className="text-[10px] text-white/60 leading-none">{sub}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 mt-6">
          <p className="text-xs text-white/60">© 2026 Kobo · Cameroun · koboonline.com</p>
        </div>
      </div>

      <div className="md:w-1/2 flex flex-col p-6 md:p-14">
        <div className="flex justify-end gap-1">
          <button onClick={toggleLang} data-testid="auth-lang-toggle" className="h-9 px-3 rounded-md hover:bg-secondary flex items-center gap-1 text-xs font-semibold uppercase transition-base">
            <Languages size={14} /> {lang}
          </button>
          <button onClick={toggle} data-testid="auth-theme-toggle" className="h-9 w-9 rounded-md hover:bg-secondary flex items-center justify-center transition-base" aria-label="toggle theme">
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>

        <div className="flex-1 flex flex-col justify-center max-w-md w-full mx-auto">
          <div className="flex items-center justify-center mb-6">
            <div className="inline-flex rounded-lg bg-secondary p-1">
              <button
                type="button"
                onClick={() => navigate("/login")}
                className={[
                  "px-4 py-2 text-sm font-semibold rounded-md transition-base",
                  mode === "login" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
                data-testid="auth-tab-login"
              >
                {lang === "fr" ? "Connexion" : "Sign in"}
              </button>
              <button
                type="button"
                onClick={() => navigate("/signup")}
                className={[
                  "px-4 py-2 text-sm font-semibold rounded-md transition-base",
                  mode === "signup" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
                data-testid="auth-tab-signup"
              >
                {lang === "fr" ? "Inscription" : "Sign up"}
              </button>
            </div>
          </div>

          {recoverMode ? (
            <form onSubmit={handleRecover} className="space-y-5 slide-up-enter">
              <div>
                <h2 className="font-display text-2xl font-bold">
                  {lang === "fr" ? "Accès de secours" : "Emergency access"}
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {lang === "fr" ? "Utilisez un code de secours pour accéder à votre compte." : "Use a recovery code to access your account."}
                </p>
              </div>
              <div>
                <Label className="text-sm">{t("auth.emailLabel")}</Label>
                <Input
                  type="email"
                  placeholder={t("auth.emailPlaceholder")}
                  value={recoverEmail}
                  onChange={(e) => setRecoverEmail(e.target.value)}
                  className="mt-1.5 rounded-md"
                  autoComplete="email"
                />
              </div>
              <div>
                <Label className="text-sm">{lang === "fr" ? "Code de secours" : "Recovery code"}</Label>
                <Input
                  placeholder="KOBO-XXXX-XXXX"
                  value={recoverCode}
                  onChange={(e) => setRecoverCode(e.target.value.toUpperCase())}
                  className="mt-1.5 rounded-md font-mono tracking-widest"
                  autoComplete="off"
                />
              </div>
              <Button
                type="submit"
                disabled={recoverLoading}
                className="w-full bg-primary hover:bg-primary/90 rounded-md h-11 text-primary-foreground"
              >
                {recoverLoading ? (lang === "fr" ? "Vérification…" : "Verifying…") : (lang === "fr" ? "Accéder au compte" : "Access account")}
                {!recoverLoading && <ArrowRight size={16} className="ml-1" />}
              </Button>
              <button
                type="button"
                onClick={() => setRecoverMode(false)}
                className="w-full text-sm text-muted-foreground hover:text-foreground text-center transition-colors"
              >
                ← {lang === "fr" ? "Retour à la connexion" : "Back to sign in"}
              </button>
            </form>
          ) : null}

          {!recoverMode && step === "email" && (
            <form onSubmit={handleSendOtp} className="space-y-5 slide-up-enter" data-testid="auth-phone-form">
              <div>
                <h2 className="font-display text-2xl font-bold">
                  {mode === "signup"
                    ? (lang === "fr" ? "Créer un compte" : "Create an account")
                    : (lang === "fr" ? "Se connecter" : "Sign in")}
                </h2>
                <p className="text-sm text-muted-foreground mt-1">{t("auth.subtitle")}</p>
              </div>
              <div>
                <Label className="text-sm">{t("auth.emailLabel")}</Label>
                <Input
                  type="email"
                  data-testid="auth-phone-input"
                  placeholder={t("auth.emailPlaceholder")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1.5 rounded-md"
                  autoComplete="email"
                />
              </div>
              <Button
                type="submit"
                data-testid="auth-send-otp-btn"
                className="w-full bg-primary hover:bg-primary/90 rounded-md h-11 text-primary-foreground"
              >
                {t("auth.sendOtp")} <ArrowRight size={16} className="ml-1" />
              </Button>
              {mode === "login" && (
                <button
                  type="button"
                  onClick={() => setRecoverMode(true)}
                  className="w-full text-xs text-muted-foreground hover:text-foreground text-center transition-colors"
                >
                  {lang === "fr" ? "Accès de secours (codes de récupération)" : "Emergency access (recovery codes)"}
                </button>
              )}
            </form>
          )}

          {!recoverMode && step === "otp" && (
            <div className="space-y-6 slide-up-enter" data-testid="auth-otp-form">
              <div>
                <h2 className="font-display text-2xl font-bold">{t("auth.otpTitle")}</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {t("auth.otpSubtitle")}{" "}
                  <span className="font-medium text-foreground">{email}</span>
                </p>
              </div>
              <PinInput length={6} onComplete={handleVerifyOtp} onChange={setOtp} testId="auth-otp" />
              <p className="text-xs text-center text-muted-foreground">{t("auth.hint")}</p>
              <div className="flex items-center justify-between gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => setStep("email")}
                  className="text-muted-foreground hover:text-foreground transition-base"
                  data-testid="auth-otp-back"
                >
                  {t("common.back")}
                </button>
                <button
                  type="button"
                  onClick={handleResendOtp}
                  className="text-primary font-medium hover:underline"
                  data-testid="auth-otp-resend"
                >
                  {t("auth.resend")}
                </button>
              </div>
              <p className="text-xs text-center text-muted-foreground">
                {lang === "fr"
                  ? "La vérification est automatique dès que tu saisis les 6 chiffres."
                  : "Verification is automatic once you enter the 6 digits."}
              </p>
            </div>
          )}

          {!recoverMode && step === "blocked" && (
            <div className="space-y-6 slide-up-enter">
              {/* Bandeau alerte */}
              <div className="flex items-center gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                <AlertTriangle size={20} className="text-destructive shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-destructive">
                    {lang === "fr" ? "Compte suspendu" : "Account suspended"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {lang === "fr"
                      ? "Votre accès a été temporairement restreint par notre équipe de sécurité."
                      : "Your access has been temporarily restricted by our security team."}
                  </p>
                </div>
              </div>

              {!appealRef ? (
                <form onSubmit={handleAppeal} className="space-y-4">
                  <div>
                    <h2 className="font-display text-xl font-bold">
                      {lang === "fr" ? "Contester la suspension" : "Appeal suspension"}
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      {lang === "fr"
                        ? "Expliquez votre situation. Notre équipe examinera votre demande sous 24–48h."
                        : "Explain your situation. Our team will review your request within 24–48h."}
                    </p>
                  </div>

                  <div className="p-3 rounded-md bg-secondary/60 border border-border text-xs text-muted-foreground font-mono">
                    {email}
                  </div>

                  <div>
                    <Label className="text-sm">
                      {lang === "fr" ? "Votre message" : "Your message"}
                    </Label>
                    <textarea
                      value={appealMsg}
                      onChange={(e) => setAppealMsg(e.target.value)}
                      rows={5}
                      placeholder={lang === "fr"
                        ? "Expliquez pourquoi vous pensez que votre compte a été suspendu par erreur…"
                        : "Explain why you believe your account was suspended by mistake…"}
                      className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={appealLoading || appealMsg.trim().length < 10}
                    className="w-full bg-primary hover:bg-primary/90 rounded-md h-11 text-primary-foreground"
                  >
                    {appealLoading
                      ? (lang === "fr" ? "Envoi en cours…" : "Sending…")
                      : (lang === "fr" ? "Envoyer ma demande" : "Submit appeal")}
                    {!appealLoading && <Send size={15} className="ml-2" />}
                  </Button>

                  <button
                    type="button"
                    onClick={() => { setStep("email"); setOtp(""); setOtpVerified(false); }}
                    className="w-full text-xs text-muted-foreground hover:text-foreground text-center transition-colors"
                  >
                    ← {lang === "fr" ? "Retour" : "Back"}
                  </button>
                </form>
              ) : (
                <div className="space-y-4 text-center">
                  <div className="flex justify-center">
                    <div className="h-14 w-14 rounded-full bg-green-500/10 flex items-center justify-center">
                      <CheckCircle2 size={28} className="text-green-500" />
                    </div>
                  </div>
                  <div>
                    <h2 className="font-display text-xl font-bold">
                      {lang === "fr" ? "Demande envoyée" : "Appeal submitted"}
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      {lang === "fr"
                        ? "Notre équipe examinera votre cas sous 24–48h ouvrées."
                        : "Our team will review your case within 24–48 business hours."}
                    </p>
                  </div>
                  <div className="p-3 rounded-md bg-secondary border border-border">
                    <p className="text-xs text-muted-foreground">
                      {lang === "fr" ? "Référence de votre demande" : "Your reference"}
                    </p>
                    <p className="font-mono text-sm font-bold text-foreground mt-0.5">{appealRef}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {lang === "fr"
                      ? "Conservez cette référence pour le suivi. Réponse par email à "
                      : "Keep this reference for tracking. Reply by email to "}
                    <span className="font-medium text-foreground">support@koboonline.com</span>
                  </p>
                </div>
              )}
            </div>
          )}

          {!recoverMode && step === "register" && (
            <form onSubmit={handleRegister} className="space-y-4 slide-up-enter" data-testid="auth-register-form">
              <div>
                <h2 className="font-display text-2xl font-bold">{t("auth.registerTitle")}</h2>
                <p className="text-sm text-muted-foreground mt-1">{email}</p>
              </div>
              <div>
                <Label>{t("auth.fullName")}</Label>
                <Input
                  data-testid="register-name"
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                  className="mt-1.5 rounded-md"
                  placeholder="Aïcha Mbongo"
                />
              </div>
              <div>
                <Label>{t("auth.dob")}</Label>
                <Input
                  type="date"
                  data-testid="register-dob"
                  value={form.dob}
                  onChange={(e) => setForm({ ...form, dob: e.target.value })}
                  className="mt-1.5 rounded-md"
                />
              </div>
              <div>
                <Label>{t("auth.country")}</Label>
                <div className="mt-1.5">
                  <CountrySelector
                    value={form.country}
                    onChange={(c) => setForm({ ...form, country: c })}
                    testId="register-country"
                  />
                </div>
              </div>
              <div>
                <Label>{lang === "fr" ? "Numéro de téléphone" : "Phone number"}</Label>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="h-10 px-3 rounded-md border border-input bg-muted text-sm flex items-center shrink-0 text-muted-foreground">
                    {COUNTRIES.find((c) => c.code === form.country)?.flag} {COUNTRIES.find((c) => c.code === form.country)?.dial || "+?"}
                  </span>
                  <Input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="rounded-md"
                    placeholder="677 123 456"
                  />
                </div>
              </div>
              <Button
                type="submit"
                data-testid="register-submit"
                className="w-full bg-primary hover:bg-primary/90 rounded-md h-11 text-primary-foreground"
              >
                {t("auth.createAccount")}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
