import React, { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronLeft, Loader2, Send, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "../components/ui/button";
import { useI18n } from "../context/I18nContext";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import { getKycStatus, resetKyc, submitKyc, uploadKycDoc } from "../api/kyc";
import { KycDocCard } from "../components/kyc/KycDocCard";

const DOC_ORDER = ["idFront", "idBack", "selfie", "address"];

const KYC_LEVELS = [
  {
    level: 0,
    label: "Non vérifié",
    color: "bg-secondary text-muted-foreground",
    limits: { daily: "50 000 FCFA", monthly: "200 000 FCFA" },
    perks: ["Portefeuille FCFA", "Transferts P2P limités"],
  },
  {
    level: 1,
    label: "Basique",
    color: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    limits: { daily: "500 000 FCFA", monthly: "2 000 000 FCFA" },
    perks: ["Transferts P2P augmentés", "Retrait Mobile Money", "Support prioritaire"],
  },
  {
    level: 2,
    label: "Intermédiaire",
    color: "bg-warning/10 text-warning",
    limits: { daily: "2 000 000 FCFA", monthly: "10 000 000 FCFA" },
    perks: ["Transferts internationaux", "Multi-devises", "Virement bancaire"],
  },
  {
    level: 3,
    label: "Premium",
    color: "bg-success/10 text-success",
    limits: { daily: "Illimité", monthly: "Illimité" },
    perks: ["Toutes fonctionnalités", "Taux préférentiels", "Gestionnaire dédié"],
  },
];

function LevelsSection({ currentLevel }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl bg-surface border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <span className="font-semibold text-sm">Niveaux & limites</span>
        {open ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
      </button>
      {open && (
        <div className="border-t border-border divide-y divide-border">
          {KYC_LEVELS.map((lvl) => {
            const isCurrent = lvl.level === currentLevel;
            return (
              <div key={lvl.level} className={`px-5 py-4 space-y-2 ${isCurrent ? "bg-primary/5" : ""}`}>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${lvl.color}`}>
                    Niveau {lvl.level} — {lvl.label}
                  </span>
                  {isCurrent && <span className="text-xs text-primary font-semibold">← Vous êtes ici</span>}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md bg-secondary px-3 py-2">
                    <span className="text-muted-foreground block">Quotidien</span>
                    <span className="font-semibold tabular-nums">{lvl.limits.daily}</span>
                  </div>
                  <div className="rounded-md bg-secondary px-3 py-2">
                    <span className="text-muted-foreground block">Mensuel</span>
                    <span className="font-semibold tabular-nums">{lvl.limits.monthly}</span>
                  </div>
                </div>
                <ul className="space-y-1">
                  {lvl.perks.map((p) => (
                    <li key={p} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <CheckCircle2 size={11} className="text-success shrink-0" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
const DOC_TITLES = {
  idFront: "Recto pièce d'identité",
  idBack:  "Verso pièce d'identité",
  selfie:  "Selfie avec pièce",
  address: "Justificatif domicile",
};

// ─── Step progress bar ────────────────────────────────────────────────────────
function StepBar({ total, current }) {
  return (
    <div className="flex gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${
            i < current ? "bg-success" : i === current ? "bg-primary" : "bg-border"
          }`}
        />
      ))}
    </div>
  );
}

// ─── Final review screen ──────────────────────────────────────────────────────
function ReviewScreen({ docs, docByKey, onBack, onSubmit, onReset, kycStatus, isSubmitting }) {
  const allDone = DOC_ORDER.every((k) => {
    const d = docByKey.get(k);
    return d?.has_file || (d?.status && d.status !== "missing" && d.status !== "rejected");
  });

  return (
    <div className="space-y-6 kyc-step-forward">
      <div className="text-center space-y-2">
        <div className="mx-auto h-16 w-16 rounded-full bg-success/10 text-success flex items-center justify-center">
          <CheckCircle2 size={32} />
        </div>
        <h2 className="font-display text-xl font-bold">Dossier complet</h2>
        <p className="text-sm text-muted-foreground">Vérifiez vos documents avant de soumettre.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {DOC_ORDER.map((key) => {
          const d = docByKey.get(key);
          const ok = d?.has_file || (d?.status && d.status !== "missing" && d.status !== "rejected");
          return (
            <div key={key} className={`rounded-xl border p-3 text-center space-y-2 ${ok ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5"}`}>
              <div className={`h-8 w-8 rounded-full mx-auto flex items-center justify-center ${ok ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                <CheckCircle2 size={16} />
              </div>
              <p className="text-xs font-medium leading-tight">{DOC_TITLES[key]}</p>
              <span className={`text-xs ${ok ? "text-success" : "text-destructive"}`}>
                {ok ? "Fourni" : "Manquant"}
              </span>
            </div>
          );
        })}
      </div>

      {kycStatus === "in_review" && (
        <div className="rounded-xl bg-warning/10 border border-warning/30 p-4 text-sm text-center text-warning font-medium">
          Dossier en cours de vérification
        </div>
      )}

      {kycStatus === "approved" && (
        <div className="rounded-xl bg-success/10 border border-success/30 p-4 text-sm text-center text-success font-medium">
          Compte vérifié ✓
        </div>
      )}

      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={onBack} className="rounded-md border-border">
          <ChevronLeft size={15} className="mr-1" /> Retour
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onReset}
          disabled={kycStatus === "approved" || kycStatus === "in_review"}
          className="rounded-md border-border"
        >
          Recommencer
        </Button>
        {allDone && kycStatus !== "approved" && kycStatus !== "in_review" && (
          <Button
            type="button"
            onClick={onSubmit}
            disabled={isSubmitting}
            className="flex-1 bg-primary hover:bg-primary/90 rounded-md text-primary-foreground"
          >
            {isSubmitting ? <Loader2 size={15} className="animate-spin mr-2" /> : <Send size={15} className="mr-2" />}
            Soumettre
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Kyc() {
  const { t } = useI18n();
  const { user, updateUser } = useAuth();

  const [docs, setDocs] = useState([]);
  const [kycStatus, setKycStatus] = useState("unverified");
  const [stepIndex, setStepIndex] = useState(0);
  const [animDir, setAnimDir] = useState("forward");
  const [screen, setScreen] = useState("steps"); // steps | review
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load KYC status on mount
  useEffect(() => {
    getKycStatus()
      .then((res) => {
        if (res?.documents?.length) setDocs(res.documents);
        if (res?.status) setKycStatus(res.status);
        if (typeof res?.level === "number") updateUser({ kycLevel: res.level });
        // Jump to review if already in_review or approved
        if (res?.status === "in_review" || res?.status === "approved") {
          setScreen("review");
        }
      })
      .catch((err) => {
        const msg = err?.response?.data?.detail || err?.message || "Erreur";
        toast.error(`KYC indisponible : ${msg}`);
      })
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line

  const refresh = async () => {
    const res = await getKycStatus();
    if (res?.documents?.length) setDocs(res.documents);
    if (res?.status) setKycStatus(res.status);
    if (typeof res?.level === "number") updateUser({ kycLevel: res.level });
    return res;
  };

  const docByKey = useMemo(() => {
    const m = new Map();
    for (const d of docs) m.set(d.key, d);
    return m;
  }, [docs]);

  const doneCount = useMemo(() =>
    DOC_ORDER.filter((k) => {
      const d = docByKey.get(k);
      return d?.has_file || (d?.status && d.status !== "missing" && d.status !== "rejected");
    }).length
  , [docByKey]);

  const handleUpload = async (key, file) => {
    await uploadKycDoc(key, file);
    toast.success("Document envoyé");
    await refresh();
  };

  // Called after each successful doc upload
  const handleConfirmed = () => {
    // Auto-advance after a short delay (let the user see the "done" state)
    setTimeout(() => {
      if (stepIndex < DOC_ORDER.length - 1) {
        goTo(stepIndex + 1, "forward");
      } else {
        // All steps done → go to review
        setAnimDir("forward");
        setScreen("review");
      }
    }, 800);
  };

  const goTo = (idx, dir) => {
    setAnimDir(dir);
    setStepIndex(idx);
  };

  const handleBack = () => {
    if (screen === "review") {
      setAnimDir("backward");
      setScreen("steps");
      setStepIndex(DOC_ORDER.length - 1);
    } else if (stepIndex > 0) {
      goTo(stepIndex - 1, "backward");
    }
  };

  const handleNext = () => {
    if (stepIndex < DOC_ORDER.length - 1) {
      goTo(stepIndex + 1, "forward");
    } else {
      setAnimDir("forward");
      setScreen("review");
    }
  };

  const handleReset = async () => {
    await resetKyc();
    toast.success("KYC réinitialisé");
    await refresh();
    setScreen("steps");
    setStepIndex(0);
    setAnimDir("forward");
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      await submitKyc();
      toast.success("Dossier soumis — en cours de vérification");
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Impossible de soumettre");
    } finally {
      setIsSubmitting(false);
    }
  };

  const isLocked = kycStatus === "in_review" || kycStatus === "approved";
  const currentKey = DOC_ORDER[stepIndex];
  const currentDoc = { ...(docByKey.get(currentKey) || { key: currentKey, status: "missing" }), locked: isLocked };

  const currentDocDone = currentDoc?.has_file || (currentDoc?.status && currentDoc.status !== "missing" && currentDoc.status !== "rejected");

  if (loading) {
    return (
      <div className="flex justify-center items-center py-24">
        <Loader2 size={28} className="animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-lg mx-auto" data-testid="kyc-page">
      {/* Title + status */}
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">{t("nav.kyc")}</h1>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
            kycStatus === "approved" ? "bg-success/10 text-success"
            : kycStatus === "in_review" ? "bg-warning/10 text-warning"
            : "bg-secondary text-muted-foreground"
          }`}>
            {kycStatus === "approved" ? "Vérifié" : kycStatus === "in_review" ? "En révision" : "Non vérifié"}
          </span>
          <span className="text-xs text-muted-foreground">Niveau {user?.kycLevel ?? 0}</span>
          {screen === "steps" && (
            <span className="text-xs text-muted-foreground ml-auto">{doneCount}/{DOC_ORDER.length} documents</span>
          )}
        </div>
      </div>

      {/* Levels section */}
      <LevelsSection currentLevel={user?.kycLevel ?? 0} />

      {/* Progress bar (only in step mode) */}
      {screen === "steps" && (
        <StepBar total={DOC_ORDER.length} current={stepIndex} />
      )}

      {/* Main content */}
      {screen === "review" ? (
        <ReviewScreen
          docs={docs}
          docByKey={docByKey}
          onBack={handleBack}
          onSubmit={handleSubmit}
          onReset={handleReset}
          kycStatus={kycStatus}
          isSubmitting={isSubmitting}
        />
      ) : (
        <div
          key={`${stepIndex}-${animDir}`}
          className={animDir === "forward" ? "kyc-step-forward" : "kyc-step-backward"}
        >
          <div className="space-y-4">
            {/* Step label */}
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold text-foreground">Étape {stepIndex + 1} / {DOC_ORDER.length}</span>
              <span className="text-muted-foreground">{DOC_TITLES[currentKey]}</span>
            </div>

            {/* Doc card */}
            <KycDocCard
              doc={currentDoc}
              onUpload={handleUpload}
              onConfirmed={handleConfirmed}
              locked={isLocked}
            />

            {/* Navigation */}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleBack}
                disabled={stepIndex === 0}
                className="rounded-md border-border"
              >
                <ChevronLeft size={15} className="mr-1" /> Retour
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleReset}
                disabled={doneCount === 0 || kycStatus === "approved"}
                className="rounded-md border-border"
              >
                Recommencer
              </Button>
              <Button
                type="button"
                onClick={handleNext}
                disabled={!currentDocDone && !isLocked}
                className="ml-auto bg-primary hover:bg-primary/90 rounded-md text-primary-foreground"
              >
                {stepIndex < DOC_ORDER.length - 1 ? "Suivant" : "Revoir le dossier"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
