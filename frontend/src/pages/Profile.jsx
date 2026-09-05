import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BadgeCheck, LogOut, ShieldCheck, ChevronRight,
  Moon, Sun, Languages, Trash2, Loader2, Monitor, Camera,
  CheckCircle2, XCircle, Mail, Lock, Smartphone, KeyRound, Copy, RefreshCw, AlertTriangle,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "../components/ui/dialog";
import { PinInput } from "../components/common/PinInput";
import { useI18n } from "../context/I18nContext";
import { useTheme } from "../context/ThemeContext";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import { checkUsername, getSessions, revokeSession, getMe, patchMe, setPin, uploadAvatar, requestSecurityChallenge, verifySecurityChallenge, getRecoveryCodesStatus, generateRecoveryCodes } from "../api/user";
import { formatDate } from "../lib/format";

// ─── PIN change dialog ────────────────────────────────────────────────────────

function PinDialog({ open, onClose, hasPin }) {
  const [step, setStep] = useState("current");
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [loading, setLoading] = useState(false);
  const submittedRef = useRef(false);

  useEffect(() => {
    if (open) {
      setStep(hasPin ? "current" : "new");
      setCurrentPin("");
      setNewPin("");
      setLoading(false);
      submittedRef.current = false;
    }
  }, [open, hasPin]);

  const handleCurrentComplete = (code) => {
    setCurrentPin(code);
    setStep("new");
  };

  const handleNewComplete = (code) => {
    setNewPin(code);
    setStep("confirm");
  };

  const handleConfirmComplete = async (code) => {
    if (loading || submittedRef.current) return;
    if (code !== newPin) {
      toast.error("Les codes PIN ne correspondent pas");
      setStep("new");
      setNewPin("");
      return;
    }
    submittedRef.current = true;
    setLoading(true);
    try {
      await setPin({ current_pin: hasPin ? currentPin : undefined, new_pin: newPin });
      toast.success(hasPin ? "PIN modifié avec succès" : "PIN défini avec succès");
      onClose(true);
    } catch (err) {
      const detail = err?.response?.data?.detail || "";
      if (detail === "Incorrect current PIN") {
        toast.error("Code PIN actuel incorrect");
        setStep("current");
        setCurrentPin("");
        submittedRef.current = false;
      } else if (detail === "current_pin required to change existing PIN") {
        toast.error("Entre d'abord ton code PIN actuel");
        setStep("current");
        setCurrentPin("");
        submittedRef.current = false;
      } else {
        toast.error(detail || "Erreur lors de la modification du PIN");
        submittedRef.current = false;
      }
    } finally {
      setLoading(false);
    }
  };

  const stepLabel = { current: "Code PIN actuel", new: "Nouveau code PIN (6 chiffres)", confirm: "Confirmez le nouveau PIN" };

  return (
    <Dialog open={open} onOpenChange={() => !loading && onClose(false)}>
      <DialogContent className="sm:max-w-sm rounded-xl">
        <DialogHeader>
          <DialogTitle className="font-display">
            {hasPin ? "Changer le code PIN" : "Définir un code PIN"}
          </DialogTitle>
          <DialogDescription>{stepLabel[step]}</DialogDescription>
        </DialogHeader>
        <div className="py-6">
          {loading ? (
            <div className="flex justify-center"><Loader2 size={28} className="animate-spin text-primary" /></div>
          ) : step === "current" ? (
            <PinInput
              key="current"
              length={6}
              onChange={setCurrentPin}
              onComplete={handleCurrentComplete}
              testId="pin-current"
            />
          ) : step === "new" ? (
            <PinInput
              key="new"
              length={6}
              onChange={setNewPin}
              onComplete={handleNewComplete}
              testId="pin-new"
            />
          ) : (
            <PinInput key="confirm" length={6} onComplete={handleConfirmComplete} testId="pin-confirm" />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Sessions actives dialog ──────────────────────────────────────────────────

function SessionsDialog({ open, onClose }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const currentSessionId = (() => { try { return localStorage.getItem("kobo:session_id"); } catch { return null; } })();

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getSessions()
      .then(setSessions)
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, [open]);

  const handleRevoke = async (sessionId) => {
    try {
      await revokeSession(sessionId);
      setSessions((s) => s.filter((x) => x.id !== sessionId));
      toast.success("Session déconnectée");
    } catch {
      toast.error("Impossible de déconnecter");
    }
  };

  const formatLastSeen = (iso) => {
    const d = new Date(iso);
    const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
    if (diffMin < 1) return "À l'instant";
    if (diffMin < 60) return `Il y a ${diffMin} min`;
    if (diffMin < 1440) return `Il y a ${Math.floor(diffMin / 60)}h`;
    return formatDate(iso);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md rounded-xl">
        <DialogHeader>
          <DialogTitle className="font-display">Sessions actives</DialogTitle>
          <DialogDescription>Appareils connectés à votre compte. Déconnectez ceux que vous ne reconnaissez pas.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-80 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 size={20} className="animate-spin text-muted-foreground" />
            </div>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-center text-muted-foreground py-8">Aucune session active</p>
          ) : (
            sessions.map((s) => {
              const isCurrent = s.id === currentSessionId;
              return (
                <div key={s.id} className={`flex items-center gap-3 p-3 rounded-lg ${isCurrent ? "bg-primary/5 border border-primary/20" : "bg-secondary"}`}>
                  <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${isCurrent ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                    <Monitor size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{s.device_name || "Navigateur"}</p>
                      {isCurrent && (
                        <span className="text-xs text-primary font-medium shrink-0">• Session actuelle</span>
                      )}
                    </div>
                    {s.ip_address && (
                      <p className="text-xs text-muted-foreground font-mono">{s.ip_address}</p>
                    )}
                    <p className="text-xs text-muted-foreground">{formatLastSeen(s.last_seen_at)}</p>
                  </div>
                  {!isCurrent && (
                    <button
                      type="button"
                      onClick={() => handleRevoke(s.id)}
                      className="h-8 w-8 rounded-md flex items-center justify-center text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                      title="Déconnecter"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Profile() {
  const { t, lang, toggleLang } = useI18n();
  const { theme, toggle } = useTheme();
  const { user, updateUser, logout } = useAuth();
  const navigate = useNavigate();
  const avatarInputRef = useRef(null);

  const [form, setForm] = useState({ fullName: "", username: "", phone: "" });
  const [savedUsername, setSavedUsername] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [hasPin, setHasPin] = useState(false);
  const [emailFlow, setEmailFlow] = useState("idle"); // idle | requesting | code | email_input | saving | done
  const [challengeId, setChallengeId] = useState("");
  const [otpCode, setOtpCode] = useState(["", "", "", "", "", ""]);
  const [newEmail, setNewEmail] = useState("");
  const [emailFlowError, setEmailFlowError] = useState("");
  const otpRefs = useRef([]);
  // null | "checking" | "available" | "taken" | "invalid" | "same"
  const [usernameStatus, setUsernameStatus] = useState(null);
  const [recoveryPhoneOpen, setRecoveryPhoneOpen] = useState(false);
  const [recoveryPhoneInput, setRecoveryPhoneInput] = useState("");
  const [recoveryPhoneSaving, setRecoveryPhoneSaving] = useState(false);
  const [recoveryCodesOpen, setRecoveryCodesOpen] = useState(false);
  const [recoveryCodesCount, setRecoveryCodesCount] = useState(null); // null = not loaded
  const [recoveryCodesGenerating, setRecoveryCodesGenerating] = useState(false);
  const [recoveryCodesResult, setRecoveryCodesResult] = useState(null); // { codes: string[] } | null
  const [copiedCode, setCopiedCode] = useState(null);

  useEffect(() => {
    getMe()
      .then((data) => {
        updateUser(data);
        const uname = data.username || "";
        setForm({ fullName: data.fullName || "", username: uname, phone: data.profilePhone || "" });
        setSavedUsername(uname);
        setHasPin(!!data.hasPin);
        if (data.recoveryPhone) setRecoveryPhoneInput(data.recoveryPhone);
      })
      .catch(() => {
        const uname = user?.username || "";
        setForm({ fullName: user?.fullName || "", username: uname, phone: user?.profilePhone || "" });
        setSavedUsername(uname);
        setHasPin(!!user?.hasPin);
        if (user?.recoveryPhone) setRecoveryPhoneInput(user.recoveryPhone);
      });
  }, []); // eslint-disable-line

  // Debounced username availability check
  useEffect(() => {
    const uname = form.username.trim();
    if (!uname) { setUsernameStatus(null); return; }
    if (uname === savedUsername) { setUsernameStatus("same"); return; }
    if (uname.length < 3 || !/^[a-z0-9_]+$/.test(uname)) { setUsernameStatus("invalid"); return; }
    setUsernameStatus("checking");
    const timer = setTimeout(() => {
      checkUsername(uname)
        .then(({ available }) => setUsernameStatus(available ? "available" : "taken"))
        .catch(() => setUsernameStatus(null));
    }, 500);
    return () => clearTimeout(timer);
  }, [form.username, savedUsername]);

  const handleSave = async () => {
    const trimmed = form.fullName.trim();
    if (trimmed.length < 2) { toast.error("Le nom doit faire au moins 2 caractères"); return; }
    const uname = form.username.trim();
    if (uname && usernameStatus === "taken") { toast.error("Ce nom d'utilisateur est déjà pris"); return; }
    if (uname && usernameStatus === "invalid") { toast.error("Username invalide"); return; }
    setSaving(true);
    try {
      const patch = { fullName: trimmed };
      if (uname) patch.username = uname;
      if (form.phone.trim()) patch.phone = form.phone.trim();
      const updated = await patchMe(patch);
      updateUser(updated);
      setSavedUsername(updated.username || "");
      setUsernameStatus(updated.username ? "same" : null);
      toast.success("Profil enregistré");
    } catch (err) {
      const detail = err?.response?.data?.detail || "";
      if (err?.response?.status === 409) setUsernameStatus("taken");
      toast.error(detail || "Impossible d'enregistrer");
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const { avatarDataUrl } = await uploadAvatar(file);
      updateUser({ avatarDataUrl });
      toast.success("Photo de profil mise à jour");
    } catch (err) {
      const detail = err?.response?.data?.detail || "";
      toast.error(detail || "Impossible de mettre à jour la photo");
    } finally {
      setUploadingAvatar(false);
      e.target.value = "";
    }
  };

  const handleEmailFlowStart = async () => {
    setEmailFlowError("");
    setOtpCode(["", "", "", "", "", ""]);
    setNewEmail("");
    setEmailFlow("requesting");
    try {
      const res = await requestSecurityChallenge();
      setChallengeId(res.challenge_id);
      setEmailFlow("code");
      setTimeout(() => otpRefs.current[0]?.focus(), 200);
    } catch {
      setEmailFlow("idle");
    }
  };

  const handleOtpInput = (idx, val) => {
    if (!/^[0-9]?$/.test(val)) return;
    const next = [...otpCode];
    next[idx] = val;
    setOtpCode(next);
    setEmailFlowError("");
    if (val && idx < 5) setTimeout(() => otpRefs.current[idx + 1]?.focus(), 10);
    if (next.every((d) => d !== "") && next.join("").length === 6) {
      handleOtpSubmit(next.join(""));
    }
  };

  const handleOtpKeyDown = (idx, e) => {
    if (e.key === "Backspace" && !otpCode[idx] && idx > 0) {
      otpRefs.current[idx - 1]?.focus();
    }
  };

  const handleOtpSubmit = async (code) => {
    if (!challengeId) {
      setEmailFlowError("Redémarre la vérification");
      setEmailFlow("code");
      return;
    }
    setEmailFlowError("");
    setEmailFlow("requesting");
    try {
      await verifySecurityChallenge(challengeId, code || otpCode.join(""));
      setChallengeId("");
      setEmailFlow("email_input");
      setTimeout(() => document.getElementById("new-email-input")?.focus(), 200);
    } catch (err) {
      const msg = err?.response?.data?.detail || "Code incorrect";
      setEmailFlowError(msg);
      setOtpCode(["", "", "", "", "", ""]);
      setEmailFlow("code");
      setTimeout(() => otpRefs.current[0]?.focus(), 100);
    }
  };

  const handleEmailSave = async () => {
    if (!newEmail.trim() || !newEmail.includes("@")) {
      setEmailFlowError("Adresse email invalide");
      return;
    }
    setEmailFlow("saving");
    try {
      const updated = await patchMe({ email: newEmail.trim() });
      updateUser(updated);
      setEmailFlow("done");
      setTimeout(() => setEmailFlow("idle"), 2500);
    } catch (err) {
      setEmailFlowError(err?.response?.data?.detail || "Impossible d'enregistrer");
      setEmailFlow("email_input");
    }
  };

  const handleRecoveryPhoneSave = async () => {
    const phone = recoveryPhoneInput.trim();
    if (!phone) { toast.error("Entrez un numéro de téléphone"); return; }
    setRecoveryPhoneSaving(true);
    try {
      const updated = await patchMe({ recoveryPhone: phone });
      updateUser(updated);
      setRecoveryPhoneOpen(false);
      toast.success("Téléphone de récupération enregistré");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Impossible d'enregistrer");
    } finally {
      setRecoveryPhoneSaving(false);
    }
  };

  const handleToggleRecoveryCodes = async () => {
    const opening = !recoveryCodesOpen;
    setRecoveryCodesOpen(opening);
    if (opening && recoveryCodesCount === null) {
      try {
        const status = await getRecoveryCodesStatus();
        setRecoveryCodesCount(status.count);
      } catch { setRecoveryCodesCount(0); }
    }
  };

  const handleGenerateCodes = async () => {
    if (recoveryCodesCount > 0) {
      if (!window.confirm("Générer de nouveaux codes invalidera les codes existants. Continuer ?")) return;
    }
    setRecoveryCodesGenerating(true);
    setRecoveryCodesResult(null);
    try {
      const result = await generateRecoveryCodes();
      setRecoveryCodesResult(result);
      setRecoveryCodesCount(5);
      toast.success("5 codes de secours générés");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Erreur lors de la génération");
    } finally {
      setRecoveryCodesGenerating(false);
    }
  };

  const handleCopyCode = (code) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    });
  };

  const handleCopyAllCodes = () => {
    if (!recoveryCodesResult?.codes) return;
    navigator.clipboard.writeText(recoveryCodesResult.codes.join("\n")).then(() => {
      toast.success("Tous les codes copiés");
    });
  };

  const initials = (user?.fullName || user?.email || "?")[0].toUpperCase();
  const avatarSrc = user?.avatarDataUrl;

  return (
    <div className="space-y-6 max-w-2xl mx-auto" data-testid="profile-page">
      <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">{t("profile.title")}</h1>

      {/* Avatar + identity */}
      <div className="rounded-xl bg-surface border border-border p-5 flex items-center gap-4">
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => avatarInputRef.current?.click()}
            disabled={uploadingAvatar}
            className="block h-16 w-16 rounded-full overflow-hidden border-2 border-border hover:border-primary transition-base focus:outline-none focus:ring-2 focus:ring-primary/30"
            title="Changer la photo"
          >
            {uploadingAvatar ? (
              <div className="h-full w-full bg-primary/10 flex items-center justify-center">
                <Loader2 size={20} className="animate-spin text-primary" />
              </div>
            ) : avatarSrc ? (
              <img src={avatarSrc} alt="avatar" className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full bg-primary/10 text-primary flex items-center justify-center text-2xl font-bold">
                {initials}
              </div>
            )}
          </button>
          <div className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-primary text-white flex items-center justify-center border-2 border-surface pointer-events-none">
            <Camera size={11} />
          </div>
          {user?.kycLevel >= 1 && (
            <div className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-success text-white flex items-center justify-center border-2 border-surface pointer-events-none">
              <BadgeCheck size={10} />
            </div>
          )}
          <input ref={avatarInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleAvatarChange} />
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="font-display text-lg font-bold truncate">{user?.fullName || user?.email || user?.phone}</h3>
          {user?.username && <p className="text-sm text-primary font-medium">@{user.username}</p>}
          <p className="text-sm text-muted-foreground truncate">{user?.email || user?.phone}</p>
          {user?.kycLevel >= 1 && (
            <span className="inline-flex items-center gap-1 mt-0.5 text-xs text-success font-medium">
              <ShieldCheck size={11} /> Vérifié · Niveau {user.kycLevel}
            </span>
          )}
        </div>
      </div>

      {/* Personal info */}
      <section>
        <p className="text-xs uppercase tracking-widest text-muted-foreground font-medium mb-3">{t("profile.personal")}</p>
        <div className="rounded-xl bg-surface border border-border p-5 space-y-4">
          <div>
            <Label>{t("auth.fullName")}</Label>
            <Input
              data-testid="profile-name"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              placeholder="Votre nom complet"
              className="rounded-md mt-1.5"
            />
          </div>
          <div>
            <Label>Nom d'utilisateur</Label>
            <div className="relative mt-1.5">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm select-none">@</span>
              <Input
                data-testid="profile-username"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })}
                placeholder="mon_pseudo"
                className={[
                  "rounded-md pl-7 pr-8",
                  usernameStatus === "available" ? "border-success focus-visible:ring-success/30" : "",
                  usernameStatus === "taken" || usernameStatus === "invalid" ? "border-destructive focus-visible:ring-destructive/30" : "",
                ].join(" ")}
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
                {usernameStatus === "checking" && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
                {usernameStatus === "available" && <CheckCircle2 size={14} className="text-success" />}
                {(usernameStatus === "taken" || usernameStatus === "invalid") && <XCircle size={14} className="text-destructive" />}
              </span>
            </div>
            <p className={[
              "text-xs mt-1",
              usernameStatus === "available" ? "text-success" :
              usernameStatus === "taken" ? "text-destructive" :
              usernameStatus === "invalid" ? "text-destructive" :
              "text-muted-foreground",
            ].join(" ")}>
              {usernameStatus === "available" && "Disponible !"}
              {usernameStatus === "taken" && "Ce nom est déjà utilisé"}
              {usernameStatus === "invalid" && "3-32 caractères, lettres/chiffres/underscore uniquement"}
              {(usernameStatus === null || usernameStatus === "same" || usernameStatus === "checking") && "3-32 caractères, lettres/chiffres/underscore. Unique."}
            </p>
          </div>
          <div>
            <Label>Identifiant de connexion</Label>
            <Input value={user?.loginId || user?.phone || ""} disabled className="rounded-md mt-1.5 bg-muted/50 text-muted-foreground" />
            <p className="text-xs text-muted-foreground mt-1">Non modifiable</p>
          </div>
          <div>
            <Label>Numéro de téléphone</Label>
            <Input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="+237 6XX XX XX XX"
              className="rounded-md mt-1.5"
              type="tel"
            />
          </div>
          <Button
            onClick={handleSave}
            disabled={saving}
            data-testid="profile-save"
            className="w-full bg-primary hover:bg-primary/90 rounded-md text-primary-foreground"
          >
            {saving && <Loader2 size={14} className="animate-spin mr-2" />}
            {t("common.save")}
          </Button>
        </div>
      </section>

      {/* Preferences */}
      <section>
        <p className="text-xs uppercase tracking-widest text-muted-foreground font-medium mb-3">Préférences</p>
        <div className="rounded-xl bg-surface border border-border overflow-hidden divide-y divide-border">
          <div className="flex items-center gap-3 p-4">
            <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Languages size={18} />
            </div>
            <div className="flex-1">
              <p className="font-medium text-sm">{t("profile.language")}</p>
              <p className="text-xs text-muted-foreground">{lang === "fr" ? "Français" : "English"}</p>
            </div>
            <Button variant="outline" onClick={toggleLang} className="rounded-md border-border">
              {lang === "fr" ? "EN" : "FR"}
            </Button>
          </div>
          <div className="flex items-center gap-3 p-4">
            <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </div>
            <div className="flex-1">
              <p className="font-medium text-sm">{t("profile.darkMode")}</p>
              <p className="text-xs text-muted-foreground">{theme === "dark" ? "Activé" : "Désactivé"}</p>
            </div>
            <Switch checked={theme === "dark"} onCheckedChange={toggle} />
          </div>
        </div>
      </section>

      {/* Security */}
      <section>
        <p className="text-xs uppercase tracking-widest text-muted-foreground font-medium mb-3">{t("profile.security")}</p>
        <div className="rounded-xl bg-surface border border-border overflow-hidden divide-y divide-border">
          <button
            type="button"
            data-testid="profile-change-pin"
            onClick={() => setPinOpen(true)}
            className="w-full flex items-center gap-3 p-4 hover:bg-secondary transition-base text-left"
          >
            <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <ShieldCheck size={18} />
            </div>
            <div className="flex-1">
              <p className="font-medium text-sm">{t("profile.changePin")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {hasPin ? "PIN défini — cliquez pour modifier" : "Aucun PIN — cliquez pour en définir un"}
              </p>
            </div>
            <ChevronRight size={16} className="text-muted-foreground" />
          </button>
          <button
            type="button"
            data-testid="profile-trusted-devices"
            onClick={() => setSessionsOpen(true)}
            className="w-full flex items-center gap-3 p-4 hover:bg-secondary transition-base text-left"
          >
            <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Monitor size={18} />
            </div>
            <div className="flex-1">
              <p className="font-medium text-sm">Sessions actives</p>
              <p className="text-xs text-muted-foreground mt-0.5">Voir et déconnecter des appareils</p>
            </div>
            <ChevronRight size={16} className="text-muted-foreground" />
          </button>

          {/* Email via security challenge */}
          <div className="overflow-hidden">
            <button
              type="button"
              onClick={emailFlow === "idle" ? handleEmailFlowStart : undefined}
              disabled={emailFlow === "requesting" || emailFlow === "saving"}
              className="w-full flex items-center gap-3 p-4 hover:bg-secondary transition-base text-left disabled:opacity-60"
            >
              <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 transition-colors ${emailFlow === "done" ? "bg-green-500/10 text-green-600" : "bg-primary/10 text-primary"}`}>
                {emailFlow === "requesting" || emailFlow === "saving"
                  ? <Loader2 size={18} className="animate-spin" />
                  : emailFlow === "done"
                    ? <CheckCircle2 size={18} />
                    : <Mail size={18} />
                }
              </div>
              <div className="flex-1">
                <p className="font-medium text-sm">Email de contact</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {emailFlow === "done"
                    ? "Email enregistré avec succès"
                    : user?.email
                      ? user.email
                      : "Ajouter un email de contact"
                  }
                </p>
              </div>
              {emailFlow === "idle" && <Lock size={14} className="text-muted-foreground" />}
            </button>

            {/* OTP input panel */}
            <div className={`transition-all duration-400 ease-in-out ${emailFlow === "code" || emailFlow === "requesting" ? "max-h-48 opacity-100" : "max-h-0 opacity-0 pointer-events-none"}`}
              style={{ overflow: "hidden" }}
            >
              <div className="px-4 pb-5 pt-2 border-t border-border bg-secondary/30">
                <div className="flex gap-2 justify-center my-4">
                  {otpCode.map((digit, idx) => (
                    <input
                      key={idx}
                      ref={(el) => (otpRefs.current[idx] = el)}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleOtpInput(idx, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                      className={`h-12 w-10 rounded-xl border-2 text-center text-lg font-bold outline-none transition-all duration-200 bg-background
                        ${digit ? "border-primary text-primary scale-105" : "border-border text-foreground"}
                        focus:border-primary focus:scale-105 focus:shadow-[0_0_0_3px_rgba(var(--primary)/0.15)]`}
                      style={{ caretColor: "transparent" }}
                    />
                  ))}
                </div>
                {emailFlowError && (
                  <p className="text-xs text-destructive text-center mb-2 animate-pulse">{emailFlowError}</p>
                )}
                <button
                  type="button"
                  onClick={() => handleOtpSubmit()}
                  disabled={otpCode.join("").length < 6}
                  className="w-full h-9 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-40 hover:bg-primary/90 transition-all"
                >
                  Confirmer
                </button>
              </div>
            </div>

            {/* Email input panel */}
            <div className={`transition-all duration-400 ease-in-out ${emailFlow === "email_input" || emailFlow === "saving" ? "max-h-48 opacity-100" : "max-h-0 opacity-0 pointer-events-none"}`}
              style={{ overflow: "hidden" }}
            >
              <div className="px-4 pb-5 pt-2 border-t border-border bg-secondary/30">
                <div className="my-3">
                  <input
                    id="new-email-input"
                    type="email"
                    value={newEmail}
                    onChange={(e) => { setNewEmail(e.target.value); setEmailFlowError(""); }}
                    placeholder="votre@email.com"
                    className="w-full h-10 rounded-xl border border-border px-3 text-sm bg-background outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                    onKeyDown={(e) => { if (e.key === "Enter") handleEmailSave(); }}
                  />
                  {emailFlowError && (
                    <p className="text-xs text-destructive mt-1.5">{emailFlowError}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleEmailSave}
                  disabled={!newEmail.trim() || emailFlow === "saving"}
                  className="w-full h-9 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-40 hover:bg-primary/90 transition-all flex items-center justify-center gap-2"
                >
                  {emailFlow === "saving" && <Loader2 size={13} className="animate-spin" />}
                  Enregistrer
                </button>
              </div>
            </div>
          </div>

          {/* Recovery phone */}
          <div className="overflow-hidden">
            <button
              type="button"
              onClick={() => setRecoveryPhoneOpen((v) => !v)}
              className="w-full flex items-center gap-3 p-4 hover:bg-secondary transition-base text-left"
            >
              <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Smartphone size={18} />
              </div>
              <div className="flex-1">
                <p className="font-medium text-sm">Téléphone de récupération</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {user?.recoveryPhone || recoveryPhoneInput
                    ? user?.recoveryPhone || recoveryPhoneInput
                    : "Ajouter un numéro de secours"}
                </p>
              </div>
              <ChevronRight size={16} className={`text-muted-foreground transition-transform duration-200 ${recoveryPhoneOpen ? "rotate-90" : ""}`} />
            </button>

            <div className={`transition-all duration-300 ease-in-out ${recoveryPhoneOpen ? "max-h-48 opacity-100" : "max-h-0 opacity-0 pointer-events-none"}`}
              style={{ overflow: "hidden" }}
            >
              <div className="px-4 pb-5 pt-2 border-t border-border bg-secondary/30 space-y-3">
                <p className="text-xs text-muted-foreground pt-1">
                  En cas de perte d'accès à votre email, notre équipe vous contactera sur ce numéro pour vérifier votre identité.
                </p>
                <Input
                  type="tel"
                  placeholder="+237 6XX XX XX XX"
                  value={recoveryPhoneInput}
                  onChange={(e) => setRecoveryPhoneInput(e.target.value)}
                  className="bg-background"
                  onKeyDown={(e) => { if (e.key === "Enter") handleRecoveryPhoneSave(); }}
                />
                <button
                  type="button"
                  onClick={handleRecoveryPhoneSave}
                  disabled={recoveryPhoneSaving || !recoveryPhoneInput.trim()}
                  className="w-full h-9 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-40 hover:bg-primary/90 transition-all flex items-center justify-center gap-2"
                >
                  {recoveryPhoneSaving && <Loader2 size={13} className="animate-spin" />}
                  Enregistrer
                </button>
              </div>
            </div>
          </div>

          {/* Recovery codes */}
          <div className="border-t border-border pt-3">
            <button
              type="button"
              onClick={handleToggleRecoveryCodes}
              className="w-full flex items-center gap-3 py-1 hover:bg-secondary/50 rounded-lg px-2 -mx-2 transition-colors"
            >
              <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                <KeyRound size={15} className="text-violet-500" />
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-medium">Codes de secours</p>
                <p className="text-xs text-muted-foreground">
                  {recoveryCodesCount === null ? "Chargement…" : recoveryCodesCount > 0 ? `${recoveryCodesCount} code${recoveryCodesCount > 1 ? "s" : ""} actif${recoveryCodesCount > 1 ? "s" : ""}` : "Aucun code généré"}
                </p>
              </div>
              <ChevronRight size={16} className={`text-muted-foreground transition-transform duration-200 ${recoveryCodesOpen ? "rotate-90" : ""}`} />
            </button>
            <div className={`transition-all duration-300 ease-in-out overflow-hidden ${recoveryCodesOpen ? "max-h-[600px] opacity-100" : "max-h-0 opacity-0 pointer-events-none"}`}>
              <div className="mt-3 space-y-3 px-1">
                {recoveryCodesResult ? (
                  <>
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                      <AlertTriangle size={12} className="shrink-0" /> Sauvegardez ces codes maintenant. Ils ne seront plus affichés.
                    </div>
                    <div className="grid grid-cols-1 gap-1.5">
                      {recoveryCodesResult.codes.map((code) => (
                        <div key={code} className="flex items-center gap-2 bg-secondary rounded-lg px-3 py-2">
                          <span className="flex-1 font-mono text-sm tracking-widest">{code}</span>
                          <button
                            onClick={() => handleCopyCode(code)}
                            className="h-7 w-7 rounded-md flex items-center justify-center hover:bg-background transition-colors shrink-0"
                            title="Copier"
                          >
                            {copiedCode === code ? <CheckCircle2 size={14} className="text-green-500" /> : <Copy size={13} className="text-muted-foreground" />}
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={handleCopyAllCodes}
                      className="w-full h-9 rounded-lg border border-border text-sm flex items-center justify-center gap-2 hover:bg-secondary transition-colors"
                    >
                      <Copy size={13} /> Copier tous les codes
                    </button>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Les codes de secours permettent d'accéder à votre compte si vous perdez accès à votre email. Chaque code ne peut être utilisé qu'une seule fois.
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleGenerateCodes}
                  disabled={recoveryCodesGenerating}
                  className="w-full h-9 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-40 hover:bg-primary/90 transition-all flex items-center justify-center gap-2"
                >
                  {recoveryCodesGenerating
                    ? <><Loader2 size={13} className="animate-spin" /> Génération…</>
                    : <><RefreshCw size={13} /> {recoveryCodesCount > 0 ? "Régénérer les codes" : "Générer 5 codes"}</>}
                </button>
              </div>
            </div>
          </div>

        </div>
      </section>

      <Button
        onClick={() => { logout(); navigate("/"); }}
        variant="outline"
        className="w-full rounded-md border-destructive/30 text-destructive hover:bg-destructive/10"
      >
        <LogOut size={16} className="mr-1.5" /> {t("common.logout")}
      </Button>

      <PinDialog
        open={pinOpen}
        hasPin={hasPin}
        onClose={(changed) => { setPinOpen(false); if (changed) setHasPin(true); }}
      />
      <SessionsDialog open={sessionsOpen} onClose={() => setSessionsOpen(false)} />
    </div>
  );
}
