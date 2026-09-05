import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Eye, EyeOff, Send, Download, Upload, Wallet as WalletIcon, TrendingUp, TrendingDown, ArrowRight, RefreshCw, ChevronLeft, ChevronRight, ArrowLeftRight, Link2, Plus, Copy, Trash2, Pause, Play, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { listMyLinks, deleteLink, pauseLink } from "../api/paymentLinks";
import { useI18n } from "../context/I18nContext";
import { useAuth } from "../context/AuthContext";
import { KycBanner } from "../components/common/KycBanner";
import { TransactionItem } from "../components/common/TransactionItem";
import { EmptyState } from "../components/common/EmptyState";
import { formatAmount } from "../lib/format";
import { getTransactions, getWallets } from "../api/wallet";
import { getRates } from "../api/rates";

const CURRENCY_TOGGLES = ["FCFA", "EUR", "USD"];

function fmtFcfa(n) {
  return new Intl.NumberFormat("fr-FR").format(n) + " FCFA";
}

function PaymentLinksSection({ recentPayments = [] }) {
  const navigate = useNavigate();
  const [links, setLinks] = useState([]);

  const load = () => listMyLinks().then((d) => setLinks(d.items || [])).catch(() => {});
  useEffect(() => { load(); }, []);

  const copy = (url) => { navigator.clipboard.writeText(url); toast.success("Lien copié !"); };

  const handlePause = async (id) => {
    try { await pauseLink(id); load(); } catch { toast.error("Erreur"); }
  };
  const handleDelete = async (id) => {
    if (!window.confirm("Supprimer ce lien ?")) return;
    try { await deleteLink(id); load(); } catch { toast.error("Erreur"); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs uppercase tracking-widest text-muted-foreground font-medium flex items-center gap-1.5">
          <Link2 size={12} /> Liens de paiement
        </p>
        <div className="flex items-center gap-2">
          {links.length > 0 && (
            <button
              onClick={() => navigate("/payment-links")}
              className="h-7 px-2.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              Gérer <ExternalLink size={10} />
            </button>
          )}
          <button
            onClick={() => navigate("/payment-links")}
            className="h-7 px-2.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold flex items-center gap-1 hover:bg-primary/90 transition-colors"
          >
            <Plus size={12} /> Créer
          </button>
        </div>
      </div>

      {links.length === 0 ? (
        <div
          onClick={() => navigate("/payment-links")}
          className="bg-surface border border-border rounded-xl py-6 text-center text-xs text-muted-foreground cursor-pointer hover:border-primary/30 transition-colors"
        >
          Aucun lien — <span className="text-primary font-medium">créer mon premier lien →</span>
        </div>
      ) : (
        <div className="space-y-2">
          {links.slice(0, 3).map((l) => (
            <div key={l.id} className="bg-surface border border-border rounded-xl px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate("/payment-links")}>
                <p className="text-sm font-medium truncate">{l.description}</p>
                <p className="text-xs text-muted-foreground">{fmtFcfa(l.amount)} · {l.paid_count || 0} paiement{l.paid_count !== 1 ? "s" : ""}{l.total_collected > 0 ? ` · ${fmtFcfa(l.total_collected)} collectés` : ""}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {l.status === "active" ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 font-medium">actif</span>
                ) : (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 font-medium">pausé</span>
                )}
                <button onClick={() => copy(l.url)} className="h-7 w-7 rounded-lg hover:bg-secondary flex items-center justify-center" title="Copier le lien">
                  <Copy size={13} className="text-muted-foreground" />
                </button>
                <button onClick={() => handlePause(l.id)} className="h-7 w-7 rounded-lg hover:bg-secondary flex items-center justify-center" title={l.status === "active" ? "Mettre en pause" : "Réactiver"}>
                  {l.status === "active" ? <Pause size={13} className="text-muted-foreground" /> : <Play size={13} className="text-muted-foreground" />}
                </button>
                <button onClick={() => handleDelete(l.id)} className="h-7 w-7 rounded-lg hover:bg-secondary flex items-center justify-center" title="Supprimer">
                  <Trash2 size={13} className="text-red-400" />
                </button>
              </div>
            </div>
          ))}
          {links.length > 3 && (
            <button
              onClick={() => navigate("/payment-links")}
              className="w-full text-xs text-primary font-medium py-2 hover:underline"
            >
              Voir tous les liens ({links.length}) →
            </button>
          )}
        </div>
      )}

      {recentPayments.length > 0 && (
        <div className="mt-4">
          <p className="text-xs uppercase tracking-widest text-muted-foreground font-medium mb-2 flex items-center gap-1.5">
            <Link2 size={11} /> Paiements reçus via liens
          </p>
          <div className="bg-surface border border-border rounded-xl divide-y divide-border overflow-hidden">
            {recentPayments.slice(0, 5).map((tx) => (
              <div key={tx.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Link2 size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{tx.label}</p>
                  <p className="text-xs text-muted-foreground truncate">{tx.counterpart} · {new Date(tx.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}</p>
                </div>
                <span className="text-sm font-semibold text-success shrink-0">+{fmtFcfa(tx.amount)}</span>
              </div>
            ))}
            {recentPayments.length > 5 && (
              <button
                onClick={() => navigate("/payment-links")}
                className="w-full text-xs text-primary font-medium py-2 hover:underline"
              >
                Voir tous les paiements ({recentPayments.length}) →
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Fallback rates (utilisés uniquement si l'API échoue)
const FALLBACK_RATES = [
  { pair: "EUR/FCFA", rate: 645.57, market_rate: 655.96, spread_pct: 1.5, change: 0 },
  { pair: "USD/FCFA", rate: 601.96, market_rate: 612.4,  spread_pct: 1.5, change: 0 },
  { pair: "BTC/FCFA", rate: 0,      market_rate: 0,      spread_pct: 2.0, change: 0 },
  { pair: "USDT/FCFA",rate: 601.96, market_rate: 612.4,  spread_pct: 1.2, change: 0 },
];

// Construit un dictionnaire base→rate depuis les items API pour la conversion de solde
function buildRateMap(items) {
  const map = { FCFA: 1 };
  for (const r of items) {
    const base = r.pair.split("/")[0];
    if (base !== "FCFA") map[base] = r.rate;
  }
  return map;
}

export default function Dashboard() {
  const { t } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [hidden, setHidden] = useState(false);
  const [displayCurrency, setDisplayCurrency] = useState("FCFA");
  const [wallets, setWallets] = useState(null);
  const [txs, setTxs] = useState(null);
  const [rates, setRates] = useState(FALLBACK_RATES);
  const [ratesLoading, setRatesLoading] = useState(false);

  // Retour depuis NotchPay ou SharePay après paiement
  useEffect(() => {
    const depositStatus = searchParams.get("deposit");
    if (depositStatus === "success") {
      toast.success("Dépôt confirmé ! Votre solde a été mis à jour.");
      setSearchParams({}, { replace: true });
    } else if (depositStatus === "pending") {
      toast.info("Paiement en cours de traitement. Votre solde sera mis à jour automatiquement.");
      setSearchParams({}, { replace: true });
    }
  }, []);

  const fetchRates = async () => {
    setRatesLoading(true);
    try {
      const rt = await getRates();
      if (rt?.length) setRates(rt);
    } catch {}
    setRatesLoading(false);
  };

  useEffect(() => {
    let alive = true;
    Promise.all([getWallets(), getTransactions(200), getRates()])
      .then(([w, tr, rt]) => {
        if (!alive) return;
        setWallets(w || []);
        setTxs(tr || []);
        if (rt?.length) setRates(rt);
      })
      .catch(() => { setWallets([]); setTxs([]); });
    return () => { alive = false; };
  }, []);

  // Conversion du solde total en FCFA en utilisant les taux live
  const rateMap = useMemo(() => buildRateMap(rates), [rates]);

  const totalFCFA = useMemo(() =>
    (wallets || []).reduce((sum, w) => sum + w.balance * (rateMap[w.currency] || 0), 0),
  [wallets, rateMap]);

  const convertedBalance = useMemo(() => {
    if (displayCurrency === "FCFA") return totalFCFA;
    const r = rateMap[displayCurrency];
    return r ? totalFCFA / r : totalFCFA;
  }, [displayCurrency, totalFCFA, rateMap]);

  const [txPage, setTxPage] = useState(1);
  const TX_PAGE_SIZE = 8;
  const allTxs = txs || [];
  const txTotalPages = Math.max(1, Math.ceil(allTxs.length / TX_PAGE_SIZE));
  const recent = allTxs.slice((txPage - 1) * TX_PAGE_SIZE, txPage * TX_PAGE_SIZE);

  const actions = [
    { to: "/fiat-deposit", icon: Download,        label: "Dépôt",     testId: "qa-deposit" },
    { to: "/withdraw",     icon: Upload,           label: "Retrait",   testId: "qa-withdraw" },
    { to: "/transfer",     icon: ArrowLeftRight,   label: "Transfert", testId: "qa-send" },
  ];

  return (
    <div className="space-y-6" data-testid="dashboard-page">
      <div>
        <p className="text-sm text-muted-foreground">{t("dashboard.hello")},</p>
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight" data-testid="dashboard-greeting">
          {user?.fullName?.split(" ")[0] || "Kobo"}
        </h1>
      </div>

      {/* Balance Card */}
      <div
        data-testid="balance-card"
        onClick={() => setHidden((h) => !h)}
        className="relative overflow-hidden rounded-xl bg-primary text-white p-6 cursor-pointer select-none transition-base hover:brightness-110"
      >
        <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-white/10" />
        <div className="absolute -right-10 bottom-[-40px] h-32 w-32 rounded-full bg-white/5" />
        <div className="relative z-10">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-widest text-white/70">
              {t("dashboard.totalBalance")}
            </span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setHidden((h) => !h); }}
              data-testid="toggle-balance-visibility"
              className="h-8 w-8 rounded-md bg-white/15 hover:bg-white/25 flex items-center justify-center transition-base"
            >
              {hidden ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <div className="mt-3 flex items-end gap-2">
            <span className="font-display text-3xl sm:text-4xl font-bold tabular-nums" data-testid="balance-amount">
              {hidden ? "••••••" : formatAmount(convertedBalance, displayCurrency)}
            </span>
          </div>
          <div className="mt-5 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {CURRENCY_TOGGLES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setDisplayCurrency(c)}
                data-testid={`currency-toggle-${c}`}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-base ${
                  displayCurrency === c ? "bg-white text-primary" : "bg-white/10 text-white hover:bg-white/20"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground font-medium mb-3">
          {t("dashboard.quickActions")}
        </p>
        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          {actions.map(({ to, icon: Icon, label, testId }) => (
            <button
              key={testId}
              data-testid={testId}
              onClick={() => navigate(to)}
              className="group flex flex-col items-center gap-2.5 py-4 px-3 rounded-xl bg-surface border border-border hover:border-primary/40 hover:-translate-y-0.5 transition-base"
            >
              <span className="h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-white transition-base">
                <Icon size={20} />
              </span>
              <span className="text-sm font-semibold">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* KYC */}
      <KycBanner />

      {/* Rates ticker */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs uppercase tracking-widest text-muted-foreground font-medium">
            {t("dashboard.rates")}
          </p>
          <button
            type="button"
            onClick={fetchRates}
            disabled={ratesLoading}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-base"
          >
            <RefreshCw size={12} className={ratesLoading ? "animate-spin" : ""} />
            Actualiser
          </button>
        </div>
        <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-4 px-4" data-testid="rates-ticker">
          {rates.map((r) => {
            const up = r.change >= 0;
            return (
              <div key={r.pair} className="shrink-0 w-44 p-4 rounded-xl bg-surface border border-border space-y-1">
                <p className="text-xs text-muted-foreground font-medium">{r.pair}</p>
                <p className="font-bold tabular-nums text-base">
                  {r.rate > 0 ? r.rate.toLocaleString("fr-FR", { maximumFractionDigits: 2 }) : "—"}
                </p>
                <div className={`flex items-center gap-1 text-xs ${up ? "text-success" : "text-destructive"}`}>
                  {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                  <span>{up ? "+" : ""}{r.change}%</span>
                </div>
                {r.spread_pct != null && (
                  <p className="text-[10px] text-muted-foreground">
                    Marché {r.market_rate > 0 ? r.market_rate.toLocaleString("fr-FR", { maximumFractionDigits: 2 }) : "—"} · comm. {r.spread_pct}%
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Liens de paiement */}
      <PaymentLinksSection recentPayments={(txs || []).filter((tx) => tx.category === "payment_link")} />

      {/* Recent transactions */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs uppercase tracking-widest text-muted-foreground font-medium">
            {t("dashboard.recentTx")}
            {allTxs.length > 0 && (
              <span className="ml-2 text-muted-foreground/60 normal-case tracking-normal">
                ({allTxs.length})
              </span>
            )}
          </p>
          <button
            type="button"
            onClick={() => navigate("/history")}
            className="text-xs font-medium text-primary hover:underline flex items-center gap-1"
            data-testid="see-all-tx"
          >
            {t("dashboard.seeAll")} <ArrowRight size={12} />
          </button>
        </div>
        <div className="rounded-xl bg-surface border border-border overflow-hidden">
          {recent.length === 0 && allTxs.length === 0 ? (
            <EmptyState
              icon={WalletIcon}
              title={t("dashboard.noTx")}
              ctaLabel={t("dashboard.noTxCta")}
              onCta={() => navigate("/transfer")}
            />
          ) : (
            <div className="divide-y divide-border">
              {recent.map((tx) => (
                <TransactionItem key={tx.id} tx={tx} />
              ))}
            </div>
          )}
        </div>

        {/* Pagination — toujours visible si au moins une transaction */}
        {allTxs.length > 0 && (
          <div className="flex items-center justify-between mt-3 px-1">
            <p className="text-xs text-muted-foreground">
              {allTxs.length <= TX_PAGE_SIZE
                ? `${allTxs.length} opération${allTxs.length > 1 ? "s" : ""}`
                : `${(txPage - 1) * TX_PAGE_SIZE + 1}–${Math.min(txPage * TX_PAGE_SIZE, allTxs.length)} sur ${allTxs.length}`}
            </p>
            {txTotalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setTxPage((p) => Math.max(1, p - 1))}
                  disabled={txPage === 1}
                  className="h-7 w-7 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:bg-secondary disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft size={13} />
                </button>
                <span className="text-xs font-medium text-muted-foreground px-2">
                  {txPage} / {txTotalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setTxPage((p) => Math.min(txTotalPages, p + 1))}
                  disabled={txPage === txTotalPages}
                  className="h-7 w-7 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:bg-secondary disabled:opacity-30 transition-colors"
                >
                  <ChevronRight size={13} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
