import React from "react";
import { ArrowDownLeft, ArrowUpRight, Clock, Link2, ArrowLeftRight, Bitcoin, Banknote } from "lucide-react";
import { formatAmount, formatDate } from "../../lib/format";

const CATEGORY_ICON = {
  payment_link: Link2,
  p2p_transfer: ArrowLeftRight,
  fiat_withdrawal_refund: Banknote,
  crypto_deposit_btc: Bitcoin,
  crypto_deposit_usdt: Bitcoin,
};

export const TransactionItem = ({ tx, onClick }) => {
  const isCredit = tx.type === "credit";
  const isPendingLike = tx.status === "pending" || tx.status === "processing";
  const statusLabel = tx.status === "processing" ? "en cours" : "pending";
  const CatIcon = CATEGORY_ICON[tx.category];
  const icon = CatIcon ? <CatIcon size={18} /> : (isCredit ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />);
  const isPayLink = tx.category === "payment_link";
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`tx-item-${tx.id}`}
      className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-secondary transition-base text-left"
    >
      <div
        className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${
          isPayLink ? "bg-primary/10 text-primary" :
          isCredit ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
        }`}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium text-foreground truncate">{tx.label}</p>
          {isPendingLike && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-warning bg-warning/10 px-1.5 py-0.5 rounded-md">
              <Clock size={10} /> {statusLabel}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {tx.counterpart} · {formatDate(tx.date)}
        </p>
      </div>
      <div
        className={`text-sm font-semibold tabular-nums shrink-0 ${
          isCredit ? "text-success" : "text-foreground"
        }`}
      >
        {isCredit ? "+" : "−"} {formatAmount(tx.amount, tx.currency)}
      </div>
    </button>
  );
};
