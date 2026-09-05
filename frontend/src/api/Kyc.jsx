import React, { useEffect, useState } from "react";
import { Upload, Check, X, Clock, Camera } from "lucide-react";
import { Progress } from "../components/ui/progress";
import { Button } from "../components/ui/button";
import { useI18n } from "../context/I18nContext";
import { useAuth } from "../context/AuthContext";
import { formatAmount } from "../lib/format";
import { toast } from "sonner";
import { getKycStatus, uploadKycDoc } from "../api/kyc";

const DOCS = [
  { key: "idFront", status: "pending" },
  { key: "idBack", status: "pending" },
  { key: "selfie", status: "pending" },
  { key: "address", status: "pending" },
];

const statusStyles = {
  approved: { bg: "bg-success/10", text: "text-success", icon: Check },
  pending: { bg: "bg-warning/10", text: "text-warning", icon: Clock },
  rejected: { bg: "bg-destructive/10", text: "text-destructive", icon: X },
};

export default function Kyc() {
  const { t } = useI18n();
  const { user, updateUser } = useAuth();
  const [docs, setDocs] = useState(DOCS);
  const [limits, setLimits] = useState({ dailyFCFA: 0, monthlyFCFA: 0 });
  const fileRefs = React.useRef({});
  const level = user?.kycLevel ?? 0;
  const levels = t("kyc.levels");

  useEffect(() => {
    let alive = true;
    getKycStatus()
      .then((res) => {
        if (!alive) return;
        if (res?.documents?.length) setDocs(res.documents);
        if (res?.limits) setLimits(res.limits);
        if (typeof res?.level === "number") updateUser({ kycLevel: res.level });
      })
      .catch(() => {
        toast.message("Mode démo: KYC local");
      });
    return () => {
      alive = false;
    };
  }, [updateUser]);

  const askFile = (key) => {
    const el = fileRefs.current[key];
    if (el) el.click();
  };

  const handleFileSelected = async (key, file) => {
    if (!file) return;
    try {
      await uploadKycDoc(key, file);
      toast.success(t("kyc.status.pending"));
      setDocs((d) => d.map((x) => (x.key === key ? { ...x, status: "pending", reason: undefined } : x)));
    } catch {
      toast.error(t("common.retry"));
    }
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto" data-testid="kyc-page">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">{t("nav.kyc")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("kyc.banner")} <span className="font-semibold text-primary">{level}</span> · {Array.isArray(levels) ? levels[level] : ""}
        </p>
      </div>

      {/* Progress */}
      <div className="rounded-xl bg-surface border border-border p-5" data-testid="kyc-progress-card">
        <div className="flex items-center justify-between mb-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col items-center flex-1">
              <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold ${
                i <= level ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
              }`}>{i}</div>
              <span className={`text-[10px] mt-1.5 font-medium uppercase tracking-wider ${i === level ? "text-primary" : "text-muted-foreground"}`}>
                {Array.isArray(levels) ? levels[i] : ""}
              </span>
            </div>
          ))}
        </div>
        <Progress value={((level + 1) / 4) * 100} className="h-1.5" />
      </div>

      {/* Limits */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-surface border border-border p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-widest">{t("kyc.daily")}</p>
          <p className="font-display text-lg font-bold mt-1 tabular-nums">{formatAmount(limits.dailyFCFA)}</p>
        </div>
        <div className="rounded-xl bg-surface border border-border p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-widest">{t("kyc.monthly")}</p>
          <p className="font-display text-lg font-bold mt-1 tabular-nums">{formatAmount(limits.monthlyFCFA)}</p>
        </div>
      </div>

      {/* Documents */}
      <div className="space-y-3">
        <p className="text-xs uppercase tracking-widest text-muted-foreground font-medium">Documents</p>
        {docs.map((d) => {
          const S = statusStyles[d.status];
          const Icon = S.icon;
          return (
            <div key={d.key} className="rounded-xl bg-surface border border-border p-4 flex items-center gap-4" data-testid={`kyc-doc-${d.key}`}>
              <div className={`h-11 w-11 rounded-full ${S.bg} ${S.text} flex items-center justify-center shrink-0`}>
                <Icon size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">{t(`kyc.upload${d.key === "idFront" ? "IdFront" : d.key === "idBack" ? "IdBack" : d.key === "selfie" ? "Selfie" : "Address"}`)}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`text-xs font-medium ${S.text}`}>{t(`kyc.status.${d.status}`)}</span>
                  {d.reason && <span className="text-xs text-muted-foreground">· {d.reason}</span>}
                </div>
              </div>
              {d.status !== "approved" && (
                <Button
                  size="sm"
                  onClick={() => askFile(d.key)}
                  data-testid={`kyc-upload-${d.key}`}
                  className="bg-primary hover:bg-primary/90 rounded-md text-primary-foreground"
                >
                  <Upload size={14} className="mr-1" />
                  {d.status === "rejected" ? t("kyc.reupload") : "Upload"}
                </Button>
              )}
              <input
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                ref={(el) => {
                  if (el) fileRefs.current[d.key] = el;
                }}
                onChange={(e) => handleFileSelected(d.key, e.target.files?.[0])}
              />
            </div>
          );
        })}
        <button
          type="button"
          data-testid="kyc-camera-cta"
          className="w-full p-5 rounded-xl border-2 border-dashed border-border hover:border-primary/40 hover:bg-primary/5 transition-base flex flex-col items-center gap-2 text-muted-foreground"
        >
          <Camera size={20} />
          <span className="text-sm font-medium">Prendre une photo / Glisser un fichier</span>
        </button>
      </div>
    </div>
  );
}
