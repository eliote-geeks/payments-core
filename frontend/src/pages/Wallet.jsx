import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Upload, Download } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { Button } from "../components/ui/button";
import { TransactionItem } from "../components/common/TransactionItem";
import { EmptyState } from "../components/common/EmptyState";
import { formatAmount } from "../lib/format";
import { useI18n } from "../context/I18nContext";
import { Wallet as WalletIcon } from "lucide-react";
import { getTransactions, getWallets } from "../api/wallet";
import { getRates } from "../api/rates";

// Target currencies to show for each wallet currency
const DISPLAY_CONVERSIONS = {
  FCFA: ["EUR", "USD"],
  USDT: ["FCFA", "USD"],
  EUR:  ["FCFA", "USD"],
  USD:  ["FCFA", "EUR"],
  BTC:  ["USD", "FCFA"],
};

// Rates API returns [{ pair: "EUR/FCFA", rate: 655.957 }, ...]
// Build a toFCFA map: { EUR: 655.957, USD: 568.87, BTC: 42150000, USDT: 568.87, FCFA: 1 }
function buildToFCFA(rates) {
  const map = { FCFA: 1 };
  (rates || []).forEach((r) => {
    const [base, quote] = (r.pair || "").split("/");
    if (quote === "FCFA" && base) map[base] = r.rate;
  });
  return map;
}

function useConversions(wallets, rates) {
  return useMemo(() => {
    if (!rates?.length) return {};
    const toFCFA = buildToFCFA(rates);
    const out = {};
    (wallets || []).forEach((w) => {
      const balance = parseFloat(w.balance) || 0;
      const inFCFA = balance * (toFCFA[w.currency] ?? 0);
      const targets = DISPLAY_CONVERSIONS[w.currency] || [];
      out[w.currency] = targets.map((target) => {
        const rate = toFCFA[target];
        if (!rate) return null;
        const converted = target === "FCFA" ? inFCFA : inFCFA / rate;
        return { currency: target, value: converted };
      }).filter(Boolean);
    });
    return out;
  }, [wallets, rates]);
}

export default function Wallet() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [wallets, setWallets] = useState(null);
  const [txs, setTxs] = useState(null);
  const [rates, setRates] = useState([]);
  const visibleWallets = useMemo(
    () => (wallets || []).filter((w) => w.currency !== "BTC"),
    [wallets]
  );
  const conversions = useConversions(visibleWallets, rates);

  useEffect(() => {
    let alive = true;
    Promise.all([getWallets(), getTransactions(200), getRates()])
      .then(([w, tr, r]) => {
        if (!alive) return;
        setWallets(w || []);
        setTxs(tr || []);
        setRates(r || []);
      })
      .catch(() => {
        setWallets([]);
        setTxs([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="space-y-6" data-testid="wallet-page">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">{t("wallet.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {visibleWallets.length} {t("wallet.balance").toLowerCase()}s
        </p>
      </div>

      <Tabs defaultValue="FCFA" className="w-full">
        <TabsList className="w-full flex overflow-x-auto no-scrollbar bg-secondary rounded-md h-auto p-1" data-testid="wallet-tabs">
          {visibleWallets.map((w) => (
            <TabsTrigger
              key={w.currency}
              value={w.currency}
              data-testid={`wallet-tab-${w.currency}`}
              className="flex-1 min-w-[80px] data-[state=active]:bg-surface data-[state=active]:text-primary data-[state=active]:shadow-sm rounded-md py-2 text-sm font-medium"
            >
              {w.currency}
            </TabsTrigger>
          ))}
        </TabsList>

        {visibleWallets.map((w) => {
          const history = (txs || []).filter((t) => t.currency === w.currency);
          return (
            <TabsContent key={w.currency} value={w.currency} className="mt-5 space-y-5">
              <div className="rounded-xl bg-surface border border-border p-6" data-testid={`wallet-card-${w.currency}`}>
                <p className="text-xs uppercase tracking-widest text-muted-foreground">{t("wallet.balance")}</p>
                <p className="font-display text-3xl font-bold mt-1 tabular-nums">{formatAmount(w.balance, w.currency)}</p>

                {/* Conversion chips — style dashboard */}
                {conversions[w.currency]?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {conversions[w.currency].map(({ currency, value }) => (
                      <span key={currency} className="inline-flex items-center gap-1 text-xs font-medium bg-secondary text-muted-foreground px-2.5 py-1 rounded-full border border-border">
                        {currency === "FCFA"
                          ? `${Math.round(value).toLocaleString("fr-FR")} FCFA`
                          : `${value < 0.01 ? value.toFixed(6) : value.toFixed(2)} ${currency}`}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-5 grid grid-cols-2 gap-2">
                  <Button
                    onClick={() => {
                      if (w.currency === "USDT") {
                        navigate("/crypto-deposit");
                      } else {
                        navigate(`/fiat-deposit?currency=${w.currency}`);
                      }
                    }}
                    data-testid={`wallet-deposit-${w.currency}`}
                    className="bg-primary hover:bg-primary/90 rounded-md text-primary-foreground"
                  >
                    <Download size={16} className="mr-1" /> {t("common.deposit")}
                  </Button>
                  <Button
                    onClick={() => {
                      if (w.currency === "USDT") {
                        navigate("/crypto-withdraw");
                      } else {
                        navigate(`/fiat-withdraw?currency=${w.currency}`);
                      }
                    }}
                    data-testid={`wallet-withdraw-${w.currency}`}
                    variant="outline"
                    className="rounded-md border-border"
                  >
                    <Upload size={16} className="mr-1" /> {t("common.withdraw")}
                  </Button>
                </div>
              </div>

              <div>
                <p className="text-xs uppercase tracking-widest text-muted-foreground font-medium mb-3">
                  {t("wallet.history")}
                </p>
                <div className="rounded-xl bg-surface border border-border overflow-hidden">
                  {history.length === 0 ? (
                    <EmptyState icon={WalletIcon} title={t("history.empty")} />
                  ) : (
                    <div className="divide-y divide-border">
                      {history.map((tx) => <TransactionItem key={tx.id} tx={tx} />)}
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
