import React, { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, RefreshCw, TrendingUp, Link2, CheckCircle2,
  XCircle, Zap, ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { getMyStats } from "../api/paymentLinks";

const fmtEarnings = (n) => new Intl.NumberFormat("fr-FR").format(Math.round(n ?? 0));
const fmtFcfa = (n) => fmtEarnings(n) + " FCFA";

const MONTH_LABELS = {
  "01": "Jan", "02": "Fév", "03": "Mar", "04": "Avr",
  "05": "Mai", "06": "Jun", "07": "Juil", "08": "Août",
  "09": "Sep", "10": "Oct", "11": "Nov", "12": "Déc",
};

function useCountUp(target, duration = 1600, started = false) {
  const [value, setValue] = useState(0);
  const raf = useRef(null);
  const startTime = useRef(null);

  useEffect(() => {
    if (!started || target === 0) { setValue(target); return; }
    startTime.current = null;
    const animate = (ts) => {
      if (!startTime.current) startTime.current = ts;
      const elapsed = ts - startTime.current;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));
      if (progress < 1) raf.current = requestAnimationFrame(animate);
    };
    raf.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf.current);
  }, [target, duration, started]);

  return value;
}

function AnimatedRing({ rate, size = 280, started }) {
  const stroke = 14;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const fill = rate / 100;

  const [offset, setOffset] = useState(circ);
  const raf = useRef(null);
  const startTime = useRef(null);

  useEffect(() => {
    if (!started) return;
    startTime.current = null;
    const target = circ * (1 - fill);
    const duration = 1800;
    const animate = (ts) => {
      if (!startTime.current) startTime.current = ts;
      const elapsed = ts - startTime.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 4);
      setOffset(circ - eased * (circ - target));
      if (progress < 1) raf.current = requestAnimationFrame(animate);
    };
    raf.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf.current);
  }, [fill, circ, started]);

  const cx = size / 2;
  const cy = size / 2;

  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <defs>
        <linearGradient id="ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="1" />
          <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0.4" />
        </linearGradient>
        <filter id="ring-glow">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* Track */}
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        className="text-border"
        opacity="0.4"
      />
      {/* Filled arc */}
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke="url(#ring-grad)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        filter="url(#ring-glow)"
        style={{ transition: "none" }}
      />
    </svg>
  );
}

function MonthlyChart({ data }) {
  if (!data || data.length === 0) return (
    <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
      Aucune donnée mensuelle
    </div>
  );
  const max = Math.max(...data.map((d) => d.collected), 1);
  const BAR_H = 80;

  return (
    <div className="flex items-end gap-2 w-full" style={{ height: BAR_H + 28 }}>
      {data.map((d, i) => {
        const pct = d.collected / max;
        const barH = Math.max(4, Math.round(pct * BAR_H));
        const month = d.month?.slice(5) || "";
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
            {/* Tooltip */}
            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:flex
                            bg-foreground text-background text-[10px] font-medium px-2 py-1 rounded-md
                            whitespace-nowrap z-10 pointer-events-none shadow-lg">
              {fmtFcfa(d.collected)}
            </div>
            <div
              className="w-full rounded-t-md transition-all duration-700"
              style={{
                height: barH,
                background: "linear-gradient(to top, var(--color-primary), color-mix(in srgb, var(--color-primary) 60%, white))",
                opacity: 0.85 + 0.15 * pct,
              }}
            />
            <span className="text-[10px] text-muted-foreground font-medium">
              {MONTH_LABELS[month] || month}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, color = "primary" }) {
  const colors = {
    primary: "bg-primary/10 text-primary",
    emerald: "bg-emerald-500/10 text-emerald-600",
    red:     "bg-red-500/10 text-red-500",
    amber:   "bg-amber-500/10 text-amber-600",
  };
  return (
    <div className="bg-background border border-border rounded-xl p-4 flex flex-col gap-3">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${colors[color]}`}>
        <Icon size={16} />
      </div>
      <div>
        <p className="text-2xl font-bold font-mono tabular-nums text-foreground leading-tight">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5 opacity-70">{sub}</p>}
      </div>
    </div>
  );
}

export default function EarningsPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [started, setStarted] = useState(false);
  const observerRef = useRef(null);
  const heroRef = useRef(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const data = await getMyStats();
      setStats(data);
    } catch {
      toast.error("Erreur lors du chargement des stats");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Trigger animations once hero section enters viewport
  useEffect(() => {
    if (!heroRef.current) return;
    observerRef.current = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setStarted(true); },
      { threshold: 0.3 }
    );
    observerRef.current.observe(heroRef.current);
    return () => observerRef.current?.disconnect();
  }, [loading]);

  const totalCollected = stats?.total_collected ?? 0;
  const successRate = stats?.success_rate ?? 0;
  const displayRate = successRate;

  const animatedTotal = useCountUp(totalCollected, 1600, started);
  const animatedRate = useCountUp(Math.round(successRate), 1200, started);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full border-4 border-border border-t-primary animate-spin" />
          <p className="text-sm text-muted-foreground">Chargement des gains…</p>
        </div>
      </div>
    );
  }

  const ringFillRate = stats?.total_txs > 0 ? successRate : 72;

  return (
    <div className="max-w-lg mx-auto px-4 pb-16 pt-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={16} />
          Retour
        </button>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
          Actualiser
        </button>
      </div>

      {/* HERO — Cercle animé */}
      <div ref={heroRef} className="relative flex flex-col items-center pt-4 pb-2">
        {/* Glow background */}
        <div
          className="absolute inset-0 rounded-3xl opacity-5 blur-3xl pointer-events-none"
          style={{ background: "var(--color-primary)" }}
        />

        <div className="relative">
          <AnimatedRing rate={ringFillRate} size={260} started={started} />

          {/* Center content */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-center px-8">
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">
              Total collecté
            </p>
            <p className="font-mono font-bold tabular-nums text-foreground leading-none"
               style={{ fontSize: totalCollected >= 1_000_000 ? "1.4rem" : "1.7rem" }}>
              {fmtEarnings(animatedTotal)}
            </p>
            <p className="text-xs text-muted-foreground">FCFA</p>
            {stats?.total_txs > 0 && (
              <div className="mt-3 flex items-center gap-1.5 bg-emerald-500/10 text-emerald-600 px-3 py-1 rounded-full">
                <CheckCircle2 size={11} />
                <span className="text-[11px] font-semibold">{animatedRate}% de réussite</span>
              </div>
            )}
          </div>
        </div>

        {/* Ring legend */}
        <div className="flex items-center gap-4 mt-1">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--color-primary)" }} />
            <span className="text-[11px] text-muted-foreground">Taux de succès</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-border opacity-60" />
            <span className="text-[11px] text-muted-foreground">Restant</span>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          icon={Link2}
          label="Liens actifs"
          value={stats?.active_links ?? 0}
          sub={`sur ${stats?.total_links ?? 0} total`}
          color="primary"
        />
        <StatCard
          icon={CheckCircle2}
          label="Paiements reçus"
          value={stats?.total_paid ?? 0}
          sub="transactions complétées"
          color="emerald"
        />
        <StatCard
          icon={TrendingUp}
          label="Volume total"
          value={stats?.total_txs ?? 0}
          sub="tentatives de paiement"
          color="amber"
        />
        <StatCard
          icon={XCircle}
          label="Échecs"
          value={stats?.total_failed ?? 0}
          sub={stats?.total_txs > 0 ? `${(100 - successRate).toFixed(1)}% des tentatives` : "—"}
          color="red"
        />
      </div>

      {/* Monthly chart */}
      <div className="bg-background border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold text-foreground">Évolution mensuelle</p>
          <span className="text-[10px] text-muted-foreground uppercase tracking-widest">6 derniers mois</span>
        </div>
        <MonthlyChart data={stats?.monthly ?? []} />
      </div>

      {/* Top links */}
      {stats?.top_links?.length > 0 && (
        <div className="bg-background border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <Zap size={14} className="text-primary" />
            <p className="text-sm font-semibold text-foreground">Meilleurs liens</p>
          </div>
          <div className="divide-y divide-border">
            {stats.top_links.map((link, i) => (
              <button
                key={link.id}
                onClick={() => navigate(`/payment-links/${link.id}`)}
                className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-secondary/50 transition-colors text-left group"
              >
                <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {link.description || "Lien sans titre"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {link.paid_count} paiement{link.paid_count !== 1 ? "s" : ""}
                    {" · "}
                    {fmtFcfa(link.amount)} / paiement
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold font-mono tabular-nums text-foreground">
                    {fmtEarnings(link.total_collected)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">FCFA</p>
                </div>
                <ArrowRight size={13} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {stats?.total_txs === 0 && (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <TrendingUp size={20} className="text-primary" />
          </div>
          <p className="text-sm font-medium text-foreground">Aucun paiement encore</p>
          <p className="text-xs text-muted-foreground max-w-xs">
            Créez votre premier lien de paiement et partagez-le pour commencer à collecter.
          </p>
          <button
            onClick={() => navigate("/payment-links")}
            className="mt-1 text-sm font-medium text-primary hover:underline flex items-center gap-1"
          >
            Créer un lien <ArrowRight size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
