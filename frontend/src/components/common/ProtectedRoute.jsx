import React, { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { Button } from "../ui/button";
import { PinInput } from "./PinInput";
import { Lock, LogOut, ShieldCheck, Loader2, Mail, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { confirmPinReset, setPin, startPinReset } from "../../api/user";

function pinErrorMessage(err, fallback) {
  const detail = err?.response?.data?.detail;
  if (detail === "device_not_recognized") {
    return "Ce navigateur n'est pas reconnu. Reconnectez-vous avec le code reçu par email.";
  }
  if (detail === "session_not_recognized") {
    return "Cette session n'est plus reconnue. Reconnectez-vous avec le code reçu par email.";
  }
  if (detail === "account_blocked") {
    return "Ce compte est bloqué. Contactez le support Kobo.";
  }
  if (detail && typeof detail === "object") return detail.message || detail.msg || fallback;
  return detail || fallback;
}

function pinRetrySeconds(err) {
  const detail = err?.response?.data?.detail;
  if (!detail || typeof detail !== "object") return 0;
  const seconds = Number(detail.retry_after_seconds || 0);
  return Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : 0;
}

function formatCountdown(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  if (minutes <= 0) return `${rest}s`;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function SessionShell({ icon, title, subtitle, children, onLogout, logoutLabel = "Se connecter avec un autre compte" }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-xl space-y-5">
        <div className="flex items-start gap-3">
          <div className="h-11 w-11 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
            {icon}
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">{title}</h1>
            <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
          </div>
        </div>
        {children}
        <button
          type="button"
          onClick={onLogout}
          className="w-full text-sm text-muted-foreground hover:text-foreground flex items-center justify-center gap-2"
        >
          <LogOut size={15} /> {logoutLabel}
        </button>
      </div>
    </div>
  );
}

function LockedSession() {
  const { unlock, logout, user, updateUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(0);
  const [resetOpen, setResetOpen] = useState(false);
  const [pinLockedUntil, setPinLockedUntil] = useState(0);
  const [lockRemaining, setLockRemaining] = useState(0);
  const isPinLocked = lockRemaining > 0;

  useEffect(() => {
    if (!pinLockedUntil) {
      setLockRemaining(0);
      return undefined;
    }

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((pinLockedUntil - Date.now()) / 1000));
      setLockRemaining(remaining);
      if (remaining <= 0) {
        setPinLockedUntil(0);
        setKey((v) => v + 1);
      }
    };

    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [pinLockedUntil]);

  const onComplete = async (pin) => {
    if (busy || isPinLocked) return;
    setBusy(true);
    try {
      await unlock(pin);
      toast.success("Session déverrouillée");
    } catch (err) {
      const retrySeconds = pinRetrySeconds(err);
      if (retrySeconds > 0) {
        setPinLockedUntil(Date.now() + retrySeconds * 1000);
      }
      toast.error(pinErrorMessage(err, "Code PIN incorrect"));
      setKey((v) => v + 1);
    } finally {
      setBusy(false);
    }
  };

  if (resetOpen) {
    return <ForgotPinReset onBack={() => setResetOpen(false)} onDone={() => { updateUser({ hasPin: true }); setResetOpen(false); }} />;
  }

  return (
    <SessionShell
      icon={<Lock size={21} />}
      title="Session en veille"
      subtitle={`Entrez votre PIN pour reprendre votre espace${user?.fullName ? `, ${user.fullName}` : ""}.`}
      onLogout={logout}
    >
      <div className="py-3">
        {busy ? (
          <div className="flex justify-center py-4"><Loader2 size={28} className="animate-spin text-primary" /></div>
        ) : isPinLocked ? (
          <div className="space-y-4">
            <PinInput key={`locked-${key}`} length={6} onComplete={onComplete} testId="session-unlock-pin" disabled autoFocus={false} />
            <div className="rounded-lg border border-amber-300/50 bg-amber-500/10 px-4 py-3 text-center">
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">PIN temporairement bloqué</p>
              <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">
                Nouvelle tentative possible dans {formatCountdown(lockRemaining)}.
              </p>
            </div>
          </div>
        ) : (
          <PinInput key={key} length={6} onComplete={onComplete} testId="session-unlock-pin" />
        )}
      </div>
      <p className="text-xs text-muted-foreground text-center">
        Ce navigateur est reconnu. Si la session a été révoquée ou expirée, une connexion complète sera demandée.
      </p>
      <Button type="button" variant="ghost" className="w-full" onClick={() => setResetOpen(true)}>
        PIN oublié ?
      </Button>
    </SessionShell>
  );
}

function ForgotPinReset({ onBack, onDone }) {
  const { unlock } = useAuth();
  const [step, setStep] = useState("start");
  const [challengeId, setChallengeId] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPin, setNewPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(0);

  const start = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const data = await startPinReset();
      setChallengeId(data.challenge_id);
      setMaskedEmail(data.masked_email || "");
      setStep("otp");
      toast.success("Code envoyé par email");
      if (data.dev_code) toast.info(`Code test : ${data.dev_code}`);
    } catch (err) {
      toast.error(pinErrorMessage(err, "Impossible d'envoyer le code"));
    } finally {
      setBusy(false);
    }
  };

  const onOtpComplete = (code) => {
    setOtp(code);
    setStep("new");
    setKey((v) => v + 1);
  };

  const onNewPinComplete = (pin) => {
    setNewPin(pin);
    setStep("confirm");
    setKey((v) => v + 1);
  };

  const onConfirmPinComplete = async (pin) => {
    if (busy) return;
    if (pin !== newPin) {
      toast.error("Les deux PIN ne correspondent pas");
      setStep("new");
      setNewPin("");
      setKey((v) => v + 1);
      return;
    }
    setBusy(true);
    try {
      await confirmPinReset({ challenge_id: challengeId, code: otp, new_pin: newPin });
      await unlock(newPin);
      toast.success("PIN réinitialisé");
      onDone();
    } catch (err) {
      toast.error(pinErrorMessage(err, "Réinitialisation impossible"));
      if (err?.response?.status === 400) setStep("otp");
      setKey((v) => v + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SessionShell
      icon={<Mail size={21} />}
      title="Réinitialiser le PIN"
      subtitle="Un code de vérification sera envoyé sur l'email de votre compte."
      onLogout={onBack}
      logoutLabel="Retour au PIN"
    >
      <button type="button" onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
        <ArrowLeft size={14} /> Retour au PIN
      </button>

      {step === "start" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-300/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
            Après vérification email, vous créerez un nouveau PIN. Un email de sécurité sera envoyé.
          </div>
          <Button type="button" className="w-full" onClick={start} disabled={busy}>
            {busy ? <Loader2 size={16} className="animate-spin mr-2" /> : <Mail size={16} className="mr-2" />}
            Envoyer le code
          </Button>
        </div>
      )}

      {step === "otp" && (
        <div className="py-3">
          <p className="text-sm text-muted-foreground text-center mb-4">
            Code envoyé à {maskedEmail || "votre email"}.
          </p>
          {busy ? <div className="flex justify-center py-4"><Loader2 size={28} className="animate-spin text-primary" /></div> : (
            <PinInput key={`otp-${key}`} length={6} onComplete={onOtpComplete} testId="pin-reset-otp" />
          )}
          <Button type="button" variant="ghost" className="w-full mt-4" onClick={start} disabled={busy}>
            Renvoyer le code
          </Button>
        </div>
      )}

      {step === "new" && (
        <div className="py-3">
          <p className="text-sm font-semibold text-center mb-4">Nouveau PIN</p>
          <PinInput key={`new-${key}`} length={6} onComplete={onNewPinComplete} testId="pin-reset-new" />
        </div>
      )}

      {step === "confirm" && (
        <div className="py-3">
          <p className="text-sm font-semibold text-center mb-4">Confirmez le nouveau PIN</p>
          {busy ? <div className="flex justify-center py-4"><Loader2 size={28} className="animate-spin text-primary" /></div> : (
            <PinInput key={`confirm-${key}`} length={6} onComplete={onConfirmPinComplete} testId="pin-reset-confirm" />
          )}
          <Button type="button" variant="ghost" className="w-full mt-4" onClick={() => { setStep("new"); setNewPin(""); }}>
            Recommencer
          </Button>
        </div>
      )}
    </SessionShell>
  );
}

function RequirePinSetup() {
  const { updateUser, logout } = useAuth();
  const [step, setStep] = useState("new");
  const [firstPin, setFirstPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(0);

  const onNewComplete = (pin) => {
    setFirstPin(pin);
    setStep("confirm");
    setKey((v) => v + 1);
  };

  const onConfirmComplete = async (pin) => {
    if (busy) return;
    if (pin !== firstPin) {
      toast.error("Les deux PIN ne correspondent pas");
      setStep("new");
      setFirstPin("");
      setKey((v) => v + 1);
      return;
    }
    setBusy(true);
    try {
      await setPin({ new_pin: firstPin });
      updateUser({ hasPin: true });
      toast.success("PIN défini");
    } catch (err) {
      toast.error(pinErrorMessage(err, "Impossible de définir le PIN"));
      setStep("new");
      setFirstPin("");
      setKey((v) => v + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SessionShell
      icon={<ShieldCheck size={21} />}
      title="Créez votre PIN Kobo"
      subtitle="Le PIN protège vos reprises de session et vos opérations sensibles."
      onLogout={logout}
    >
      <div className="rounded-lg border border-primary/15 bg-primary/5 p-3 text-sm text-muted-foreground">
        Vous êtes connecté. Avant d'utiliser votre espace, créez un PIN à 6 chiffres.
      </div>
      <div className="py-3">
        {busy ? (
          <div className="flex justify-center py-4"><Loader2 size={28} className="animate-spin text-primary" /></div>
        ) : step === "new" ? (
          <>
            <p className="text-sm font-semibold text-center mb-4">Nouveau PIN</p>
            <PinInput key={`new-${key}`} length={6} onComplete={onNewComplete} testId="setup-pin-new" />
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-center mb-4">Confirmez le PIN</p>
            <PinInput key={`confirm-${key}`} length={6} onComplete={onConfirmComplete} testId="setup-pin-confirm" />
            <Button type="button" variant="ghost" className="w-full mt-4" onClick={() => { setStep("new"); setFirstPin(""); }}>
              Recommencer
            </Button>
          </>
        )}
      </div>
    </SessionShell>
  );
}

export const ProtectedRoute = ({ children }) => {
  const { isAuthed, user, locked } = useAuth();
  const location = useLocation();
  if (!isAuthed) return <Navigate to="/login" replace state={{ from: location }} />;
  if (locked) return <LockedSession />;
  if (user && !user.hasPin) return <RequirePinSetup />;
  return children;
};
