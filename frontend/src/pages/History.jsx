import React, { useEffect, useMemo, useState } from "react";
import { TransactionItem } from "../components/common/TransactionItem";
import { EmptyState } from "../components/common/EmptyState";
import { useI18n } from "../context/I18nContext";
import { History as HistoryIcon, Search, CalendarDays, Download, X, ChevronLeft, ChevronRight } from "lucide-react";
import { getTransactions } from "../api/wallet";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { Calendar } from "../components/ui/calendar";
import { format, isWithinInterval, startOfDay, endOfDay } from "date-fns";

const PAGE_SIZE = 15;

export default function History() {
  const { t } = useI18n();
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [dateRange, setDateRange] = useState(undefined);
  const [calOpen, setCalOpen] = useState(false);
  const [txs, setTxs] = useState(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let alive = true;
    getTransactions(500)
      .then((items) => { if (alive) setTxs(items || []); })
      .catch(() => setTxs([]));
    return () => { alive = false; };
  }, []);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [filter, search, dateRange]);

  const filtered = useMemo(() => {
    let items = txs || [];
    if (filter === "credits") items = items.filter((tx) => tx.type === "credit");
    if (filter === "debits") items = items.filter((tx) => tx.type === "debit");
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter((tx) =>
        tx.label?.toLowerCase().includes(q) ||
        tx.counterpart?.toLowerCase().includes(q) ||
        String(tx.amount).includes(q)
      );
    }
    if (dateRange?.from) {
      const from = startOfDay(dateRange.from);
      const to = endOfDay(dateRange.to || dateRange.from);
      items = items.filter((tx) => isWithinInterval(new Date(tx.date), { start: from, end: to }));
    }
    return items;
  }, [filter, search, dateRange, txs]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const grouped = useMemo(() => {
    const map = {};
    for (const tx of paginated) {
      const day = new Date(tx.date).toDateString();
      if (!map[day]) map[day] = [];
      map[day].push(tx);
    }
    return map;
  }, [paginated]);

  const exportCsv = () => {
    const header = "Date,Type,Label,Contrepartie,Montant,Devise,Statut\n";
    const rows = filtered.map((tx) => [
      new Date(tx.date).toISOString(),
      tx.type,
      `"${(tx.label || "").replace(/"/g, '""')}"`,
      `"${(tx.counterpart || "").replace(/"/g, '""')}"`,
      tx.amount,
      tx.currency,
      tx.status,
    ].join(",")).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kobo-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const loading = txs === null;
  const hasDateRange = !!dateRange?.from;
  const dateLabel = hasDateRange
    ? dateRange.to && dateRange.to.toDateString() !== dateRange.from.toDateString()
      ? `${format(dateRange.from, "dd/MM")} – ${format(dateRange.to, "dd/MM/yy")}`
      : format(dateRange.from, "dd/MM/yy")
    : null;

  return (
    <div className="space-y-5" data-testid="history-page">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">{t("history.title")}</h1>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={exportCsv}
          disabled={loading || filtered.length === 0}
          className="shrink-0 rounded-md border-border text-xs gap-1.5"
        >
          <Download size={13} /> CSV
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          type="text"
          placeholder={`${t("common.search")}…`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-md pl-9 pr-9"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Filter chips + date picker */}
      <div className="flex items-center gap-2 flex-wrap" data-testid="history-filters">
        {[
          { k: "all", label: t("history.all") },
          { k: "credits", label: t("history.credits") },
          { k: "debits", label: t("history.debits") },
        ].map((f) => (
          <button
            key={f.k}
            type="button"
            onClick={() => setFilter(f.k)}
            data-testid={`history-filter-${f.k}`}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-base ${
              filter === f.k
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}

        <Popover open={calOpen} onOpenChange={setCalOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-base ${
                hasDateRange
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              <CalendarDays size={13} />
              {dateLabel || "Période"}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="range"
              selected={dateRange}
              onSelect={(r) => {
                setDateRange(r);
                if (r?.from && r?.to) setCalOpen(false);
              }}
              numberOfMonths={1}
              toDate={new Date()}
            />
            {hasDateRange && (
              <div className="border-t border-border p-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setDateRange(undefined); setCalOpen(false); }}
                  className="w-full text-xs text-muted-foreground hover:text-foreground py-1"
                >
                  Effacer la période
                </button>
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>

      {/* Results */}
      {!loading && filtered.length === 0 ? (
        <div className="rounded-xl bg-surface border border-border">
          <EmptyState icon={HistoryIcon} title={t("history.empty")} />
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([day, dayTxs]) => (
            <div key={day}>
              <p className="text-xs uppercase tracking-widest text-muted-foreground font-medium mb-2 px-1">
                {new Date(day).toLocaleDateString("fr-FR", {
                  weekday: "long",
                  day: "2-digit",
                  month: "long",
                })}
              </p>
              <div className="rounded-xl bg-surface border border-border overflow-hidden divide-y divide-border">
                {dayTxs.map((tx) => <TransactionItem key={tx.id} tx={tx} />)}
              </div>
            </div>
          ))}

          {/* Pagination controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-2 pt-2">
              <p className="text-xs text-muted-foreground">
                {filtered.length} transaction{filtered.length > 1 ? "s" : ""} · Page {page}/{totalPages}
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="h-8 w-8 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-base"
                >
                  <ChevronLeft size={15} />
                </button>

                {/* Page numbers */}
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                  .reduce((acc, p, idx, arr) => {
                    if (idx > 0 && arr[idx - 1] !== p - 1) acc.push("…");
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((p, i) =>
                    p === "…" ? (
                      <span key={`dots-${i}`} className="h-8 w-6 flex items-center justify-center text-xs text-muted-foreground">…</span>
                    ) : (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPage(p)}
                        className={`h-8 min-w-[32px] px-2 rounded-md text-xs font-medium transition-base ${
                          p === page
                            ? "bg-primary text-primary-foreground"
                            : "border border-border text-muted-foreground hover:bg-secondary"
                        }`}
                      >
                        {p}
                      </button>
                    )
                  )}

                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="h-8 w-8 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-base"
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          )}

          {totalPages <= 1 && !loading && filtered.length > 0 && (
            <p className="text-xs text-center text-muted-foreground py-1">
              {filtered.length} transaction{filtered.length > 1 ? "s" : ""}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
