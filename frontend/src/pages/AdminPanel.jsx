import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle, XCircle, RefreshCw, ArrowDownToLine, Send, Clock,
  Globe, Plus, Pencil, Trash2, Landmark, ArrowLeftRight, Settings,
  ChevronUp, ChevronDown, ChevronsUpDown, Search, ChevronLeft,
  ChevronRight, Eye, MessageSquare, UserCheck, AlertCircle, FileText,
  X, Check, Ban, Users, Activity, BarChart2, Download, Shield,
  LogOut, Mail, Lock, TrendingUp, Zap, UserX, UserCog, Megaphone, Banknote,
  History, SlidersHorizontal, Key, Webhook, Copy, ExternalLink, Link2,
  Wallet, ShieldCheck, ArrowUpDown, Building2, DollarSign, Smartphone, Loader2,
  Database, PackageOpen, Bitcoin,
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";

const ADMIN_TOKEN_KEY = "kobo_admin_token";
const ADMIN_ROLE_KEY  = "kobo_admin_role";
const ADMIN_EMAIL_KEY = "kobo_admin_email";

const ROLE_PERMS = {
  superadmin: ["*"],
  ops:        ["analytics","view_activity","confirm_withdrawal","reject_withdrawal","force_status",
               "confirm_deposit","reject_deposit","kyc_decide","block_user","view_users",
               "intl","crypto_ops","fraud_review"],
  support:    ["view_activity","view_users","reply_ticket"],
};
// Mapping statique id→perm pour les useEffect qui s'exécutent avant le rendu des TABS
const TAB_PERM_MAP = {
  analytics: "analytics", activity: "view_activity", users: "view_users",
  accounting: "*", "balance-audit": "*",
  deposits: "crypto_ops", "fiat-deposits": "confirm_deposit",
  "fiat-withdrawals": "confirm_withdrawal", "mm-bridge": "confirm_withdrawal", withdrawals: "crypto_ops",
  "crypto-onchain": "crypto_ops",
  "p2p-transfers": "view_activity", virements: "confirm_withdrawal", intl: "intl", kyc: "kyc_decide",
  support: "reply_ticket", wallets: "crypto_ops", fraud: "fraud_review",
  marketing: "*", fees: "*", compliance: "*", audit: "*", team: "*", settings: "*", exports: "*",
  "admin-sessions": "*",
};
function hasPermission(role, perm) {
  const perms = ROLE_PERMS[role] || [];
  return perms.includes("*") || perms.includes(perm);
}
const API = "https://pay-api.koboonline.com";

function csrfHeader() {
  const raw = document.cookie.split("; ").find((part) => part.startsWith("kobo_csrf="));
  return raw ? decodeURIComponent(raw.slice("kobo_csrf=".length)) : "";
}

async function adminFetch(path, method = "GET", body = null, token) {
  const headers = { "Content-Type": "application/json" };
  const csrf = csrfHeader();
  if (csrf && method !== "GET") headers["X-CSRF-Token"] = csrf;
  if (token) headers["X-Admin-Token"] = token;
  const res = await fetch(`${API}${path}`, {
    method,
    credentials: "include",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = typeof err.detail === "object" ? err.detail?.message : err.detail;
    const error = new Error(res.status === 401 ? "Session admin expirée. Reconnectez-vous." : detail || `Erreur ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n) {
  if (n == null) return "—";
  return Number(n).toLocaleString("fr-FR");
}

function fmtDate(s) {
  if (!s) return "—";
  return new Date(s).toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportCsv(columns, data, filename) {
  const header = columns.map((c) => c.label).join(",");
  const rows = data.map((row) =>
    columns.map((c) => {
      const v = String(row[c.key] ?? "").replace(/"/g, '""');
      return `"${v}"`;
    }).join(",")
  );
  triggerDownload(
    new Blob(["﻿" + [header, ...rows].join("\n")], { type: "text/csv;charset=utf-8;" }),
    filename,
  );
}

function exportJson(data, filename) {
  triggerDownload(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    filename.replace(/\.csv$/, ".json"),
  );
}

function exportExcel(columns, data, filename) {
  const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const isNum = (v) => v !== null && v !== "" && !isNaN(Number(v));

  const headerRow = columns.map((c) =>
    `<Cell><Data ss:Type="String">${esc(c.label)}</Data></Cell>`
  ).join("");

  const dataRows = data.map((row) =>
    `<Row>${columns.map((c) => {
      const v = row[c.key] ?? "";
      const type = isNum(v) ? "Number" : "String";
      return `<Cell><Data ss:Type="${type}">${esc(v)}</Data></Cell>`;
    }).join("")}</Row>`
  ).join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="header"><Font ss:Bold="1"/></Style>
  </Styles>
  <Worksheet ss:Name="Export">
    <Table>
      <Row>${headerRow}</Row>
${dataRows}
    </Table>
  </Worksheet>
</Workbook>`;

  triggerDownload(
    new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8;" }),
    filename.replace(/\.csv$/, ".xls"),
  );
}

// Petit menu déroulant pour choisir le format d'export
function ExportMenu({ label = "Exporter", onCsv, onExcel, onJson }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="h-8 px-3 rounded-md border border-border text-xs flex items-center gap-1.5 hover:bg-secondary transition-colors"
      >
        <Download size={13} /> {label}
        <ChevronDown size={11} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-background border border-border rounded-xl shadow-lg py-1 min-w-[130px]">
          {onCsv && (
            <button onClick={() => { onCsv(); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-secondary transition-colors flex items-center gap-2">
              <FileText size={12} /> CSV
            </button>
          )}
          {onExcel && (
            <button onClick={() => { onExcel(); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-secondary transition-colors flex items-center gap-2">
              <FileText size={12} /> Excel (.xls)
            </button>
          )}
          {onJson && (
            <button onClick={() => { onJson(); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-secondary transition-colors flex items-center gap-2">
              <FileText size={12} /> JSON
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const STATUS_COLORS = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  pending_approval: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  pending_payment: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  pending_settlement: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  processing: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  submitted: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  in_review: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  confirmed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  approved: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  auto_confirmed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  hash_verified: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  settled: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  open: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  closed: "bg-secondary text-muted-foreground",
  paid: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  payin_processing: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  payout_processing: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  payout_failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  payin_failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  refunded: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
};

function StatusBadge({ status }) {
  const cls = STATUS_COLORS[status] || "bg-secondary text-muted-foreground";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
      {status || "—"}
    </span>
  );
}

// ── DataTable ─────────────────────────────────────────────────────────────────

function DataTable({ columns, data = [], searchFields = [], emptyText = "Aucune donnée", actions, exportFilename, selectable, bulkActions, tableTitle, expandable = false }) {
  const [q, setQ] = useState("");
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState(new Set());
  const [expanded, setExpanded] = useState(false);

  useEffect(() => { setPage(1); setSelected(new Set()); }, [q, data.length]);

  const filtered = q
    ? data.filter((row) => searchFields.some((f) => String(row[f] ?? "").toLowerCase().includes(q.toLowerCase())))
    : data;

  const sorted = sortCol
    ? [...filtered].sort((a, b) => {
        const av = a[sortCol] ?? "", bv = b[sortCol] ?? "";
        const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
        return sortDir === "asc" ? cmp : -cmp;
      })
    : filtered;

  const total = sorted.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const pageClamp = Math.min(page, pages);
  const rows = sorted.slice((pageClamp - 1) * pageSize, pageClamp * pageSize);

  const toggleSort = (key) => {
    if (sortCol === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(key); setSortDir("desc"); }
  };

  const toggleRow = (row) => setSelected((s) => { const n = new Set(s); n.has(row) ? n.delete(row) : n.add(row); return n; });
  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r));
  const toggleAll = () => setSelected((s) => { const n = new Set(s); if (allOnPageSelected) rows.forEach((r) => n.delete(r)); else rows.forEach((r) => n.add(r)); return n; });

  const SortIcon = ({ col }) => {
    if (!col.sortable) return null;
    if (sortCol !== col.key) return <ChevronsUpDown size={12} className="ml-1 text-muted-foreground/40" />;
    return sortDir === "asc" ? <ChevronUp size={12} className="ml-1" /> : <ChevronDown size={12} className="ml-1" />;
  };

  const tableMarkup = (
    <>
      {/* Barre d'actions en masse */}
      {selectable && selected.size > 0 && bulkActions && (
        <div className="flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-xl px-4 py-2.5 flex-wrap">
          <span className="text-sm font-semibold text-primary shrink-0">{selected.size} sélectionné{selected.size > 1 ? "s" : ""}</span>
          <div className="flex gap-2 flex-wrap flex-1">
            {bulkActions.map((act) => (
              <Button key={act.label} size="sm" variant={act.variant || "outline"} className={act.className || ""}
                onClick={() => { act.onAction([...selected]); setSelected(new Set()); }}>
                {act.icon && <act.icon size={13} className="mr-1.5" />}{act.label}
              </Button>
            ))}
          </div>
          <button onClick={() => setSelected(new Set())} className="text-muted-foreground hover:text-foreground shrink-0"><X size={15} /></button>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher…" className="pl-8 h-10 text-[15px]" />
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{total} résultat{total > 1 ? "s" : ""}{selectable && selected.size > 0 ? ` · ${selected.size} sélectionné${selected.size > 1 ? "s" : ""}` : ""}</span>
          <select
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
            className="border border-border rounded-md px-2 py-1.5 bg-background text-sm text-foreground"
          >
            {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
          </select>
        </div>
        {expandable && (
          <button
            onClick={() => setExpanded(true)}
            className="h-9 px-3 rounded-md border border-border text-sm font-semibold flex items-center gap-1.5 hover:bg-secondary transition-colors text-foreground"
          >
            <ExternalLink size={14} /> Voir en grand
          </button>
        )}
        {exportFilename && (
          <ExportMenu
            onCsv={() => exportCsv(columns.filter((c) => !c.noExport), sorted, exportFilename)}
            onExcel={() => exportExcel(columns.filter((c) => !c.noExport), sorted, exportFilename)}
            onJson={() => exportJson(sorted, exportFilename)}
          />
        )}
      </div>

      <div className="bg-background border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-[15px]">
            <thead>
              <tr className="border-b border-border bg-secondary/40">
                {selectable && (
                  <th className="px-3 py-3 w-px">
                    <input type="checkbox" checked={allOnPageSelected} onChange={toggleAll}
                      className="rounded w-4 h-4 cursor-pointer accent-primary" title={allOnPageSelected ? "Désélectionner la page" : "Sélectionner la page"} />
                  </th>
                )}
                {columns.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => col.sortable && toggleSort(col.key)}
                    className={`text-left px-4 py-3.5 font-bold text-slate-600 dark:text-slate-300 text-xs uppercase tracking-wide whitespace-nowrap ${col.sortable ? "cursor-pointer hover:text-foreground select-none" : ""}`}
                  >
                    <span className="flex items-center">{col.label}<SortIcon col={col} /></span>
                  </th>
                ))}
                {actions && <th className="px-4 py-3 w-px" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + (selectable ? 1 : 0) + (actions ? 1 : 0)} className="text-center py-12 text-muted-foreground text-sm">{emptyText}</td>
                </tr>
              ) : (
                rows.map((row, i) => (
                  <tr key={i}
                    onClick={selectable ? () => toggleRow(row) : undefined}
                    className={`transition-colors ${selectable ? "cursor-pointer select-none" : ""} ${selected.has(row) ? "bg-primary/5 hover:bg-primary/8" : "hover:bg-secondary/20"}`}>
                    {selectable && (
                      <td className="px-3 py-3 w-px" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(row)} onChange={() => toggleRow(row)}
                          className="rounded w-4 h-4 cursor-pointer accent-primary" />
                      </td>
                    )}
                    {columns.map((col) => (
                      <td key={col.key} className="px-4 py-3.5 whitespace-nowrap text-slate-950 dark:text-slate-100">
                        {col.render ? col.render(row[col.key], row) : <span className="text-foreground">{row[col.key] ?? "—"}</span>}
                      </td>
                    ))}
                    {actions && <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}><div className="flex items-center gap-1 justify-end">{actions(row)}</div></td>}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {pageClamp} / {pages}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pageClamp === 1} className="h-7 w-7 rounded border border-border flex items-center justify-center disabled:opacity-30 hover:bg-secondary">
              <ChevronLeft size={13} />
            </button>
            {Array.from({ length: Math.min(5, pages) }, (_, i) => {
              const pg = pageClamp <= 3 ? i + 1 : Math.min(pages - 4, pageClamp - 2) + i;
              return (
                <button key={pg} onClick={() => setPage(pg)} className={`h-7 w-7 rounded border text-xs font-medium ${pg === pageClamp ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-secondary"}`}>
                  {pg}
                </button>
              );
            })}
            <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={pageClamp === pages} className="h-7 w-7 rounded border border-border flex items-center justify-center disabled:opacity-30 hover:bg-secondary">
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      )}
    </>
  );

  return (
    <div className="space-y-3">
      {tableMarkup}
      {expanded && (
        <div className="fixed inset-0 z-[80] bg-background flex flex-col">
          <div className="h-14 px-4 border-b border-border flex items-center justify-between shrink-0">
            <div>
              <h3 className="font-bold text-lg text-foreground">{tableTitle || "Tableau"}</h3>
              <p className="text-sm text-muted-foreground">{total} ligne{total > 1 ? "s" : ""} filtrée{total > 1 ? "s" : ""}</p>
            </div>
            <button onClick={() => setExpanded(false)} className="h-9 px-3 rounded-md border border-border text-sm font-semibold flex items-center gap-1.5 hover:bg-secondary">
              <X size={15} /> Fermer
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-4">
            <div className="min-w-[1100px] space-y-3">
              {tableMarkup}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Modals ────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className={`bg-background border border-border rounded-2xl shadow-2xl w-full ${wide ? "max-w-2xl" : "max-w-md"} max-h-[90vh] flex flex-col`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h3 className="font-semibold text-base">{title}</h3>
          <button onClick={onClose} className="h-7 w-7 rounded-md hover:bg-secondary flex items-center justify-center text-muted-foreground"><X size={16} /></button>
        </div>
        <div className="overflow-y-auto p-5 flex-1">{children}</div>
      </div>
    </div>
  );
}

function UsdtVerifyModal({ transfer, token, onClose, onConfirmed }) {
  const [scanning, setScanning] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [candidates, setCandidates] = useState(null);
  const [bestMatch, setBestMatch] = useState(null);
  const [manualHash, setManualHash] = useState("");
  const [verifyResult, setVerifyResult] = useState(null);
  const [error, setError] = useState("");

  const fmtTs = (iso) => iso ? new Date(iso).toLocaleString("fr-FR") : "—";
  const fmtUsdt = (n) => Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 6 });

  const scan = async () => {
    setScanning(true); setError(""); setCandidates(null); setBestMatch(null); setVerifyResult(null);
    try {
      const res = await adminFetch(`/admin/intl-transfers/${transfer.id}/scan-usdt`, "GET", null, token);
      setCandidates(res.candidates || []);
      setBestMatch(res.best_match || null);
      if (res.best_match) setManualHash(res.best_match.tx_hash);
    } catch (e) { setError(e.message); } finally { setScanning(false); }
  };

  const verify = async (txHash) => {
    if (!txHash?.trim()) { setError("Hash requis"); return; }
    setVerifying(true); setError(""); setVerifyResult(null);
    try {
      const res = await adminFetch(`/admin/intl-transfers/${transfer.id}/verify-usdt-tx`, "POST", { tx_hash: txHash.trim(), auto_confirm: true }, token);
      setVerifyResult(res);
      if (res.payment_confirmed) onConfirmed();
    } catch (e) { setError(e.message); } finally { setVerifying(false); }
  };

  const statusColor = {
    auto_confirmed: "text-green-600",
    hash_verified: "text-blue-500",
    needs_manual_review: "text-amber-500",
    invalid: "text-red-500",
  };
  const statusLabel = {
    auto_confirmed: "Confirmé automatiquement",
    hash_verified: "Hash vérifié — confirmations insuffisantes",
    needs_manual_review: "Revue manuelle requise",
    invalid: "Transaction invalide",
  };

  return (
    <Modal title="Vérification paiement USDT via TronScan" onClose={onClose} wide>
      <div className="space-y-5">

        {/* Infos transfert */}
        <div className="rounded-xl bg-secondary/40 p-4 text-sm space-y-1.5">
          <div className="flex justify-between"><span className="text-muted-foreground">Référence</span><code className="font-mono text-xs">{transfer.id}</code></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Montant attendu</span><span className="font-bold text-emerald-600">{fmtUsdt(transfer.source_amount)} USDT</span></div>
          <div className="flex justify-between text-xs"><span className="text-muted-foreground">Réseau</span><span className="font-mono">TRC-20 (TRON)</span></div>
        </div>

        {/* Scan automatique */}
        <div>
          <p className="text-sm font-semibold mb-2">1. Scan automatique TronScan</p>
          <Button onClick={scan} disabled={scanning} className="w-full h-9 rounded-md" variant="outline">
            {scanning ? <><RefreshCw size={14} className="animate-spin mr-2" />Scan en cours…</> : <><RefreshCw size={14} className="mr-2" />Scanner les transactions entrantes</>}
          </Button>
        </div>

        {/* Résultats du scan */}
        {candidates !== null && (
          <div>
            {candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-3">Aucune transaction USDT trouvée après la création du transfert.</p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{candidates.length} transaction{candidates.length > 1 ? "s" : ""} trouvée{candidates.length > 1 ? "s" : ""}</p>
                <div className="rounded-xl border border-border overflow-hidden divide-y divide-border max-h-48 overflow-y-auto">
                  {candidates.map((c) => (
                    <div key={c.tx_hash}
                      className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors hover:bg-secondary/50 ${c.tx_hash === manualHash ? "bg-primary/5 border-l-2 border-primary" : ""}`}
                      onClick={() => setManualHash(c.tx_hash)}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {c.amount_match && c.success && <CheckCircle size={12} className="text-green-500 shrink-0" />}
                          <code className="text-xs font-mono truncate text-foreground">{c.tx_hash.slice(0, 16)}…{c.tx_hash.slice(-8)}</code>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{fmtTs(c.block_ts_iso)}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-sm font-bold tabular-nums ${c.amount_match ? "text-green-600" : "text-red-500"}`}>{fmtUsdt(c.amount_usdt)} USDT</p>
                        <p className="text-[10px] text-muted-foreground">{c.success ? "Confirmée" : "Non confirmée"}</p>
                      </div>
                    </div>
                  ))}
                </div>
                {bestMatch && (
                  <p className="text-xs text-green-600 flex items-center gap-1"><CheckCircle size={11} />Correspondance trouvée — sélectionnée automatiquement</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Hash manuel */}
        <div>
          <p className="text-sm font-semibold mb-2">2. Vérifier par hash de transaction</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={manualHash}
              onChange={(e) => setManualHash(e.target.value)}
              placeholder="Coller le Transaction ID TronScan (64 hex)"
              className="flex-1 border border-border rounded-md px-3 py-2 text-xs font-mono bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <Button onClick={() => verify(manualHash)} disabled={verifying || !manualHash.trim()}
            className="w-full h-9 mt-2 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
            {verifying ? <><RefreshCw size={14} className="animate-spin mr-2" />Vérification TronScan…</> : <>Vérifier et confirmer le paiement</>}
          </Button>
        </div>

        {/* Résultat vérification */}
        {verifyResult && (
          <div className={`rounded-xl border p-4 space-y-2 ${verifyResult.payment_confirmed ? "border-green-500/30 bg-green-500/5" : "border-border bg-secondary/30"}`}>
            <p className={`font-semibold text-sm ${statusColor[verifyResult.verify_status] || "text-foreground"}`}>
              {statusLabel[verifyResult.verify_status] || verifyResult.verify_status}
            </p>
            {verifyResult.amount_usdt && (
              <p className="text-xs text-muted-foreground">Montant détecté : <strong className="text-foreground">{fmtUsdt(verifyResult.amount_usdt)} USDT</strong></p>
            )}
            {verifyResult.confirmations > 0 && (
              <p className="text-xs text-muted-foreground">Confirmations blockchain : <strong className="text-foreground">{verifyResult.confirmations}</strong></p>
            )}
            {verifyResult.reason && (
              <p className="text-xs text-muted-foreground">{verifyResult.reason}</p>
            )}
            {verifyResult.payment_confirmed && (
              <div className="flex items-center gap-2 pt-1">
                <CheckCircle size={14} className="text-green-500" />
                <p className="text-sm font-semibold text-green-600">Paiement confirmé — transfert en cours de traitement</p>
              </div>
            )}
          </div>
        )}

        {error && <p className="text-sm text-destructive flex items-center gap-1"><AlertCircle size={13} />{error}</p>}

        <div className="pt-1">
          <Button variant="outline" onClick={onClose} className="w-full h-9 rounded-md">Fermer</Button>
        </div>
      </div>
    </Modal>
  );
}


function IntlTransferDetailModal({ transfer: t, token, onClose, onAction }) {
  const fmt = (n, c = "") => c
    ? `${Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`
    : Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const fmtDate = (iso) => iso ? new Date(iso).toLocaleString("fr-FR") : "—";

  const statusColors = {
    pending_payment: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    pending_funding: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    pending_settlement: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    completed: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    cancelled: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  };

  if (!t) return null;
  const isUsdt = t.funding_method === "usdt";
  const isPendingPayment = ["pending_payment", "pending_funding"].includes(t.status);

  return (
    <Modal title="Détail du transfert international" onClose={onClose} wide>
      <div className="space-y-5">

        {/* Statut + référence */}
        <div className="flex items-center justify-between">
          <code className="text-xs font-mono bg-secondary px-2 py-1 rounded text-foreground">{t.id}</code>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusColors[t.status] || "bg-secondary text-muted-foreground"}`}>
            {t.status}
          </span>
        </div>

        {/* Flux montant */}
        <div className="rounded-xl bg-secondary/40 p-4">
          <div className="flex items-center justify-between">
            <div className="text-center flex-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">Envoyé</p>
              <p className="text-xl font-bold tabular-nums text-foreground">{fmt(t.source_amount, t.source_currency)}</p>
              {isUsdt && <span className="text-[10px] text-emerald-600 font-semibold">USDT (TRC-20)</span>}
            </div>
            <ArrowLeftRight size={16} className="text-muted-foreground mx-3 shrink-0" />
            <div className="text-center flex-1">
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">Reçoit</p>
              <p className="text-xl font-bold tabular-nums text-primary">{fmt(t.target_amount, t.target_currency)}</p>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-border flex justify-between text-xs text-muted-foreground">
            <span>Frais : <strong className="text-foreground">{fmt(t.fees_amount, t.source_currency)}</strong></span>
            <span>Méthode : <strong className="text-foreground">{isUsdt ? "USDT" : "Virement"}</strong></span>
            <span>{fmtDate(t.created_at)}</span>
          </div>
        </div>

        {/* Expéditeur / Destinataire */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-border p-3 space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Expéditeur</p>
            <p className="text-sm font-medium text-foreground">{t.sender_name || "—"}</p>
            <p className="text-xs text-muted-foreground font-mono">{t.sender_phone || "—"}</p>
            {t.user_id && <p className="text-[10px] text-muted-foreground truncate">ID : {t.user_id}</p>}
          </div>
          <div className="rounded-xl border border-border p-3 space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Bénéficiaire</p>
            <p className="text-sm font-medium text-foreground">{t.recipient_name || "—"}</p>
            <p className="text-xs text-muted-foreground font-mono">{t.recipient_phone || "—"}</p>
          </div>
        </div>

        {/* Actions principales */}
        {isPendingPayment && (
          <div className="rounded-xl border border-amber-300/40 bg-amber-50/50 dark:bg-amber-900/10 p-4 space-y-3">
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
              <Clock size={14} />En attente de paiement
            </p>
            <p className="text-xs text-muted-foreground">
              {isUsdt
                ? "Vérifiez que le paiement USDT a bien été reçu sur l'adresse Kobo avant de confirmer."
                : "Vérifiez le virement bancaire sur le compte Kobo avant de confirmer."
              }
            </p>
            <div className="flex gap-2">
              {isUsdt ? (
                <Button size="sm" className="flex-1 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md"
                  onClick={() => { onClose(); onAction("verify-usdt", t); }}>
                  <ShieldCheck size={13} />Vérifier USDT (TronScan)
                </Button>
              ) : (
                <Button size="sm" className="flex-1 gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md"
                  onClick={() => { onClose(); onAction("confirm-payment", t); }}>
                  <CheckCircle size={13} />Confirmer paiement reçu
                </Button>
              )}
            </div>
          </div>
        )}

        {t.status === "pending_settlement" && (
          <div className="rounded-xl border border-blue-300/40 bg-blue-50/50 dark:bg-blue-900/10 p-4 space-y-2">
            <p className="text-sm font-semibold text-blue-700 dark:text-blue-400 flex items-center gap-1.5">
              <Send size={14} />Paiement reçu — en attente d'envoi
            </p>
            <Button size="sm" className="w-full gap-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md"
              onClick={() => { onClose(); onAction("complete", t); }}>
              <CheckCircle size={13} />Marquer fonds envoyés
            </Button>
          </div>
        )}

        <Button variant="outline" onClick={onClose} className="w-full h-9 rounded-md">Fermer</Button>
      </div>
    </Modal>
  );
}


function ConfirmDepositModal({ deposit, token, onClose, onDone }) {
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState("");
  const confirm = async () => {
    setLoading(true);
    try { await adminFetch(`/admin/crypto/deposits/${deposit.deposit_id}/confirm`, "POST", { note }, token); toast.success("Dépôt confirmé"); onDone(); }
    catch (e) { toast.error(e.message); } finally { setLoading(false); }
  };
  const reject = async () => {
    if (!note.trim()) { toast.error("Motif requis"); return; }
    setLoading(true);
    try { await adminFetch(`/admin/crypto/deposits/${deposit.deposit_id}/reject`, "POST", { reason: note }, token); toast.success("Dépôt rejeté"); onDone(); }
    catch (e) { toast.error(e.message); } finally { setLoading(false); }
  };
  const vStatus = deposit.verification_status;
  const isAutoConfirmed = vStatus === "auto_confirmed";
  const isHashVerified = vStatus === "hash_verified";

  return (
    <Modal title={isAutoConfirmed ? "Dépôt auto-vérifié" : "Confirmer / Rejeter le dépôt"} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <div className="bg-secondary/50 rounded-lg p-3 space-y-1">
          <p><span className="text-muted-foreground">Utilisateur </span><strong>{deposit.phone_e164 || deposit.user_id}</strong></p>
          <p><span className="text-muted-foreground">Montant </span><strong>{deposit.amount_usdt} USDT → {fmt(deposit.amount_xaf)} FCFA</strong></p>
          <p><span className="text-muted-foreground">Réseau </span>{deposit.network}</p>
          {deposit.tx_hash && <p className="font-mono text-xs text-muted-foreground truncate">{deposit.tx_hash}</p>}
          {vStatus && (
            <p className="flex items-center gap-1.5 mt-1">
              <span className="text-muted-foreground">Vérif. blockchain </span>
              <StatusBadge status={vStatus} />
              {deposit.verification_confirmations != null && (
                <span className="text-xs text-muted-foreground">({deposit.verification_confirmations} confirmations)</span>
              )}
            </p>
          )}
        </div>
        {isAutoConfirmed ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <CheckCircle size={14} />
            Ce dépôt a été crédité automatiquement par le système — aucune action requise.
          </div>
        ) : (
          <>
            <Input placeholder={isHashVerified ? "Note (optionnel)" : "Note / motif de rejet"} value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={reject} disabled={loading}><XCircle size={14} className="mr-1.5" />Rejeter</Button>
              <Button className="flex-1" onClick={confirm} disabled={loading}><CheckCircle size={14} className="mr-1.5" />{isHashVerified ? "Confirmer (hash vérifié)" : "Confirmer"}</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function WalletModal({ wallet, token, onClose, onDone }) {
  const isNew = !wallet;
  const [form, setForm] = useState({ network: wallet?.network || "", address: wallet?.address || "", label: wallet?.label || "", explorer_url_prefix: wallet?.explorer_url_prefix || "", active: wallet?.active ?? true });
  const [loading, setLoading] = useState(false);
  const save = async () => {
    setLoading(true);
    try {
      if (isNew) await adminFetch("/admin/crypto/wallets", "POST", form, token);
      else await adminFetch(`/admin/crypto/wallets/${wallet.id}`, "PUT", form, token);
      toast.success(isNew ? "Adresse ajoutée" : "Mise à jour");
      onDone();
    } catch (e) { toast.error(e.message); } finally { setLoading(false); }
  };
  const field = (key, label, placeholder) => (
    <div>
      <label className="text-xs font-medium text-muted-foreground block mb-1">{label}</label>
      <Input value={form[key]} onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))} placeholder={placeholder} className="font-mono text-sm" />
    </div>
  );
  return (
    <Modal title={isNew ? "Nouvelle adresse" : "Modifier l'adresse"} onClose={onClose}>
      <div className="space-y-3">
        {field("network", "Réseau", "TRC20 / ERC20…")}
        {field("address", "Adresse", "T…")}
        {field("label", "Label (optionnel)", "Wallet principal")}
        {field("explorer_url_prefix", "URL explorateur (optionnel)", "https://tronscan.org/#/transaction/")}
        <Button className="w-full mt-2" onClick={save} disabled={loading}>Enregistrer</Button>
      </div>
    </Modal>
  );
}

function KycDecideModal({ user, token, onClose, onDone }) {
  const [decision, setDecision] = useState("approved");
  const [level, setLevel] = useState(1);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    setLoading(true);
    try {
      await adminFetch(`/admin/kyc/${user.user_id}/decide`, "POST", { decision, level: decision === "approved" ? level : 0, reason: reason || undefined }, token);
      toast.success(`KYC ${decision === "approved" ? "approuvé" : "rejeté"}`);
      onDone();
    } catch (e) { toast.error(e.message); } finally { setLoading(false); }
  };
  return (
    <Modal title={`Décision KYC — ${user.phone_e164 || user.user_id}`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div className="bg-secondary/50 rounded-lg p-3 space-y-1">
          <p><span className="text-muted-foreground">Statut </span><StatusBadge status={user.status} /></p>
          <p><span className="text-muted-foreground">Niveau </span>{user.level}</p>
        </div>
        <div className="flex gap-2">
          {["approved", "rejected"].map((d) => (
            <button key={d} onClick={() => setDecision(d)} className={`flex-1 h-9 rounded-lg border text-sm font-medium transition-colors ${decision === d ? (d === "approved" ? "border-green-500 bg-green-500/10 text-green-600" : "border-red-500 bg-red-500/10 text-red-600") : "border-border text-muted-foreground hover:bg-secondary"}`}>
              {d === "approved" ? <><Check size={13} className="inline mr-1" />Approuver</> : <><Ban size={13} className="inline mr-1" />Rejeter</>}
            </button>
          ))}
        </div>
        {decision === "approved" && (
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-2">Niveau KYC accordé</label>
            <div className="space-y-2">
              {[
                { l: 1, label: "Niveau 1 — Identité", desc: "CNI / Passeport vérifié. Retraits jusqu'à 200 000 FCFA/mois." },
                { l: 2, label: "Niveau 2 — Adresse",  desc: "Justificatif de domicile. Retraits jusqu'à 1 000 000 FCFA/mois." },
                { l: 3, label: "Niveau 3 — Renforcé", desc: "Vérification complète. Pas de limite mensuelle." },
              ].map(({ l, label, desc }) => (
                <button key={l} onClick={() => setLevel(l)} className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${level === l ? "border-primary bg-primary/5" : "border-border hover:bg-secondary"}`}>
                  <p className={`text-sm font-semibold ${level === l ? "text-primary" : ""}`}>{label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                </button>
              ))}
            </div>
          </div>
        )}
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={decision === "rejected" ? "Motif (requis)" : "Note (optionnel)"} />
        <Button className="w-full" onClick={submit} disabled={loading || (decision === "rejected" && !reason.trim())}>Confirmer la décision</Button>
      </div>
    </Modal>
  );
}

function KycDocsModal({ user, token, onClose }) {
  const [docs, setDocs] = useState([]);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [imgError, setImgError] = useState({});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    adminFetch(`/admin/kyc/${user.user_id}/documents`, "GET", null, token)
      .then((r) => setDocs(r.documents || [])).catch((e) => toast.error(e.message)).finally(() => setLoading(false));
  }, []);
  const docUrl = (doc) => `${API}/admin/kyc/${user.user_id}/documents/${doc.doc_key}/view?view_token=${encodeURIComponent(doc.view_token || "")}`;
  const isImage = (doc) => (doc.content_type || "").startsWith("image/");
  const DOC_LABELS = { id_front: "CNI Recto", id_back: "CNI Verso", passport: "Passeport", selfie: "Selfie", proof_of_address: "Justificatif domicile" };
  return (
    <Modal title={`Documents KYC — ${user.phone_e164 || user.user_id}`} onClose={onClose} wide>
      {loading ? <div className="flex items-center justify-center py-12"><RefreshCw size={20} className="animate-spin text-muted-foreground" /></div>
        : docs.length === 0 ? <p className="text-center text-muted-foreground py-8">Aucun document</p>
        : (
          <div className="grid grid-cols-2 gap-4">
            {docs.map((doc) => (
              <div key={doc.doc_key} className="border border-border rounded-xl overflow-hidden">
                <div className="bg-secondary/40 px-3 py-2 flex items-center justify-between">
                  <span className="text-xs font-semibold">{DOC_LABELS[doc.doc_key] || doc.doc_key}</span>
                  <StatusBadge status={doc.status} />
                </div>
                {isImage(doc) && !imgError[doc.doc_key] ? (
                  <div className="aspect-video bg-secondary/20 cursor-pointer relative overflow-hidden group" onClick={() => setSelectedDoc(doc)}>
                    <img src={docUrl(doc)} alt={doc.doc_key} className="w-full h-full object-contain" onError={() => setImgError((p) => ({ ...p, [doc.doc_key]: true }))} />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                      <Eye size={24} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                ) : (
                  <div className="aspect-video bg-secondary/20 flex flex-col items-center justify-center gap-2">
                    <FileText size={32} className="text-muted-foreground" />
                    <a href={docUrl(doc)} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline">Télécharger ({((doc.size_bytes || 0) / 1024).toFixed(0)} KB)</a>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      {selectedDoc && (
        <div className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4" onClick={() => setSelectedDoc(null)}>
          <img src={docUrl(selectedDoc)} alt={selectedDoc.doc_key} className="max-w-full max-h-full rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()} />
          <button onClick={() => setSelectedDoc(null)} className="absolute top-4 right-4 h-9 w-9 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20"><X size={18} /></button>
        </div>
      )}
    </Modal>
  );
}

const UDM_PAGE = 8;
function UdmPager({ items, page, setPage, renderItem, emptyLabel = "Aucune donnée" }) {
  const total = items?.length || 0;
  const sliced = (items || []).slice(page * UDM_PAGE, (page + 1) * UDM_PAGE);
  const hasNext = (page + 1) * UDM_PAGE < total;
  if (!total) return <p className="text-xs text-muted-foreground py-2 text-center">{emptyLabel}</p>;
  return (
    <div>
      <div className="space-y-0 divide-y divide-border">{sliced.map(renderItem)}</div>
      {(page > 0 || hasNext) && (
        <div className="flex items-center justify-between pt-2 mt-1">
          <span className="text-[10px] text-muted-foreground">{page * UDM_PAGE + 1}–{Math.min((page + 1) * UDM_PAGE, total)} / {total}</span>
          <div className="flex gap-1">
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
              className="px-2 py-0.5 text-[10px] rounded border border-border disabled:opacity-30 hover:bg-secondary transition">Préc.</button>
            <button disabled={!hasNext} onClick={() => setPage(p => p + 1)}
              className="px-2 py-0.5 text-[10px] rounded border border-border disabled:opacity-30 hover:bg-secondary transition">Suiv.</button>
          </div>
        </div>
      )}
    </div>
  );
}

function UserDetailModal({ userId, token, onClose, onBlock }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [blocking, setBlocking] = useState(false);
  const [localModal, setLocalModal] = useState(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [newBalance, setNewBalance] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [depPage, setDepPage]   = useState(0);
  const [wdPage,  setWdPage]    = useState(0);
  const [p2pPage, setP2pPage]   = useState(0);
  const [txPage,  setTxPage]    = useState(0);

  const reload = () => {
    setLoading(true);
    adminFetch(`/admin/users/${userId}/detail`, "GET", null, token)
      .then(setDetail).catch((e) => toast.error(e.message)).finally(() => setLoading(false));
  };

  useEffect(() => { reload(); }, [userId]); // eslint-disable-line

  const handleAdjustBalance = async () => {
    const num = parseFloat(newBalance.replace(/\s/g, "").replace(",", "."));
    if (isNaN(num) || num < 0) { toast.error("Montant invalide"); return; }
    if (!adjustNote.trim() || adjustNote.trim().length < 5) { toast.error("Note obligatoire (min 5 caractères)"); return; }
    const fcfaWallet = detail?.wallets?.find((w) => w.currency === "FCFA");
    const prev = fcfaWallet?.balance ?? 0;
    const diff = num - prev;
    const confirmMsg = diff === 0
      ? "Aucune modification (solde identique)."
      : `${diff > 0 ? "Créditer" : "Débiter"} ${Math.abs(diff).toLocaleString("fr-FR")} FCFA pour passer de ${prev.toLocaleString("fr-FR")} à ${num.toLocaleString("fr-FR")} FCFA ?`;
    if (!window.confirm(confirmMsg)) return;
    setAdjusting(true);
    try {
      await adminFetch(`/admin/users/${userId}/adjust-balance`, "POST", { new_balance: num, note: adjustNote.trim() }, token);
      toast.success("Solde ajusté avec succès");
      setAdjustOpen(false);
      setNewBalance("");
      setAdjustNote("");
      reload();
    } catch (e) { toast.error(e.message); } finally { setAdjusting(false); }
  };

  const toggleBlock = () => {
    if (!detail) return;
    const isBlocked = detail.is_blocked;
    setLocalModal({
      title: isBlocked ? "Débloquer cet utilisateur ?" : "Bloquer cet utilisateur ?",
      description: isBlocked ? "L'utilisateur pourra se reconnecter." : "Il sera déconnecté immédiatement et ne pourra plus se connecter.",
      variant: isBlocked ? "default" : "danger",
      icon: isBlocked ? <Check size={20} /> : <Ban size={20} />,
      confirmLabel: isBlocked ? "Débloquer" : "Bloquer",
      onConfirm: async () => {
        setBlocking(true);
        const action = isBlocked ? "unblock" : "block";
        try {
          await adminFetch(`/admin/users/${userId}/${action}`, "POST", null, token);
          toast.success(isBlocked ? "Utilisateur débloqué" : "Utilisateur bloqué");
          setDetail((d) => ({ ...d, is_blocked: !d.is_blocked }));
          onBlock();
        } catch (e) { toast.error(e.message); } finally { setBlocking(false); }
      },
    });
  };

  return (
    <Modal title="Détail utilisateur" onClose={onClose} wide>
      {loading ? (
        <div className="flex items-center justify-center py-12"><RefreshCw size={20} className="animate-spin text-muted-foreground" /></div>
      ) : !detail ? null : (
        <div className="space-y-5 text-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-bold text-base">{detail.fullName || "—"}</p>
              <p className="text-muted-foreground">{detail.email}</p>
              {detail.username && <p className="text-xs text-primary">@{detail.username}</p>}
              <p className="text-xs text-muted-foreground mt-1">Inscrit le {fmtDate(detail.created_at)}</p>
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              {detail.is_blocked && <span className="text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 px-2 py-0.5 rounded-full font-semibold">Bloqué</span>}
              <Button size="sm" variant={detail.is_blocked ? "outline" : "destructive"} onClick={toggleBlock} disabled={blocking} className="text-xs">
                {blocking ? <RefreshCw size={12} className="animate-spin mr-1" /> : detail.is_blocked ? <><Check size={12} className="mr-1" />Débloquer</> : <><Ban size={12} className="mr-1" />Bloquer</>}
              </Button>
            </div>
          </div>

          {/* Wallets + ajustement */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 bg-secondary/30 border-b border-border">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><Wallet size={13} />Portefeuilles</span>
              <button onClick={() => setAdjustOpen((v) => !v)}
                className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline">
                <ArrowUpDown size={12} />{adjustOpen ? "Fermer" : "Ajuster le solde FCFA"}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-0 divide-x divide-border">
              {detail.wallets.map((w) => (
                <div key={w.currency} className="px-4 py-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest">{w.currency}</p>
                  <p className="font-bold text-xl tabular-nums">{fmt(w.balance)}</p>
                </div>
              ))}
            </div>
            {adjustOpen && (
              <div className="border-t border-border bg-amber-500/5 px-4 py-4 space-y-3">
                <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                  <ShieldCheck size={13} /> Ajustement manuel du solde FCFA — action enregistrée dans le journal
                </p>
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <label className="text-xs text-muted-foreground block mb-1">Nouveau solde FCFA</label>
                    <Input
                      type="text" inputMode="numeric"
                      placeholder={`Actuel : ${fmt(detail.wallets.find((w) => w.currency === "FCFA")?.balance ?? 0)} FCFA`}
                      value={newBalance}
                      onChange={(e) => setNewBalance(e.target.value)}
                      className="rounded-md h-9 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Motif obligatoire</label>
                  <Input
                    placeholder="Ex: correction suite à erreur technique, remboursement validé..."
                    value={adjustNote}
                    onChange={(e) => setAdjustNote(e.target.value)}
                    className="rounded-md h-9 text-sm"
                  />
                </div>
                <Button onClick={handleAdjustBalance} disabled={adjusting}
                  className="w-full h-9 bg-amber-600 hover:bg-amber-700 text-white rounded-md text-sm font-semibold">
                  {adjusting ? <RefreshCw size={14} className="animate-spin mr-2" /> : <ArrowUpDown size={14} className="mr-2" />}
                  Appliquer l'ajustement
                </Button>
              </div>
            )}
          </div>

          {detail.kyc && (
            <div className="bg-secondary/50 rounded-lg p-3 flex items-center gap-3">
              <UserCheck size={16} className="text-muted-foreground" />
              <div>
                <p className="font-medium">KYC niveau {detail.kyc.level}</p>
                <div className="flex items-center gap-2"><StatusBadge status={detail.kyc.status} /><span className="text-xs text-muted-foreground">{fmtDate(detail.kyc.updated_at)}</span></div>
              </div>
            </div>
          )}

          {/* Dépôts fiat */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="px-4 py-2.5 bg-secondary/30 border-b border-border flex items-center gap-1.5">
              <ArrowDownToLine size={13} className="text-green-500" />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dépôts fiat</span>
              <span className="ml-1 text-[10px] bg-secondary px-1.5 py-0.5 rounded-full">{detail.fiat_deposits?.length || 0}</span>
            </div>
            <div className="px-4 py-3">
              <UdmPager
                items={detail.fiat_deposits}
                page={depPage}
                setPage={setDepPage}
                emptyLabel="Aucun dépôt"
                renderItem={(d) => (
                  <div key={d.id} className="flex items-center justify-between text-xs py-2">
                    <div className="min-w-0 flex-1">
                      <span className="text-muted-foreground">{d.provider?.toUpperCase()}</span>
                      <span className="mx-1 text-muted-foreground/40">·</span>
                      <span className="text-muted-foreground">{d.reference?.slice(0, 8)}</span>
                    </div>
                    <span className="font-semibold text-green-600 mx-3 tabular-nums">+{fmt(d.amount)}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${d.status === "completed" ? "bg-green-500/10 text-green-600" : d.status === "failed" ? "bg-red-500/10 text-red-500" : "bg-yellow-500/10 text-yellow-600"}`}>{d.status}</span>
                    <span className="text-muted-foreground ml-3 shrink-0">{fmtDate(d.created_at)}</span>
                  </div>
                )}
              />
            </div>
          </div>

          {/* Retraits fiat */}
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="px-4 py-2.5 bg-secondary/30 border-b border-border flex items-center gap-1.5">
              <Send size={13} className="text-red-500" />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Retraits fiat</span>
              <span className="ml-1 text-[10px] bg-secondary px-1.5 py-0.5 rounded-full">{detail.fiat_withdrawals?.length || 0}</span>
            </div>
            <div className="px-4 py-3">
              <UdmPager
                items={detail.fiat_withdrawals}
                page={wdPage}
                setPage={setWdPage}
                emptyLabel="Aucun retrait"
                renderItem={(w) => (
                  <div key={w.id} className="flex items-center justify-between text-xs py-2">
                    <div className="min-w-0 flex-1">
                      <span className="text-muted-foreground">{w.provider?.toUpperCase() || w.method}</span>
                      {w.recipient_contact && <span className="ml-1 text-muted-foreground">· {w.recipient_contact}</span>}
                    </div>
                    <span className="font-semibold text-red-500 mx-3 tabular-nums">−{fmt(w.total_debit ?? w.amount)}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${w.status === "completed" ? "bg-green-500/10 text-green-600" : w.status === "failed" ? "bg-red-500/10 text-red-500" : "bg-yellow-500/10 text-yellow-600"}`}>{w.status}</span>
                    <span className="text-muted-foreground ml-3 shrink-0">{fmtDate(w.created_at)}</span>
                  </div>
                )}
              />
            </div>
          </div>

          {/* Transferts P2P */}
          {detail.p2p_transfers?.length > 0 && (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-2.5 bg-secondary/30 border-b border-border flex items-center gap-1.5">
                <ArrowLeftRight size={13} className="text-purple-500" />
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Transferts P2P</span>
                <span className="ml-1 text-[10px] bg-secondary px-1.5 py-0.5 rounded-full">{detail.p2p_transfers.length}</span>
              </div>
              <div className="px-4 py-3">
                <UdmPager
                  items={detail.p2p_transfers}
                  page={p2pPage}
                  setPage={setP2pPage}
                  renderItem={(t, i) => (
                    <div key={i} className="flex items-center justify-between text-xs py-2">
                      <span className={`font-medium ${t.direction === "out" ? "text-red-500" : "text-green-600"}`}>
                        {t.direction === "out" ? "↑ Envoyé" : "↓ Reçu"}
                      </span>
                      <span className="font-semibold tabular-nums">{fmt(t.amount)} FCFA</span>
                      <span className="text-muted-foreground">{fmtDate(t.created_at)}</span>
                    </div>
                  )}
                />
              </div>
            </div>
          )}

          {/* Toutes les transactions */}
          {detail.wallet_transactions?.length > 0 && (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-2.5 bg-secondary/30 border-b border-border flex items-center gap-1.5">
                <History size={13} className="text-muted-foreground" />
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Toutes les transactions</span>
                <span className="ml-1 text-[10px] bg-secondary px-1.5 py-0.5 rounded-full">{detail.wallet_transactions.length}</span>
              </div>
              <div className="px-4 py-3">
                <UdmPager
                  items={detail.wallet_transactions}
                  page={txPage}
                  setPage={setTxPage}
                  renderItem={(t) => (
                    <div key={t.id} className="flex items-center gap-3 py-2">
                      <div className={`w-1.5 h-5 rounded-full shrink-0 ${t.direction === "credit" ? "bg-green-500" : "bg-red-500"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{t.label || t.category}</p>
                        <p className="text-[10px] text-muted-foreground">{fmtDate(t.created_at)}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-xs font-bold tabular-nums ${t.direction === "credit" ? "text-green-600" : "text-red-500"}`}>
                          {t.direction === "credit" ? "+" : "−"}{fmt(t.amount)} <span className="font-normal text-muted-foreground text-[10px]">{t.currency}</span>
                        </p>
                        {t.category === "admin_balance_adjustment" && (
                          <span className="text-[9px] font-bold text-purple-500 uppercase">Ajust. admin</span>
                        )}
                      </div>
                    </div>
                  )}
                />
              </div>
            </div>
          )}

          {/* Liens de paiement */}
          {detail.payment_links?.length > 0 && (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-2.5 bg-secondary/30 border-b border-border flex items-center gap-1.5">
                <Link2 size={13} className="text-primary" />
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Liens de paiement</span>
                <span className="ml-1 text-[10px] bg-secondary px-1.5 py-0.5 rounded-full">{detail.payment_links.length}</span>
              </div>
              <div className="divide-y divide-border">
                {detail.payment_links.slice(0, 5).map((pl) => (
                  <div key={pl.id} className="flex items-center justify-between px-4 py-2.5 text-xs">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{pl.description || pl.slug}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{pl.slug}</p>
                    </div>
                    <div className="text-right ml-3 shrink-0">
                      <p className="font-semibold tabular-nums">{pl.amount ? `${fmt(pl.amount)} ${pl.currency}` : "Montant libre"}</p>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${pl.status === "active" ? "bg-green-500/10 text-green-600" : "bg-secondary text-muted-foreground"}`}>{pl.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sessions actives */}
          {detail.sessions?.length > 0 && (
            <div>
              <p className="font-semibold mb-2 text-xs uppercase tracking-wide text-muted-foreground">Sessions actives</p>
              <div className="space-y-1">
                {detail.sessions.slice(0, 5).map((s) => (
                  <div key={s.id} className="flex items-center justify-between text-xs py-1 border-b border-border last:border-0">
                    <span>{s.device_name}</span>
                    <span className="text-muted-foreground font-mono">{s.ip_address}</span>
                    <span className="text-muted-foreground">{fmtDate(s.last_seen_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <ActionModal modal={localModal} onClose={() => setLocalModal(null)} />
    </Modal>
  );
}

function ConversationPanel({ conv, token, onClose, onRefresh }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [ticketInfo, setTicketInfo] = useState(null);
  const bottomRef = useRef(null);
  useEffect(() => { loadMessages(); }, [conv.user_id]);
  const loadMessages = async () => {
    setLoading(true);
    try {
      const r = await adminFetch(`/admin/support/conversations/${conv.user_id}`, "GET", null, token);
      setMessages(r.messages || []);
      setTicketInfo(r.ticket || null);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch (e) { toast.error(e.message); } finally { setLoading(false); }
  };
  const send = async (closeTicket = false) => {
    if (!reply.trim()) return;
    setSending(true);
    try {
      await adminFetch(`/admin/support/conversations/${conv.user_id}/reply`, "POST", { message: reply, author_name: "Support Kobo", close_ticket: closeTicket }, token);
      setReply("");
      await loadMessages();
      onRefresh();
      if (closeTicket) onClose();
    } catch (e) { toast.error(e.message); } finally { setSending(false); }
  };
  const closeTicket = async () => {
    if (!ticketInfo || isClosed) return;
    setSending(true);
    try {
      await adminFetch(`/admin/support/conversations/${conv.user_id}/close`, "POST", {}, token);
      toast.success("Ticket fermé");
      await loadMessages();
      onRefresh();
    } catch (e) { toast.error(e.message); } finally { setSending(false); }
  };
  const isClosed = ticketInfo?.status === "closed";
  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="w-full max-w-lg bg-background border-l border-border flex flex-col shadow-2xl">
        <div className="px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-start justify-between">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm truncate">{conv.full_name || conv.phone_e164}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{conv.phone_e164}</p>
              {ticketInfo && <div className="flex items-center gap-2 mt-1.5"><span className="flex items-center gap-1 text-xs text-muted-foreground truncate max-w-[200px]"><FileText size={10} className="shrink-0" />{ticketInfo.subject}</span><StatusBadge status={ticketInfo.status} /></div>}
            </div>
            <button onClick={onClose} className="h-7 w-7 rounded-md hover:bg-secondary flex items-center justify-center text-muted-foreground ml-3 shrink-0"><X size={16} /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? <div className="flex items-center justify-center py-8"><RefreshCw size={18} className="animate-spin text-muted-foreground" /></div>
            : messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.from === "agent" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-sm ${msg.from === "agent" ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-secondary text-foreground rounded-tl-sm"}`}>
                  {msg.from === "agent" && msg.name && <p className="text-xs font-semibold mb-1 opacity-70">{msg.name}</p>}
                  <p className="leading-relaxed whitespace-pre-wrap break-words">{msg.text}</p>
                  <p className={`text-xs mt-1.5 ${msg.from === "agent" ? "text-primary-foreground/50 text-right" : "text-muted-foreground"}`}>{fmtDate(msg.ts)}</p>
                </div>
              </div>
            ))}
          <div ref={bottomRef} />
        </div>
        {!isClosed ? (
          <div className="p-4 border-t border-border space-y-2.5 shrink-0">
            <textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Réponse… (Ctrl+Entrée)" rows={3} className="w-full rounded-xl border border-border bg-secondary/30 px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50" onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) send(false); }} />
            <div className="flex gap-2">
              {ticketInfo && <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => send(true)} disabled={sending || !reply.trim()}><CheckCircle size={12} className="mr-1.5" />Répondre & Fermer</Button>}
              {ticketInfo && <Button variant="outline" size="sm" className="text-xs text-red-600 hover:text-red-700" onClick={closeTicket} disabled={sending}><XCircle size={12} className="mr-1.5" />Fermer</Button>}
              <Button size="sm" className="flex-1 text-xs" onClick={() => send(false)} disabled={sending || !reply.trim()}>
                {sending ? <RefreshCw size={12} className="animate-spin mr-1.5" /> : <Send size={12} className="mr-1.5" />}Envoyer
              </Button>
            </div>
          </div>
        ) : (
          <div className="p-4 border-t border-border text-center text-sm text-muted-foreground">Ticket fermé — conversation archivée</div>
        )}
      </div>
    </div>
  );
}

// ── Platform Withdraw Modal ───────────────────────────────────────────────────

function PlatformWithdrawModal({ balance, token, onClose, onDone }) {
  const [form, setForm] = useState({ amount: "", method: "mobile_money", destination: "", note: "" });
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0) { toast.error("Montant invalide"); return; }
    if (amount > balance) { toast.error(`Solde insuffisant (disponible : ${fmt(balance)} FCFA)`); return; }
    if (!form.destination.trim()) { toast.error(form.method === "mobile_money" ? "Numéro requis" : "IBAN requis"); return; }
    setLoading(true);
    try {
      const res = await adminFetch("/admin/platform/withdraw", "POST", {
        amount,
        method: form.method,
        destination: form.destination.trim(),
        note: form.note.trim(),
      }, token);
      toast.success(`Retrait de ${fmt(amount)} FCFA enregistré — nouveau solde : ${fmt(res.new_balance)} FCFA`);
      onDone();
    } catch (e) { toast.error(e.message); } finally { setLoading(false); }
  };

  return (
    <Modal title="Retrait — Compte Kobo" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 border border-blue-200 dark:border-blue-800">
          <p className="text-xs text-muted-foreground mb-1">Solde disponible</p>
          <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{fmt(balance)} <span className="text-sm font-normal">FCFA</span></p>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Montant (FCFA)</label>
          <Input type="number" value={form.amount} onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} placeholder="Ex: 50000" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Méthode</label>
          <select
            value={form.method}
            onChange={(e) => setForm((p) => ({ ...p, method: e.target.value }))}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="mobile_money">Mobile Money (MTN / Orange)</option>
            <option value="bank_transfer">Virement bancaire</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">
            {form.method === "mobile_money" ? "Numéro de téléphone" : "IBAN"}
          </label>
          <Input
            value={form.destination}
            onChange={(e) => setForm((p) => ({ ...p, destination: e.target.value }))}
            placeholder={form.method === "mobile_money" ? "+237…" : "CM…"}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Note (optionnel)</label>
          <Input value={form.note} onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))} placeholder="Ex: Virement mensuel" />
        </div>
        <Button className="w-full" onClick={submit} disabled={loading || !form.amount || !form.destination.trim()}>
          {loading ? <RefreshCw size={14} className="animate-spin mr-2" /> : <Banknote size={14} className="mr-2" />}
          Confirmer le retrait
        </Button>
        <p className="text-xs text-muted-foreground text-center">Le solde est débité immédiatement. Effectuez le virement manuellement.</p>
      </div>
    </Modal>
  );
}

// ── Login OTP ─────────────────────────────────────────────────────────────────

function OtpDigits({ value, onChange, onSubmit, loading }) {
  const refs = useRef([]);
  const digits = (value + "      ").slice(0, 6).split("");

  const handleKey = (i, e) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const next = value.slice(0, i) + value.slice(i + 1);
      onChange(next);
      if (i > 0) refs.current[i - 1]?.focus();
    } else if (e.key === "Enter" && value.length === 6) {
      onSubmit();
    }
  };

  const handleInput = (i, e) => {
    const ch = e.target.value.replace(/\D/g, "").slice(-1);
    if (!ch) return;
    const next = (value.slice(0, i) + ch + value.slice(i + 1)).slice(0, 6);
    onChange(next);
    if (i < 5) refs.current[i + 1]?.focus();
    else if (next.length === 6) onSubmit();
  };

  const handlePaste = (e) => {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted) { onChange(pasted); refs.current[Math.min(pasted.length, 5)]?.focus(); }
    e.preventDefault();
  };

  return (
    <div className="flex gap-2 justify-center" onPaste={handlePaste}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={d.trim()}
          onChange={(e) => handleInput(i, e)}
          onKeyDown={(e) => handleKey(i, e)}
          disabled={loading}
          className={`w-11 h-14 rounded-xl border-2 text-center text-2xl font-bold font-mono transition-all outline-none
            ${d.trim() ? "border-primary bg-primary/5 text-primary" : "border-border bg-secondary"}
            focus:border-primary focus:bg-primary/5 focus:scale-105
            disabled:opacity-50`}
        />
      ))}
    </div>
  );
}

const ADMIN_EMAIL = "service@koboonline.com";

function AdminLogin({ onLogin }) {
  const [phase, setPhase] = useState("idle"); // idle | sending | code | verifying
  const [email, setEmail] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [digits, setDigits] = useState("");
  const [showCode, setShowCode] = useState(false);

  const sendOtp = async () => {
    if (phase === "sending") return;
    if (!email.trim() || !email.includes("@")) { toast.error("Adresse e-mail invalide"); return; }
    setPhase("sending");
    try {
      const res = await fetch(`${API}/admin/auth/start`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Erreur");
      const data = await res.json();
      setChallengeId(data.challenge_id);
      setPhase("code");
      setTimeout(() => setShowCode(true), 40);
    } catch (e) {
      toast.error(e.message);
      setPhase("idle");
    }
  };

  const verifyOtp = async () => {
    if (digits.length < 6 || phase === "verifying") return;
    setPhase("verifying");
    try {
      const res = await fetch(`${API}/admin/auth/verify`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge_id: challengeId, code: digits }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Code incorrect");
      const data = await res.json();
      if (data.role)  localStorage.setItem(ADMIN_ROLE_KEY,  data.role);
      if (data.email) localStorage.setItem(ADMIN_EMAIL_KEY, data.email);
      onLogin("cookie");
    } catch (e) {
      toast.error(e.message);
      setDigits("");
      setPhase("code");
    }
  };

  const isIdle = phase === "idle";
  const isSending = phase === "sending";
  const isVerifying = phase === "verifying";
  const isCode = phase === "code";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-8">

        {/* Logo */}
        <div className="flex flex-col items-center gap-4">
          <div className={`h-20 w-20 rounded-3xl flex items-center justify-center shadow-2xl transition-all duration-300
            ${isCode || isVerifying ? "bg-primary/40 scale-75" : "bg-primary shadow-primary/30"}`}>
            {isSending
              ? <RefreshCw size={32} className="text-white animate-spin" />
              : <Shield size={32} className="text-white" />}
          </div>
          <div className="text-center">
            <h1 className="font-display text-2xl font-bold">Kobo Ops Center</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {isIdle && "Accès réservé aux administrateurs"}
              {isSending && "Envoi du code en cours…"}
              {(isCode || isVerifying) && `Code envoyé à ${email}`}
            </p>
          </div>
        </div>

        {/* Phase 1 : saisie email */}
        {(isIdle || isSending) && (
          <div className="space-y-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendOtp()}
              placeholder="Adresse e-mail admin"
              autoFocus
              disabled={isSending}
              className="w-full h-11 rounded-xl border border-input bg-background px-4 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
            <Button onClick={sendOtp} className="w-full h-11 shadow-md shadow-primary/20" disabled={isSending}>
              {isSending
                ? <><RefreshCw size={15} className="animate-spin mr-2" /> Envoi…</>
                : <><Mail size={15} className="mr-2" /> Recevoir le code</>}
            </Button>
          </div>
        )}

        {/* Phase 2 : saisie OTP */}
        <div
          className="space-y-4 overflow-hidden transition-all duration-500 ease-out"
          style={{ maxHeight: showCode ? "220px" : "0px", opacity: showCode ? 1 : 0 }}
        >
          <OtpDigits value={digits} onChange={setDigits} onSubmit={verifyOtp} loading={isVerifying} />
          <Button onClick={verifyOtp} className="w-full h-11 shadow-md shadow-primary/20" disabled={isVerifying || digits.length < 6}>
            {isVerifying
              ? <><RefreshCw size={15} className="animate-spin mr-2" /> Vérification…</>
              : <><Shield size={15} className="mr-2" /> Accéder</>}
          </Button>
          <button
            type="button"
            onClick={() => { setPhase("idle"); setShowCode(false); setDigits(""); setChallengeId(""); }}
            className="w-full text-xs text-muted-foreground hover:text-foreground text-center transition-colors"
          >
            ← Changer d'adresse
          </button>
        </div>

      </div>
    </div>
  );
}

// ── Platform Balance Tab ───────────────────────────────────────────────────────

function PlatformBalanceTab({ token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminFetch("/admin/analytics", "GET", null, token)
      .then(setData)
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return (
    <div className="flex justify-center py-20">
      <RefreshCw size={24} className="animate-spin text-muted-foreground" />
    </div>
  );
  if (!data) return null;

  const { summary, recent_transactions = [], recent_intl_transfers = [] } = data;
  const aum = summary.total_aum_fcfa || 0;
  const platformRev = summary.platform_revenue_fcfa || 0;
  const totalFees = summary.total_fees_collected_fcfa || 0;
  const feesThisMonth = summary.fees_this_month_fcfa || 0;
  const intlVolume = summary.intl_total_volume || 0;
  const deposits = data.deposits_by_day || [];
  const withdrawals = data.withdrawals_by_day || [];
  const flowDays = [...new Set([...deposits.map((r) => r.day), ...withdrawals.map((r) => r.day)])].sort().slice(-14);
  const flowData = flowDays.map((day) => {
    const dep = deposits.find((r) => r.day === day) || {};
    const wit = withdrawals.find((r) => r.day === day) || {};
    return {
      day: new Date(day).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }),
      depots: Math.round(dep.volume || 0),
      retraits: Math.round(wit.volume || 0),
    };
  });
  const totalVisibleFlows = Math.max(aum + platformRev + intlVolume, 1);
  const composition = [
    { label: "Wallets utilisateurs", value: aum, color: "bg-blue-500", text: "text-blue-600" },
    { label: "Revenus plateforme", value: platformRev, color: "bg-emerald-500", text: "text-emerald-600" },
    { label: "Volume international", value: intlVolume, color: "bg-violet-500", text: "text-violet-600" },
  ];

  const TX_COLORS = { credit: "text-emerald-600 bg-emerald-500/10", debit: "text-red-500 bg-red-500/10" };
  const TX_AMOUNT_COLORS = { credit: "text-emerald-600", debit: "text-red-500" };
  const STATUS_DOT = { completed: "bg-emerald-500", pending: "bg-amber-400", failed: "bg-red-400" };
  const INTL_STATUS = { completed: "text-emerald-600 bg-emerald-500/10", pending: "text-amber-600 bg-amber-500/10", failed: "text-red-500 bg-red-500/10" };

  return (
    <div className="space-y-5 pb-10">
      <div className="grid xl:grid-cols-[1.45fr_0.9fr] gap-4">
        <div className="rounded-2xl border border-border bg-background overflow-hidden">
          <div className="p-6 border-b border-border bg-secondary/35">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Solde opérationnel</p>
                <h1 className="mt-2 text-3xl md:text-4xl font-black tabular-nums tracking-tight">
                  {fmt(Math.round(aum))} <span className="text-base font-semibold text-muted-foreground">FCFA</span>
                </h1>
                <p className="text-sm text-muted-foreground mt-2">Somme agrégée des wallets FCFA utilisateurs et exposition cash à surveiller.</p>
              </div>
              <div className="h-12 w-12 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shrink-0">
                <Banknote size={22} />
              </div>
            </div>
          </div>
          <div className="grid sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border">
            {[
              { label: "Utilisateurs", value: fmt(summary.total_users), icon: Users },
              { label: "Revenus Kobo", value: `${fmt(Math.round(platformRev))} F`, icon: Wallet },
              { label: "Frais ce mois", value: `${fmt(Math.round(feesThisMonth))} F`, icon: Zap },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="p-4 flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground shrink-0">
                  <Icon size={16} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-lg font-bold tabular-nums truncate">{value}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-background p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-sm font-semibold">Composition contrôlée</h2>
              <p className="text-xs text-muted-foreground">Répartition des principaux postes FCFA.</p>
            </div>
            <Activity size={18} className="text-muted-foreground" />
          </div>
          <div className="space-y-4">
            {composition.map((item) => {
              const pct = Math.max(0, Math.min(100, (item.value / totalVisibleFlows) * 100));
              return (
                <div key={item.label} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm gap-3">
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className={`font-bold tabular-nums ${item.text}`}>{fmt(Math.round(item.value))} F</span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary overflow-hidden">
                    <div className={`h-full ${item.color}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-5 pt-4 border-t border-border grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] text-muted-foreground">Frais historiques</p>
              <p className="text-lg font-bold tabular-nums">{fmt(Math.round(totalFees))} F</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">Intl complétés</p>
              <p className="text-lg font-bold tabular-nums">{fmt(summary.intl_completed_count || 0)}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Revenus plateforme", value: `${fmt(Math.round(platformRev))} FCFA`, sub: "solde frais Kobo", icon: Banknote, color: "text-blue-600", bg: "bg-blue-500/10" },
          { label: "Frais collectés", value: `${fmt(Math.round(totalFees))} FCFA`, sub: "cumul historique", icon: TrendingUp, color: "text-emerald-600", bg: "bg-emerald-500/10" },
          { label: "Frais du mois", value: `${fmt(Math.round(feesThisMonth))} FCFA`, sub: "période courante", icon: Zap, color: "text-violet-600", bg: "bg-violet-500/10" },
          { label: "Transferts intl.", value: `${fmt(Math.round(intlVolume))} FCFA`, sub: `${summary.intl_completed_count || 0} complétés / ${summary.intl_total_count || 0} total`, icon: ArrowLeftRight, color: "text-orange-600", bg: "bg-orange-500/10" },
        ].map(({ label, value, sub, icon: Icon, color, bg }) => (
          <div key={label} className="rounded-xl border border-border bg-background p-4">
            <div className={`h-9 w-9 rounded-lg ${bg} flex items-center justify-center mb-3`}>
              <Icon size={16} className={color} />
            </div>
            <p className={`text-lg font-bold tabular-nums leading-tight ${color}`}>{value}</p>
            <p className="text-xs font-medium mt-1">{label}</p>
            <p className="text-[11px] text-muted-foreground">{sub}</p>
          </div>
        ))}
      </div>

      <div className="grid xl:grid-cols-[1.2fr_0.8fr] gap-4">
        <div className="rounded-xl border border-border bg-background p-5 min-w-0">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-sm font-semibold">Flux dépôts / retraits</h2>
              <p className="text-xs text-muted-foreground">Volumes quotidiens sur les 14 derniers jours visibles.</p>
            </div>
            <BarChart2 size={18} className="text-muted-foreground" />
          </div>
          <div className="min-w-0">
            {flowData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Aucun flux récent à afficher</div>
            ) : (
              <ResponsiveContainer width="100%" height={256} minWidth={0}>
                <BarChart data={flowData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-border" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <Tooltip formatter={(v) => `${fmt(Math.round(v))} FCFA`} />
                  <Legend />
                  <Bar dataKey="depots" name="Dépôts" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="retraits" name="Retraits" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-background overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center gap-2">
            <History size={14} className="text-muted-foreground" />
            <div>
              <p className="text-sm font-semibold">Mouvements récents</p>
              <p className="text-[11px] text-muted-foreground">Dernières écritures wallet</p>
            </div>
            <span className="ml-auto text-[10px] text-muted-foreground">{recent_transactions.length}</span>
          </div>
          {recent_transactions.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Aucune transaction récente</div>
          ) : (
            <div className="divide-y divide-border max-h-80 overflow-y-auto">
              {recent_transactions.slice(0, 12).map((tx) => (
                <div key={tx.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${TX_COLORS[tx.direction] || "text-muted-foreground bg-secondary"}`}>
                    {tx.direction === "credit" ? "+" : "−"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{tx.label}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{tx.user_phone || tx.user_name || tx.counterpart} · {tx.category}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-xs font-bold tabular-nums ${TX_AMOUNT_COLORS[tx.direction] || "text-foreground"}`}>
                      {tx.direction === "credit" ? "+" : "−"}{fmt(Math.round(tx.amount))}
                    </p>
                    <p className="text-[9px] text-muted-foreground">{tx.currency}</p>
                  </div>
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[tx.status] || "bg-border"}`} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-background border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center gap-2">
          <ArrowLeftRight size={14} className="text-muted-foreground" />
          <div>
            <p className="text-sm font-semibold">Transferts internationaux récents</p>
            <p className="text-[11px] text-muted-foreground">Suivi des sorties et paiements cross-border</p>
          </div>
          <span className="ml-auto text-[10px] text-muted-foreground">{summary.intl_completed_count || 0} complétés</span>
        </div>
        {recent_intl_transfers.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Aucun transfert international pour le moment</div>
        ) : (
          <div className="divide-y divide-border">
            {recent_intl_transfers.map((t) => {
              const statusLabel = { completed: "Complété", pending_payment: "En attente paiement", pending_settlement: "En cours d'envoi", cancelled: "Annulé", rejected: "Rejeté", failed: "Échoué" }[t.status] || t.status;
              return (
                <div key={t.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="w-8 h-8 rounded-full bg-indigo-500/10 flex items-center justify-center shrink-0">
                    <ArrowLeftRight size={13} className="text-indigo-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {t.sender_name || "Expéditeur inconnu"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Envoi de <span className="font-semibold text-foreground">{t.source_amount} {t.source_currency}</span>
                      {" · "}
                      {new Date(t.created_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-foreground font-mono">
                      {fmt(Math.round(t.target_amount))} {t.target_currency}
                    </p>
                    <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full mt-0.5 ${INTL_STATUS[t.status] || "text-muted-foreground bg-border/50"}`}>
                      {statusLabel}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Analytics Tab ─────────────────────────────────────────────────────────────

const ANALYTICS_SECTIONS = [
  { id: "revenus",       label: "Revenus",       icon: DollarSign },
  { id: "activite",      label: "Activité",      icon: Activity },
  { id: "tendances",     label: "Tendances",     icon: BarChart2 },
  { id: "comptabilite",  label: "Comptabilité",  icon: TrendingUp },
  { id: "journaux",      label: "Journaux",      icon: History },
];

function AnalyticsTab({ token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [withdrawModal, setWithdrawModal] = useState(false);
  const [withdrawals, setWithdrawals] = useState([]);
  const [activeSection, setActiveSection] = useState("revenus");

  const loadAnalytics = () => {
    setLoading(true);
    adminFetch("/admin/analytics", "GET", null, token)
      .then(setData).catch((e) => toast.error(e.message)).finally(() => setLoading(false));
  };
  const loadWithdrawals = () => {
    adminFetch("/admin/platform/withdrawals", "GET", null, token)
      .then((r) => setWithdrawals(r.items || [])).catch(() => {});
  };

  useEffect(() => { loadAnalytics(); loadWithdrawals(); }, [token]);

  if (loading) return <div className="flex items-center justify-center py-20"><RefreshCw size={24} className="animate-spin text-muted-foreground" /></div>;
  if (!data) return null;

  const { summary, users_by_day, p2p_by_day, logins_by_day, deposits_by_day = [], withdrawals_by_day = [],
          fees_by_category = [], monthly_fees = [], monthly_deposits = [], monthly_withdrawals = [],
          recent_transactions = [], recent_intl_transfers = [] } = data;

  // ── helpers locaux ─────────────────────────────────────────────────────────
  const fmtK = (n) => {
    if (n == null) return "—";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
    return String(Math.round(n));
  };

  const SectionHeading = ({ icon: Icon, iconColor, title, description }) => (
    <div className="flex items-start gap-3 mb-4 pt-2">
      <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${iconColor}`}>
        <Icon size={18} className="text-white" />
      </div>
      <div>
        <p className="font-bold text-sm text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-0 pb-10">

      {/* ── Barre de navigation sections + bouton imprimer ── */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border -mx-4 px-4 mb-8 print:hidden">
        <div className="flex items-center justify-between py-2 gap-4">
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
            {ANALYTICS_SECTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveSection(id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                  activeSection === id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                }`}
              >
                <Icon size={12} />
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-xs hover:bg-secondary transition-colors"
            >
              <FileText size={13} /> Imprimer
            </button>
            <button onClick={() => { loadAnalytics(); loadWithdrawals(); }} className="flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-xs hover:bg-secondary transition-colors">
              <RefreshCw size={12} /> Actualiser
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-10">

      {activeSection === "revenus" && <section>
        <SectionHeading icon={DollarSign} iconColor="bg-blue-600" title="Revenus de la plateforme" description="Trésorerie Kobo, frais collectés sur les transactions et performance des liens de paiement." />

        {/* Solde & frais */}
        <div className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-xl p-5 text-white mb-4">
          <div className="flex items-center justify-between mb-5">
            <p className="text-xs font-semibold uppercase tracking-widest opacity-75">Compte Kobo</p>
            <button onClick={() => setWithdrawModal(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs font-semibold transition-colors">
              <Banknote size={13} /> Retirer
            </button>
          </div>
          <div className="grid grid-cols-3 gap-6">
            <div>
              <p className="text-[11px] opacity-60 mb-1">Solde disponible</p>
              <p className="text-3xl font-extrabold tabular-nums">{fmtK(summary.platform_revenue_fcfa || 0)}</p>
              <p className="text-xs opacity-50 mt-0.5">FCFA</p>
            </div>
            <div className="border-l border-white/20 pl-6">
              <p className="text-[11px] opacity-60 mb-1">Frais — ce mois</p>
              <p className="text-2xl font-bold tabular-nums">{fmtK(summary.fees_this_month_fcfa || 0)}</p>
              <p className="text-xs opacity-50 mt-0.5">FCFA</p>
            </div>
            <div className="border-l border-white/20 pl-6">
              <p className="text-[11px] opacity-60 mb-1">Frais — total cumulé</p>
              <p className="text-2xl font-bold tabular-nums">{fmtK(summary.total_fees_collected_fcfa || 0)}</p>
              <p className="text-xs opacity-50 mt-0.5">FCFA</p>
            </div>
          </div>
        </div>

        {/* Breakdown frais par catégorie */}
        {fees_by_category.length > 0 && (() => {
          const grand = fees_by_category.reduce((s, r) => s + r.total, 0);
          return (
            <div className="bg-background border border-border rounded-xl p-5 mb-4">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-semibold">Répartition des frais par source</p>
                <ExportMenu
                  onCsv={() => { const g=grand; const cols=[{key:"category",label:"Catégorie"},{key:"count",label:"Nb transactions"},{key:"total",label:"Total (FCFA)"},{key:"pct",label:"% du total"}]; exportCsv(cols, fees_by_category.map(r=>({...r,total:Math.round(r.total),pct:g>0?`${((r.total/g)*100).toFixed(1)}%`:"—"})), "kobo-frais-categorie.csv"); }}
                  onExcel={() => { const g=grand; const cols=[{key:"category",label:"Catégorie"},{key:"count",label:"Nb transactions"},{key:"total",label:"Total (FCFA)"},{key:"pct",label:"% du total"}]; exportExcel(cols, fees_by_category.map(r=>({...r,total:Math.round(r.total),pct:g>0?`${((r.total/g)*100).toFixed(1)}%`:"—"})), "kobo-frais-categorie.csv"); }}
                  onJson={() => { const g=grand; exportJson(fees_by_category.map(r=>({...r,total_fcfa:Math.round(r.total),pct_total:g>0?`${((r.total/g)*100).toFixed(1)}%`:"—"})), "kobo-frais-categorie.csv"); }}
                />
              </div>
              <div className="space-y-3">
                {fees_by_category.map((r) => {
                  const pct = grand > 0 ? (r.total / grand) * 100 : 0;
                  return (
                    <div key={r.category}>
                      <div className="flex items-center justify-between mb-1 text-xs">
                        <span className="font-mono bg-secondary px-1.5 py-0.5 rounded text-[11px]">{r.category}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-muted-foreground">{fmt(r.count)} tx</span>
                          <span className="font-semibold text-amber-600 tabular-nums">{fmt(Math.round(r.total))} FCFA</span>
                          <span className="text-muted-foreground w-10 text-right">{pct.toFixed(1)}%</span>
                        </div>
                      </div>
                      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div className="h-full bg-amber-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Liens de paiement */}
        <div className="bg-background border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center gap-2">
            <Link2 size={14} className="text-primary" />
            <p className="text-sm font-semibold">Liens de paiement</p>
            <p className="text-xs text-muted-foreground">— volume traité via les liens créés par les utilisateurs</p>
            {summary.pl_success_rate > 0 && (
              <span className="ml-auto text-xs font-semibold text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full">{summary.pl_success_rate}% de réussite</span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-border">
            {[
              { label: "Volume brut total", value: fmt(Math.round(summary.pl_total_gross_volume || 0)), sub: "payé par les clients", color: "text-blue-500" },
              { label: "Reçu par les créateurs", value: fmt(Math.round(summary.pl_total_net_volume || 0)), sub: "montant net versé", color: "text-emerald-600" },
              { label: "Volume ce mois", value: fmt(Math.round(summary.pl_gross_this_month || 0)), sub: "FCFA brut mois en cours", color: "text-purple-500" },
              { label: "Transactions réussies", value: fmt(summary.pl_total_paid || 0), sub: `sur ${fmt(summary.pl_total_txs || 0)} tentatives`, color: "text-orange-500" },
            ].map(({ label, value, sub, color }) => (
              <div key={label} className="px-5 py-4">
                <p className={`text-2xl font-bold font-mono tabular-nums ${color}`}>{value}</p>
                <p className="text-xs font-medium text-foreground mt-0.5">{label}</p>
                <p className="text-[11px] text-muted-foreground">{sub}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Historique retraits Kobo */}
        {withdrawals.length > 0 && (
          <div className="bg-background border border-border rounded-xl overflow-hidden mt-4">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <Banknote size={14} className="text-muted-foreground" />
              <p className="text-sm font-semibold">Historique des retraits Kobo</p>
            </div>
            <div className="divide-y divide-border">
              {withdrawals.slice(0, 10).map((w) => (
                <div key={w.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <div>
                    <p className="font-medium">{w.method === "mobile_money" ? "Mobile Money" : "Virement bancaire"}</p>
                    <p className="text-xs text-muted-foreground">{w.destination}{w.note ? ` · ${w.note}` : ""}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-red-600">−{fmt(w.amount)} FCFA</p>
                    <p className="text-xs text-muted-foreground">{fmtDate(w.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {withdrawModal && (
        <PlatformWithdrawModal
          balance={summary.platform_revenue_fcfa || 0}
          token={token}
          onClose={() => setWithdrawModal(false)}
          onDone={() => { setWithdrawModal(false); loadAnalytics(); loadWithdrawals(); }}
        />
      )}

      </section>}

      {activeSection === "activite" && <section>
        <SectionHeading icon={Activity} iconColor="bg-indigo-600" title="Indicateurs d'activité" description="Mesures clés sur les utilisateurs, les transactions et le volume traité depuis le lancement." />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
          {[
            { label: "Utilisateurs inscrits", value: fmt(summary.total_users), sub: "comptes créés", icon: Users, color: "text-indigo-500", bg: "bg-indigo-500/10" },
            { label: "Sessions actives 24h", value: fmt(summary.active_sessions_24h), sub: "connexions récentes", icon: Zap, color: "text-amber-500", bg: "bg-amber-500/10" },
            { label: "Transferts P2P", value: fmt(summary.total_p2p_transfers), sub: `${fmtK(summary.total_p2p_volume_fcfa || 0)} FCFA`, icon: ArrowLeftRight, color: "text-purple-500", bg: "bg-purple-500/10" },
            { label: "AUM — wallets", value: `${fmtK(summary.total_aum_fcfa || 0)} F`, sub: "FCFA détenus en tout", icon: Wallet, color: "text-emerald-500", bg: "bg-emerald-500/10" },
          ].map(({ label, value, sub, icon: Icon, color, bg }) => (
            <div key={label} className="bg-background border border-border rounded-xl p-4">
              <div className={`h-9 w-9 rounded-xl ${bg} flex items-center justify-center mb-3`}>
                <Icon size={18} className={color} />
              </div>
              <p className="text-2xl font-bold tabular-nums">{value}</p>
              <p className="text-xs font-medium text-foreground mt-1">{label}</p>
              <p className="text-[11px] text-muted-foreground">{sub}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Dépôts complétés", value: fmt(summary.deposits_completed_count || 0), sub: `${fmtK(summary.deposits_total_volume || 0)} FCFA entrants`, color: "text-green-600", bg: "bg-green-500/10", icon: ArrowDownToLine },
            { label: "Retraits complétés", value: fmt(summary.withdrawals_completed_count || 0), sub: `${fmtK(summary.withdrawals_total_volume || 0)} FCFA sortants`, color: "text-red-500", bg: "bg-red-500/10", icon: Send },
            { label: "Transferts intl.", value: fmt(recent_intl_transfers.length), sub: "dans l'historique", color: "text-blue-500", bg: "bg-blue-500/10", icon: Globe },
            { label: "Liens de paiement", value: fmt(summary.pl_total_txs || 0), sub: `dont ${fmt(summary.pl_total_paid || 0)} payés`, color: "text-orange-500", bg: "bg-orange-500/10", icon: Link2 },
          ].map(({ label, value, sub, color, bg, icon: Icon }) => (
            <div key={label} className={`rounded-xl p-4 ${bg}`}>
              <div className="flex items-center gap-2 mb-2">
                <Icon size={14} className={color} />
                <p className="text-xs font-semibold text-foreground">{label}</p>
              </div>
              <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>
            </div>
          ))}
        </div>
      </section>}

      {activeSection === "tendances" && <section>
        <SectionHeading icon={BarChart2} iconColor="bg-violet-600" title="Tendances — 30 derniers jours" description="Visualisation jour par jour des flux financiers et de l'engagement utilisateurs sur la plateforme." />

        {/* Ligne 1 : Dépôts / Retraits */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <div className="bg-background border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-2.5 h-2.5 rounded-full bg-green-500 shrink-0" />
              <p className="text-sm font-semibold">Dépôts fiat (volume FCFA)</p>
              <p className="text-xs text-muted-foreground ml-1">— argent entrant sur la plateforme</p>
            </div>
            <ResponsiveContainer width="100%" height={200} minWidth={0} minHeight={160}>
              <BarChart data={deposits_by_day} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1000 ? `${Math.round(v/1000)}k` : v} />
                <Tooltip labelFormatter={(v) => new Date(v).toLocaleDateString("fr-FR")} formatter={(v) => [`${fmt(Math.round(v))} FCFA`, "Volume"]} />
                <Bar dataKey="volume" fill="#10b981" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-background border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400 shrink-0" />
              <p className="text-sm font-semibold">Retraits fiat (volume FCFA)</p>
              <p className="text-xs text-muted-foreground ml-1">— argent sortant de la plateforme</p>
            </div>
            <ResponsiveContainer width="100%" height={200} minWidth={0} minHeight={160}>
              <BarChart data={withdrawals_by_day} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1000 ? `${Math.round(v/1000)}k` : v} />
                <Tooltip labelFormatter={(v) => new Date(v).toLocaleDateString("fr-FR")} formatter={(v) => [`${fmt(Math.round(v))} FCFA`, "Volume"]} />
                <Bar dataKey="volume" fill="#f87171" radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Ligne 2 : P2P + Utilisateurs/Connexions */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-background border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-2.5 h-2.5 rounded-full bg-purple-500 shrink-0" />
              <p className="text-sm font-semibold">Transferts P2P</p>
              <p className="text-xs text-muted-foreground ml-1">— volume et nombre de transactions</p>
            </div>
            <ResponsiveContainer width="100%" height={200} minWidth={0} minHeight={160}>
              <BarChart data={p2p_by_day} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                <YAxis yAxisId="vol" orientation="left" tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1000 ? `${Math.round(v/1000)}k` : v} />
                <YAxis yAxisId="cnt" orientation="right" tick={{ fontSize: 10 }} />
                <Tooltip labelFormatter={(v) => new Date(v).toLocaleDateString("fr-FR")} formatter={(v, n) => [fmt(Math.round(v)), n === "volume" ? "FCFA" : "tx"]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="vol" dataKey="volume" fill="#a78bfa" radius={[3,3,0,0]} name="Volume FCFA" />
                <Bar yAxisId="cnt" dataKey="count" fill="#6366f1" radius={[3,3,0,0]} name="Nb transactions" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-background border border-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0" />
              <p className="text-sm font-semibold">Utilisateurs & connexions</p>
              <p className="text-xs text-muted-foreground ml-1">— inscriptions et sessions du jour</p>
            </div>
            <ResponsiveContainer width="100%" height={200} minWidth={0} minHeight={160}>
              <LineChart margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} allowDuplicatedCategory={false} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip labelFormatter={(v) => new Date(v).toLocaleDateString("fr-FR")} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line data={users_by_day} type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} dot={false} name="Nouveaux inscrits" />
                <Line data={logins_by_day} type="monotone" dataKey="count" stroke="#f59e0b" strokeWidth={2} dot={false} name="Connexions" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>}

      {activeSection === "comptabilite" && <section>
          <SectionHeading icon={TrendingUp} iconColor="bg-purple-600" title="Comptabilité mensuelle" description="Synthèse mois par mois des frais collectés, dépôts et retraits sur les 6 derniers mois. À utiliser pour le reporting." />
          <div className="bg-background border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border flex items-center gap-2">
              <p className="text-sm font-semibold text-muted-foreground">6 derniers mois</p>
              <div className="ml-auto">
                <ExportMenu
                  onCsv={() => { const months=[...new Set([...monthly_fees.map(r=>r.month),...monthly_deposits.map(r=>r.month),...monthly_withdrawals.map(r=>r.month)])].sort().reverse(); const rows=months.map(m=>{const fee=monthly_fees.find(r=>r.month===m)||{};const dep=monthly_deposits.find(r=>r.month===m)||{};const wd=monthly_withdrawals.find(r=>r.month===m)||{};return{mois:m,transactions:fee.transactions||0,frais:Math.round(fee.fees||0),depots:dep.count||0,vol_depots:Math.round(dep.volume||0),retraits:wd.count||0,vol_retraits:Math.round(wd.volume||0)};}); const cols=[{key:"mois",label:"Mois"},{key:"transactions",label:"Transactions"},{key:"frais",label:"Frais (FCFA)"},{key:"depots",label:"Dépôts"},{key:"vol_depots",label:"Vol. dépôts (FCFA)"},{key:"retraits",label:"Retraits"},{key:"vol_retraits",label:"Vol. retraits (FCFA)"}]; exportCsv(cols,rows,"kobo-synthese-mensuelle.csv"); }}
                  onExcel={() => { const months=[...new Set([...monthly_fees.map(r=>r.month),...monthly_deposits.map(r=>r.month),...monthly_withdrawals.map(r=>r.month)])].sort().reverse(); const rows=months.map(m=>{const fee=monthly_fees.find(r=>r.month===m)||{};const dep=monthly_deposits.find(r=>r.month===m)||{};const wd=monthly_withdrawals.find(r=>r.month===m)||{};return{mois:m,transactions:fee.transactions||0,frais:Math.round(fee.fees||0),depots:dep.count||0,vol_depots:Math.round(dep.volume||0),retraits:wd.count||0,vol_retraits:Math.round(wd.volume||0)};}); const cols=[{key:"mois",label:"Mois"},{key:"transactions",label:"Transactions"},{key:"frais",label:"Frais (FCFA)"},{key:"depots",label:"Dépôts"},{key:"vol_depots",label:"Vol. dépôts (FCFA)"},{key:"retraits",label:"Retraits"},{key:"vol_retraits",label:"Vol. retraits (FCFA)"}]; exportExcel(cols,rows,"kobo-synthese-mensuelle.csv"); }}
                  onJson={() => { const months=[...new Set([...monthly_fees.map(r=>r.month),...monthly_deposits.map(r=>r.month),...monthly_withdrawals.map(r=>r.month)])].sort().reverse(); exportJson(months.map(m=>{const fee=monthly_fees.find(r=>r.month===m)||{};const dep=monthly_deposits.find(r=>r.month===m)||{};const wd=monthly_withdrawals.find(r=>r.month===m)||{};return{mois:m,transactions:fee.transactions||0,frais_fcfa:Math.round(fee.fees||0),depots:dep.count||0,vol_depots_fcfa:Math.round(dep.volume||0),retraits:wd.count||0,vol_retraits_fcfa:Math.round(wd.volume||0)};}), "kobo-synthese-mensuelle.csv"); }}
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-secondary/30">
                    <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground">Mois</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-muted-foreground">Frais (FCFA)</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-muted-foreground">Dépôts</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-muted-foreground">Vol. dépôts (FCFA)</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-muted-foreground">Retraits</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-muted-foreground">Vol. retraits (FCFA)</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-muted-foreground">Net (dépôts − retraits)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(() => {
                    const months = [...new Set([...monthly_fees.map(r=>r.month),...monthly_deposits.map(r=>r.month),...monthly_withdrawals.map(r=>r.month)])].sort().reverse();
                    return months.map((m) => {
                      const fee = monthly_fees.find(r=>r.month===m)||{};
                      const dep = monthly_deposits.find(r=>r.month===m)||{};
                      const wd = monthly_withdrawals.find(r=>r.month===m)||{};
                      const net = Math.round((dep.volume||0) - (wd.volume||0));
                      const label = new Date(m+"-01").toLocaleDateString("fr-FR",{month:"long",year:"numeric"});
                      return (
                        <tr key={m} className="hover:bg-secondary/20 transition-colors">
                          <td className="px-4 py-2.5 font-medium capitalize">{label}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-purple-600">{fmt(Math.round(fee.fees||0))}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{fmt(dep.count||0)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-green-600">{fmt(Math.round(dep.volume||0))}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{fmt(wd.count||0)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-red-500">{fmt(Math.round(wd.volume||0))}</td>
                          <td className={`px-4 py-2.5 text-right tabular-nums font-bold ${net >= 0 ? "text-green-600" : "text-red-500"}`}>{net >= 0 ? "+" : ""}{fmt(net)}</td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </section>}

      {activeSection === "journaux" && <section>
        <SectionHeading icon={History} iconColor="bg-slate-600" title="Journaux récents" description="Dernières transactions pour audit — recherche, tri, pagination et export intégrés." />
        <div className="space-y-6">

          {recent_intl_transfers.length > 0 && (() => {
            const rows = recent_intl_transfers.map(t => ({
              ...t,
              _envoi: `${fmt(t.source_amount)} ${t.source_currency}`,
              _recu:  `${fmt(t.target_amount)} ${t.target_currency}`,
              _frais: `${fmt(t.fees_amount)} ${t.source_currency}`,
              _date:  fmtDate(t.created_at),
            }));
            const cols = [
              { key: "sender_name",  label: "Expéditeur",  sortable: true },
              { key: "_envoi",       label: "Envoyé",       sortable: true },
              { key: "_recu",        label: "Reçu",         sortable: true },
              { key: "_frais",       label: "Frais",        sortable: true },
              { key: "status",       label: "Statut",       sortable: true, render: (v) => <StatusBadge status={v} /> },
              { key: "_date",        label: "Date",         sortable: true },
            ];
            return (
              <div>
                <p className="text-sm font-semibold mb-3 flex items-center gap-2"><Globe size={14} className="text-blue-500" /> Transferts internationaux</p>
                <DataTable columns={cols} data={rows} searchFields={["sender_name","status","_envoi","_recu"]} exportFilename="kobo-transferts-intl.csv" />
              </div>
            );
          })()}

          {recent_transactions.length > 0 && (() => {
            const rows = recent_transactions.map(tx => ({
              ...tx,
              _phone: tx.user_phone || "—",
              _montant: `${tx.direction === "credit" ? "+" : "−"}${fmt(tx.amount)} ${tx.currency}`,
              _date: fmtDate(tx.created_at),
            }));
            const cols = [
              { key: "_phone",    label: "Utilisateur",  sortable: true },
              { key: "label",     label: "Libellé",      sortable: true },
              { key: "category",  label: "Catégorie",    sortable: true },
              { key: "_montant",  label: "Montant",      sortable: true },
              { key: "status",    label: "Statut",       sortable: true, render: (v) => <StatusBadge status={v} /> },
              { key: "_date",     label: "Date",         sortable: true },
            ];
            return (
              <div>
                <p className="text-sm font-semibold mb-3 flex items-center gap-2"><History size={14} className="text-muted-foreground" /> Transactions plateforme</p>
                <DataTable columns={cols} data={rows} searchFields={["_phone","label","category","status"]} exportFilename="kobo-transactions-plateforme.csv" />
              </div>
            );
          })()}

        </div>
      </section>}

      </div>{/* end space-y-10 wrapper */}
    </div>
  );
}

// ── Activity Feed Tab ─────────────────────────────────────────────────────────

const ACTIVITY_ICON_MAP = { login: Key, p2p: ArrowLeftRight, kyc: UserCheck, deposit: ArrowDownToLine, withdrawal: Send };
const ACTIVITY_COLORS = { login: "text-blue-500", p2p: "text-purple-500", kyc: "text-yellow-500", deposit: "text-green-500", withdrawal: "text-orange-500" };

function ActivityFeedTab({ token }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = useCallback(() => {
    adminFetch("/admin/activity-feed?limit=80", "GET", null, token)
      .then((r) => setItems(r.items || [])).catch(() => {}).finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh, load]);

  const formatRelative = (iso) => {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60) return `${diff}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}min`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return fmtDate(iso);
  };

  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${autoRefresh ? "bg-green-500 animate-pulse" : "bg-muted-foreground"}`} />
          <span className="text-sm font-medium">{autoRefresh ? "Temps réel (10s)" : "Pause"}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={load} className="text-xs gap-1">
            <RefreshCw size={12} />Rafraîchir
          </Button>
          <Button size="sm" variant={autoRefresh ? "outline" : "default"} onClick={() => setAutoRefresh((a) => !a)} className="text-xs">
            {autoRefresh ? "Pause" : "▶ Reprendre"}
          </Button>
        </div>
      </div>

      <div className="bg-background border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16"><RefreshCw size={20} className="animate-spin text-muted-foreground" /></div>
        ) : items.length === 0 ? (
          <p className="text-center text-muted-foreground py-16">Aucune activité récente</p>
        ) : (
          <div className="divide-y divide-border">
            {items.map((item, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3 hover:bg-secondary/20 transition-colors">
                <span className="shrink-0 flex items-center justify-center w-5 h-5">{(() => { const Icon = ACTIVITY_ICON_MAP[item.type]; return Icon ? <Icon size={15} className={ACTIVITY_COLORS[item.type] || "text-muted-foreground"} /> : <span className="text-muted-foreground">•</span>; })()}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.label}</p>
                  <p className={`text-xs ${ACTIVITY_COLORS[item.type] || "text-muted-foreground"}`}>{item.user_phone}</p>
                </div>
                {item.ip_address && <span className="text-xs text-muted-foreground font-mono hidden sm:block shrink-0">{item.ip_address}</span>}
                <span className="text-xs text-muted-foreground shrink-0">{formatRelative(item.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AccountingTab({ token, onViewUser }) {
  const todayIso = () => new Date().toISOString().slice(0, 10);
  const daysAgoIso = (days) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  };
  const [dateFrom, setDateFrom] = useState(() => daysAgoIso(30));
  const [dateTo, setDateTo] = useState(() => todayIso());
  const [data, setData] = useState({ balances: [], ledger_totals: [], ledger_daily: [], withdrawal_totals: [], withdrawal_daily: [], aggregates: [], entries: [], withdrawals: [], alerts: [] });
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);

  const loadAccounting = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams({ limit: "5000" });
    if (dateFrom) qs.set("date_from", dateFrom);
    if (dateTo) qs.set("date_to", dateTo);
    adminFetch(`/admin/accounting/ledger?${qs.toString()}`, "GET", null, token)
      .then((res) => setData(res))
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [token, dateFrom, dateTo]);

  useEffect(() => { loadAccounting(); }, [loadAccounting]);

  const fcfaTotal = data.balances.filter((b) => b.currency === "FCFA").reduce((s, b) => s + Number(b.total_balance || 0), 0);
  const ledgerTotals = data.ledger_totals || [];
  const withdrawalTotals = data.withdrawal_totals || [];
  const fcfaLedger = ledgerTotals.find((r) => r.currency === "FCFA") || {};
  const openWithdrawals = data.withdrawals.filter((w) => ["pending", "processing", "pending_approval"].includes(w.status));
  const refunded = data.withdrawals.filter((w) => w.has_refund);
  const reversed = data.withdrawals.filter((w) => w.has_refund_reversal);
  const totalDebits = ledgerTotals.reduce((s, r) => s + Number(r.debits || 0), 0);
  const totalCredits = ledgerTotals.reduce((s, r) => s + Number(r.credits || 0), 0);
  const withdrawalDebit = withdrawalTotals.reduce((s, r) => s + Number(r.total_debit || 0), 0);
  const withdrawalRefunds = withdrawalTotals.reduce((s, r) => s + Number(r.refunds || 0), 0);
  const withdrawalReversals = withdrawalTotals.reduce((s, r) => s + Number(r.reversals || 0), 0);
  const netWithdrawalEffect = withdrawalTotals.reduce((s, r) => s + Number(r.net_user_effect || 0), 0);
  const ledgerChart = (data.ledger_daily || []).filter((r) => r.currency === "FCFA").map((r) => ({
    day: new Date(r.day).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }),
    credits: Math.round(r.credits || 0),
    debits: Math.round(r.debits || 0),
    net: Math.round(r.net_movement || 0),
  }));
  const withdrawalChart = (data.withdrawal_daily || []).map((r) => ({
    day: new Date(r.day).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }),
    debits: Math.round(r.total_debit || 0),
    refunds: Math.round(r.refunds || 0),
    reversals: Math.round(r.reversals || 0),
  }));

  const Section = ({ title, subtitle, children }) => (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-bold text-slate-950 dark:text-slate-50">{title}</h2>
        {subtitle && <p className="text-sm text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">{subtitle}</p>}
      </div>
      {children}
    </section>
  );

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground text-sm"><RefreshCw size={14} className="animate-spin" /> Chargement comptable...</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-slate-50">Comptabilité</h1>
          <p className="text-base text-slate-600 dark:text-slate-300">Soldes, écritures wallet, remboursements, contrepassations, diagrammes et exports par période.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5">
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="bg-transparent text-sm text-foreground outline-none" />
            <span className="text-muted-foreground text-xs">à</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="bg-transparent text-sm text-foreground outline-none" />
          </div>
          <button onClick={() => { setDateFrom(daysAgoIso(30)); setDateTo(todayIso()); }} className="h-9 px-3 rounded-md border border-border text-sm font-semibold hover:bg-secondary transition-colors">
            30 jours
          </button>
          <button onClick={loadAccounting} className="h-9 px-3 rounded-md border border-border text-sm font-semibold flex items-center gap-1.5 hover:bg-secondary transition-colors">
            <RefreshCw size={13} /> Appliquer
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-6 gap-3">
        {[
          { label: "Alertes", value: fmt(data.alerts.length), icon: AlertCircle, color: data.alerts.length ? "text-red-500" : "text-green-500", bg: data.alerts.length ? "bg-red-500/10" : "bg-green-500/10" },
          { label: "Wallets FCFA", value: `${fmt(Math.round(fcfaTotal))} FCFA`, icon: Banknote, color: "text-emerald-500", bg: "bg-emerald-500/10" },
          { label: "Crédits ledger", value: `${fmt(Math.round(totalCredits))}`, icon: ArrowDownToLine, color: "text-emerald-500", bg: "bg-emerald-500/10" },
          { label: "Débits ledger", value: `${fmt(Math.round(totalDebits))}`, icon: Send, color: "text-red-500", bg: "bg-red-500/10" },
          { label: "Retraits ouverts", value: fmt(openWithdrawals.length), icon: Send, color: "text-orange-500", bg: "bg-orange-500/10" },
          { label: "Remboursés", value: fmt(refunded.length), icon: ArrowUpDown, color: "text-blue-500", bg: "bg-blue-500/10" },
          { label: "Contrepassés", value: fmt(reversed.length), icon: History, color: "text-violet-500", bg: "bg-violet-500/10" },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="rounded-xl border border-border bg-background p-4">
            <div className={`h-8 w-8 rounded-lg ${bg} flex items-center justify-center mb-3`}><Icon size={15} className={color} /></div>
            <p className="text-xl font-bold text-slate-950 dark:text-slate-50">{value}</p>
            <p className="text-sm text-slate-600 dark:text-slate-300">{label}</p>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-4 gap-3">
        {[
          { label: "Flux net FCFA", value: `${fmt(Math.round(fcfaLedger.net_movement || 0))} FCFA`, hint: "crédits - débits du journal wallet" },
          { label: "Débits retraits", value: `${fmt(Math.round(withdrawalDebit))} FCFA`, hint: "montant + frais débités aux utilisateurs" },
          { label: "Remboursements nets", value: `${fmt(Math.round(withdrawalRefunds - withdrawalReversals))} FCFA`, hint: "remboursements - contrepassations" },
          { label: "Impact net retraits", value: `${fmt(Math.round(netWithdrawalEffect))} FCFA`, hint: "effet net sur les soldes utilisateurs" },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-border bg-secondary/30 p-4">
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">{c.label}</p>
            <p className="text-xl font-bold mt-1 text-slate-950 dark:text-slate-50">{c.value}</p>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">{c.hint}</p>
          </div>
        ))}
      </div>

      <section className="rounded-xl border border-border bg-background p-4">
        <h2 className="text-base font-bold text-slate-950 dark:text-slate-50">Lecture comptable rapide</h2>
        <div className="grid md:grid-cols-4 gap-3 mt-3 text-sm">
          {[
            { title: "1. Entrée d'argent", text: "Un dépôt, lien de paiement, virement ou crypto validé crée un crédit wallet." },
            { title: "2. Sortie d'argent", text: "Un retrait ou transfert validé crée un débit wallet avec ses frais." },
            { title: "3. Échec ou rejet", text: "Si l'argent doit revenir au client, une écriture de remboursement doit exister." },
            { title: "4. Correction", text: "Une contrepassation annule un remboursement déjà fait quand le paiement repart." },
          ].map((item) => (
            <div key={item.title} className="rounded-lg bg-secondary/40 p-3">
              <p className="font-bold text-slate-950 dark:text-slate-50">{item.title}</p>
              <p className="text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid xl:grid-cols-2 gap-4">
        <Section title="Diagramme grand livre FCFA" subtitle="Évolution quotidienne des crédits, débits et du net sur la période sélectionnée.">
          <div className="rounded-xl border border-border bg-background p-4 min-w-0">
            {ledgerChart.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Aucune écriture FCFA sur cette période</div>
            ) : (
              <ResponsiveContainer width="100%" height={320} minWidth={0}>
                <LineChart data={ledgerChart}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-border" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <Tooltip formatter={(v) => `${fmt(Math.round(v))} FCFA`} />
                  <Legend />
                  <Line type="monotone" dataKey="credits" name="Crédits" stroke="#10b981" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="debits" name="Débits" stroke="#ef4444" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="net" name="Net" stroke="#2563eb" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </Section>

        <Section title="Diagramme retraits et régularisations" subtitle="Débits retraits, remboursements et contrepassations par jour.">
          <div className="rounded-xl border border-border bg-background p-4 min-w-0">
            {withdrawalChart.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Aucun retrait sur cette période</div>
            ) : (
              <ResponsiveContainer width="100%" height={320} minWidth={0}>
                <BarChart data={withdrawalChart}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-border" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <Tooltip formatter={(v) => `${fmt(Math.round(v))} FCFA`} />
                  <Legend />
                  <Bar dataKey="debits" name="Débits" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="refunds" name="Remboursements" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="reversals" name="Contrepassations" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Section>
      </div>

      {data.alerts.length > 0 && (
        <Section title="Alertes de cohérence" subtitle="Exceptions à traiter avant clôture : remboursement manquant, retrait actif déjà remboursé, ou statut incohérent.">
        <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20 p-4 space-y-3">
          <p className="text-sm font-semibold text-red-700 dark:text-red-300 flex items-center gap-2"><AlertCircle size={15} /> Alertes de cohérence</p>
          <DataTable
            data={data.alerts}
            searchFields={["id", "reference", "status", "issue", "email", "phone_e164"]}
            emptyText="Aucune alerte"
            exportFilename="kobo-alertes-comptables.csv"
            columns={[
              { key: "issue", label: "Anomalie", sortable: true, render: (v) => <span className="text-xs font-semibold text-red-600">{v}</span> },
              { key: "reference", label: "Référence", render: (v) => <span className="font-mono text-xs">{v}</span> },
              { key: "status", label: "Statut", sortable: true, render: (v) => <StatusBadge status={v} /> },
              { key: "total_debit", label: "Montant", sortable: true, render: (v) => <span className="font-semibold">{fmt(v)} FCFA</span> },
              { key: "email", label: "Utilisateur", render: (v, row) => <span>{v || row.phone_e164 || row.user_id}</span> },
            ]}
            tableTitle="Alertes de cohérence"
            expandable
            actions={(r) => (
              <>
                <button onClick={() => setDetail({ type: "Alerte comptable", row: r })} className="h-7 px-2 rounded-md text-xs font-medium flex items-center gap-1 hover:bg-secondary text-muted-foreground hover:text-foreground"><FileText size={12} />Détails</button>
                <button onClick={() => onViewUser(r.user_id)} className="h-7 px-2 rounded-md text-xs font-medium flex items-center gap-1 hover:bg-secondary text-muted-foreground hover:text-foreground"><Eye size={12} />Profil</button>
              </>
            )}
          />
        </div>
        </Section>
      )}

      <div className="space-y-4">
        <Section title="Balances wallets par devise" subtitle="Vue de contrôle des soldes utilisateurs agrégés par monnaie.">
          <DataTable
            data={data.balances}
            searchFields={["currency"]}
            emptyText="Aucun solde"
            exportFilename="kobo-soldes-wallets.csv"
            tableTitle="Balances wallets par devise"
            expandable
            columns={[
              { key: "currency", label: "Devise", sortable: true, render: (v) => <span className="font-mono text-xs bg-secondary px-1.5 py-0.5 rounded">{v}</span> },
              { key: "accounts", label: "Comptes", sortable: true, render: (v) => <span>{fmt(v)}</span> },
              { key: "total_balance", label: "Solde total", sortable: true, render: (v, row) => <span className="font-semibold">{fmt(v)} {row.currency}</span> },
            ]}
            actions={(r) => <button onClick={() => setDetail({ type: "Balance wallet", row: r })} className="h-7 px-2 rounded-md text-xs font-medium flex items-center gap-1 hover:bg-secondary text-muted-foreground hover:text-foreground"><FileText size={12} />Détails</button>}
          />
        </Section>
        <Section title="Grand livre par devise" subtitle="Total débit, total crédit et mouvement net du journal wallet.">
          <DataTable
            data={ledgerTotals}
            searchFields={["currency"]}
            emptyText="Aucun total ledger"
            exportFilename="kobo-grand-livre-devises.csv"
            tableTitle="Grand livre par devise"
            expandable
            columns={[
              { key: "currency", label: "Devise", sortable: true, render: (v) => <span className="font-mono text-xs bg-secondary px-1.5 py-0.5 rounded">{v}</span> },
              { key: "entries", label: "Écritures", sortable: true, render: (v) => <span>{fmt(v)}</span> },
              { key: "credits", label: "Crédits", sortable: true, render: (v, row) => <span className="font-semibold text-emerald-600">{fmt(v)} {row.currency}</span> },
              { key: "debits", label: "Débits", sortable: true, render: (v, row) => <span className="font-semibold text-red-500">{fmt(v)} {row.currency}</span> },
              { key: "net_movement", label: "Net", sortable: true, render: (v, row) => <span className={Number(v) >= 0 ? "font-semibold text-emerald-600" : "font-semibold text-red-500"}>{fmt(v)} {row.currency}</span> },
            ]}
            actions={(r) => <button onClick={() => setDetail({ type: "Grand livre devise", row: r })} className="h-7 px-2 rounded-md text-xs font-medium flex items-center gap-1 hover:bg-secondary text-muted-foreground hover:text-foreground"><FileText size={12} />Détails</button>}
          />
        </Section>
      </div>

      <div className="space-y-4">
        <Section title="Agrégats par catégorie" subtitle="Regroupe les écritures par catégorie, sens, statut et devise.">
          <DataTable
            data={data.aggregates}
            searchFields={["category", "direction", "status", "currency"]}
            emptyText="Aucun agrégat"
            exportFilename="kobo-agregats-comptables.csv"
            tableTitle="Agrégats comptables par catégorie"
            expandable
            columns={[
              { key: "category", label: "Catégorie", sortable: true, render: (v) => <span className="font-mono text-xs">{v}</span> },
              { key: "direction", label: "Sens", sortable: true, render: (v) => <span className={v === "credit" ? "text-emerald-600 font-semibold" : "text-red-500 font-semibold"}>{v}</span> },
              { key: "status", label: "Statut", sortable: true, render: (v) => <StatusBadge status={v} /> },
              { key: "count", label: "Nb", sortable: true },
              { key: "total", label: "Total", sortable: true, render: (v, row) => <span>{fmt(v)} {row.currency}</span> },
            ]}
            actions={(r) => <button onClick={() => setDetail({ type: "Agrégat comptable", row: r })} className="h-7 px-2 rounded-md text-xs font-medium flex items-center gap-1 hover:bg-secondary text-muted-foreground hover:text-foreground"><FileText size={12} />Détails</button>}
          />
        </Section>
        <Section title="Rapprochement des retraits" subtitle="Débits wallet, remboursements, contrepassations et impact net par statut.">
          <DataTable
            data={withdrawalTotals}
            searchFields={["status"]}
            emptyText="Aucun calcul retrait"
            exportFilename="kobo-rapprochement-retraits.csv"
            tableTitle="Rapprochement des retraits"
            expandable
            columns={[
              { key: "status", label: "Statut", sortable: true, render: (v) => <StatusBadge status={v} /> },
              { key: "count", label: "Nb", sortable: true },
              { key: "total_debit", label: "Débits", sortable: true, render: (v) => <span className="font-semibold text-red-500">{fmt(v)} FCFA</span> },
              { key: "refunds", label: "Remb.", sortable: true, render: (v) => <span className="font-semibold text-blue-600">{fmt(v)} FCFA</span> },
              { key: "reversals", label: "Contrep.", sortable: true, render: (v) => <span className="font-semibold text-violet-600">{fmt(v)} FCFA</span> },
              { key: "net_user_effect", label: "Net", sortable: true, render: (v) => <span className={Number(v) >= 0 ? "font-semibold text-emerald-600" : "font-semibold text-red-500"}>{fmt(v)} FCFA</span> },
            ]}
            actions={(r) => <button onClick={() => setDetail({ type: "Rapprochement retrait", row: r })} className="h-7 px-2 rounded-md text-xs font-medium flex items-center gap-1 hover:bg-secondary text-muted-foreground hover:text-foreground"><FileText size={12} />Détails</button>}
          />
        </Section>
      </div>

      <Section title="Suivi détaillé des retraits fiat" subtitle="Chaque retrait expose le débit initial, les frais, le remboursement éventuel, la contrepassation et l'effet net utilisateur.">
        <DataTable
          data={data.withdrawals}
          searchFields={["id", "reference", "notchpay_txid", "status", "email", "phone_e164", "recipient_phone", "note", "reject_reason"]}
          emptyText="Aucun retrait"
          exportFilename="kobo-retraits-comptabilite.csv"
          tableTitle="Suivi détaillé des retraits fiat"
          expandable
          columns={[
            { key: "created_at", label: "Date", sortable: true, render: (v) => <span className="text-xs text-muted-foreground">{fmtDate(v)}</span> },
            { key: "reference", label: "Référence", render: (v, row) => <div><p className="font-mono text-xs">{v}</p>{row.notchpay_txid && <p className="font-mono text-[11px] text-muted-foreground">{row.notchpay_txid}</p>}</div> },
            { key: "email", label: "Utilisateur", render: (v, row) => <div><p className="text-sm font-medium">{v || row.phone_e164 || row.user_id}</p><p className="text-xs text-muted-foreground">{row.recipient_name}</p></div> },
            { key: "amount", label: "Montant", sortable: true, render: (v) => <span>{fmt(v)} FCFA</span> },
            { key: "fee_fcfa", label: "Frais", sortable: true, render: (v) => <span>{fmt(v)} FCFA</span> },
            { key: "total_debit", label: "Débit wallet", sortable: true, render: (v) => <span className="font-semibold text-red-500">-{fmt(v)} FCFA</span> },
            { key: "refund_amount", label: "Remb.", sortable: true, render: (v) => <span className="font-semibold text-blue-600">{fmt(v)} FCFA</span> },
            { key: "reversal_amount", label: "Contrep.", sortable: true, render: (v) => <span className="font-semibold text-violet-600">{fmt(v)} FCFA</span> },
            { key: "net_user_effect", label: "Net user", sortable: true, render: (v) => <span className={Number(v) >= 0 ? "font-semibold text-emerald-600" : "font-semibold text-red-500"}>{fmt(v)} FCFA</span> },
            { key: "status", label: "Statut", sortable: true, render: (v) => <StatusBadge status={v} /> },
          ]}
          actions={(r) => (
            <>
              <button onClick={() => setDetail({ type: "Retrait fiat", row: r })} className="h-7 px-2 rounded-md text-xs font-medium flex items-center gap-1 hover:bg-secondary text-muted-foreground hover:text-foreground"><FileText size={12} />Détails</button>
              <button onClick={() => onViewUser(r.user_id)} className="h-7 px-2 rounded-md text-xs font-medium flex items-center gap-1 hover:bg-secondary text-muted-foreground hover:text-foreground"><Eye size={12} />Profil</button>
            </>
          )}
        />
      </Section>

      <Section title="Journal wallet détaillé" subtitle="Audit trail des écritures unitaires : utilisateur, catégorie, sens, statut, montant et métadonnées.">
        <DataTable
          data={data.entries}
          searchFields={["id", "user_id", "email", "phone_e164", "category", "label", "counterpart", "status"]}
          emptyText="Aucune écriture"
          exportFilename="kobo-journal-wallet.csv"
          tableTitle="Journal wallet détaillé"
          expandable
          columns={[
            { key: "created_at", label: "Date", sortable: true, render: (v) => <span className="text-xs text-muted-foreground">{fmtDate(v)}</span> },
            { key: "id", label: "Écriture", render: (v) => <span className="font-mono text-xs">{v}</span> },
            { key: "category", label: "Catégorie", sortable: true, render: (v) => <span className="font-mono text-xs">{v}</span> },
            { key: "direction", label: "Sens", sortable: true, render: (v) => <span className={v === "credit" ? "text-emerald-600 font-semibold" : "text-red-500 font-semibold"}>{v}</span> },
            { key: "amount", label: "Montant", sortable: true, render: (v, row) => <span className="font-semibold">{fmt(v)} {row.currency}</span> },
            { key: "status", label: "Statut", sortable: true, render: (v) => <StatusBadge status={v} /> },
            { key: "label", label: "Libellé", render: (v, row) => <div><p className="text-sm">{v}</p><p className="text-xs text-muted-foreground">{row.email || row.phone_e164 || row.user_id}</p></div> },
          ]}
          actions={(r) => (
            <>
              <button onClick={() => setDetail({ type: "Écriture wallet", row: r })} className="h-7 px-2 rounded-md text-xs font-medium flex items-center gap-1 hover:bg-secondary text-muted-foreground hover:text-foreground"><FileText size={12} />Détails</button>
              <button onClick={() => onViewUser(r.user_id)} className="h-7 px-2 rounded-md text-xs font-medium flex items-center gap-1 hover:bg-secondary text-muted-foreground hover:text-foreground"><Eye size={12} />Profil</button>
            </>
          )}
        />
      </Section>

      {detail && <AccountingDetailModal detail={detail} onClose={() => setDetail(null)} onViewUser={onViewUser} />}
    </div>
  );
}

function BalanceAuditTab({ token, onViewUser }) {
  const [search, setSearch] = useState("");
  const [currency, setCurrency] = useState("FCFA");
  const [onlyMismatches, setOnlyMismatches] = useState(false);
  const [data, setData] = useState({ summary: {}, items: [], detail: { breakdown: [], transactions: [] } });
  const [selectedUserId, setSelectedUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);

  const loadAudit = useCallback((forcedUserId = selectedUserId) => {
    setLoading(true);
    const qs = new URLSearchParams({ currency, limit: "200" });
    if (search.trim()) qs.set("search", search.trim());
    if (forcedUserId) qs.set("user_id", forcedUserId);
    if (onlyMismatches) qs.set("only_mismatches", "true");
    adminFetch(`/admin/accounting/balance-audit?${qs.toString()}`, "GET", null, token)
      .then((res) => setData(res))
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [token, search, currency, onlyMismatches, selectedUserId]);

  useEffect(() => { loadAudit(""); }, [token]);

  const summary = data.summary || {};
  const selected = data.items?.find((i) => i.user_id === (data.detail?.user_id || selectedUserId)) || data.items?.[0];
  const mismatchCount = Number(summary.mismatches || 0);
  const absDelta = Number(summary.abs_delta_total || 0);
  const selectedDelta = Number(selected?.delta || 0);
  const selectedName = selected ? (selected.fullName || selected.email || selected.phone_e164 || selected.user_id) : "";
  const categoryLabel = (category) => ({
    fiat_deposit: "Dépôts fiat confirmés",
    crypto_deposit: "Dépôts crypto",
    payment_link: "Paiements reçus par lien",
    p2p: "Transferts entre utilisateurs",
    fiat_withdrawal: "Retraits demandés",
    fiat_withdrawal_refund: "Retraits remboursés",
    fiat_withdrawal_refund_reversal: "Remboursements repris",
    admin_balance_adjustment: "Ajustements admin",
    correction: "Corrections comptables",
    platform_fee: "Frais plateforme",
    platform_fee_reversal: "Annulation frais plateforme",
    platform_withdrawal: "Retrait plateforme",
  }[category] || category);
  const simpleBreakdown = (data.detail?.breakdown || [])
    .filter((r) => r.category !== "withdraw")
    .map((r) => ({
      ...r,
      signed: r.direction === "credit" ? Number(r.total || 0) : -Number(r.total || 0),
    }))
    .sort((a, b) => Math.abs(b.signed) - Math.abs(a.signed))
    .slice(0, 8);
  const txImpact = (tx) => tx.direction === "credit" ? Number(tx.amount || 0) : -Number(tx.amount || 0);
  const flowItems = (data.detail?.transactions || [])
    .filter((tx) => tx.category !== "withdraw")
    .slice()
    .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
    .map((tx) => {
      const impact = txImpact(tx);
      const isWithdrawal = tx.category === "fiat_withdrawal";
      const isRefund = tx.category === "fiat_withdrawal_refund";
      const isReversal = tx.category === "fiat_withdrawal_refund_reversal";
      return {
        ...tx,
        impact,
        tone: impact >= 0 ? "text-emerald-600 bg-emerald-500/10" : "text-red-500 bg-red-500/10",
        title: isWithdrawal ? "Retrait demandé" : isRefund ? "Retrait remboursé" : isReversal ? "Remboursement repris" : categoryLabel(tx.category),
        text: isWithdrawal
          ? "Le solde diminue dès la demande de retrait."
          : isRefund
            ? "Le retrait a échoué ou été rejeté, donc Kobo remet l'argent."
            : isReversal
              ? "Le retrait est reparti en traitement, donc le remboursement est retiré."
              : tx.direction === "credit"
                ? "Cette opération augmente le solde."
                : "Cette opération diminue le solde.",
      };
    });
  const withdrawalMap = new Map();
  (data.detail?.transactions || []).forEach((tx) => {
    const wid = tx.metadata?.withdrawal_id;
    if (!wid) return;
    if (!withdrawalMap.has(wid)) withdrawalMap.set(wid, { id: wid, debits: 0, refunds: 0, reversals: 0, entries: [] });
    const row = withdrawalMap.get(wid);
    if (tx.category === "fiat_withdrawal") row.debits += Number(tx.amount || 0);
    if (tx.category === "fiat_withdrawal_refund") row.refunds += Number(tx.amount || 0);
    if (tx.category === "fiat_withdrawal_refund_reversal") row.reversals += Number(tx.amount || 0);
    row.entries.push(tx);
  });
  const withdrawalJourneys = [...withdrawalMap.values()]
    .map((w) => ({ ...w, net: w.refunds - w.debits - w.reversals }))
    .sort((a, b) => new Date(b.entries[0]?.created_at || 0) - new Date(a.entries[0]?.created_at || 0));
  const operations = data.detail?.operations || [];
  const operationSummary = data.detail?.operation_summary || [];
  const opBucketLabel = {
    "réussi": "Réussis",
    "en cours": "En cours",
    "échoué": "Échoués",
    "remboursé": "Remboursés",
    "remboursement du": "Remboursement dû",
  };
  const opBucketTone = {
    "réussi": "border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/20 dark:text-green-300",
    "en cours": "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/20 dark:text-blue-300",
    "échoué": "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300",
    "remboursé": "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/20 dark:text-violet-300",
    "remboursement du": "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300",
  };
  const opGroups = ["remboursement du", "réussi", "en cours", "échoué", "remboursé"].map((bucket) => {
    const rows = operations.filter((op) => op.status_bucket === bucket);
    return {
      bucket,
      rows,
      count: rows.length,
      gross: rows.reduce((s, op) => s + Number(op.gross_amount || 0), 0),
      due: rows.reduce((s, op) => s + Number(op.refund_due || 0), 0),
      effect: rows.reduce((s, op) => s + Number(op.balance_effect || 0), 0),
    };
  });

  const verdictBadge = (v) => {
    if (v === "ok") return <span className="px-2 py-1 rounded-md bg-green-500/10 text-green-600 text-xs font-semibold">OK</span>;
    if (v === "surplus") return <span className="px-2 py-1 rounded-md bg-orange-500/10 text-orange-600 text-xs font-semibold">Surplus</span>;
    return <span className="px-2 py-1 rounded-md bg-red-500/10 text-red-600 text-xs font-semibold">Manquant</span>;
  };

  const auditUser = (userId) => {
    setSelectedUserId(userId);
    loadAudit(userId);
  };

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground text-sm"><RefreshCw size={14} className="animate-spin" /> Audit des soldes...</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Audit des soldes</h1>
          <p className="text-sm text-muted-foreground">Compare le solde affiché avec le solde attendu recalculé depuis le grand livre wallet.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setSelectedUserId(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") loadAudit(""); }}
              placeholder="Email, téléphone, nom, username, ID..."
              className="h-9 w-80 max-w-[80vw] pl-9 pr-3 rounded-lg border border-input bg-background text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-9 px-3 rounded-lg border border-input bg-background text-sm">
            {["FCFA", "EUR", "USD", "USDT", "BTC"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <label className="h-9 px-3 rounded-lg border border-border bg-background flex items-center gap-2 text-xs">
            <input type="checkbox" checked={onlyMismatches} onChange={(e) => setOnlyMismatches(e.target.checked)} />
            Écarts seulement
          </label>
          <button onClick={() => loadAudit("")} className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold flex items-center gap-1.5">
            <RefreshCw size={13} /> Auditer
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
        {[
          { label: "Comptes audités", value: fmt(summary.accounts_checked || 0), color: "text-foreground" },
          { label: "Écarts détectés", value: fmt(mismatchCount), color: mismatchCount ? "text-red-500" : "text-green-500" },
          { label: "Solde affiché", value: `${fmt(Math.round(summary.stored_total || 0))} ${data.currency || currency}`, color: "text-blue-600" },
          { label: "Solde attendu", value: `${fmt(Math.round(summary.expected_total || 0))} ${data.currency || currency}`, color: "text-emerald-600" },
          { label: "Écart absolu", value: `${fmt(Math.round(absDelta))} ${data.currency || currency}`, color: absDelta ? "text-red-500" : "text-green-500" },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-border bg-background p-4">
            <p className={`text-lg font-bold tabular-nums ${c.color}`}>{c.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{c.label}</p>
          </div>
        ))}
      </div>

      <div className={`rounded-xl border p-4 ${mismatchCount ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20" : "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/20"}`}>
        <p className={`text-sm font-semibold ${mismatchCount ? "text-red-700 dark:text-red-300" : "text-green-700 dark:text-green-300"}`}>
          {mismatchCount ? `${mismatchCount} compte(s) ont un écart de solde.` : "Aucun écart détecté sur le périmètre audité."}
        </p>
        <p className="text-xs text-muted-foreground mt-1">{data.formula}</p>
      </div>

      {selected && (
        <div className="rounded-2xl border border-border bg-background overflow-hidden">
          <div className={`p-5 border-b ${Math.abs(selectedDelta) > 0.01 ? "bg-red-50 border-red-100 dark:bg-red-950/20 dark:border-red-900" : "bg-green-50 border-green-100 dark:bg-green-950/20 dark:border-green-900"}`}>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conclusion simple</p>
                <h2 className="text-xl font-bold mt-1">
                  {Math.abs(selectedDelta) <= 0.01
                    ? `${selectedName} a le bon solde.`
                    : selectedDelta > 0
                      ? `${selectedName} a trop d'argent affiché.`
                      : `${selectedName} a moins d'argent affiché que prévu.`}
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {selected.email || selected.phone_e164} {selected.username ? `· @${selected.username}` : ""} · {fmt(selected.entries)} écriture(s) analysée(s)
                </p>
              </div>
              <div>{verdictBadge(selected.verdict)}</div>
            </div>
          </div>

          <div className="grid md:grid-cols-4 gap-0 divide-y md:divide-y-0 md:divide-x divide-border">
            <div className="p-4">
              <p className="text-xs text-muted-foreground">Solde affiché à l'utilisateur</p>
              <p className="text-2xl font-extrabold mt-1 tabular-nums">{fmt(Math.round(selected.stored_balance))} {selected.currency}</p>
            </div>
            <div className="p-4">
              <p className="text-xs text-muted-foreground">Solde recalculé par Kobo</p>
              <p className="text-2xl font-extrabold mt-1 tabular-nums text-emerald-600">{fmt(Math.round(selected.expected_balance))} {selected.currency}</p>
            </div>
            <div className="p-4">
              <p className="text-xs text-muted-foreground">Écart</p>
              <p className={`text-2xl font-extrabold mt-1 tabular-nums ${Math.abs(selectedDelta) > 0.01 ? "text-red-500" : "text-green-600"}`}>
                {fmt(Math.round(selectedDelta))} {selected.currency}
              </p>
            </div>
            <div className="p-4">
              <p className="text-xs text-muted-foreground">Calcul utilisé</p>
              <p className="text-sm font-semibold mt-2">
                {fmt(Math.round(selected.credits))} crédits - {fmt(Math.round(selected.debits))} débits = {fmt(Math.round(selected.expected_balance))} {selected.currency}
              </p>
            </div>
          </div>

          {simpleBreakdown.length > 0 && (
            <div className="p-5 border-t border-border">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                <div>
                  <h3 className="text-sm font-semibold">Ce qui explique le solde</h3>
                  <p className="text-xs text-muted-foreground">Les principales entrées qui augmentent ou diminuent le compte.</p>
                </div>
              </div>
              <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
                {simpleBreakdown.map((r) => (
                  <div key={`${r.category}-${r.direction}-${r.status}`} className="rounded-xl border border-border bg-secondary/25 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold">{categoryLabel(r.category)}</p>
                      <StatusBadge status={r.status} />
                    </div>
                    <p className={`text-xl font-extrabold mt-3 tabular-nums ${r.signed >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                      {r.signed >= 0 ? "+" : "-"}{fmt(Math.round(Math.abs(r.signed)))} {r.currency}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">{fmt(r.count)} opération(s) · {r.direction === "credit" ? "augmente" : "diminue"} le solde</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {withdrawalJourneys.length > 0 && (
            <div className="p-5 border-t border-border">
              <h3 className="text-sm font-semibold">Analyse des retraits</h3>
              <p className="text-xs text-muted-foreground mt-1">Pour chaque retrait : débit initial, remboursement éventuel, puis reprise si le retrait repart en traitement.</p>
              <div className="grid lg:grid-cols-2 gap-3 mt-3">
                {withdrawalJourneys.slice(0, 6).map((w) => (
                  <div key={w.id} className="rounded-xl border border-border bg-secondary/20 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-xs text-muted-foreground">{w.id}</p>
                        <p className="text-sm font-semibold mt-1">
                          {w.refunds > 0 && w.reversals === 0 ? "Retrait remboursé" : w.reversals > 0 ? "Retrait relancé après remboursement" : "Retrait débité"}
                        </p>
                      </div>
                      <span className={`px-2 py-1 rounded-md text-xs font-semibold ${w.net >= 0 ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-500"}`}>
                        Net {w.net >= 0 ? "+" : "-"}{fmt(Math.round(Math.abs(w.net)))} {currency}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                      <div className="rounded-lg bg-background border border-border p-2">
                        <p className="text-muted-foreground">Débité</p>
                        <p className="font-bold text-red-500">-{fmt(Math.round(w.debits))}</p>
                      </div>
                      <div className="rounded-lg bg-background border border-border p-2">
                        <p className="text-muted-foreground">Remboursé</p>
                        <p className="font-bold text-emerald-600">+{fmt(Math.round(w.refunds))}</p>
                      </div>
                      <div className="rounded-lg bg-background border border-border p-2">
                        <p className="text-muted-foreground">Repris</p>
                        <p className="font-bold text-red-500">-{fmt(Math.round(w.reversals))}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {flowItems.length > 0 && (
            <div className="p-5 border-t border-border">
              <h3 className="text-sm font-semibold">Cheminement chronologique</h3>
              <p className="text-xs text-muted-foreground mt-1">Lecture dans l'ordre : chaque ligne montre pourquoi le solde monte ou descend.</p>
              <div className="mt-4 space-y-3">
                {flowItems.slice(-12).map((tx, index) => (
                  <div key={tx.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className={`h-8 w-8 rounded-full flex items-center justify-center ${tx.tone}`}>
                        {tx.impact >= 0 ? <ArrowDownToLine size={14} /> : <Send size={14} />}
                      </div>
                      {index < Math.min(flowItems.length, 12) - 1 && <div className="w-px flex-1 bg-border mt-2" />}
                    </div>
                    <div className="flex-1 rounded-xl border border-border bg-secondary/20 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold">{tx.title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{fmtDate(tx.created_at)} · {tx.label || tx.counterpart || tx.status}</p>
                          <p className="text-xs text-muted-foreground mt-1">{tx.text}</p>
                        </div>
                        <p className={`text-sm font-extrabold tabular-nums ${tx.impact >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                          {tx.impact >= 0 ? "+" : "-"}{fmt(Math.round(Math.abs(tx.impact)))} {tx.currency}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {operations.length > 0 && (
            <div className="p-5 border-t border-border">
              <h3 className="text-sm font-semibold">Toutes les opérations séparées</h3>
              <p className="text-xs text-muted-foreground mt-1">Paiements par lien, dépôts, retraits, transferts bancaires, P2P et crypto sont classés par résultat.</p>
              <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3 mt-3">
                {opGroups.map((g) => (
                  <div key={g.bucket} className={`rounded-xl border p-4 ${opBucketTone[g.bucket] || "border-border bg-secondary/20"}`}>
                    <p className="text-xs font-semibold uppercase tracking-wide">{opBucketLabel[g.bucket] || g.bucket}</p>
                    <p className="text-2xl font-extrabold mt-2">{fmt(g.count)}</p>
                    <p className="text-xs mt-2">Volume : {fmt(Math.round(g.gross))} {currency}</p>
                    {g.due > 0 && <p className="text-xs font-bold">À rembourser : {fmt(Math.round(g.due))} {currency}</p>}
                    <p className="text-xs">Effet solde : {g.effect >= 0 ? "+" : "-"}{fmt(Math.round(Math.abs(g.effect)))} {currency}</p>
                  </div>
                ))}
              </div>
              {operationSummary.length > 0 && (
                <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3 mt-4">
                  {operationSummary.slice(0, 9).map((r) => (
                    <div key={`${r.family}-${r.status_bucket}`} className="rounded-xl border border-border bg-secondary/20 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold">{r.family}</p>
                        <span className="text-xs text-muted-foreground">{opBucketLabel[r.status_bucket] || r.status_bucket}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">{fmt(r.count)} opération(s)</p>
                      <p className="text-sm font-bold mt-1">Effet : {Number(r.balance_effect_total || 0) >= 0 ? "+" : "-"}{fmt(Math.round(Math.abs(Number(r.balance_effect_total || 0))))} {r.currency || currency}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {operations.length > 0 && (
        <div className="hidden xl:block rounded-xl border border-border bg-background p-4 space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Tableau des opérations métier</h2>
            <p className="text-xs text-muted-foreground">Vue séparée de toutes les transactions : lien de paiement, dépôt, retrait, P2P, transfert bancaire et crypto.</p>
          </div>
          <DataTable
            data={operations}
            searchFields={["family", "channel", "status_bucket", "status", "reference", "provider_reference", "note"]}
            emptyText="Aucune opération"
            exportFilename="kobo-audit-operations.csv"
            columns={[
              { key: "created_at", label: "Date", sortable: true, render: (v) => <span className="text-xs text-muted-foreground">{fmtDate(v)}</span> },
              { key: "family", label: "Type", sortable: true, render: (v, row) => <div><p className="font-semibold">{v}</p><p className="text-xs text-muted-foreground">{row.channel}</p></div> },
              { key: "status_bucket", label: "Résultat", sortable: true, render: (v) => <span className={`px-2 py-1 rounded-md text-xs font-semibold ${opBucketTone[v] || "bg-secondary text-muted-foreground"}`}>{opBucketLabel[v] || v}</span> },
              { key: "gross_amount", label: "Montant", sortable: true, render: (v, row) => <span className="font-semibold">{fmt(Math.round(v))} {row.currency}</span> },
              { key: "fee_amount", label: "Frais", sortable: true, render: (v, row) => <span>{fmt(Math.round(v))} {row.currency}</span> },
              { key: "refund_amount", label: "Remboursé", sortable: true, render: (v, row) => <span className="font-semibold text-violet-600">{fmt(Math.round(v))} {row.currency}</span> },
              { key: "refund_due", label: "À rembourser", sortable: true, render: (v, row) => <span className={Number(v) > 0 ? "font-bold text-amber-600" : "text-muted-foreground"}>{fmt(Math.round(v))} {row.currency}</span> },
              { key: "balance_effect", label: "Effet solde", sortable: true, render: (v, row) => <span className={Number(v) >= 0 ? "font-bold text-emerald-600" : "font-bold text-red-500"}>{Number(v) >= 0 ? "+" : "-"}{fmt(Math.round(Math.abs(Number(v))))} {row.currency}</span> },
              { key: "reference", label: "Référence", render: (v, row) => <div><p className="font-mono text-xs">{v}</p>{row.provider_reference && <p className="font-mono text-[11px] text-muted-foreground">{row.provider_reference}</p>}</div> },
              { key: "note", label: "Explication", render: (v) => <span className="text-sm">{v || "—"}</span> },
            ]}
            actions={(r) => <button onClick={() => setDetail({ type: "Opération métier", row: r })} className="h-7 px-2 rounded-md text-xs font-medium flex items-center gap-1 hover:bg-secondary text-muted-foreground hover:text-foreground"><FileText size={12} />Détails</button>}
          />
        </div>
      )}

      <div className="hidden xl:block rounded-xl border border-border bg-background p-4 space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Tableau complet des utilisateurs audités</h2>
          <p className="text-xs text-muted-foreground">“Solde affiché” vient de `wallet_accounts`. “Solde attendu” est reconstruit depuis `wallet_transactions`.</p>
        </div>
        <DataTable
          data={data.items || []}
          searchFields={["user_id", "email", "phone_e164", "fullName", "username", "verdict"]}
          emptyText="Aucun compte à afficher"
          exportFilename="kobo-audit-soldes.csv"
          columns={[
            { key: "verdict", label: "Verdict", sortable: true, render: (v) => verdictBadge(v) },
            { key: "fullName", label: "Utilisateur", render: (v, row) => <div><p className="font-semibold">{v || row.email || row.phone_e164 || row.user_id}</p><p className="text-xs text-muted-foreground">{row.email || row.phone_e164} {row.username ? `· @${row.username}` : ""}</p></div> },
            { key: "stored_balance", label: "Solde affiché", sortable: true, render: (v, row) => <span className="font-semibold">{fmt(Math.round(v))} {row.currency}</span> },
            { key: "expected_balance", label: "Solde attendu", sortable: true, render: (v, row) => <span className="font-semibold text-emerald-600">{fmt(Math.round(v))} {row.currency}</span> },
            { key: "delta", label: "Écart", sortable: true, render: (v, row) => <span className={Math.abs(Number(v)) > 0.01 ? "font-bold text-red-500" : "font-semibold text-green-600"}>{fmt(Math.round(v))} {row.currency}</span> },
            { key: "credits", label: "Crédits", sortable: true, render: (v, row) => <span>{fmt(Math.round(v))} {row.currency}</span> },
            { key: "debits", label: "Débits", sortable: true, render: (v, row) => <span>{fmt(Math.round(v))} {row.currency}</span> },
            { key: "entries", label: "Écritures", sortable: true },
            { key: "last_entry_at", label: "Dernière écriture", sortable: true, render: (v) => <span className="text-xs text-muted-foreground">{fmtDate(v)}</span> },
          ]}
          actions={(r) => (
            <>
              <button onClick={() => auditUser(r.user_id)} className="h-7 px-2 rounded-md text-xs font-medium flex items-center gap-1 hover:bg-secondary text-muted-foreground hover:text-foreground"><Database size={12} />Auditer</button>
              <button onClick={() => onViewUser(r.user_id)} className="h-7 px-2 rounded-md text-xs font-medium flex items-center gap-1 hover:bg-secondary text-muted-foreground hover:text-foreground"><Eye size={12} />Profil</button>
              <button onClick={() => setDetail({ type: "Audit solde", row: r })} className="h-7 px-2 rounded-md text-xs font-medium flex items-center gap-1 hover:bg-secondary text-muted-foreground hover:text-foreground"><FileText size={12} />Détails</button>
            </>
          )}
        />
      </div>

      <details className="xl:hidden rounded-xl border border-border bg-background p-4">
        <summary className="cursor-pointer text-sm font-semibold">Voir le tableau complet des utilisateurs audités</summary>
        <div className="mt-4 space-y-3">
          <p className="text-xs text-muted-foreground">“Solde affiché” vient de `wallet_accounts`. “Solde attendu” est reconstruit depuis `wallet_transactions`.</p>
        <DataTable
          data={data.items || []}
          searchFields={["user_id", "email", "phone_e164", "fullName", "username", "verdict"]}
          emptyText="Aucun compte à afficher"
          exportFilename="kobo-audit-soldes.csv"
          columns={[
            { key: "verdict", label: "Verdict", sortable: true, render: (v) => verdictBadge(v) },
            { key: "fullName", label: "Utilisateur", render: (v, row) => <div><p className="font-semibold">{v || row.email || row.phone_e164 || row.user_id}</p><p className="text-xs text-muted-foreground">{row.email || row.phone_e164} {row.username ? `· @${row.username}` : ""}</p></div> },
            { key: "stored_balance", label: "Solde affiché", sortable: true, render: (v, row) => <span className="font-semibold">{fmt(Math.round(v))} {row.currency}</span> },
            { key: "expected_balance", label: "Solde attendu", sortable: true, render: (v, row) => <span className="font-semibold text-emerald-600">{fmt(Math.round(v))} {row.currency}</span> },
            { key: "delta", label: "Écart", sortable: true, render: (v, row) => <span className={Math.abs(Number(v)) > 0.01 ? "font-bold text-red-500" : "font-semibold text-green-600"}>{fmt(Math.round(v))} {row.currency}</span> },
            { key: "credits", label: "Crédits", sortable: true, render: (v, row) => <span>{fmt(Math.round(v))} {row.currency}</span> },
            { key: "debits", label: "Débits", sortable: true, render: (v, row) => <span>{fmt(Math.round(v))} {row.currency}</span> },
            { key: "entries", label: "Écritures", sortable: true },
            { key: "last_entry_at", label: "Dernière écriture", sortable: true, render: (v) => <span className="text-xs text-muted-foreground">{fmtDate(v)}</span> },
          ]}
          actions={(r) => (
            <>
              <button onClick={() => auditUser(r.user_id)} className="h-7 px-2 rounded-md text-xs font-medium flex items-center gap-1 hover:bg-secondary text-muted-foreground hover:text-foreground"><Database size={12} />Auditer</button>
              <button onClick={() => onViewUser(r.user_id)} className="h-7 px-2 rounded-md text-xs font-medium flex items-center gap-1 hover:bg-secondary text-muted-foreground hover:text-foreground"><Eye size={12} />Profil</button>
              <button onClick={() => setDetail({ type: "Audit solde", row: r })} className="h-7 px-2 rounded-md text-xs font-medium flex items-center gap-1 hover:bg-secondary text-muted-foreground hover:text-foreground"><FileText size={12} />Détails</button>
            </>
          )}
        />
        </div>
      </details>

      {data.detail?.user_id && (
        <div className="grid xl:grid-cols-2 gap-4">
          <div className="hidden xl:block rounded-xl border border-border bg-background p-4">
            <h2 className="text-sm font-semibold mb-4">Décomposition comptable</h2>
            <DataTable
              data={data.detail.breakdown || []}
              searchFields={["category", "direction", "status", "currency"]}
              emptyText="Aucune décomposition"
              exportFilename="kobo-audit-solde-breakdown.csv"
              columns={[
                { key: "category", label: "Catégorie", sortable: true, render: (v) => <span className="font-mono text-xs">{v}</span> },
                { key: "direction", label: "Sens", sortable: true, render: (v) => <span className={v === "credit" ? "text-emerald-600 font-semibold" : "text-red-500 font-semibold"}>{v}</span> },
                { key: "status", label: "Statut", sortable: true, render: (v) => <StatusBadge status={v} /> },
                { key: "count", label: "Nb", sortable: true },
                { key: "total", label: "Total", sortable: true, render: (v, row) => <span>{fmt(Math.round(v))} {row.currency}</span> },
              ]}
            />
          </div>
          <div className="hidden xl:block rounded-xl border border-border bg-background p-4">
            <h2 className="text-sm font-semibold mb-4">Écritures récentes</h2>
            <DataTable
              data={data.detail.transactions || []}
              searchFields={["id", "category", "label", "counterpart", "status"]}
              emptyText="Aucune écriture"
              exportFilename="kobo-audit-solde-transactions.csv"
              columns={[
                { key: "created_at", label: "Date", sortable: true, render: (v) => <span className="text-xs text-muted-foreground">{fmtDate(v)}</span> },
                { key: "category", label: "Catégorie", sortable: true, render: (v) => <span className="font-mono text-xs">{v}</span> },
                { key: "direction", label: "Sens", sortable: true, render: (v) => <span className={v === "credit" ? "text-emerald-600 font-semibold" : "text-red-500 font-semibold"}>{v}</span> },
                { key: "amount", label: "Montant", sortable: true, render: (v, row) => <span className="font-semibold">{fmt(Math.round(v))} {row.currency}</span> },
                { key: "status", label: "Statut", sortable: true, render: (v) => <StatusBadge status={v} /> },
                { key: "label", label: "Libellé", render: (v) => <span className="text-sm">{v}</span> },
              ]}
              actions={(r) => <button onClick={() => setDetail({ type: "Écriture audit", row: r })} className="h-7 px-2 rounded-md text-xs font-medium flex items-center gap-1 hover:bg-secondary text-muted-foreground hover:text-foreground"><FileText size={12} />Détails</button>}
            />
          </div>
          <details className="xl:hidden rounded-xl border border-border bg-background p-4">
            <summary className="cursor-pointer text-sm font-semibold">Voir la décomposition comptable</summary>
            <div className="mt-4">
            <DataTable
              data={data.detail.breakdown || []}
              searchFields={["category", "direction", "status", "currency"]}
              emptyText="Aucune décomposition"
              exportFilename="kobo-audit-solde-breakdown.csv"
              columns={[
                { key: "category", label: "Catégorie", sortable: true, render: (v) => <span className="font-mono text-xs">{v}</span> },
                { key: "direction", label: "Sens", sortable: true, render: (v) => <span className={v === "credit" ? "text-emerald-600 font-semibold" : "text-red-500 font-semibold"}>{v}</span> },
                { key: "status", label: "Statut", sortable: true, render: (v) => <StatusBadge status={v} /> },
                { key: "count", label: "Nb", sortable: true },
                { key: "total", label: "Total", sortable: true, render: (v, row) => <span>{fmt(Math.round(v))} {row.currency}</span> },
              ]}
            />
            </div>
          </details>
          <details className="xl:hidden rounded-xl border border-border bg-background p-4">
            <summary className="cursor-pointer text-sm font-semibold">Voir les écritures récentes</summary>
            <div className="mt-4">
            <DataTable
              data={data.detail.transactions || []}
              searchFields={["id", "category", "label", "counterpart", "status"]}
              emptyText="Aucune écriture"
              exportFilename="kobo-audit-solde-transactions.csv"
              columns={[
                { key: "created_at", label: "Date", sortable: true, render: (v) => <span className="text-xs text-muted-foreground">{fmtDate(v)}</span> },
                { key: "category", label: "Catégorie", sortable: true, render: (v) => <span className="font-mono text-xs">{v}</span> },
                { key: "direction", label: "Sens", sortable: true, render: (v) => <span className={v === "credit" ? "text-emerald-600 font-semibold" : "text-red-500 font-semibold"}>{v}</span> },
                { key: "amount", label: "Montant", sortable: true, render: (v, row) => <span className="font-semibold">{fmt(Math.round(v))} {row.currency}</span> },
                { key: "status", label: "Statut", sortable: true, render: (v) => <StatusBadge status={v} /> },
                { key: "label", label: "Libellé", render: (v) => <span className="text-sm">{v}</span> },
              ]}
              actions={(r) => <button onClick={() => setDetail({ type: "Écriture audit", row: r })} className="h-7 px-2 rounded-md text-xs font-medium flex items-center gap-1 hover:bg-secondary text-muted-foreground hover:text-foreground"><FileText size={12} />Détails</button>}
            />
            </div>
          </details>
        </div>
      )}

      {detail && <AccountingDetailModal detail={detail} onClose={() => setDetail(null)} onViewUser={onViewUser} />}
    </div>
  );
}

function AccountingDetailModal({ detail, onClose, onViewUser }) {
  const row = detail?.row || {};
  const entries = Object.entries(row).filter(([k]) => k !== "metadata");
  const copyId = row.id || row.reference || "";
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-background border border-border rounded-xl shadow-xl w-full max-w-3xl max-h-[86vh] overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{detail.type}</p>
            <h3 className="text-lg font-bold mt-1">{row.reference || row.id || row.category || row.currency || "Détail comptable"}</h3>
            <p className="text-xs text-muted-foreground mt-1">Trace détaillée utilisée pour audit, rapprochement et contrôle manuel.</p>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-md hover:bg-secondary flex items-center justify-center text-muted-foreground"><X size={16} /></button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          <div className="grid sm:grid-cols-3 gap-3">
            {[
              ["Montant", row.amount != null ? `${fmt(row.amount)} ${row.currency || "FCFA"}` : "—"],
              ["Débit total", row.total_debit != null ? `${fmt(row.total_debit)} FCFA` : row.debits != null ? `${fmt(row.debits)} ${row.currency}` : "—"],
              ["Net", row.net_user_effect != null ? `${fmt(row.net_user_effect)} FCFA` : row.net_movement != null ? `${fmt(row.net_movement)} ${row.currency}` : "—"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border bg-secondary/30 p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</p>
                <p className="text-sm font-bold mt-1">{value}</p>
              </div>
            ))}
          </div>

          <div className="grid sm:grid-cols-2 gap-2 text-sm">
            {entries.map(([key, value]) => (
              <div key={key} className="rounded-lg border border-border p-3 min-w-0">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">{key}</p>
                <p className="mt-1 break-words font-mono text-xs">{value == null || value === "" ? "—" : typeof value === "boolean" ? (value ? "oui" : "non") : String(value)}</p>
              </div>
            ))}
          </div>

          {row.metadata && Object.keys(row.metadata).length > 0 && (
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="px-3 py-2 border-b border-border bg-secondary/40 text-xs font-semibold text-muted-foreground">Métadonnées</div>
              <pre className="p-3 text-xs overflow-x-auto">{JSON.stringify(row.metadata, null, 2)}</pre>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {copyId && (
              <button onClick={() => { navigator.clipboard.writeText(copyId); toast.success("Identifiant copié"); }} className="h-8 px-3 rounded-md border border-border text-xs flex items-center gap-1.5 hover:bg-secondary">
                <Copy size={13} /> Copier ID
              </button>
            )}
            {row.user_id && (
              <button onClick={() => onViewUser(row.user_id)} className="h-8 px-3 rounded-md border border-border text-xs flex items-center gap-1.5 hover:bg-secondary">
                <Eye size={13} /> Profil utilisateur
              </button>
            )}
          </div>
          <button onClick={onClose} className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium">Fermer</button>
        </div>
      </div>
    </div>
  );
}

// ── API Tab ───────────────────────────────────────────────────────────────────

function ApiTab({ token }) {
  const [users, setUsers]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState("");
  const [selected, setSelected]     = useState(null); // user sélectionné
  const [keys, setKeys]             = useState([]);
  const [webhook, setWebhook]       = useState(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [creating, setCreating]     = useState(false);
  const [newKey, setNewKey]         = useState(null); // clé affichée une seule fois

  useEffect(() => {
    adminFetch("/admin/users?limit=200", "GET", null, token)
      .then((d) => setUsers(d.items || []))
      .catch(() => toast.error("Erreur chargement utilisateurs"))
      .finally(() => setLoading(false));
  }, [token]);

  const loadMerchantData = async (userId) => {
    try {
      const [keysData, webhookData] = await Promise.allSettled([
        adminFetch(`/admin/api/keys/${userId}`, "GET", null, token),
        adminFetch(`/admin/api/webhook/${userId}`, "GET", null, token),
      ]);
      setKeys(keysData.status === "fulfilled" ? (keysData.value.items || []) : []);
      setWebhook(webhookData.status === "fulfilled" ? webhookData.value : null);
    } catch {}
  };

  const selectUser = (u) => { setSelected(u); setNewKey(null); loadMerchantData(u.id); };

  const createKey = async () => {
    if (!newKeyName.trim()) { toast.error("Nom requis"); return; }
    setCreating(true);
    try {
      const res = await adminFetch("/admin/api/keys", "POST",
        { user_id: selected.id, name: newKeyName.trim() }, token);
      setNewKey(res.key);
      setNewKeyName("");
      loadMerchantData(selected.id);
    } catch (e) { toast.error(e.message); }
    finally { setCreating(false); }
  };

  const revokeKey = async (keyId) => {
    if (!window.confirm("Révoquer cette clé API ?")) return;
    try {
      await adminFetch(`/admin/api/keys/${keyId}`, "DELETE", null, token);
      toast.success("Clé révoquée");
      loadMerchantData(selected.id);
    } catch (e) { toast.error(e.message); }
  };

  const saveWebhook = async () => {
    if (!webhookUrl.trim()) return;
    try {
      await adminFetch("/admin/api/webhook", "POST",
        { user_id: selected.id, url: webhookUrl.trim() }, token);
      toast.success("Webhook enregistré");
      setWebhookUrl("");
      loadMerchantData(selected.id);
    } catch (e) { toast.error(e.message); }
  };

  const filtered = users.filter((u) =>
    !search || (u.email || u.phone_e164 || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-4xl space-y-5 mb-8">
      <div>
        <h2 className="font-semibold text-base mb-1">API publique marchands</h2>
        <p className="text-sm text-muted-foreground">
          Gérez les clés API et webhooks des marchands. Frais : <strong>5 %</strong> par paiement.
        </p>
      </div>

      <div className="grid md:grid-cols-5 gap-4">
        {/* Liste marchands */}
        <div className="md:col-span-2 space-y-2">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Chercher un marchand…"
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-input bg-background text-sm focus:outline-none" />
          </div>
          <div className="space-y-1 max-h-[400px] overflow-y-auto">
            {loading ? <p className="text-xs text-muted-foreground p-2">Chargement…</p> :
              filtered.map((u) => (
                <button key={u.id} onClick={() => selectUser(u)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors
                    ${selected?.id === u.id ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}>
                  <p className="font-medium truncate">{u.email || u.phone_e164}</p>
                  <p className="text-[10px] opacity-60">{u.id}</p>
                </button>
              ))}
          </div>
        </div>

        {/* Détail marchand */}
        <div className="md:col-span-3 space-y-4">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground text-sm border border-dashed rounded-xl">
              <Key size={24} className="mb-2 opacity-30" />
              Sélectionnez un marchand
            </div>
          ) : (
            <>
              <p className="font-semibold text-sm truncate">{selected.email || selected.phone_e164}</p>

              {/* Clé créée — affichage unique */}
              {newKey && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 p-4 space-y-2">
                  <p className="text-xs font-semibold text-emerald-700">Clé créée — copiez-la maintenant, elle ne sera plus visible</p>
                  <div className="flex items-center gap-2">
                    <code className="text-xs flex-1 bg-white dark:bg-background border border-border rounded-lg px-3 py-1.5 break-all font-mono">
                      {newKey}
                    </code>
                    <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(newKey); toast.success("Copié !"); }}>
                      <Copy size={12} />
                    </Button>
                  </div>
                  <Button size="sm" variant="ghost" className="text-xs" onClick={() => setNewKey(null)}>Masquer</Button>
                </div>
              )}

              {/* Clés existantes */}
              <div className="rounded-xl border border-border bg-background">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <p className="text-sm font-semibold">Clés API</p>
                  <div className="flex gap-2">
                    <input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)}
                      placeholder="Nom de la clé"
                      className="h-7 px-2 rounded-lg border border-input bg-background text-xs focus:outline-none w-32" />
                    <Button size="sm" onClick={createKey} disabled={creating}>
                      <Plus size={12} className="mr-1" /> Créer
                    </Button>
                  </div>
                </div>
                {keys.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-4 py-3">Aucune clé API</p>
                ) : (
                  <div className="divide-y divide-border">
                    {keys.map((k) => (
                      <div key={k.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{k.name}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {k.is_test ? "TEST" : "LIVE"} · Créée {new Date(k.created_at).toLocaleDateString("fr")}
                            {k.last_used_at ? ` · Dernière utilisation ${new Date(k.last_used_at).toLocaleDateString("fr")}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${k.active ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-600"}`}>
                            {k.active ? "Active" : "Révoquée"}
                          </span>
                          {k.active && (
                            <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700 h-6 px-2"
                              onClick={() => revokeKey(k.id)}>
                              <Ban size={11} />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Webhook */}
              <div className="rounded-xl border border-border bg-background">
                <div className="px-4 py-3 border-b border-border">
                  <p className="text-sm font-semibold">Webhook</p>
                  <p className="text-xs text-muted-foreground mt-0.5">URL appelée à chaque paiement réussi</p>
                </div>
                <div className="px-4 py-3 space-y-3">
                  {webhook ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <ExternalLink size={12} className="text-muted-foreground shrink-0" />
                        <code className="text-xs flex-1 truncate text-muted-foreground">{webhook.url}</code>
                      </div>
                      <p className="text-[10px] text-muted-foreground font-mono">Secret : {webhook.secret}</p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Aucun webhook configuré</p>
                  )}
                  <div className="flex gap-2">
                    <input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)}
                      placeholder="https://votresite.com/webhooks/kobo"
                      className="flex-1 h-8 px-3 rounded-lg border border-input bg-background text-xs focus:outline-none" />
                    <Button size="sm" onClick={saveWebhook} disabled={!webhookUrl.trim()}>
                      {webhook ? "Modifier" : "Enregistrer"}
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Documentation rapide */}
      <div className="rounded-xl border border-border bg-background p-4 space-y-3">
        <p className="text-sm font-semibold">Référence rapide</p>
        <div className="grid sm:grid-cols-2 gap-2">
          {[
            ["POST /api/v1/payment-requests", "Créer un lien de paiement"],
            ["GET /api/v1/payment-requests/:id", "Statut d'un paiement"],
            ["GET /api/v1/balance", "Solde FCFA"],
            ["GET /api/v1/me", "Infos compte marchand"],
          ].map(([endpoint, desc]) => (
            <div key={endpoint} className="bg-secondary/40 rounded-lg px-3 py-2">
              <code className="text-[11px] font-mono text-blue-600 dark:text-blue-400">{endpoint}</code>
              <p className="text-[10px] text-muted-foreground mt-0.5">{desc}</p>
            </div>
          ))}
        </div>
        <div className="bg-secondary/40 rounded-lg px-3 py-2">
          <p className="text-[11px] font-mono text-muted-foreground">Authorization: Bearer kb_live_...</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Header requis sur toutes les requêtes</p>
        </div>
      </div>
    </div>
  );
}

// ── Fraud Tab ─────────────────────────────────────────────────────────────────

const SIGNAL_LABELS = {
  accumulated_warns:    { label: "Warns accumulés",       color: "text-orange-500", bg: "bg-orange-500/10" },
  rapid_cycle:          { label: "Cycle rapide dépôt/retrait", color: "text-red-500", bg: "bg-red-500/10" },
  smurfing:             { label: "Fractionnement (smurfing)", color: "text-purple-500", bg: "bg-purple-500/10" },
  balance_anomaly:      { label: "Anomalie de solde",     color: "text-red-600", bg: "bg-red-600/10" },
  kyc0_high_balance:    { label: "KYC-0 + solde élevé",   color: "text-yellow-500", bg: "bg-yellow-500/10" },
  circular_flow:        { label: "Flux circulaire A→B→C→A", color: "text-pink-500", bg: "bg-pink-500/10" },
  dormant_reactivation: { label: "Compte dormant réactivé", color: "text-blue-500", bg: "bg-blue-500/10" },
  multi_ip:             { label: "Multi-IP suspect",       color: "text-indigo-500", bg: "bg-indigo-500/10" },
};

const ACTION_STYLE = {
  auto_block: { label: "AUTO-BLOQUÉ",  bg: "bg-red-100 dark:bg-red-900/30",    text: "text-red-700 dark:text-red-400",    dot: "bg-red-500" },
  review:     { label: "SURVEILLANCE", bg: "bg-orange-100 dark:bg-orange-900/30", text: "text-orange-700 dark:text-orange-400", dot: "bg-orange-500" },
  flag:       { label: "SIGNALÉ",      bg: "bg-yellow-100 dark:bg-yellow-900/20", text: "text-yellow-700 dark:text-yellow-500", dot: "bg-yellow-500" },
};

// ── UsersTab ──────────────────────────────────────────────────────────────────

function UsersTab({ token, onViewUser }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterKyc, setFilterKyc] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterPeriod, setFilterPeriod] = useState("");
  const [filterCountry, setFilterCountry] = useState("");
  const [sortBy, setSortBy] = useState("created_at");
  const [sortOrder, setSortOrder] = useState("desc");
  const [page, setPage] = useState(0);
  const [localModal, setLocalModal] = useState(null);
  const [selectedUsers, setSelectedUsers] = useState(new Set());
  const PAGE_SIZE = 25;
  const searchTimer = useRef(null);

  // Debounce search
  useEffect(() => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setDebouncedSearch(search); setPage(0); }, 350);
    return () => clearTimeout(searchTimer.current);
  }, [search]);

  useEffect(() => { fetchUsers(); setSelectedUsers(new Set()); }, [debouncedSearch, filterKyc, filterStatus, filterCountry, sortBy, sortOrder, page]);

  async function fetchUsers() {
    setLoading(true);
    try {
      const p = new URLSearchParams({ limit: PAGE_SIZE, offset: page * PAGE_SIZE, sort_by: sortBy, sort_order: sortOrder });
      if (debouncedSearch) p.set("search", debouncedSearch);
      if (filterKyc !== "") p.set("kyc_level", filterKyc);
      if (filterStatus === "blocked") p.set("is_blocked", "true");
      if (filterStatus === "active")  p.set("is_blocked", "false");
      if (filterCountry) p.set("country", filterCountry);
      const d = await adminFetch(`/admin/users?${p}`, "GET", null, token);
      setItems(d.items || []);
      setTotal(d.total || 0);
      setStats(d.stats || null);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  function toggleSelectUser(id) {
    setSelectedUsers((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  const allOnPageSelected = items.length > 0 && items.every((u) => selectedUsers.has(u.id));
  function toggleAllOnPage() {
    setSelectedUsers((s) => { const n = new Set(s); if (allOnPageSelected) items.forEach((u) => n.delete(u.id)); else items.forEach((u) => n.add(u.id)); return n; });
  }

  async function bulkBlock(ids, block) {
    const endpoint = block ? "block" : "unblock";
    let ok = 0;
    for (const id of ids) {
      try { await adminFetch(`/admin/users/${id}/${endpoint}`, "POST", {}, token); ok++; } catch { /* skip */ }
    }
    toast.success(`${ok} compte${ok > 1 ? "s" : ""} ${block ? "bloqué" : "débloqué"}${ok > 1 ? "s" : ""}`);
    setSelectedUsers(new Set());
    fetchUsers();
  }

  function toggleBlock(user) {
    const isBlocked = user.is_blocked;
    setLocalModal({
      title: isBlocked ? "Débloquer ce compte ?" : `Bloquer ${user.phone_e164} ?`,
      description: isBlocked ? "L'utilisateur pourra se reconnecter." : "Il sera déconnecté immédiatement.",
      variant: isBlocked ? "default" : "danger",
      confirmLabel: isBlocked ? "Débloquer" : "Bloquer",
      onConfirm: async () => {
        const endpoint = isBlocked ? `/admin/users/${user.id}/unblock` : `/admin/users/${user.id}/block`;
        try {
          await adminFetch(endpoint, "POST", {}, token);
          toast.success(isBlocked ? "Compte débloqué" : "Compte bloqué");
          fetchUsers();
        } catch (e) { toast.error(e.message); }
      },
    });
  }

  const fmt = (n) => (n || 0).toLocaleString("fr");
  const fmtDate = (d) => d ? new Date(d).toLocaleString("fr", { dateStyle: "short", timeStyle: "short" }) : "—";

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const blocked  = stats?.blocked ?? items.filter((u) => u.is_blocked).length;
  const active   = stats?.active ?? Math.max(0, total - blocked);
  const kyc0     = items.filter((u) => u.kyc_level === 0).length;
  const kyc1plus = stats?.kyc_validated ?? items.filter((u) => u.kyc_level >= 1).length;

  const SortBtn = ({ col, label }) => (
    <button onClick={() => { if (sortBy === col) setSortOrder(o => o === "desc" ? "asc" : "desc"); else { setSortBy(col); setSortOrder("desc"); } }}
      className={`flex items-center gap-1 text-xs font-semibold ${sortBy === col ? "text-primary" : "text-muted-foreground"}`}>
      {label}
      <span className="opacity-60">{sortBy === col ? (sortOrder === "desc" ? "↓" : "↑") : "↕"}</span>
    </button>
  );

  return (
    <div className="space-y-4">
      {/* ── Stats row ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total",          val: stats?.total ?? total,   color: "text-foreground" },
          { label: "Actifs",         val: active, color: "text-green-500" },
          { label: "Bloqués",        val: blocked,  color: "text-red-500" },
          { label: "KYC validés",    val: kyc1plus, color: "text-blue-500" },
        ].map(({ label, val, color }) => (
          <div key={label} className="rounded-xl border border-border bg-background p-3 text-center">
            <p className={`text-xl font-extrabold tabular-nums ${color}`}>{val}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>

      {/* ── Search + Filters ── */}
      <div className="rounded-xl border border-border bg-background p-4 space-y-3">
        {/* Search bar */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Rechercher par téléphone, email, nom, ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Filter row */}
        <div className="flex gap-2 flex-wrap">
          {/* KYC */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">KYC :</span>
            {[["", "Tous"], ["0", "Non vérifié"], ["1", "Niv.1"], ["2", "Niv.2+"]].map(([v, l]) => (
              <button key={v} onClick={() => { setFilterKyc(v); setPage(0); }}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${filterKyc === v ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-foreground/30"}`}>
                {l}
              </button>
            ))}
          </div>

          {/* Statut */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">Statut :</span>
            {[["", "Tous"], ["active", "Actifs"], ["blocked", "Bloqués"]].map(([v, l]) => (
              <button key={v} onClick={() => { setFilterStatus(v); setPage(0); }}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${filterStatus === v ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-foreground/30"}`}>
                {l}
              </button>
            ))}
          </div>

          {/* Pays */}
          <select value={filterCountry} onChange={(e) => { setFilterCountry(e.target.value); setPage(0); }}
            className="rounded-lg border border-input bg-background px-2.5 py-1 text-xs focus:outline-none">
            <option value="">Tous les pays</option>
            <option value="CM">Cameroun</option>
            <option value="FR">France</option>
            <option value="SN">Sénégal</option>
            <option value="CI">Côte d'Ivoire</option>
            <option value="CD">Congo RDC</option>
          </select>

          {/* Trier par */}
          <select value={`${sortBy}:${sortOrder}`}
            onChange={(e) => { const [s, o] = e.target.value.split(":"); setSortBy(s); setSortOrder(o); setPage(0); }}
            className="rounded-lg border border-input bg-background px-2.5 py-1 text-xs focus:outline-none">
            <option value="created_at:desc">Plus récents</option>
            <option value="created_at:asc">Plus anciens</option>
            <option value="balance_fcfa:desc">Solde FCFA ↓</option>
            <option value="balance_fcfa:asc">Solde FCFA ↑</option>
            <option value="last_active:desc">Dernière activité</option>
            <option value="phone_e164:asc">Téléphone A→Z</option>
          </select>

          <button onClick={() => fetchUsers()} className="h-8 w-8 rounded-lg border border-input flex items-center justify-center hover:bg-secondary shrink-0">
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>

          <span className="text-xs text-muted-foreground flex items-center ml-auto">
            {loading ? "…" : `${total} utilisateur${total > 1 ? "s" : ""}`}
          </span>
        </div>
      </div>

      {/* ── Bulk action bar ── */}
      {selectedUsers.size > 0 && (
        <div className="flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-xl px-4 py-2.5 flex-wrap">
          <span className="text-sm font-semibold text-primary shrink-0">{selectedUsers.size} sélectionné{selectedUsers.size > 1 ? "s" : ""}</span>
          <div className="flex gap-2 flex-1 flex-wrap">
            <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50 dark:border-red-800"
              onClick={() => bulkBlock([...selectedUsers], true)}>
              <Ban size={13} className="mr-1.5" /> Bloquer tous
            </Button>
            <Button size="sm" variant="outline" className="text-green-600 border-green-200 hover:bg-green-50 dark:border-green-800"
              onClick={() => bulkBlock([...selectedUsers], false)}>
              <Check size={13} className="mr-1.5" /> Débloquer tous
            </Button>
            <Button size="sm" variant="outline"
              onClick={() => { const sel = items.filter((u) => selectedUsers.has(u.id)); exportCsv([{key:"id",label:"ID"},{key:"phone_e164",label:"Téléphone"},{key:"email",label:"Email"},{key:"kyc_level",label:"KYC"},{key:"balance_fcfa",label:"Solde FCFA"},{key:"is_blocked",label:"Bloqué"},{key:"created_at",label:"Inscription"}], sel, "kobo-users-selection.csv"); }}>
              <Download size={13} className="mr-1.5" /> Exporter
            </Button>
          </div>
          <button onClick={() => setSelectedUsers(new Set())} className="text-muted-foreground hover:text-foreground shrink-0"><X size={15} /></button>
        </div>
      )}

      {/* ── Table ── */}
      <div className="rounded-xl border border-border overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[24px_2fr_1.5fr_1fr_1fr_1fr_1fr_80px] bg-secondary/50 px-4 py-2 gap-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide items-center">
          <input type="checkbox" checked={allOnPageSelected} onChange={toggleAllOnPage}
            className="rounded w-4 h-4 cursor-pointer accent-primary" />
          <span>Identité</span>
          <SortBtn col="phone_e164" label="Téléphone" />
          <SortBtn col="balance_fcfa" label="Solde FCFA" />
          <span>KYC</span>
          <SortBtn col="last_active" label="Dernière activité" />
          <span>Statut</span>
          <span />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground text-sm">
            <RefreshCw size={14} className="animate-spin" /> Chargement…
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">Aucun utilisateur trouvé.</div>
        ) : (
          <div className="divide-y divide-border">
            {items.map((u) => (
              <div key={u.id} onClick={() => toggleSelectUser(u.id)}
                className={`grid grid-cols-[24px_2fr_1.5fr_1fr_1fr_1fr_1fr_80px] px-4 py-3 gap-3 items-center text-sm cursor-pointer transition-colors ${selectedUsers.has(u.id) ? "bg-primary/5 hover:bg-primary/8" : "hover:bg-secondary/20"}`}>
                <input type="checkbox" checked={selectedUsers.has(u.id)} onChange={() => toggleSelectUser(u.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="rounded w-4 h-4 cursor-pointer accent-primary" />
                {/* Identité */}
                <div className="min-w-0">
                  <p className="font-medium truncate">{u.fullName || "—"}</p>
                  <p className="text-xs text-muted-foreground truncate">{u.email || u.phone_e164 || ""}</p>
                  <p className="text-[10px] text-muted-foreground">{u.country || "—"} · <span className="font-mono">{u.id.slice(0, 8)}…</span></p>
                </div>
                {/* Téléphone */}
                <span className="font-mono text-xs">{u.phone_e164}</span>
                {/* Solde */}
                <span className="font-bold tabular-nums">{fmt(Math.round(u.balance_fcfa))} <span className="text-xs font-normal text-muted-foreground">FCFA</span></span>
                {/* KYC */}
                <div>
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${u.kyc_level >= 1 ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"}`}>
                    Niv.{u.kyc_level}
                  </span>
                  {u.kyc_status && <p className="text-[10px] text-muted-foreground mt-0.5">{u.kyc_status}</p>}
                </div>
                {/* Dernière activité */}
                <span className="text-xs text-muted-foreground">{fmtDate(u.last_active) || <span className="italic">Jamais</span>}</span>
                {/* Statut */}
                <span className={`text-xs font-semibold ${u.is_blocked ? "text-red-500" : "text-green-500"}`}>
                  {u.is_blocked ? "Bloqué" : "Actif"}
                </span>
                {/* Actions */}
                <div className="flex gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => onViewUser(u.id)}
                    className="h-7 w-7 rounded-lg border border-border flex items-center justify-center hover:bg-secondary text-muted-foreground hover:text-foreground"
                    title="Voir le profil">
                    <Eye size={12} />
                  </button>
                  <button onClick={() => toggleBlock(u)}
                    className={`h-7 w-7 rounded-lg border flex items-center justify-center ${u.is_blocked ? "border-green-200 text-green-600 hover:bg-green-50" : "border-red-200 text-red-500 hover:bg-red-50"}`}
                    title={u.is_blocked ? "Débloquer" : "Bloquer"}>
                    {u.is_blocked ? <Check size={12} /> : <Ban size={12} />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Pagination ── */}
      <div className="flex items-center justify-between gap-3 pt-1">
        <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-xs font-medium disabled:opacity-40 hover:bg-secondary">
          <ChevronLeft size={13} /> Précédent
        </button>
        <span className="text-xs text-muted-foreground">
          Page {page + 1} / {Math.max(1, totalPages)} · {total} utilisateur{total > 1 ? "s" : ""}
        </span>
        <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-xs font-medium disabled:opacity-40 hover:bg-secondary">
          Suivant <ChevronRight size={13} />
        </button>
      </div>
      <ActionModal modal={localModal} onClose={() => setLocalModal(null)} />
    </div>
  );
}

function FraudUserPanel({ userId, token, onOpenModal }) {
  const [ud, setUd] = useState(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!userId) return;
    setUd(null); setErr(false);
    adminFetch(`/admin/users/${userId}/detail`, "GET", null, token)
      .then(setUd)
      .catch(() => setErr(true));
  }, [userId, token]);

  if (err) return (
    <div className="mt-3 rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 p-3 flex items-center justify-between gap-3">
      <p className="text-xs text-red-600">Impossible de charger le profil.</p>
      <button onClick={onOpenModal} className="text-xs font-medium text-primary underline shrink-0">Réessayer dans modal</button>
    </div>
  );
  if (!ud) return (
    <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
      <RefreshCw size={12} className="animate-spin" /> Chargement du profil…
    </div>
  );

  const f = (n) => (n || 0).toLocaleString("fr");
  const fd = (d) => d ? new Date(d).toLocaleString("fr") : "—";

  return (
    <div className="mt-4 space-y-4">
      {/* Profile + Wallets */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="rounded-xl border border-border p-4 space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Profil</p>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
              {(ud.fullName || ud.email || ud.phone_e164 || "?")[0]?.toUpperCase() || "?"}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate">{ud.fullName || "Nom inconnu"}</p>
              <p className="text-xs text-muted-foreground truncate">{ud.email || ud.phone_e164 || "—"}</p>
            </div>
          </div>
          {[["Pays", ud.country || "—"], ["KYC", `Niv. ${ud.kycLevel ?? 0}`], ["Inscription", fd(ud.created_at)]].map(([k, v]) => (
            <div key={k} className="flex justify-between text-xs"><span className="text-muted-foreground">{k}</span><span className="font-medium">{v}</span></div>
          ))}
          <div className="flex justify-between text-xs"><span className="text-muted-foreground">Statut</span><span className={`font-medium ${ud.is_blocked ? "text-red-500" : "text-green-500"}`}>{ud.is_blocked ? "BLOQUÉ" : "Actif"}</span></div>
        </div>
        <div className="space-y-2">
          <div className="rounded-xl border border-border p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Soldes</p>
            {ud.wallets?.filter(w => w.balance > 0).length > 0
              ? ud.wallets.filter(w => w.balance > 0).map((w) => (
                  <div key={w.currency} className="flex justify-between text-sm font-medium">
                    <span className="text-muted-foreground">{w.currency}</span>
                    <span className="font-bold tabular-nums">{f(w.balance)}</span>
                  </div>
                ))
              : ud.wallets?.map((w) => (
                  <div key={w.currency} className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{w.currency}</span>
                    <span className="tabular-nums">{f(w.balance)}</span>
                  </div>
                ))
            }
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Dépôts", v: ud.stats?.deposits_completed, sub: `${f(ud.stats?.deposits_total_fcfa)} F`, color: "text-green-500" },
              { label: "Retraits", v: ud.stats?.withdrawals_completed, sub: `${f(ud.stats?.withdrawals_total_fcfa)} F`, color: "text-red-400" },
            ].map(({ label, v, sub, color }) => (
              <div key={label} className="rounded-xl border border-border p-3 text-center">
                <p className={`text-lg font-extrabold ${color}`}>{v ?? "—"}</p>
                <p className="text-[10px] text-muted-foreground">{label}</p>
                <p className="text-[10px]">{sub}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Fiat deposits */}
      {ud.fiat_deposits?.length > 0 && (
        <details className="rounded-xl border border-border">
          <summary className="p-3 text-xs font-semibold cursor-pointer list-none flex justify-between">
            <span>Dépôts fiat ({ud.fiat_deposits.length})</span><ChevronDown size={12} className="text-muted-foreground" />
          </summary>
          <div className="px-3 pb-3 divide-y divide-border/50">
            {ud.fiat_deposits.map((d) => (
              <div key={d.id} className="py-1.5 flex justify-between text-xs">
                <span className="text-muted-foreground">{d.provider?.toUpperCase()} · {d.phone}</span>
                <span className="font-bold text-green-600">+{f(d.amount)} F</span>
                <span className={`text-[10px] font-bold ${d.status === "completed" ? "text-green-600" : d.status === "failed" ? "text-red-500" : "text-yellow-600"}`}>{d.status}</span>
                <span className="text-muted-foreground">{fd(d.created_at)}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Fiat withdrawals */}
      {ud.fiat_withdrawals?.length > 0 && (
        <details className="rounded-xl border border-border">
          <summary className="p-3 text-xs font-semibold cursor-pointer list-none flex justify-between">
            <span>Retraits fiat ({ud.fiat_withdrawals.length})</span><ChevronDown size={12} className="text-muted-foreground" />
          </summary>
          <div className="px-3 pb-3 divide-y divide-border/50">
            {ud.fiat_withdrawals.map((w) => (
              <div key={w.id} className="py-1.5 flex justify-between text-xs">
                <span className="text-muted-foreground">{w.provider?.toUpperCase()} · {w.recipient_phone}</span>
                <span className="font-bold text-red-500">-{f(w.total_debit ?? w.amount)} F</span>
                <span className={`text-[10px] font-bold ${w.status === "completed" ? "text-green-600" : w.status === "failed" ? "text-red-500" : "text-yellow-600"}`}>{w.status}</span>
                <span className="text-muted-foreground">{fd(w.created_at)}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* P2P transfers */}
      {ud.p2p_transfers?.length > 0 && (
        <details className="rounded-xl border border-border">
          <summary className="p-3 text-xs font-semibold cursor-pointer list-none flex justify-between">
            <span>Transferts P2P ({ud.p2p_transfers.length})</span><ChevronDown size={12} className="text-muted-foreground" />
          </summary>
          <div className="px-3 pb-3 divide-y divide-border/50">
            {ud.p2p_transfers.map((t, i) => (
              <div key={t.id || i} className="py-1.5 flex justify-between text-xs">
                <span className={t.sender_user_id === userId ? "text-red-500" : "text-green-600"}>{t.sender_user_id === userId ? "↑ Envoyé" : "↓ Reçu"}</span>
                <span className="font-bold">{f(t.amount)} {t.currency}</span>
                <span className={`text-[10px] ${t.status === "completed" ? "text-green-600" : "text-muted-foreground"}`}>{t.status}</span>
                <span className="text-muted-foreground">{fd(t.created_at)}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      <button onClick={onOpenModal} className="w-full text-xs text-primary underline text-left">
        Ouvrir profil complet →
      </button>
    </div>
  );
}

const FRAUD_PAGE_SIZE = 20;

function FraudTab({ token, onViewUser }) {
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState(null);
  const [filterAction, setFilterAction] = useState("");
  const [filterReviewed, setFilterReviewed] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [noteModal, setNoteModal] = useState(null);
  const [note, setNote] = useState("");
  const [localModal, setLocalModal] = useState(null);
  const [page, setPage] = useState(0);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupDays, setCleanupDays] = useState(30);
  const [cleanupBusy, setCleanupBusy] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / FRAUD_PAGE_SIZE));

  async function loadResults(p = page) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: FRAUD_PAGE_SIZE, offset: p * FRAUD_PAGE_SIZE });
      if (filterAction) params.set("action", filterAction);
      if (filterReviewed !== "") params.set("reviewed", filterReviewed);
      const data = await adminFetch(`/admin/fraud-scan/results?${params}`, "GET", null, token);
      setResults(data.items || []);
      setTotal(data.total || 0);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadResults(page); }, [page, filterAction, filterReviewed]);

  async function runScan() {
    setRunning(true);
    try {
      const r = await adminFetch("/admin/fraud-scan/run", "POST", {}, token);
      setLastRun(r);
      toast.success(`Scan terminé — ${r.scanned} comptes analysés, ${r.blocked} bloqués, ${r.reviewed} sous surveillance`);
      loadResults(page);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setRunning(false);
    }
  }

  async function markReviewed(id, reviewNote) {
    try {
      await adminFetch(`/admin/fraud-scan/results/${id}/review`, "POST", { note: reviewNote }, token);
      toast.success("Marqué comme traité");
      loadResults(page);
    } catch (e) {
      toast.error(e.message);
    }
  }

  async function unblockUser(userId) {
    try {
      await adminFetch(`/admin/users/${userId}/unblock`, "POST", {}, token);
      toast.success("Compte débloqué");
      loadResults(page);
    } catch (e) {
      toast.error(e.message);
    }
  }

  async function doCleanup(all = false) {
    setCleanupBusy(true);
    try {
      const endpoint = all ? "/admin/fraud/cleanup/all" : `/admin/fraud/cleanup?days=${cleanupDays}`;
      const r = await adminFetch(endpoint, "DELETE", null, token);
      toast.success(`Nettoyage terminé — ${r.deleted_results} résultat${r.deleted_results > 1 ? "s" : ""} supprimé${r.deleted_results > 1 ? "s" : ""}`);
      setCleanupOpen(false);
      setPage(0);
      loadResults(0);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setCleanupBusy(false);
    }
  }

  const pendingReview = results.filter((r) => !r.reviewed && (r.action === "auto_block" || r.action === "review")).length;

  return (
    <div className="max-w-4xl space-y-6 mb-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-semibold text-base mb-1">Détection de fraude automatique</h2>
          <p className="text-sm text-muted-foreground">Cron actif toutes les 30 minutes · 8 signaux comportementaux · auto-blocage à 80/100</p>
        </div>
        <div className="flex gap-2 flex-wrap shrink-0">
          <Button variant="outline" onClick={() => setCleanupOpen(true)} className="text-red-600 border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/30">
            <Trash2 size={14} className="mr-2" />
            Nettoyer les résultats
          </Button>
          <Button onClick={runScan} disabled={running}>
            {running ? <RefreshCw size={14} className="animate-spin mr-2" /> : <AlertCircle size={14} className="mr-2" />}
            {running ? "Scan en cours…" : "Lancer un scan"}
          </Button>
        </div>
      </div>

      {/* Cleanup modal */}
      {cleanupOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-background rounded-2xl border border-border shadow-2xl p-6 w-full max-w-sm space-y-4">
            <h3 className="font-semibold">Nettoyer les résultats de fraude</h3>
            <p className="text-sm text-muted-foreground">Choisissez quoi supprimer :</p>
            <div className="space-y-3">
              <div className="rounded-xl border border-border p-4 space-y-3">
                <p className="text-sm font-medium">Résultats traités antérieurs à</p>
                <div className="flex items-center gap-2">
                  <select value={cleanupDays} onChange={(e) => setCleanupDays(Number(e.target.value))}
                    className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm focus:outline-none flex-1">
                    <option value={7}>7 jours</option>
                    <option value={30}>30 jours</option>
                    <option value={90}>90 jours</option>
                    <option value={180}>180 jours</option>
                  </select>
                  <Button size="sm" variant="outline" disabled={cleanupBusy} onClick={() => doCleanup(false)}
                    className="text-orange-600 border-orange-200 hover:bg-orange-50 dark:border-orange-800 shrink-0">
                    {cleanupBusy ? <RefreshCw size={13} className="animate-spin mr-1" /> : <Trash2 size={13} className="mr-1" />}
                    Nettoyer
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Supprime uniquement les résultats marqués "traités" et les événements associés.</p>
              </div>
              <div className="rounded-xl border border-red-200 dark:border-red-800/50 p-4 space-y-2">
                <p className="text-sm font-medium text-red-600 dark:text-red-400">Tout supprimer</p>
                <p className="text-xs text-muted-foreground">Supprime TOUS les résultats et événements de fraude sans condition. Action irréversible.</p>
                <Button size="sm" variant="outline" disabled={cleanupBusy} onClick={() => doCleanup(true)}
                  className="w-full text-red-600 border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/30">
                  {cleanupBusy ? <RefreshCw size={13} className="animate-spin mr-1.5" /> : <Trash2 size={13} className="mr-1.5" />}
                  Effacer tous les résultats
                </Button>
              </div>
            </div>
            <Button variant="outline" className="w-full" onClick={() => setCleanupOpen(false)}>Annuler</Button>
          </div>
        </div>
      )}


      {/* Last run stats */}
      {lastRun && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Analysés", value: lastRun.scanned, color: "text-foreground" },
            { label: "Signalés", value: lastRun.flagged, color: "text-yellow-500" },
            { label: "Surveillance", value: lastRun.reviewed, color: "text-orange-500" },
            { label: "Bloqués", value: lastRun.blocked, color: "text-red-500" },
          ].map((s) => (
            <div key={s.label} className="bg-background border border-border rounded-xl p-4 text-center">
              <p className={`text-2xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Signals legend */}
      <details className="rounded-xl border border-border bg-background">
        <summary className="p-4 font-medium text-sm cursor-pointer flex items-center justify-between list-none">
          <span>Signaux utilisés (8 règles)</span>
          <ChevronDown size={14} className="text-muted-foreground" />
        </summary>
        <div className="px-4 pb-4 grid sm:grid-cols-2 gap-2">
          {Object.entries(SIGNAL_LABELS).map(([code, { label, color, bg }]) => (
            <div key={code} className={`flex items-center gap-2 rounded-lg px-3 py-2 ${bg}`}>
              <span className={`text-xs font-bold ${color}`}>●</span>
              <div>
                <p className="text-xs font-semibold">{label}</p>
                <p className="text-[10px] text-muted-foreground font-mono">{code}</p>
              </div>
            </div>
          ))}
        </div>
      </details>

      {/* Pending badge */}
      {pendingReview > 0 && (
        <div className="flex items-center gap-3 rounded-xl bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 p-4">
          <AlertCircle size={18} className="text-orange-500 shrink-0" />
          <p className="text-sm text-orange-800 dark:text-orange-200">
            <strong>{pendingReview} résultat{pendingReview > 1 ? "s" : ""}</strong> en attente de traitement manuel.
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <select value={filterAction} onChange={(e) => { setPage(0); setFilterAction(e.target.value); }}
          className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm focus:outline-none">
          <option value="">Toutes les actions</option>
          <option value="auto_block">Auto-bloqué</option>
          <option value="review">Surveillance</option>
          <option value="flag">Signalé</option>
        </select>
        <select value={filterReviewed} onChange={(e) => { setPage(0); setFilterReviewed(e.target.value); }}
          className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm focus:outline-none">
          <option value="">Tous</option>
          <option value="false">Non traités</option>
          <option value="true">Traités</option>
        </select>
        <button onClick={() => loadResults(page)} className="h-9 w-9 rounded-lg border border-input flex items-center justify-center hover:bg-secondary">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
        <span className="text-sm text-muted-foreground flex items-center">{total} résultats</span>
      </div>

      {/* Results list */}
      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center">
          <RefreshCw size={14} className="animate-spin" /> Chargement…
        </div>
      ) : results.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <AlertCircle size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Aucun résultat de scan — lancez un scan ou attendez le prochain cycle automatique.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {results.map((r) => {
            const style = ACTION_STYLE[r.action] || ACTION_STYLE.flag;
            const isOpen = expanded === r.id;
            return (
              <div key={r.id} className={`rounded-xl border overflow-hidden ${r.reviewed ? "border-border opacity-60" : "border-border"}`}>
                {/* Row header */}
                <button onClick={() => setExpanded(isOpen ? null : r.id)}
                  className="w-full text-left p-4 flex items-center gap-3 hover:bg-secondary/40 transition-base">
                  <span className={`h-2 w-2 rounded-full shrink-0 ${style.dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{r.email || r.phone || r.user_id}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${style.bg} ${style.text}`}>{style.label}</span>
                      {r.reviewed && <span className="text-[10px] text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">Traité</span>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Score {r.risk_score}/100 · {r.signals?.length || 0} signal{r.signals?.length > 1 ? "s" : ""} · {new Date(r.created_at).toLocaleString("fr")}
                    </p>
                  </div>
                  <ChevronDown size={14} className={`text-muted-foreground shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </button>

                {/* Expanded detail */}
                {isOpen && (
                    <div className="border-t border-border bg-background p-4 space-y-4">

                      {/* ── Signals ── */}
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Signaux déclenchés</p>
                        <div className="space-y-2">
                          {(r.signals || []).map((s, i) => {
                            const sl = SIGNAL_LABELS[s.code] || { label: s.code, color: "text-foreground", bg: "bg-secondary" };
                            return (
                              <div key={i} className={`flex items-start gap-3 rounded-lg p-3 ${sl.bg}`}>
                                <span className={`text-xs font-bold mt-0.5 ${sl.color}`}>+{s.score}</span>
                                <div>
                                  <p className={`text-xs font-semibold ${sl.color}`}>{sl.label}</p>
                                  <p className="text-xs text-muted-foreground mt-0.5">{s.detail}</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* ── User profile ── */}
                      <FraudUserPanel userId={r.user_id} token={token} onOpenModal={() => onViewUser(r.user_id)} />

                      {/* ── Reviewer note ── */}
                      {r.reviewer_note && (
                        <div className="text-xs bg-secondary rounded-lg p-3">
                          <strong>Note admin :</strong> {r.reviewer_note}
                        </div>
                      )}

                      {/* ── Actions ── */}
                      {!r.reviewed && (
                        <div className="flex gap-2 flex-wrap pt-1">
                          <Button size="sm" variant="outline" onClick={() => { setNoteModal(r.id); setNote(""); }}>
                            <Check size={13} className="mr-1.5" /> Marquer traité
                          </Button>
                          {r.auto_blocked && (
                            <Button size="sm" variant="outline" className="text-green-600 border-green-200 hover:bg-green-50"
                              onClick={() => unblockUser(r.user_id)}>
                              Débloquer le compte
                            </Button>
                          )}
                          <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50"
                            onClick={() => setLocalModal({
                              title: "Bloquer définitivement ce compte ?",
                              description: "L'utilisateur sera déconnecté et ne pourra plus se connecter.",
                              variant: "danger",
                              confirmLabel: "Bloquer",
                              onConfirm: async () => {
                                await adminFetch(`/admin/users/${r.user_id}/block`, "POST", {}, token);
                                toast.success("Compte bloqué");
                                loadResults(page);
                              },
                            })}>
                            <Ban size={13} className="mr-1.5" /> Bloquer manuellement
                          </Button>
                        </div>
                      )}
                    </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {!loading && total > FRAUD_PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3 pt-1">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-4 py-1.5 rounded-lg border border-border text-xs font-medium disabled:opacity-40 hover:bg-secondary transition-colors">
            ← Précédent
          </button>
          <span className="text-xs text-muted-foreground">
            Page <strong>{page + 1}</strong> / {totalPages} · {total} résultats
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-4 py-1.5 rounded-lg border border-border text-xs font-medium disabled:opacity-40 hover:bg-secondary transition-colors">
            Suivant →
          </button>
        </div>
      )}

      {/* Note modal */}
      {noteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-background rounded-2xl border border-border shadow-2xl p-6 w-full max-w-sm space-y-4">
            <h3 className="font-semibold">Marquer comme traité</h3>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
              placeholder="Note facultative (ex: faux positif, utilisateur contacté…)"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setNoteModal(null)}>Annuler</Button>
              <Button className="flex-1" onClick={() => { markReviewed(noteModal, note); setNoteModal(null); }}>Confirmer</Button>
            </div>
          </div>
        </div>
      )}
      <ActionModal modal={localModal} onClose={() => setLocalModal(null)} />
    </div>
  );
}

// ── Fees Tab ──────────────────────────────────────────────────────────────────

const FEE_CATEGORIES = [
  { key: "p2p_transfer",            group: "Transferts",    label: "Transfert P2P Kobo→Kobo",           desc: "% du montant envoyé entre utilisateurs" },
  { key: "mobile_money_bridge",     group: "Transferts",    label: "Transfert direct MTN/Orange",       desc: "% payé par l'expéditeur Mobile Money hors wallet Kobo" },
  { key: "intl_transfer_spread",    group: "Transferts",    label: "Spread transfert international",    desc: "% appliqué sur la conversion EUR/USD/GBP→FCFA" },
  { key: "mobile_money_withdrawal", group: "Retraits",      label: "Retrait Mobile Money (MTN/Orange)", desc: "% du montant retiré" },
  { key: "bank_withdrawal_fcfa",    group: "Retraits",      label: "Retrait virement FCFA",             desc: "% du montant" },
  { key: "bank_withdrawal_eur",     group: "Retraits",      label: "Retrait virement EUR",              desc: "Montant fixe en EUR" },
  { key: "bank_withdrawal_usd",     group: "Retraits",      label: "Retrait virement USD",              desc: "Montant fixe en USD" },
  { key: "crypto_withdrawal_usdt",  group: "Retraits",      label: "Retrait USDT",                      desc: "Montant fixe en USDT (frais réseau + marge)" },
  { key: "crypto_withdrawal_btc",   group: "Retraits",      label: "Retrait BTC",                       desc: "Montant fixe en BTC (frais réseau + marge)" },
  { key: "mobile_money_deposit",    group: "Dépôts",        label: "Dépôt Mobile Money",                desc: "% du montant déposé (0 = gratuit)" },
  { key: "fiat_deposit",            group: "Dépôts",        label: "Dépôt virement bancaire",           desc: "% du montant déposé (0 = gratuit)" },
  { key: "crypto_deposit_usdt",     group: "Dépôts",        label: "Dépôt USDT",                        desc: "% du montant (0 = gratuit)" },
  { key: "crypto_deposit_btc",      group: "Dépôts",        label: "Dépôt BTC",                         desc: "% du montant (0 = gratuit)" },
  { key: "payment_link",            group: "Liens de paiement", label: "Frais Kobo sur liens de paiement", desc: "% prélevé sur le montant net reçu par le créateur (gross-up automatique)" },
];

function FeesTab({ token }) {
  const [fees, setFees] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [activeGroup, setActiveGroup] = useState(null);

  useEffect(() => {
    adminFetch("/admin/settings/fees", "GET", null, token)
      .then((data) => { setFees(data); setLoading(false); })
      .catch(() => { toast.error("Impossible de charger les frais"); setLoading(false); });
  }, [token]);

  function updateFee(key, field, value) {
    setFees((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
    setDirty(true);
  }

  function normalizeFeesPayload(raw) {
    return Object.fromEntries(Object.entries(raw || {}).map(([key, fee]) => {
      const txMin = fee.min_amount_fcfa ?? fee.min_transaction_fcfa ?? 0;
      return [key, { ...fee, min_amount_fcfa: Number(txMin) || 0 }];
    }));
  }

  async function save() {
    setSaving(true);
    try {
      const payload = normalizeFeesPayload(fees);
      await adminFetch("/admin/settings/fees", "PUT", payload, token);
      setFees(payload);
      toast.success("Frais enregistrés");
      setDirty(false);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground text-sm"><RefreshCw size={14} className="animate-spin" /> Chargement…</div>;
  if (!fees) return null;

  const groups = [...new Set(FEE_CATEGORIES.map((c) => c.group))];
  const currentGroup = activeGroup ?? groups[0];

  return (
    <div className="max-w-4xl mb-8">
      {/* Tab nav */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border mb-6 -mx-4 px-4 py-2">
        <div className="flex items-center gap-1 flex-wrap">
          {groups.map((g) => (
            <button key={g} onClick={() => setActiveGroup(g)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${currentGroup === g ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}>
              {g}
            </button>
          ))}
          <div className="flex-1" />
          {dirty && (
            <Button onClick={save} disabled={saving} size="sm">
              {saving ? <RefreshCw size={13} className="animate-spin mr-1.5" /> : null}
              Enregistrer
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-8">
      {groups.map((group) => currentGroup === group && (
        <div key={group}>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">{group}</h3>
          <div className="bg-background border border-border rounded-xl overflow-hidden divide-y divide-border">
            {FEE_CATEGORIES.filter((c) => c.group === group).map(({ key, label, desc }) => {
              const fee = fees[key] || {};
              const isPercent = fee.type === "percent";
              const txMin = fee.min_amount_fcfa ?? fee.min_transaction_fcfa ?? 0;
              return (
                <div key={key} className="p-4">
                  <div className="flex items-start justify-between gap-5 flex-wrap xl:flex-nowrap">
                    <div className="min-w-[220px] flex-1">
                      <p className="text-sm font-medium truncate">{label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                    </div>
                    <div className="grid grid-cols-[auto_minmax(112px,1fr)_auto_minmax(128px,1fr)] xl:flex xl:items-center gap-2 shrink-0 w-full xl:w-auto">
                      {isPercent ? (
                        <>
                          <div className="relative col-span-2 xl:col-span-1">
                            <Input
                              type="number"
                              step="0.1"
                              min="0"
                              max="20"
                              value={fee.rate ?? 0}
                              onChange={(e) => updateFee(key, "rate", parseFloat(e.target.value) || 0)}
                              className="w-full xl:w-24 text-right pr-7 font-mono text-sm"
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                          </div>
                          <div className="text-xs text-muted-foreground self-center text-right xl:text-left">frais min</div>
                          <div className="relative">
                            <Input
                              type="number"
                              step="10"
                              min="0"
                              value={fee.min_fcfa ?? 0}
                              onChange={(e) => updateFee(key, "min_fcfa", parseInt(e.target.value) || 0)}
                              className="w-full xl:w-32 text-right pr-12 font-mono text-sm"
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">FCFA</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="relative col-span-2 xl:col-span-1">
                            <Input
                              type="number"
                              step="0.0001"
                              min="0"
                              value={fee.amount ?? 0}
                              onChange={(e) => updateFee(key, "amount", parseFloat(e.target.value) || 0)}
                              className="w-full xl:w-32 text-right pr-12 font-mono text-sm"
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">{fee.currency || ""}</span>
                          </div>
                        </>
                      )}
                      <div className="text-xs text-muted-foreground self-center text-right xl:text-left">montant min</div>
                      <div className="relative">
                        <Input
                          type="number"
                          step="10"
                          min="0"
                          value={txMin}
                          onChange={(e) => updateFee(key, "min_amount_fcfa", parseInt(e.target.value) || 0)}
                          className="w-full xl:w-36 text-right pr-12 font-mono text-sm"
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">FCFA</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${isPercent ? "bg-blue-500/10 text-blue-600 dark:text-blue-400" : "bg-purple-500/10 text-purple-600 dark:text-purple-400"}`}>
                        {isPercent ? "Pourcentage" : "Montant fixe"}
                      </span>
                    </span>
                    {isPercent && fee.rate === 0 && <span className="text-green-600 dark:text-green-400 font-medium">Gratuit</span>}
                    {isPercent && fee.rate > 0 && <span>Ex : 10 000 FCFA → frais {(10000 * fee.rate / 100).toLocaleString("fr")} FCFA{fee.min_fcfa > 0 ? ` (frais min ${fee.min_fcfa.toLocaleString("fr")} FCFA)` : ""}</span>}
                    {txMin > 0 && <span>Transaction min : {Number(txMin).toLocaleString("fr")} FCFA</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {dirty && (
        <Button onClick={save} disabled={saving} className="w-full">
          {saving ? <RefreshCw size={14} className="animate-spin mr-2" /> : <TrendingUp size={14} className="mr-2" />}
          Enregistrer la grille de frais
        </Button>
      )}
      </div>
    </div>
  );
}

// ── Exports Tab ───────────────────────────────────────────────────────────────

const EXPORT_SOURCES = [
  {
    group: "Finances",
    icon: DollarSign,
    color: "text-green-500",
    bg: "bg-green-500/10",
    items: [
      { id: "fiat-deposits",      label: "Dépôts fiat",               endpoint: "/admin/fiat-deposits?limit=5000" },
      { id: "fiat-withdrawals",   label: "Sorties Mobile Money / fiat", endpoint: "/admin/fiat-withdrawals?limit=5000" },
      { id: "virements",          label: "Virements P2P",             endpoint: "/admin/withdrawals?limit=5000" },
      { id: "intl-transfers",     label: "Transferts internationaux", endpoint: "/admin/intl-transfers?limit=5000" },
      { id: "crypto-deposits",    label: "Dépôts crypto",             endpoint: "/admin/crypto/deposits" },
      { id: "crypto-withdrawals", label: "Retraits crypto",           endpoint: "/admin/crypto/withdrawals" },
    ],
  },
  {
    group: "Utilisateurs",
    icon: Users,
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    items: [
      { id: "users",          label: "Comptes utilisateurs", endpoint: "/admin/users?limit=5000" },
      { id: "kyc",            label: "Dossiers KYC",         endpoint: "/admin/kyc?limit=5000" },
      { id: "payment-links",  label: "Liens de paiement",   endpoint: "/admin/payment-links" },
    ],
  },
  {
    group: "Activité & Audit",
    icon: History,
    color: "text-purple-500",
    bg: "bg-purple-500/10",
    items: [
      { id: "audit-logs",  label: "Journal d'audit",          endpoint: "/admin/audit-logs?limit=5000" },
      { id: "fraud-scans", label: "Résultats de scan fraude", endpoint: "/admin/fraud-scan/results?limit=5000" },
    ],
  },
];

function ExportsTab({ token }) {
  const [busy, setBusy] = useState({});
  const [counts, setCounts] = useState({});

  async function fetchRows(endpoint) {
    const data = await adminFetch(endpoint, "GET", null, token);
    return Array.isArray(data) ? data : (data.items || data.withdrawals || data.links || []);
  }

  async function doExport(source, format) {
    setBusy((b) => ({ ...b, [source.id]: format }));
    try {
      const rows = await fetchRows(source.endpoint);
      setCounts((c) => ({ ...c, [source.id]: rows.length }));
      if (!rows.length) { toast.error("Aucune donnée à exporter"); return; }
      const cols = Object.keys(rows[0]).map((k) => ({ key: k, label: k }));
      const filename = `kobo_${source.id}_${new Date().toISOString().slice(0, 10)}`;
      if (format === "csv") exportCsv(cols, rows, `${filename}.csv`);
      else if (format === "excel") exportExcel(cols, rows, `${filename}.csv`);
      else exportJson(rows, `${filename}.csv`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy((b) => ({ ...b, [source.id]: null }));
    }
  }

  async function exportAll(format) {
    setBusy((b) => ({ ...b, __all: format }));
    try {
      const allSources = EXPORT_SOURCES.flatMap((g) => g.items);
      const stamp = new Date().toISOString().slice(0, 10);

      if (format === "json") {
        const bundle = {};
        for (const src of allSources) {
          try { bundle[src.id] = await fetchRows(src.endpoint); } catch { bundle[src.id] = []; }
        }
        exportJson(bundle, `kobo_backup_${stamp}.csv`);
      } else {
        for (const src of allSources) {
          try {
            const rows = await fetchRows(src.endpoint);
            if (!rows.length) continue;
            const cols = Object.keys(rows[0]).map((k) => ({ key: k, label: k }));
            if (format === "csv") exportCsv(cols, rows, `kobo_${src.id}_${stamp}.csv`);
            else exportExcel(cols, rows, `kobo_${src.id}_${stamp}.csv`);
            await new Promise((r) => setTimeout(r, 200));
          } catch { /* table vide ou inaccessible */ }
        }
      }
      toast.success("Sauvegarde complète exportée");
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy((b) => ({ ...b, __all: null }));
    }
  }

  function ExportButtons({ source }) {
    const isLoading = busy[source.id];
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        {[
          { fmt: "csv",   label: "CSV"   },
          { fmt: "excel", label: "Excel" },
          { fmt: "json",  label: "JSON"  },
        ].map(({ fmt, label }) => (
          <button key={fmt} disabled={!!isLoading}
            onClick={() => doExport(source, fmt)}
            className="px-2.5 py-1 rounded-lg border border-border text-xs font-medium hover:bg-secondary transition-colors disabled:opacity-40 flex items-center gap-1">
            {isLoading === fmt ? <RefreshCw size={11} className="animate-spin" /> : <Download size={11} />}
            {label}
          </button>
        ))}
        {counts[source.id] != null && (
          <span className="text-xs text-muted-foreground ml-0.5">{counts[source.id].toLocaleString("fr")} entrées</span>
        )}
      </div>
    );
  }

  const allBusy = !!busy.__all;

  return (
    <div className="max-w-3xl space-y-8 mb-10">
      {/* Header */}
      <div>
        <h2 className="font-semibold text-base mb-1">Exports & Sauvegardes</h2>
        <p className="text-sm text-muted-foreground">Exportez toutes les données de la plateforme au format CSV, Excel ou JSON.</p>
      </div>

      {/* Sauvegarde complète */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Database size={18} className="text-primary" />
          </div>
          <div>
            <p className="font-semibold text-sm">Sauvegarde complète</p>
            <p className="text-xs text-muted-foreground">Toutes les tables combinées — idéal pour archivage ou migration.</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {[
            { fmt: "json",  label: "Tout en JSON (1 fichier)" },
            { fmt: "csv",   label: "CSV par table" },
            { fmt: "excel", label: "Excel par table" },
          ].map(({ fmt, label }) => (
            <Button key={fmt} variant="outline" size="sm" disabled={allBusy} onClick={() => exportAll(fmt)}>
              {busy.__all === fmt ? <RefreshCw size={13} className="animate-spin mr-1.5" /> : <PackageOpen size={13} className="mr-1.5" />}
              {label}
            </Button>
          ))}
        </div>
        {allBusy && <p className="text-xs text-muted-foreground">Export en cours… ne fermez pas cette page.</p>}
      </div>

      {/* Par catégorie */}
      {EXPORT_SOURCES.map(({ group, icon: Icon, color, bg, items }) => (
        <div key={group}>
          <div className="flex items-center gap-2 mb-3">
            <div className={`h-7 w-7 rounded-lg ${bg} flex items-center justify-center`}>
              <Icon size={14} className={color} />
            </div>
            <h3 className="font-semibold text-sm">{group}</h3>
          </div>
          <div className="bg-background border border-border rounded-xl overflow-hidden divide-y divide-border">
            {items.map((src) => (
              <div key={src.id} className="px-4 py-3.5 flex items-center justify-between gap-4 flex-wrap">
                <p className="text-sm font-medium">{src.label}</p>
                <ExportButtons source={src} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Audit Log Tab ─────────────────────────────────────────────────────────────

const ACTION_LABELS = {
  admin_login:               { label: "Connexion admin",          color: "text-blue-400",   bg: "bg-blue-500/10" },
  kyc_approved:              { label: "KYC approuvé",             color: "text-green-400",  bg: "bg-green-500/10" },
  kyc_rejected:              { label: "KYC refusé",               color: "text-red-400",    bg: "bg-red-500/10" },
  confirm_fiat_withdrawal:       { label: "Retrait confirmé",            color: "text-green-400",  bg: "bg-green-500/10" },
  approve_fiat_withdrawal:       { label: "Retrait approuvé",            color: "text-green-400",  bg: "bg-green-500/10" },
  reject_fiat_withdrawal:        { label: "Retrait rejeté",              color: "text-red-400",    bg: "bg-red-500/10" },
  force_withdrawal_status:       { label: "Statut forcé",                color: "text-orange-400", bg: "bg-orange-500/10" },
  force_crypto_deposit_status:   { label: "Dépôt crypto forcé",          color: "text-orange-400", bg: "bg-orange-500/10" },
  adjust_user_balance:               { label: "Solde ajusté manuellement",   color: "text-purple-400", bg: "bg-purple-500/10" },
  update_withdrawal_threshold:       { label: "Seuil retrait modifié",        color: "text-blue-400",   bg: "bg-blue-500/10"   },
  block_user:                    { label: "Utilisateur bloqué",          color: "text-red-400",    bg: "bg-red-500/10" },
  unblock_user:                  { label: "Utilisateur débloqué",        color: "text-green-400",  bg: "bg-green-500/10" },
};

function AuditLogTab({ token }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);

  const fmtDate = (iso) => iso ? new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

  async function fetchLogs() {
    setLoading(true);
    try {
      const data = await adminFetch(`/admin/audit-logs?limit=500&offset=0`, "GET", null, token);
      setLogs(data.items || []);
    } catch (e) {
      toast.error("Erreur chargement journal");
    }
    setLoading(false);
  }

  useEffect(() => { fetchLogs(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Journal des actions admin</h2>
          <p className="text-xs text-muted-foreground">{logs.length} entrée{logs.length > 1 ? "s" : ""} chargée{logs.length > 1 ? "s" : ""}</p>
        </div>
        <button onClick={fetchLogs} className="h-8 w-8 rounded-lg border border-input flex items-center justify-center hover:bg-secondary" disabled={loading}>
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
      <DataTable
        data={logs}
        searchFields={["actor_identifier", "action", "resource"]}
        emptyText="Aucune entrée dans le journal"
        exportFilename="kobo-journal-admin.csv"
        columns={[
          { key: "created_at",      label: "Date",         sortable: true, render: (v) => <span className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(v)}</span> },
          { key: "actor_identifier",label: "Identifiant",  sortable: true, render: (v) => <span className="font-mono text-xs bg-secondary px-2 py-0.5 rounded">{v || "—"}</span> },
          { key: "action",          label: "Action",       sortable: true, render: (v) => {
            const m = ACTION_LABELS[v] || { label: v, color: "text-muted-foreground", bg: "bg-secondary" };
            return <span className={`text-xs font-medium px-2 py-0.5 rounded ${m.bg} ${m.color}`}>{m.label}</span>;
          }},
          { key: "resource",        label: "Ressource",    sortable: true, render: (v) => <span className="font-mono text-xs text-muted-foreground">{v}</span> },
          { key: "metadata",        label: "Détails",      noExport: true, render: (v) =>
            v && Object.keys(v).length > 0 ? (
              <details className="cursor-pointer">
                <summary className="text-xs text-primary hover:underline">Voir détails</summary>
                <pre className="mt-1 text-[10px] bg-secondary rounded p-2 overflow-x-auto max-w-[220px]">{JSON.stringify(v, null, 2)}</pre>
              </details>
            ) : <span className="text-muted-foreground">—</span>
          },
        ]}
      />
    </div>
  );
}

function AdminSessionsTab({ token }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [includeRevoked, setIncludeRevoked] = useState(true);

  const loadSessions = useCallback(() => {
    setLoading(true);
    adminFetch(`/admin/admin-sessions?limit=500&include_revoked=${includeRevoked ? "true" : "false"}`, "GET", null, token)
      .then((d) => setSessions(d.items || []))
      .catch((e) => toast.error(e.message || "Erreur chargement sessions"))
      .finally(() => setLoading(false));
  }, [token, includeRevoked]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const revokeSession = async (s) => {
    const currentMsg = s.current ? " C'est votre session actuelle : vous serez déconnecté." : "";
    if (!window.confirm(`Révoquer la session de ${s.email} ?${currentMsg}`)) return;
    try {
      await adminFetch("/admin/admin-sessions/revoke", "POST", {
        email: s.email,
        token_prefix: s.token_prefix,
        created_at: s.created_at,
      }, token);
      toast.success("Session révoquée");
      loadSessions();
      if (s.current) {
        localStorage.removeItem(ADMIN_TOKEN_KEY);
        localStorage.removeItem(ADMIN_ROLE_KEY);
        localStorage.removeItem(ADMIN_EMAIL_KEY);
        window.location.reload();
      }
    } catch (e) {
      toast.error(e.message || "Révocation impossible");
    }
  };

  const activeCount = sessions.filter((s) => s.status === "active").length;
  const revokedCount = sessions.filter((s) => s.status === "revoked").length;
  const expiredCount = sessions.filter((s) => s.status === "expired").length;
  const statusBadge = (s) => {
    if (s.status === "active") return <span className="px-2 py-1 rounded-md bg-green-500/10 text-green-600 text-xs font-semibold">Actif</span>;
    if (s.status === "revoked") return <span className="px-2 py-1 rounded-md bg-red-500/10 text-red-500 text-xs font-semibold">Révoqué</span>;
    return <span className="px-2 py-1 rounded-md bg-secondary text-muted-foreground text-xs font-semibold">Expiré</span>;
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold">Sessions admin</h2>
          <p className="text-xs text-muted-foreground">Historique des connexions Kobo Ops et révocation immédiate des accès actifs.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="h-8 px-3 rounded-lg border border-border bg-background flex items-center gap-2 text-xs">
            <input type="checkbox" checked={includeRevoked} onChange={(e) => setIncludeRevoked(e.target.checked)} />
            Inclure révoquées
          </label>
          <button onClick={loadSessions} className="h-8 w-8 rounded-lg border border-input flex items-center justify-center hover:bg-secondary" disabled={loading}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ["Total", sessions.length, "text-foreground"],
          ["Actives", activeCount, "text-green-600"],
          ["Révoquées", revokedCount, "text-red-500"],
          ["Expirées", expiredCount, "text-muted-foreground"],
        ].map(([label, value, color]) => (
          <div key={label} className="rounded-xl border border-border bg-background p-4">
            <p className={`text-2xl font-extrabold ${color}`}>{fmt(value)}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>

      <DataTable
        data={sessions}
        searchFields={["email", "role", "status", "token_prefix"]}
        emptyText="Aucune session admin"
        exportFilename="kobo-sessions-admin.csv"
        columns={[
          { key: "status", label: "Statut", sortable: true, render: (_, row) => <div className="flex items-center gap-2">{statusBadge(row)}{row.current && <span className="px-2 py-1 rounded-md bg-blue-500/10 text-blue-600 text-xs font-semibold">Vous</span>}</div> },
          { key: "email", label: "Admin", sortable: true, render: (v, row) => <div><p className="font-semibold">{v}</p><p className="text-xs text-muted-foreground">{row.role}</p></div> },
          { key: "token_prefix", label: "Session", sortable: true, render: (v) => <span className="font-mono text-xs bg-secondary px-2 py-1 rounded">{v}...</span> },
          { key: "created_at", label: "Connexion", sortable: true, render: (v) => <span className="text-xs text-muted-foreground">{fmtDate(v)}</span> },
          { key: "expires_at", label: "Expire", sortable: true, render: (v) => <span className="text-xs text-muted-foreground">{fmtDate(v)}</span> },
        ]}
        actions={(s) => (
          s.status === "active" ? (
            <button onClick={() => revokeSession(s)} className="h-7 px-2 rounded-md text-xs font-medium flex items-center gap-1 text-red-500 hover:bg-red-500/10">
              <Ban size={12} /> Révoquer
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )
        )}
      />
    </div>
  );
}

// ── Marketing Tab ─────────────────────────────────────────────────────────────

const TEMPLATES = [
  {
    id: "promo",
    label: "Promotion",
    subject: "Offre spéciale Kobo — jusqu'à -50% de frais",
    body: "Bonne nouvelle ! Pendant <b>7 jours</b>, profitez de frais réduits sur tous vos retraits Kobo.\n\nConnectez-vous maintenant et effectuez vos transactions à tarif préférentiel.",
  },
  {
    id: "annonce",
    label: "Annonce produit",
    subject: "Nouvelle fonctionnalité disponible sur Kobo",
    body: "Nous avons le plaisir de vous annoncer une nouvelle fonctionnalité sur Kobo.\n\n<b>Découvrez dès maintenant</b> ce qui a changé dans votre application.",
  },
  {
    id: "maintenance",
    label: "Maintenance",
    subject: "Maintenance programmée — Kobo",
    body: "Une maintenance est prévue le <b>[DATE]</b> de <b>[HEURE_DEBUT]</b> à <b>[HEURE_FIN]</b>.\n\nPendant cette période, certains services pourront être temporairement indisponibles. Nous nous excusons pour la gêne occasionnée.",
  },
  {
    id: "kyc",
    label: "Rappel KYC",
    subject: "Vérifiez votre identité pour débloquer tous vos avantages",
    body: "Votre compte Kobo n'est pas encore vérifié.\n\nEn complétant votre <b>vérification d'identité (KYC)</b>, vous débloquez :\n• Les retraits en FCFA, EUR et USD\n• Les virements bancaires\n• Des limites de transaction plus élevées\n\nCela prend moins de 2 minutes.",
  },
];

function LinkTxModal({ link, token, onClose }) {
  const [txs, setTxs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(null);

  const load = () => {
    setLoading(true);
    adminFetch(`/admin/payment-links/${link.id}/transactions`, "GET", null, token)
      .then((d) => setTxs(d.items || []))
      .catch(() => toast.error("Erreur chargement transactions"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [link.id, token]);

  const handleConfirmCrypto = async (tx) => {
    if (!window.confirm(`Confirmer manuellement cette TX crypto et créditer ${fmt(tx.net_fcfa)} FCFA au créateur ?`)) return;
    setConfirming(tx.id);
    try {
      await adminFetch(`/admin/payment-links/txs/${tx.id}/confirm-crypto`, "POST", {}, token);
      toast.success(`TX confirmée — ${fmt(tx.net_fcfa)} FCFA crédités`);
      load();
    } catch (e) {
      toast.error(e.message || "Erreur");
    } finally {
      setConfirming(null);
    }
  };

  const PROVIDER_LABELS = {
    mtn: "MTN MoMo", orange: "Orange Money",
    kobo_wallet: "Kobo Wallet", crypto_trc20: "USDT TRC20",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <p className="font-semibold text-foreground">{link.description}</p>
            <p className="text-xs text-muted-foreground">{link.id} · {fmt(link.amount)} FCFA · {link.paid_count} paiement{link.paid_count !== 1 ? "s" : ""}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-auto">
          {loading ? (
            <div className="py-12 text-center text-muted-foreground text-sm">Chargement…</div>
          ) : txs.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">Aucune transaction</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-secondary/60">
                <tr>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Payeur / Hash</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Méthode</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Brut</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Net</th>
                  <th className="text-center px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Statut</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {txs.map((t) => {
                  const isCrypto = t.provider === "crypto_trc20";
                  const isPending = t.status === "pending";
                  const txHash = t.aggregator_txid;
                  return (
                    <tr key={t.id} className="hover:bg-secondary/30">
                      <td className="px-4 py-2.5">
                        {isCrypto && txHash ? (
                          <div>
                            <a href={`https://tronscan.org/#/transaction/${txHash}`}
                              target="_blank" rel="noopener noreferrer"
                              className="font-mono text-xs text-blue-600 hover:underline">
                              {txHash.slice(0, 12)}…{txHash.slice(-6)}
                            </a>
                          </div>
                        ) : (
                          <span className="font-mono text-xs">{t.payer_phone_display}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded
                          ${isCrypto ? "bg-orange-100 text-orange-700" :
                            t.provider === "kobo_wallet" ? "bg-blue-100 text-blue-700" :
                            "bg-secondary text-foreground"}`}>
                          {PROVIDER_LABELS[t.provider] || t.provider}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-sm">{fmt(t.amount)}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-sm text-green-600">{fmt(t.net_fcfa)}</td>
                      <td className="px-4 py-2.5 text-center"><StatusBadge status={t.status} /></td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(t.created_at)}</td>
                      <td className="px-4 py-2.5">
                        {isCrypto && isPending && (
                          <button
                            onClick={() => handleConfirmCrypto(t)}
                            disabled={confirming === t.id}
                            className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-50 whitespace-nowrap"
                          >
                            {confirming === t.id ? "…" : "✓ Confirmer"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function DeleteLinkModal({ link, token, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    setLoading(true);
    try {
      await adminFetch(`/admin/payment-links/${link.id}`, "DELETE", { reason }, token);
      toast.success("Lien supprimé — utilisateur notifié");
      onDone();
    } catch (e) {
      toast.error(e.message || "Erreur");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 space-y-4">
          <div className="flex items-start gap-4">
            <div className="w-11 h-11 rounded-2xl bg-destructive/10 flex items-center justify-center shrink-0">
              <Trash2 size={20} className="text-destructive" />
            </div>
            <div>
              <p className="font-semibold text-foreground">Supprimer le lien</p>
              <p className="text-sm text-muted-foreground mt-0.5">« {link.description} » — {fmt(link.amount)} FCFA</p>
              <p className="text-xs text-muted-foreground mt-1">L'utilisateur sera notifié par email et notification.</p>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Motif (optionnel)</label>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex : Fraude suspectée, contenu non conforme…"
              className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
        <div className="flex gap-2 px-6 pb-6">
          <button onClick={onClose} className="flex-1 h-9 rounded-lg border border-border text-sm font-medium hover:bg-secondary transition-colors">
            Annuler
          </button>
          <button
            onClick={handleDelete}
            disabled={loading}
            className="flex-1 h-9 rounded-lg bg-destructive text-white text-sm font-medium hover:bg-destructive/90 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-60"
          >
            <Trash2 size={13} />
            {loading ? "Suppression…" : "Supprimer"}
          </button>
        </div>
      </div>
    </div>
  );
}

const PL_ADMIN_PAGE_SIZE = 15;

function PendingCryptoLinkTxsTab({ items, token, onRefresh }) {
  const [confirming, setConfirming] = useState(null);

  const handleConfirm = async (tx) => {
    if (!window.confirm(`Confirmer la TX crypto et créditer ${fmt(tx.net_fcfa)} FCFA à ${tx.creator_name || tx.creator_phone || "l'utilisateur"} ?`)) return;
    setConfirming(tx.id);
    try {
      await adminFetch(`/admin/payment-links/txs/${tx.id}/confirm-crypto`, "POST", {}, token);
      toast.success(`✓ ${fmt(tx.net_fcfa)} FCFA crédités`);
      onRefresh();
    } catch (e) {
      toast.error(e.message || "Erreur");
    } finally {
      setConfirming(null);
    }
  };

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
        <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
          <CheckCircle size={24} className="text-emerald-500" />
        </div>
        <p className="font-semibold text-foreground">Aucune transaction en attente</p>
        <p className="text-sm text-muted-foreground">Toutes les transactions crypto sur liens ont été confirmées.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-foreground">Transactions crypto en attente</h2>
          <p className="text-sm text-muted-foreground">Transactions USDT TRC20 sur liens de paiement nécessitant validation manuelle</p>
        </div>
        <span className="px-3 py-1 bg-orange-500/10 text-orange-600 text-sm font-semibold rounded-full">
          {items.length} en attente
        </span>
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/40">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Créateur</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Lien</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">TX Hash</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Brut</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Net à créditer</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((tx) => (
                <tr key={tx.id} className="hover:bg-secondary/30 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-foreground truncate max-w-[130px]">{tx.creator_name || "—"}</p>
                    <p className="text-xs text-muted-foreground font-mono">{tx.creator_phone || ""}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="truncate max-w-[160px] text-foreground" title={tx.link_desc}>{tx.link_desc}</p>
                    <p className="text-xs text-muted-foreground font-mono">{tx.link_id}</p>
                  </td>
                  <td className="px-4 py-3">
                    {tx.aggregator_txid ? (
                      <a href={`https://tronscan.org/#/transaction/${tx.aggregator_txid}`}
                        target="_blank" rel="noopener noreferrer"
                        className="font-mono text-xs text-blue-600 hover:underline flex items-center gap-1">
                        {tx.aggregator_txid.slice(0, 10)}…{tx.aggregator_txid.slice(-6)}
                        <ExternalLink size={10} />
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">{fmt(tx.amount)}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-green-600">{fmt(tx.net_fcfa)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(tx.created_at)}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleConfirm(tx)}
                      disabled={confirming === tx.id}
                      className="h-8 px-3 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                    >
                      {confirming === tx.id
                        ? <RefreshCw size={12} className="animate-spin" />
                        : <CheckCircle size={12} />}
                      Confirmer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CryptoOnChainEventsTab({ data, token, onRefresh }) {
  const [running, setRunning] = useState(false);
  const items = data?.items || [];
  const summary = data?.summary || [];
  const runs = data?.runs || [];

  const summaryByStatus = summary.reduce((acc, row) => {
    acc[row.status] = row;
    return acc;
  }, {});
  const counted = (status) => Number(summaryByStatus[status]?.count || 0);
  const amount = (status) => Number(summaryByStatus[status]?.amount_usdt || 0);
  const reviewCount = counted("manual_review") + counted("unmatched") + counted("invalid");
  const creditedCount = counted("credited");
  const detectedCount = items.length;
  const lastRun = runs[0];

  const runScan = async () => {
    setRunning(true);
    try {
      const res = await adminFetch("/admin/crypto/reconcile", "POST", {}, token);
      const result = res.result || {};
      toast.success(`Scan terminé : ${result.crypto_deposits_credited || 0} crédité(s), ${result.crypto_manual_review || 0} en revue`);
      onRefresh();
    } catch (e) {
      toast.error(e.message || "Scan impossible");
    } finally {
      setRunning(false);
    }
  };

  const statusHelp = {
    detected: "Détecté sur TRON, pas encore rapproché",
    matched: "Montant/adresse associés à une opération Kobo",
    hash_verified: "Hash valide, confirmations encore insuffisantes",
    credited: "Crédit wallet effectué et ledger écrit",
    manual_review: "Validation manuelle nécessaire",
    unmatched: "Aucune opération Kobo ouverte ne correspond",
    invalid: "Transaction invalide ou mauvais réseau/adresse/montant",
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Événements on-chain USDT TRC20</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Journal blockchain détecté par TronScan/TronGrid, rapprochement Kobo, confirmations et crédit automatique.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {lastRun && (
            <div className="h-9 px-3 rounded-lg border border-border bg-surface flex items-center gap-2 text-xs">
              <Clock size={14} className="text-muted-foreground" />
              <span className="text-muted-foreground">Dernier scan</span>
              <span className="font-semibold">{fmtDate(lastRun.created_at)}</span>
            </div>
          )}
          <button
            type="button"
            onClick={runScan}
            disabled={running}
            className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-60"
          >
            <RefreshCw size={14} className={running ? "animate-spin" : ""} />
            Scanner maintenant
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: "Événements lus", value: fmt(detectedCount), sub: "fenêtre récente", color: "text-blue-600", bg: "bg-blue-500/10" },
          { label: "Crédités", value: fmt(creditedCount), sub: `${amount("credited").toFixed(2)} USDT`, color: "text-emerald-600", bg: "bg-emerald-500/10" },
          { label: "À revoir", value: fmt(reviewCount), sub: "doublons / sans match / invalides", color: "text-red-600", bg: "bg-red-500/10" },
          { label: "Confirmations", value: "20", sub: "minimum avant crédit auto", color: "text-violet-600", bg: "bg-violet-500/10" },
          { label: "Anti-doublon", value: "Actif", sub: "tx_hash unique + ledger idempotent", color: "text-slate-800 dark:text-slate-100", bg: "bg-secondary" },
        ].map((card) => (
          <div key={card.label} className={`${card.bg} border border-border rounded-xl p-4`}>
            <p className={`text-xs font-semibold ${card.color}`}>{card.label}</p>
            <p className="text-2xl font-extrabold mt-1">{card.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{card.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid xl:grid-cols-[1fr_360px] gap-4">
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-bold">Grand journal blockchain</h2>
            <p className="text-xs text-muted-foreground">
              Chaque hash apparaît une seule fois. Kobo crédite uniquement après match adresse + montant + confirmations.
            </p>
          </div>
          <DataTable
            data={items}
            searchFields={["tx_hash", "from_address", "to_address", "status", "match_type", "matched_id", "reason"]}
            emptyText="Aucun événement on-chain détecté"
            exportFilename="kobo-crypto-onchain-events.csv"
            tableTitle="Événements on-chain"
            expandable
            columns={[
              { key: "created_at", label: "Détecté", sortable: true, render: (v) => <span className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(v)}</span> },
              { key: "tx_hash", label: "Hash", render: (v) => (
                <a href={`https://tronscan.org/#/transaction/${v}`} target="_blank" rel="noopener noreferrer"
                  className="font-mono text-xs text-blue-600 hover:underline inline-flex items-center gap-1 max-w-[180px] truncate">
                  {v?.slice(0, 12)}…{v?.slice(-8)}
                  <ExternalLink size={10} />
                </a>
              ) },
              { key: "amount_usdt", label: "Montant", sortable: true, render: (v) => <span className="font-bold tabular-nums">{Number(v || 0).toFixed(2)} USDT</span> },
              { key: "confirmations", label: "Conf.", sortable: true, render: (v) => (
                <span className={`font-mono text-xs font-bold ${Number(v || 0) >= 20 ? "text-emerald-600" : "text-amber-600"}`}>
                  {fmt(v || 0)}/20
                </span>
              ) },
              { key: "status", label: "Statut", sortable: true, render: (v) => (
                <div className="space-y-1">
                  <StatusBadge status={v} />
                  <p className="text-[11px] text-muted-foreground max-w-[180px] whitespace-normal">{statusHelp[v] || "Statut scanner"}</p>
                </div>
              ) },
              { key: "match_type", label: "Rapprochement", render: (v, row) => (
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold">{v === "payment_link" ? "Lien paiement" : v === "crypto_deposit" ? "Dépôt wallet" : "Non rapproché"}</p>
                  {row.matched_id && <p className="font-mono text-xs text-muted-foreground">{row.matched_id}</p>}
                </div>
              ) },
              { key: "to_address", label: "Adresse Kobo", render: (v) => <span className="font-mono text-xs text-muted-foreground max-w-[180px] truncate block">{v}</span> },
              { key: "reason", label: "Décision", render: (v) => <span className="text-sm text-muted-foreground whitespace-normal max-w-[260px] block">{v || "—"}</span> },
            ]}
          />
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-surface p-4">
            <h2 className="text-sm font-bold">Derniers scans</h2>
            <p className="text-xs text-muted-foreground mt-1">Contrôle opérationnel des passages TronScan/TronGrid.</p>
            <div className="mt-3 divide-y divide-border">
              {runs.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">Aucun scan enregistré</p>
              ) : runs.slice(0, 8).map((run) => (
                <div key={run.id} className="py-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <StatusBadge status={run.status} />
                    <span className="text-xs text-muted-foreground">{fmtDate(run.created_at)}</span>
                  </div>
                  <p className="font-mono text-xs text-muted-foreground truncate">{run.wallet_address}</p>
                  <div className="grid grid-cols-4 gap-2 text-center text-xs">
                    <div><p className="font-bold">{fmt(run.checked)}</p><p className="text-muted-foreground">lus</p></div>
                    <div><p className="font-bold">{fmt(run.matched)}</p><p className="text-muted-foreground">match</p></div>
                    <div><p className="font-bold text-emerald-600">{fmt(run.credited)}</p><p className="text-muted-foreground">crédit</p></div>
                    <div><p className="font-bold text-red-600">{fmt(run.failed)}</p><p className="text-muted-foreground">fail</p></div>
                  </div>
                  {run.message && <p className="text-xs text-red-600 whitespace-normal">{run.message}</p>}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface p-4">
            <h2 className="text-sm font-bold">Règles appliquées</h2>
            <div className="mt-3 space-y-3 text-sm">
              {[
                "Réseau accepté : USDT TRC20 uniquement.",
                "Crédit automatique seulement après au moins 20 confirmations.",
                "Le hash doit être unique dans Kobo.",
                "Le montant reçu doit couvrir le montant attendu avec tolérance de 2%.",
                "Si plusieurs opérations correspondent, l'événement part en revue manuelle.",
              ].map((rule) => (
                <div key={rule} className="flex gap-2">
                  <CheckCircle size={15} className="text-emerald-600 shrink-0 mt-0.5" />
                  <span>{rule}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PaymentLinksAdminTab({ token }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [txModal, setTxModal] = useState(null);
  const [deleteModal, setDeleteModal] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);
  const [plPage, setPlPage] = useState(1);

  const load = () => {
    setLoading(true);
    adminFetch("/admin/payment-links", "GET", null, token)
      .then((d) => setItems(d.items || []))
      .catch(() => toast.error("Erreur chargement liens"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [token]);

  const handleTogglePause = async (link) => {
    setActionLoading(link.id);
    try {
      const res = await adminFetch(`/admin/payment-links/${link.id}/pause`, "PATCH", {}, token);
      toast.success(res.status === "paused" ? "Lien suspendu — utilisateur notifié" : "Lien réactivé — utilisateur notifié");
      setItems((prev) => prev.map((r) => r.id === link.id ? { ...r, status: res.status } : r));
    } catch (e) {
      toast.error(e.message || "Erreur");
    } finally {
      setActionLoading(null);
    }
  };

  const filtered = items.filter((r) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      r.description?.toLowerCase().includes(q) ||
      r.creator_name?.toLowerCase().includes(q) ||
      r.user_email?.toLowerCase().includes(q) ||
      r.user_phone?.includes(q) ||
      r.id?.includes(q);
    const matchStatus = statusFilter === "all" || r.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const totalCollected = filtered.reduce((s, r) => s + r.total_collected, 0);
  const totalPaid = filtered.reduce((s, r) => s + r.paid_count, 0);
  const plTotalPages = Math.max(1, Math.ceil(filtered.length / PL_ADMIN_PAGE_SIZE));
  const plSafePage = Math.min(plPage, plTotalPages);
  const pageItems = filtered.slice((plSafePage - 1) * PL_ADMIN_PAGE_SIZE, plSafePage * PL_ADMIN_PAGE_SIZE);

  return (
    <>
      {txModal && <LinkTxModal link={txModal} token={token} onClose={() => setTxModal(null)} />}
      {deleteModal && (
        <DeleteLinkModal
          link={deleteModal}
          token={token}
          onClose={() => setDeleteModal(null)}
          onDone={() => { setDeleteModal(null); load(); }}
        />
      )}

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Rechercher (description, créateur, email…)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9 text-sm"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 rounded-md border border-border bg-background text-sm px-2"
          >
            <option value="all">Tous les statuts</option>
            <option value="active">Actif</option>
            <option value="paused">Pausé</option>
            <option value="expired">Expiré</option>
          </select>
          <div className="flex items-center gap-4 text-sm text-muted-foreground ml-auto">
            <span><strong className="text-foreground">{filtered.length}</strong> liens</span>
            <span><strong className="text-green-600">{fmt(totalCollected)}</strong> FCFA collectés</span>
            <span><strong className="text-foreground">{totalPaid}</strong> paiements</span>
          </div>
        </div>

        {loading ? (
          <div className="py-16 text-center text-muted-foreground text-sm">Chargement…</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground text-sm">Aucun lien trouvé</div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/40">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Créateur</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Description</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Montant</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Paiements</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Collecté</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Statut</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Créé le</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pageItems.map((r) => {
                    const isSuspended = r.status === "suspended";
                    const isActing = actionLoading === r.id;
                    return (
                      <tr key={r.id} className="hover:bg-secondary/30 transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-medium text-foreground truncate max-w-[140px]">{r.creator_name || "—"}</p>
                          <p className="text-xs text-muted-foreground truncate max-w-[140px] font-mono">{r.user_phone || r.user_email || ""}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="truncate max-w-[180px]" title={r.description}>{r.description}</p>
                          <p className="text-xs text-muted-foreground font-mono">{r.id}</p>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <p className="font-mono font-semibold tabular-nums">{fmt(r.amount)} <span className="text-muted-foreground text-xs font-normal">FCFA</span></p>
                          {r.gross_amount && r.gross_amount !== r.amount && (
                            <p className="text-xs text-muted-foreground tabular-nums">payeur : {fmt(r.gross_amount)}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-semibold text-foreground">{r.paid_count}</span>
                          {r.max_uses && <span className="text-xs text-muted-foreground"> / {r.max_uses}</span>}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold text-green-600 tabular-nums">
                          {r.total_collected > 0 ? fmt(r.total_collected) : <span className="text-muted-foreground font-normal">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center"><StatusBadge status={r.status} /></td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(r.created_at)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <a
                              href={r.url}
                              target="_blank"
                              rel="noreferrer"
                              title="Ouvrir le lien"
                              className="h-7 w-7 rounded-md flex items-center justify-center hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <ExternalLink size={13} />
                            </a>
                            <button
                              title="Voir les transactions"
                              onClick={() => setTxModal(r)}
                              className="h-7 w-7 rounded-md flex items-center justify-center hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                            >
                              <Eye size={13} />
                            </button>
                            <button
                              title={isSuspended ? "Lever la suspension" : "Suspendre"}
                              onClick={() => handleTogglePause(r)}
                              disabled={isActing}
                              className={`h-7 w-7 rounded-md flex items-center justify-center transition-colors disabled:opacity-50 ${
                                isSuspended
                                  ? "hover:bg-green-500/10 text-green-600"
                                  : "hover:bg-amber-500/10 text-amber-600"
                              }`}
                            >
                              {isSuspended ? <Check size={13} /> : <Ban size={13} />}
                            </button>
                            <button
                              title="Supprimer"
                              onClick={() => setDeleteModal(r)}
                              className="h-7 w-7 rounded-md flex items-center justify-center hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {/* Pagination */}
        {plTotalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <p className="text-xs text-muted-foreground">
              {(plSafePage - 1) * PL_ADMIN_PAGE_SIZE + 1}–{Math.min(plSafePage * PL_ADMIN_PAGE_SIZE, filtered.length)} sur {filtered.length}
            </p>
            <div className="flex items-center gap-1">
              <button onClick={() => setPlPage((p) => Math.max(1, p - 1))} disabled={plSafePage === 1}
                className="h-7 w-7 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:bg-secondary disabled:opacity-40 transition-colors">
                <ChevronLeft size={13} />
              </button>
              <span className="text-xs font-medium text-muted-foreground px-2">{plSafePage} / {plTotalPages}</span>
              <button onClick={() => setPlPage((p) => Math.min(plTotalPages, p + 1))} disabled={plSafePage === plTotalPages}
                className="h-7 w-7 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:bg-secondary disabled:opacity-40 transition-colors">
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function MarketingTab({ token }) {
  const [templates, setTemplates] = useState([]);
  const [segments, setSegments] = useState([]);
  const [settings, setSettings] = useState({ enabled: false, daily_cap: 50, interval_seconds: 86400 });
  const [campaigns, setCampaigns] = useState([]);
  const [campaignKey, setCampaignKey] = useState("dormant_30d");
  const [segment, setSegment] = useState("all_active");
  const [limit, setLimit] = useState(50);
  const [testEmail, setTestEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const loadEmailOps = useCallback(async () => {
    const [tpls, cfg, history] = await Promise.all([
      adminFetch("/admin/lifecycle-emails/templates", "GET", null, token),
      adminFetch("/admin/lifecycle-emails/settings", "GET", null, token),
      adminFetch("/admin/lifecycle-emails/campaigns?limit=12", "GET", null, token),
    ]);
    setTemplates(tpls.templates || []);
    setSegments(tpls.segments || []);
    setSettings(cfg || { enabled: false, daily_cap: 50, interval_seconds: 86400 });
    setCampaigns(history.items || []);
    if ((tpls.templates || []).length && !campaignKey) setCampaignKey(tpls.templates[0].key);
  }, [token, campaignKey]);

  useEffect(() => {
    loadEmailOps().catch((e) => toast.error(e.message));
  }, [loadEmailOps]);

  async function updateSettings(next) {
    setBusy(true);
    setResult(null);
    try {
      const payload = {
        enabled: Boolean(next.enabled),
        daily_cap: Number(next.daily_cap || 50),
        interval_seconds: Number(next.interval_seconds || 86400),
      };
      const saved = await adminFetch("/admin/lifecycle-emails/settings", "PUT", payload, token);
      setSettings(saved);
      toast.success(saved.enabled ? "Automatisation email activée" : "Automatisation email désactivée");
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function runDryRun() {
    setBusy(true);
    setResult(null);
    try {
      const res = await adminFetch("/admin/lifecycle-emails/send", "POST", { campaign_key: campaignKey, segment, limit: Number(limit), dry_run: true }, token);
      setResult(res);
      toast.success(`${res.targeted} destinataire(s) ciblé(s), aucun email envoyé`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    if (!testEmail || !testEmail.includes("@")) return toast.error("Email de test invalide");
    setBusy(true);
    setResult(null);
    try {
      const res = await adminFetch("/admin/lifecycle-emails/send", "POST", { campaign_key: campaignKey, segment, test_email: testEmail, limit: 1, dry_run: false }, token);
      setResult(res);
      await loadEmailOps();
      toast.success(`Email de test envoyé à ${testEmail}`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function runAutomationNow() {
    setBusy(true);
    setResult(null);
    try {
      const res = await adminFetch(`/admin/lifecycle-emails/run-automation?limit=${Number(limit) || 50}`, "POST", null, token);
      setResult(res);
      await loadEmailOps();
      toast.success("Cycle lifecycle lancé");
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  const selectedTemplate = templates.find((t) => t.key === campaignKey);
  const intervalDays = Math.round((Number(settings.interval_seconds || 86400) / 86400) * 10) / 10;

  return (
    <div className="max-w-6xl space-y-6 mb-8">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-bold uppercase tracking-wide mb-3">
            <Mail size={14} /> Lifecycle emails
          </div>
          <h2 className="text-2xl font-extrabold tracking-tight text-slate-950 dark:text-slate-50">Relances automatiques Kobo</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Emails professionnels envoyés par segment, avec désinscription, journalisation et limite anti-spam.
          </p>
        </div>
        <button
          onClick={() => updateSettings({ ...settings, enabled: !settings.enabled })}
          disabled={busy}
          className={`h-11 px-5 rounded-xl font-bold border transition-colors ${settings.enabled ? "bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700" : "bg-slate-950 text-white border-slate-950 hover:bg-slate-800"}`}
        >
          {settings.enabled ? "Automatisation activée" : "Activer l'automatisation"}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-border bg-surface p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">État</p>
          <div className="mt-3 flex items-center gap-3">
            <span className={`h-3 w-3 rounded-full ${settings.enabled ? "bg-emerald-500" : "bg-slate-300"}`} />
            <p className="text-xl font-extrabold text-slate-950 dark:text-slate-50">{settings.enabled ? "Actif" : "En pause"}</p>
          </div>
          <p className="text-sm text-muted-foreground mt-2">Le cron lit ce réglage automatiquement côté backend.</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Cap quotidien</p>
          <div className="mt-3 flex items-center gap-3">
            <input type="number" min="1" max="500" value={settings.daily_cap || 50} onChange={(e) => setSettings({ ...settings, daily_cap: e.target.value })} className="h-11 w-28 rounded-xl border border-border bg-background px-3 font-bold" />
            <button onClick={() => updateSettings(settings)} disabled={busy} className="h-11 px-4 rounded-xl border border-border hover:bg-secondary font-semibold">Enregistrer</button>
          </div>
          <p className="text-sm text-muted-foreground mt-2">Maximum d'emails envoyés par cycle automatique.</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Fréquence</p>
          <select value={settings.interval_seconds || 86400} onChange={(e) => setSettings({ ...settings, interval_seconds: Number(e.target.value) })} className="mt-3 h-11 w-full rounded-xl border border-border bg-background px-3 font-bold">
            <option value={86400}>Chaque jour</option>
            <option value={172800}>Tous les 2 jours</option>
            <option value={604800}>Chaque semaine</option>
          </select>
          <p className="text-sm text-muted-foreground mt-2">Actuellement : tous les {intervalDays} jour(s).</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-5">
        <div className="rounded-2xl border border-border bg-surface p-5 space-y-5">
          <div>
            <h3 className="text-lg font-extrabold text-slate-950 dark:text-slate-50">Préparer une campagne</h3>
            <p className="text-sm text-muted-foreground">Testez d'abord, puis lancez un cycle manuel si le ciblage est correct.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-2">
              <span className="text-sm font-bold">Message</span>
              <select value={campaignKey} onChange={(e) => setCampaignKey(e.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 font-semibold">
                {templates.map((t) => <option key={t.key} value={t.key}>{t.subject}</option>)}
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm font-bold">Segment</span>
              <select value={segment} onChange={(e) => setSegment(e.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 font-semibold">
                {segments.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>
          <div className="rounded-xl bg-secondary p-4 border border-border">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Aperçu du message</p>
            <p className="mt-2 text-lg font-extrabold text-slate-950 dark:text-slate-50">{selectedTemplate?.title || selectedTemplate?.subject || "Message lifecycle"}</p>
            <p className="text-sm text-muted-foreground mt-1">{selectedTemplate?.subject || "Sélectionnez un modèle"}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[160px_1fr] gap-4">
            <label className="space-y-2">
              <span className="text-sm font-bold">Limite</span>
              <input type="number" min="1" max="500" value={limit} onChange={(e) => setLimit(e.target.value)} className="h-11 w-full rounded-xl border border-border bg-background px-3 font-bold" />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-bold">Email de test</span>
              <input value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="service@koboonline.com" className="h-11 w-full rounded-xl border border-border bg-background px-3" />
            </label>
          </div>
          <div className="flex flex-wrap gap-3">
            <button onClick={runDryRun} disabled={busy} className="h-11 px-4 rounded-xl border border-border hover:bg-secondary font-bold">Dry-run</button>
            <button onClick={sendTest} disabled={busy} className="h-11 px-4 rounded-xl border border-border hover:bg-secondary font-bold">Envoyer test</button>
            <button onClick={runAutomationNow} disabled={busy} className="h-11 px-5 rounded-xl bg-primary text-white hover:bg-primary/90 font-bold inline-flex items-center gap-2">
              {busy && <Loader2 size={16} className="animate-spin" />} Lancer maintenant
            </button>
          </div>
          {result && (
            <pre className="rounded-xl bg-slate-950 text-slate-50 p-4 text-xs overflow-auto max-h-64">{JSON.stringify(result, null, 2)}</pre>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-surface p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-lg font-extrabold text-slate-950 dark:text-slate-50">Historique</h3>
              <p className="text-sm text-muted-foreground">Dernières campagnes journalisées.</p>
            </div>
            <button onClick={loadEmailOps} className="h-9 w-9 rounded-lg border border-border hover:bg-secondary flex items-center justify-center"><RefreshCw size={15} /></button>
          </div>
          <div className="space-y-3">
            {campaigns.length === 0 && <p className="text-sm text-muted-foreground">Aucune campagne enregistrée.</p>}
            {campaigns.map((c) => (
              <div key={c.id} className="rounded-xl border border-border p-3 bg-background">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold truncate text-slate-950 dark:text-slate-50">{c.subject}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{c.segment} · {fmtDate(c.created_at)}</p>
                  </div>
                  <span className={`text-xs font-bold px-2 py-1 rounded-full ${c.status === "completed" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{c.status}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3 text-sm">
                  <div><p className="text-muted-foreground text-xs">Ciblés</p><p className="font-extrabold">{fmt(c.total_targeted)}</p></div>
                  <div><p className="text-muted-foreground text-xs">Envoyés</p><p className="font-extrabold text-emerald-600">{fmt(c.total_sent)}</p></div>
                  <div><p className="text-muted-foreground text-xs">Échecs</p><p className="font-extrabold text-red-600">{fmt(c.total_failed)}</p></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionModal({ modal, onClose }) {
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!modal) { setValues({}); setBusy(false); return; }
    const defaults = {};
    (modal.inputs || []).forEach((inp) => {
      if (inp.type === "select" && inp.options?.length > 0) defaults[inp.key] = inp.options[0].value;
    });
    setValues(defaults);
    setBusy(false);
  }, [modal]);
  if (!modal) return null;
  const { title, description, variant = "default", inputs = [], confirmLabel = "Confirmer", icon } = modal;
  const colorMap = {
    success: { bg: "bg-green-500/10", border: "border-green-500/30", icon: "text-green-500", btn: "bg-green-600 hover:bg-green-700 text-white" },
    danger:  { bg: "bg-red-500/10",   border: "border-red-500/30",   icon: "text-red-500",   btn: "bg-red-600 hover:bg-red-700 text-white" },
    warning: { bg: "bg-orange-500/10",border: "border-orange-500/30",icon: "text-orange-500",btn: "bg-orange-600 hover:bg-orange-700 text-white" },
    default: { bg: "bg-blue-500/10",  border: "border-blue-500/30",  icon: "text-blue-500",  btn: "bg-primary hover:bg-primary/90 text-primary-foreground" },
  };
  const c = colorMap[variant] || colorMap.default;
  const handleConfirm = async () => {
    setBusy(true);
    try { await modal.onConfirm(values); onClose(); }
    catch (e) { toast.error(e.message || "Erreur"); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start gap-4">
          <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${c.bg} ${c.border} border`}>
            {icon ? <span className={c.icon}>{icon}</span> : <AlertCircle size={20} className={c.icon} />}
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-base">{title}</h3>
            {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
          </div>
          <button onClick={onClose} className="h-7 w-7 rounded-lg hover:bg-secondary flex items-center justify-center shrink-0">
            <X size={14} />
          </button>
        </div>
        {/* Inputs */}
        {inputs.length > 0 && (
          <div className="space-y-3">
            {inputs.map((inp) => (
              <div key={inp.key}>
                <label className="text-xs font-medium text-muted-foreground block mb-1">{inp.label}{inp.required && <span className="text-red-500 ml-0.5">*</span>}</label>
                {inp.type === "select" ? (
                  <select
                    value={values[inp.key] || ""}
                    onChange={(e) => setValues((v) => ({ ...v, [inp.key]: e.target.value }))}
                    className="w-full h-9 px-3 text-sm rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    <option value="">— Choisir —</option>
                    {(inp.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : inp.type === "textarea" ? (
                  <textarea
                    value={values[inp.key] || ""}
                    onChange={(e) => setValues((v) => ({ ...v, [inp.key]: e.target.value }))}
                    placeholder={inp.placeholder || ""}
                    rows={3}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                ) : (
                  <input
                    type={inp.type || "text"}
                    value={values[inp.key] || ""}
                    onChange={(e) => setValues((v) => ({ ...v, [inp.key]: e.target.value }))}
                    placeholder={inp.placeholder || ""}
                    className="w-full h-9 px-3 text-sm rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                )}
              </div>
            ))}
          </div>
        )}
        {/* Actions */}
        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onClose} disabled={busy} className="h-9 px-4 rounded-lg border border-border text-sm font-medium hover:bg-secondary transition-colors disabled:opacity-50">
            Annuler
          </button>
          <button
            onClick={handleConfirm}
            disabled={busy || inputs.filter(i => i.required).some(i => !values[i.key])}
            className={`h-9 px-5 rounded-lg text-sm font-bold transition-colors disabled:opacity-50 flex items-center gap-2 ${c.btn}`}
          >
            {busy && <RefreshCw size={13} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Admin Team Tab ─────────────────────────────────────────────────────────────

const ROLE_CONFIG = {
  superadmin: { label: "Super Admin",  color: "text-purple-500", bg: "bg-purple-500/10", desc: "Accès complet à toutes les fonctionnalités" },
  ops:        { label: "Opérations",   color: "text-blue-500",   bg: "bg-blue-500/10",   desc: "Dépôts, retraits, KYC, blocage utilisateurs" },
  support:    { label: "Support",      color: "text-green-500",  bg: "bg-green-500/10",  desc: "Tickets, consultation utilisateurs (lecture seule)" },
};

function AdminTeamTab({ token, role: myRole }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(null);
  const canManage = hasPermission(myRole, "*");

  async function fetchMembers() {
    setLoading(true);
    try {
      const data = await adminFetch("/admin/admin-users", "GET", null, token);
      setMembers(data.items || []);
    } catch { toast.error("Erreur chargement"); }
    setLoading(false);
  }
  useEffect(() => { fetchMembers(); }, []);

  const addMember = () => setModal({
    title: "Ajouter un admin",
    variant: "default",
    icon: <UserCog size={20} />,
    inputs: [
      { key: "email", label: "Email", placeholder: "admin@exemple.com", required: true },
      { key: "name",  label: "Nom",   placeholder: "Jean Dupont" },
      { key: "role",  label: "Rôle",  type: "select", required: true,
        options: Object.entries(ROLE_CONFIG).map(([v, c]) => ({ value: v, label: c.label })) },
    ],
    confirmLabel: "Ajouter",
    onConfirm: async (v) => {
      await adminFetch("/admin/admin-users", "POST", v, token);
      toast.success("Admin ajouté");
      fetchMembers();
    },
  });

  const changeRole = (m) => setModal({
    title: `Modifier le rôle — ${m.email}`,
    description: `Rôle actuel : ${ROLE_CONFIG[m.role]?.label || m.role}`,
    variant: "warning",
    icon: <SlidersHorizontal size={20} />,
    inputs: [
      { key: "status", label: "Nouveau rôle", type: "select", required: true,
        options: Object.entries(ROLE_CONFIG).map(([v, c]) => ({ value: v, label: c.label })) },
    ],
    confirmLabel: "Modifier",
    onConfirm: async (v) => {
      await adminFetch(`/admin/admin-users/${encodeURIComponent(m.email)}/role`, "PATCH", { status: v.status }, token);
      toast.success("Rôle modifié");
      fetchMembers();
    },
  });

  const deactivate = (m) => setModal({
    title: `Désactiver ${m.email}`,
    description: "Cet admin perdra l'accès immédiatement. Ses sessions actives seront révoquées.",
    variant: "danger",
    icon: <UserX size={20} />,
    confirmLabel: "Désactiver",
    onConfirm: async () => {
      await adminFetch(`/admin/admin-users/${encodeURIComponent(m.email)}`, "DELETE", null, token);
      toast.success("Admin désactivé");
      fetchMembers();
    },
  });

  return (
    <div className="space-y-5">
      <ActionModal modal={modal} onClose={() => setModal(null)} />
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Équipe admin</h2>
          <p className="text-xs text-muted-foreground">{members.length} membre{members.length > 1 ? "s" : ""}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchMembers} className="h-8 w-8 rounded-lg border border-input flex items-center justify-center hover:bg-secondary" disabled={loading}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          {canManage && (
            <button onClick={addMember} className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold flex items-center gap-1.5 hover:bg-primary/90">
              <Plus size={13} /> Ajouter
            </button>
          )}
        </div>
      </div>

      {/* Légende des rôles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {Object.entries(ROLE_CONFIG).map(([key, c]) => (
          <div key={key} className={`rounded-xl p-3 border border-border ${c.bg}`}>
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs font-bold ${c.color}`}>{c.label}</span>
            </div>
            <p className="text-xs text-muted-foreground">{c.desc}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50">
            <tr>
              {["Admin", "Rôle", "Statut", "Ajouté le", "Actions"].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {members.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-10 text-muted-foreground text-sm">
                Aucun admin. {canManage && "Cliquez sur « Ajouter » pour créer le premier."}
              </td></tr>
            ) : members.map((m) => {
              const rc = ROLE_CONFIG[m.role] || ROLE_CONFIG.ops;
              return (
                <tr key={m.id} className="hover:bg-secondary/30 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-sm">{m.name || m.email}</p>
                    {m.name && <p className="text-xs text-muted-foreground">{m.email}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${rc.bg} ${rc.color}`}>{rc.label}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${m.is_active ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"}`}>
                      {m.is_active ? "Actif" : "Désactivé"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(m.created_at).toLocaleDateString("fr-FR")}
                  </td>
                  <td className="px-4 py-3">
                    {canManage && m.is_active && (
                      <div className="flex gap-1">
                        <button onClick={() => changeRole(m)} className="h-7 px-2 rounded-md text-xs font-medium bg-orange-500/10 text-orange-500 hover:bg-orange-500/20 flex items-center gap-1">
                          <SlidersHorizontal size={11} /> Rôle
                        </button>
                        <button onClick={() => deactivate(m)} className="h-7 px-2 rounded-md text-xs font-medium bg-red-500/10 text-red-600 hover:bg-red-500/20 flex items-center gap-1">
                          <Ban size={11} /> Désactiver
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── GlobalSearch ──────────────────────────────────────────────────────────────

function GlobalSearch({ token, onSelectUser }) {
  const [query, setQuery]       = useState("");
  const [results, setResults]   = useState([]);
  const [open, setOpen]         = useState(false);
  const [loading, setLoading]   = useState(false);
  const [cursor, setCursor]     = useState(-1);
  const inputRef  = useRef(null);
  const wrapRef   = useRef(null);
  const timerRef  = useRef(null);

  // Ctrl+K / Cmd+K ouvre la recherche
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Clic en dehors → ferme
  useEffect(() => {
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // Debounce + fetch
  useEffect(() => {
    clearTimeout(timerRef.current);
    if (query.trim().length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    timerRef.current = setTimeout(async () => {
      try {
        const p = new URLSearchParams({ search: query.trim(), limit: 7 });
        const d = await adminFetch(`/admin/users?${p}`, "GET", null, token);
        setResults(d.items || []);
        setCursor(-1);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 280);
    return () => clearTimeout(timerRef.current);
  }, [query, token]);

  const select = (user) => {
    onSelectUser(user.id);
    setQuery("");
    setOpen(false);
    setResults([]);
  };

  const onKeyDown = (e) => {
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === "Enter" && cursor >= 0 && results[cursor]) { select(results[cursor]); }
    else if (e.key === "Escape") { setOpen(false); inputRef.current?.blur(); }
  };

  const kycBadge = (lvl, status) => {
    if (status === "approved") return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600 font-medium">KYC {lvl}</span>;
    if (status === "pending")  return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/10 text-yellow-600 font-medium">En attente</span>;
    return null;
  };

  const initials = (u) => {
    const name = u.full_name || u.email || u.phone_e164 || "?";
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <div ref={wrapRef} className="relative flex-1 max-w-xl mx-3">
      <div className={`flex items-center gap-2.5 h-11 px-4 rounded-lg border transition-colors bg-surface shadow-sm ${open ? "border-primary ring-2 ring-primary/10" : "border-border hover:border-slate-300 dark:hover:border-slate-600"}`}>
        <Search size={16} className="text-muted-foreground shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Rechercher un utilisateur…"
          className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/60 min-w-0"
        />
        {query ? (
          <button onClick={() => { setQuery(""); setResults([]); inputRef.current?.focus(); }}
            className="text-muted-foreground hover:text-foreground shrink-0">
            <X size={13} />
          </button>
        ) : (
          <kbd className="hidden lg:flex text-[11px] font-mono text-muted-foreground/60 bg-background border border-border rounded-md px-1.5 py-0.5 shrink-0">⌘K</kbd>
        )}
      </div>

      {open && (query.trim().length >= 2) && (
        <div className="absolute left-0 right-0 top-10 z-50 rounded-xl border border-border bg-background shadow-xl overflow-hidden">
          {loading && (
            <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
              <Loader2 size={13} className="animate-spin" /> Recherche…
            </div>
          )}
          {!loading && results.length === 0 && (
            <div className="px-4 py-3 text-sm text-muted-foreground">Aucun résultat pour « {query} »</div>
          )}
          {!loading && results.map((u, i) => (
            <button key={u.id} onClick={() => select(u)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors border-b border-border last:border-0 ${cursor === i ? "bg-primary/10" : "hover:bg-secondary"}`}>
              <div className="w-8 h-8 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                {initials(u)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{u.full_name || u.email || u.phone_e164}</p>
                <p className="text-xs text-muted-foreground truncate">{u.phone_e164}{u.email ? ` · ${u.email}` : ""}</p>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                {kycBadge(u.kyc_level, u.kyc_status)}
                {u.is_blocked && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-500 font-medium">Bloqué</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Corridors Panel ────────────────────────────────────────────────────────────

const COUNTRY_NAMES = {
  CM:"Cameroun",SN:"Sénégal",CI:"Côte d'Ivoire",ML:"Mali",BF:"Burkina Faso",
  GN:"Guinée",TG:"Togo",BJ:"Bénin",NE:"Niger",GA:"Gabon",CG:"Congo",
  CD:"RD Congo",MG:"Madagascar",MR:"Mauritanie",GH:"Ghana",NG:"Nigéria",
  TZ:"Tanzanie",KE:"Kenya",UG:"Ouganda",RW:"Rwanda",ET:"Éthiopie",
  MA:"Maroc",TN:"Tunisie",DZ:"Algérie",EG:"Égypte",CA:"Canada",US:"États-Unis",
};
const COUNTRY_CURRENCIES = {
  CM:"XAF",SN:"XOF",CI:"XOF",ML:"XOF",BF:"XOF",GN:"GNF",TG:"XOF",
  BJ:"XOF",NE:"XOF",GA:"XAF",CG:"XAF",CD:"CDF",MG:"MGA",MR:"MRU",
  GH:"GHS",NG:"NGN",TZ:"TZS",KE:"KES",UG:"UGX",RW:"RWF",ET:"ETB",
  MA:"MAD",TN:"TND",DZ:"DZD",EG:"EGP",
};
const SOURCE_CURRENCIES = ["EUR","USD","GBP","CAD","CHF","XAF","XOF"];
const PAYOUT_METHODS_LIST = [
  { value: "mobile_money", label: "Mobile Money" },
  { value: "bank_transfer", label: "Virement bancaire" },
  { value: "cash_pickup", label: "Retrait espèces" },
];

function ComplianceTab({ token }) {
  const [rules, setRules] = useState([]);
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const [evalForm, setEvalForm] = useState({ country: "CA", amount_fcfa: "1000000", flow: "intl", kyc_level: "1" });
  const [evalResult, setEvalResult] = useState(null);

  const loadRules = useCallback(() => {
    adminFetch("/admin/compliance/rules", "GET", null, token)
      .then((r) => {
        const items = r.items || [];
        setRules(items);
        setSelected((prev) => prev || items[0] || null);
      })
      .catch((e) => toast.error(e.message));
  }, [token]);

  useEffect(() => { loadRules(); }, [loadRules]);

  const updateSelected = (key, value) => setSelected((p) => ({ ...p, [key]: value }));
  const saveRule = async () => {
    if (!selected?.country) return;
    setSaving(true);
    try {
      const payload = {
        ...selected,
        country: selected.country.toUpperCase(),
        kyc_min_level: Number(selected.kyc_min_level || 0),
        single_limit_fcfa: Number(selected.single_limit_fcfa || 0),
        daily_limit_fcfa: Number(selected.daily_limit_fcfa || 0),
        monthly_limit_fcfa: Number(selected.monthly_limit_fcfa || 0),
        manual_review_above_fcfa: Number(selected.manual_review_above_fcfa || 0),
        reporting_threshold_fcfa: Number(selected.reporting_threshold_fcfa || 0),
      };
      const res = await adminFetch("/admin/compliance/rules", "PUT", payload, token);
      toast.success("Règle conformité enregistrée");
      setSelected(res.rule);
      loadRules();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const runEval = async () => {
    try {
      const res = await adminFetch("/admin/compliance/evaluate", "POST", {
        country: evalForm.country,
        amount_fcfa: Number(evalForm.amount_fcfa || 0),
        flow: evalForm.flow,
        kyc_level: Number(evalForm.kyc_level || 0),
      }, token);
      setEvalResult(res);
    } catch (e) { toast.error(e.message); }
  };

  const statusClass = {
    active: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    manual_review: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    blocked: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  };

  return (
    <div className="grid lg:grid-cols-[280px_1fr] gap-5">
      <div className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">Conformité pays</h2>
          <p className="text-sm text-muted-foreground">Règles applicables par pays/corridor : KYC, plafonds, revue manuelle, restrictions et reporting.</p>
        </div>
        <div className="rounded-xl border border-border bg-background overflow-hidden">
          <div className="divide-y divide-border max-h-[560px] overflow-y-auto">
            {rules.map((r) => (
              <button key={r.country} onClick={() => setSelected(r)}
                className={`w-full px-4 py-3 text-left hover:bg-secondary/60 transition-colors ${selected?.country === r.country ? "bg-primary/10" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{COUNTRY_NAMES[r.country] || r.name || r.country}</p>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusClass[r.status] || "bg-secondary text-muted-foreground"}`}>{r.status}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{r.country} · KYC min {r.kyc_min_level} · {fmt(r.single_limit_fcfa)} FCFA max</p>
              </button>
            ))}
          </div>
        </div>
        <button onClick={() => setSelected({ country: "", name: "", status: "manual_review", kyc_min_level: 1, single_limit_fcfa: 0, daily_limit_fcfa: 0, monthly_limit_fcfa: 0, crypto_allowed: true, fiat_allowed: true, p2p_allowed: true, intl_allowed: true, manual_review_above_fcfa: 0, reporting_threshold_fcfa: 0, notes: "" })}
          className="w-full h-9 rounded-md border border-border text-sm hover:bg-secondary flex items-center justify-center gap-2">
          <Plus size={14} /> Nouvelle règle
        </button>
      </div>

      <div className="space-y-5">
        {selected && (
          <div className="rounded-xl border border-border bg-background p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">Règle {selected.country || "pays"}</h3>
                <p className="text-xs text-muted-foreground">Ces paramètres servent au moteur de décision conformité avant transaction.</p>
              </div>
              <button onClick={saveRule} disabled={saving} className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold flex items-center gap-1.5">
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Enregistrer
              </button>
            </div>

            <div className="grid md:grid-cols-4 gap-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Pays</label>
                <input value={selected.country || ""} onChange={(e) => updateSelected("country", e.target.value.toUpperCase())} className="mt-1 w-full h-9 rounded-md border border-border bg-background px-3 text-sm" placeholder="CA" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Nom</label>
                <input value={selected.name || ""} onChange={(e) => updateSelected("name", e.target.value)} className="mt-1 w-full h-9 rounded-md border border-border bg-background px-3 text-sm" placeholder="Canada" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Statut</label>
                <select value={selected.status || "manual_review"} onChange={(e) => updateSelected("status", e.target.value)} className="mt-1 w-full h-9 rounded-md border border-border bg-background px-3 text-sm">
                  <option value="active">Actif</option>
                  <option value="manual_review">Revue manuelle</option>
                  <option value="blocked">Bloqué</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">KYC minimum</label>
                <input type="number" value={selected.kyc_min_level ?? 0} onChange={(e) => updateSelected("kyc_min_level", e.target.value)} className="mt-1 w-full h-9 rounded-md border border-border bg-background px-3 text-sm" />
              </div>
            </div>

            <div className="grid md:grid-cols-5 gap-3">
              {[
                ["single_limit_fcfa", "Max transaction"],
                ["daily_limit_fcfa", "Max jour"],
                ["monthly_limit_fcfa", "Max mois"],
                ["manual_review_above_fcfa", "Revue dès"],
                ["reporting_threshold_fcfa", "Reporting dès"],
              ].map(([key, label]) => (
                <div key={key}>
                  <label className="text-xs font-semibold text-muted-foreground">{label}</label>
                  <input type="number" value={selected[key] ?? 0} onChange={(e) => updateSelected(key, e.target.value)} className="mt-1 w-full h-9 rounded-md border border-border bg-background px-3 text-sm tabular-nums" />
                </div>
              ))}
            </div>

            <div className="grid sm:grid-cols-4 gap-2">
              {[
                ["fiat_allowed", "Fiat"],
                ["crypto_allowed", "Crypto"],
                ["p2p_allowed", "P2P"],
                ["intl_allowed", "International"],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                  <input type="checkbox" checked={!!selected[key]} onChange={(e) => updateSelected(key, e.target.checked)} className="accent-primary" />
                  {label}
                </label>
              ))}
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground">Notes réglementaires</label>
              <textarea value={selected.notes || ""} onChange={(e) => updateSelected("notes", e.target.value)} rows={4} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
            </div>
          </div>
        )}

        <div className="rounded-xl border border-border bg-background p-5 space-y-4">
          <div>
            <h3 className="font-semibold">Test de décision conformité</h3>
            <p className="text-xs text-muted-foreground">Simule la décision que le backend doit appliquer avant transaction.</p>
          </div>
          <div className="grid md:grid-cols-5 gap-3">
            <input value={evalForm.country} onChange={(e) => setEvalForm((p) => ({ ...p, country: e.target.value.toUpperCase() }))} className="h-9 rounded-md border border-border bg-background px-3 text-sm" placeholder="Pays" />
            <input type="number" value={evalForm.amount_fcfa} onChange={(e) => setEvalForm((p) => ({ ...p, amount_fcfa: e.target.value }))} className="h-9 rounded-md border border-border bg-background px-3 text-sm" placeholder="Montant FCFA" />
            <select value={evalForm.flow} onChange={(e) => setEvalForm((p) => ({ ...p, flow: e.target.value }))} className="h-9 rounded-md border border-border bg-background px-3 text-sm">
              <option value="fiat">Fiat</option>
              <option value="crypto">Crypto</option>
              <option value="p2p">P2P</option>
              <option value="intl">International</option>
            </select>
            <input type="number" value={evalForm.kyc_level} onChange={(e) => setEvalForm((p) => ({ ...p, kyc_level: e.target.value }))} className="h-9 rounded-md border border-border bg-background px-3 text-sm" placeholder="KYC" />
            <button onClick={runEval} className="h-9 rounded-md bg-primary text-primary-foreground text-sm font-semibold">Tester</button>
          </div>
          {evalResult && (
            <div className="rounded-lg border border-border bg-secondary/30 p-3">
              <p className="text-sm font-semibold">Décision : <span className="font-mono">{evalResult.decision}</span></p>
              <p className="text-xs text-muted-foreground mt-1">Raisons : {(evalResult.reasons || []).join(", ") || "aucune"}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CorridorsPanel({ corridors, setCorridors, corridorToggling, setCorridorToggling, token }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [addForm, setAddForm] = useState({
    source_currency:"EUR", destination_country:"CM",
    target_currency:"XAF", payout_method:"mobile_money",
    fixed_fee:"0", variable_fee_bps:"150", min_fee:"0",
  });
  const [saving, setSaving] = useState(false);

  const handleAddCountry = (code) => {
    setAddForm((p) => ({ ...p, destination_country: code, target_currency: COUNTRY_CURRENCIES[code] || p.target_currency }));
  };

  const resetAdd = () => {
    setShowAdd(false);
    setAddForm({ source_currency:"EUR", destination_country:"CM", target_currency:"XAF", payout_method:"mobile_money", fixed_fee:"0", variable_fee_bps:"150", min_fee:"0" });
  };

  const submitAdd = async () => {
    setSaving(true);
    try {
      const res = await adminFetch("/admin/corridors", "POST", {
        ...addForm,
        fixed_fee: parseFloat(addForm.fixed_fee) || 0,
        variable_fee_bps: parseInt(addForm.variable_fee_bps) || 0,
        min_fee: parseFloat(addForm.min_fee) || 0,
      }, token);
      setCorridors((prev) => [...prev, res]);
      resetAdd();
      toast.success("Corridor créé avec succès");
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };

  const submitEdit = async () => {
    setSaving(true);
    try {
      const res = await adminFetch(`/admin/corridors/${editId}`, "PATCH", {
        fixed_fee: parseFloat(editForm.fixed_fee) || 0,
        variable_fee_bps: parseInt(editForm.variable_fee_bps) || 0,
        min_fee: parseFloat(editForm.min_fee) || 0,
      }, token);
      setCorridors((prev) => prev.map((x) => x.id === editId ? res : x));
      setEditId(null);
      toast.success("Corridor mis à jour");
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };

  const deleteCorridor = async (id) => {
    if (!window.confirm("Supprimer ce corridor ?")) return;
    try {
      await adminFetch(`/admin/corridors/${id}`, "DELETE", null, token);
      setCorridors((prev) => prev.filter((x) => x.id !== id));
      toast.success("Corridor supprimé");
    } catch (e) { toast.error(e.message); }
  };

  const bps = parseInt(addForm.variable_fee_bps) || 0;
  const fixedFee = parseFloat(addForm.fixed_fee) || 0;
  const minFee = parseFloat(addForm.min_fee) || 0;
  const exampleAmount = 100;
  const exampleVarFee = (exampleAmount * bps / 10000).toFixed(2);
  const exampleTotal = Math.max(minFee, fixedFee + parseFloat(exampleVarFee)).toFixed(2);

  const payoutMethodInfo = {
    mobile_money: { icon: Smartphone, desc: "Le bénéficiaire reçoit l'argent directement sur son numéro de téléphone mobile (MTN, Orange, Wave…). Traitement quasi-instantané.", color: "text-yellow-600 bg-yellow-500/10 border-yellow-300 dark:border-yellow-700" },
    bank_transfer: { icon: Building2, desc: "Virement vers un compte bancaire (IBAN). Traitement sous 1-3 jours ouvrés selon la banque du bénéficiaire.", color: "text-blue-600 bg-blue-500/10 border-blue-300 dark:border-blue-700" },
    cash_pickup: { icon: DollarSign, desc: "Le bénéficiaire récupère les fonds en espèces dans un point de retrait partenaire. Disponible dans les grandes villes.", color: "text-green-600 bg-green-500/10 border-green-300 dark:border-green-700" },
  };

  // ── Page dédiée Nouveau corridor ──────────────────────────────────────────
  if (showAdd) {
    return (
      <div className="space-y-0">
        {/* En-tête de page */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={resetAdd}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded-md hover:bg-secondary">
            <ChevronLeft size={14} /> Retour aux corridors
          </button>
          <span className="text-muted-foreground/40">|</span>
          <h2 className="font-semibold text-base">Nouveau corridor de transfert</h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
          {/* Formulaire principal */}
          <div className="space-y-5">

            {/* Étape 1 — Pays de destination */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-3">
              <div className="flex items-start gap-3">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold shrink-0 mt-0.5">1</span>
                <div>
                  <p className="text-sm font-semibold">Pays de destination</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Sélectionnez le pays où le bénéficiaire va recevoir l'argent. Chaque pays a sa propre devise locale pré-remplie.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {Object.entries(COUNTRY_NAMES).map(([code, name]) => (
                  <button key={code} onClick={() => handleAddCountry(code)}
                    className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${addForm.destination_country === code ? "bg-primary text-primary-foreground border-primary shadow-sm" : "border-border bg-background text-foreground hover:border-primary/60 hover:bg-primary/5"}`}>
                    {name}
                  </button>
                ))}
              </div>
            </div>

            {/* Étape 2 — Devises */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-3">
              <div className="flex items-start gap-3">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold shrink-0 mt-0.5">2</span>
                <div>
                  <p className="text-sm font-semibold">Devises</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    La <strong>devise source</strong> est celle utilisée par l'expéditeur (ex : EUR en France). La <strong>devise cible</strong> est celle reçue par le bénéficiaire, automatiquement définie selon le pays choisi.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Devise source (expéditeur)</label>
                  <select value={addForm.source_currency}
                    onChange={(e) => setAddForm((p) => ({ ...p, source_currency: e.target.value }))}
                    className="w-full text-sm rounded-md border border-border bg-background px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-ring font-semibold">
                    {SOURCE_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <p className="text-[11px] text-muted-foreground">La devise dans laquelle l'utilisateur paie depuis l'app</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Devise cible (bénéficiaire)</label>
                  <input type="text" value={addForm.target_currency}
                    onChange={(e) => setAddForm((p) => ({ ...p, target_currency: e.target.value.toUpperCase() }))}
                    placeholder="XAF"
                    className="w-full text-sm rounded-md border border-border bg-background px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-ring font-semibold font-mono" />
                  <p className="text-[11px] text-muted-foreground">Code ISO de la devise reçue par le bénéficiaire</p>
                </div>
              </div>
            </div>

            {/* Étape 3 — Méthode de paiement */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-3">
              <div className="flex items-start gap-3">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold shrink-0 mt-0.5">3</span>
                <div>
                  <p className="text-sm font-semibold">Méthode de paiement au bénéficiaire</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Comment le bénéficiaire va recevoir les fonds. Chaque méthode a des délais et des contraintes différents.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                {PAYOUT_METHODS_LIST.map(({ value, label }) => {
                  const info = payoutMethodInfo[value];
                  const Icon = info.icon;
                  const active = addForm.payout_method === value;
                  return (
                    <button key={value} onClick={() => setAddForm((p) => ({ ...p, payout_method: value }))}
                      className={`flex flex-col gap-2 p-3.5 rounded-lg border text-left transition-all ${active ? "bg-primary text-primary-foreground border-primary shadow-md" : "border-border bg-background hover:border-primary/50 hover:bg-primary/5"}`}>
                      <div className="flex items-center gap-2">
                        <Icon size={15} className={active ? "text-primary-foreground" : "text-muted-foreground"} />
                        <span className="text-xs font-semibold">{label}</span>
                      </div>
                      <p className={`text-[11px] leading-relaxed ${active ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{info.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Étape 4 — Frais */}
            <div className="rounded-xl border border-border bg-card p-5 space-y-3">
              <div className="flex items-start gap-3">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold shrink-0 mt-0.5">4</span>
                <div>
                  <p className="text-sm font-semibold">Configuration des frais</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Les frais prélevés sur chaque transaction. Le montant final = <strong>max(frais minimum, frais fixe + montant × bps/10000)</strong>.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Frais fixe</label>
                  <div className="relative">
                    <input type="number" min="0" step="any" value={addForm.fixed_fee}
                      onChange={(e) => setAddForm((p) => ({ ...p, fixed_fee: e.target.value }))}
                      placeholder="0.00"
                      className="w-full text-sm rounded-md border border-border bg-background pl-3 pr-12 py-2.5 focus:outline-none focus:ring-2 focus:ring-ring tabular-nums" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">{addForm.source_currency}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Montant fixe prélevé sur toute transaction, quel que soit le montant envoyé</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Frais variables</label>
                  <div className="relative">
                    <input type="number" min="0" step="1" value={addForm.variable_fee_bps}
                      onChange={(e) => setAddForm((p) => ({ ...p, variable_fee_bps: e.target.value }))}
                      placeholder="150"
                      className="w-full text-sm rounded-md border border-border bg-background pl-3 pr-12 py-2.5 focus:outline-none focus:ring-2 focus:ring-ring tabular-nums" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">bps</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Pourcentage du montant en points de base. <strong>{bps} bps = {(bps / 100).toFixed(2)}%</strong>. 150 bps = 1,5%.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Frais minimum</label>
                  <div className="relative">
                    <input type="number" min="0" step="any" value={addForm.min_fee}
                      onChange={(e) => setAddForm((p) => ({ ...p, min_fee: e.target.value }))}
                      placeholder="0.00"
                      className="w-full text-sm rounded-md border border-border bg-background pl-3 pr-12 py-2.5 focus:outline-none focus:ring-2 focus:ring-ring tabular-nums" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">{addForm.source_currency}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Seuil plancher : si les frais calculés sont inférieurs, ce montant minimum s'applique</p>
                </div>
              </div>
            </div>
          </div>

          {/* Panneau récap à droite */}
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-5 space-y-4 sticky top-4">
              <p className="text-sm font-semibold">Récapitulatif du corridor</p>

              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Route</span>
                  <span className="font-mono font-semibold text-primary">{addForm.source_currency} → {addForm.target_currency}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Destination</span>
                  <span className="font-medium">{COUNTRY_NAMES[addForm.destination_country] || addForm.destination_country}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Méthode</span>
                  <span className="font-medium">{PAYOUT_METHODS_LIST.find((m) => m.value === addForm.payout_method)?.label}</span>
                </div>
                <hr className="border-border" />
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Frais fixe</span>
                  <span className="font-mono">{fixedFee.toFixed(2)} {addForm.source_currency}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Frais variables</span>
                  <span className="font-mono">{bps} bps ({(bps / 100).toFixed(2)}%)</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Frais minimum</span>
                  <span className="font-mono">{minFee.toFixed(2)} {addForm.source_currency}</span>
                </div>
              </div>

              {/* Simulation */}
              <div className="rounded-lg bg-secondary/50 p-3 space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Simulation — {exampleAmount} {addForm.source_currency}</p>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Frais prélevés</span>
                  <span className="font-mono font-semibold text-destructive">−{exampleTotal} {addForm.source_currency}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Montant net converti</span>
                  <span className="font-mono font-semibold text-primary">{(exampleAmount - parseFloat(exampleTotal)).toFixed(2)} {addForm.source_currency}</span>
                </div>
              </div>

              <div className="space-y-2">
                <Button onClick={submitAdd} disabled={saving}
                  className="w-full h-10 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm gap-1.5">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  Créer le corridor
                </Button>
                <Button variant="outline" onClick={resetAdd}
                  className="w-full h-8 rounded-md text-xs text-muted-foreground">
                  Annuler
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Liste des corridors ───────────────────────────────────────────────────
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-semibold text-base">Pays et corridors de transfert</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Routes actives disponibles dans l'application — {corridors.length} corridor{corridors.length !== 1 ? "s" : ""} configuré{corridors.length !== 1 ? "s" : ""}.</p>
        </div>
        <Button size="sm" className="gap-1.5 h-8 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold"
          onClick={() => setShowAdd(true)}>
          <Plus size={13} /> Ajouter un corridor
        </Button>
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] text-xs font-semibold text-muted-foreground uppercase tracking-wide bg-secondary/40 px-4 py-2.5 gap-3 border-b border-border">
          <span>Corridor</span><span>Méthode</span><span>Frais fixe</span><span>Bps</span><span>Statut</span><span></span>
        </div>
        <div className="divide-y divide-border">
          {corridors.map((c) => (
            <div key={c.id} className={`transition-colors ${!c.active ? "opacity-50 bg-secondary/20" : ""}`}>
              {editId === c.id ? (
                <div className="px-4 py-3 space-y-3">
                  <p className="text-sm font-semibold">
                    <span className="text-primary">{c.source_currency}</span>
                    <span className="text-muted-foreground mx-1">→</span>
                    <span>{c.target_currency}</span>
                    <span className="text-muted-foreground text-xs font-normal ml-1">({COUNTRY_NAMES[c.destination_country] || c.destination_country})</span>
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { key:"fixed_fee", label:"Frais fixe", hint:"Montant fixe en devise source" },
                      { key:"variable_fee_bps", label:"Frais variables (bps)", hint:`${parseInt(editForm.variable_fee_bps)||0} bps = ${((parseInt(editForm.variable_fee_bps)||0)/100).toFixed(2)}%` },
                      { key:"min_fee", label:"Frais minimum", hint:"Seuil plancher" },
                    ].map(({ key, label, hint }) => (
                      <div key={key} className="space-y-1">
                        <label className="text-xs font-semibold text-muted-foreground">{label}</label>
                        <input type="number" min="0" step="any" value={editForm[key] ?? ""}
                          onChange={(e) => setEditForm((p) => ({ ...p, [key]: e.target.value }))}
                          className="w-full text-sm rounded-md border border-border bg-background px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring tabular-nums" />
                        <p className="text-[10px] text-muted-foreground">{hint}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={submitEdit} disabled={saving} className="flex-1 h-7 rounded text-xs bg-primary text-primary-foreground gap-1">
                      {saving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}Enregistrer
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditId(null)} className="flex-1 h-7 rounded text-xs">Annuler</Button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] items-center gap-3 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold">
                      <span className="text-primary">{c.source_currency}</span>
                      <span className="text-muted-foreground mx-1">→</span>
                      <span>{c.target_currency}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">{COUNTRY_NAMES[c.destination_country] || c.destination_country} ({c.destination_country})</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${c.payout_method === "mobile_money" ? "bg-yellow-500/10 text-yellow-600" : c.payout_method === "bank_transfer" ? "bg-blue-500/10 text-blue-500" : "bg-green-500/10 text-green-600"}`}>
                    {c.payout_method === "mobile_money" ? "Mobile Money" : c.payout_method === "bank_transfer" ? "Virement" : "Espèces"}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">{c.fixed_fee}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{c.variable_fee_bps}</span>
                  <button disabled={corridorToggling === c.id} onClick={async () => {
                    setCorridorToggling(c.id);
                    try {
                      const res = await adminFetch(`/admin/corridors/${c.id}/toggle`, "PATCH", null, token);
                      setCorridors((prev) => prev.map((x) => x.id === c.id ? { ...x, active: res.active } : x));
                      toast.success(res.active ? "Corridor activé" : "Corridor désactivé");
                    } catch (e) { toast.error(e.message); } finally { setCorridorToggling(null); }
                  }} className={`relative inline-flex h-5 w-9 items-center rounded-full border-2 transition-colors shrink-0 ${c.active ? "bg-primary border-primary" : "bg-secondary border-border"} ${corridorToggling === c.id ? "opacity-50 cursor-wait" : "cursor-pointer"}`}>
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${c.active ? "translate-x-3.5" : "translate-x-0.5"}`} />
                  </button>
                  <div className="flex gap-1">
                    <button onClick={() => { setEditId(c.id); setEditForm({ fixed_fee: c.fixed_fee, variable_fee_bps: c.variable_fee_bps, min_fee: c.min_fee }); }}
                      className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors" title="Modifier les frais">
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => deleteCorridor(c.id)}
                      className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-muted-foreground hover:text-red-500 transition-colors" title="Supprimer">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {corridors.length === 0 && (
            <div className="px-4 py-10 text-center space-y-2">
              <Globe size={24} className="mx-auto text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Aucun corridor configuré</p>
              <button onClick={() => setShowAdd(true)}
                className="text-xs text-primary hover:underline font-medium">
                Créer le premier corridor
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// ── Main Component ─────────────────────────────────────────────────────────────

export default function AdminPanel() {
  const [token, setToken] = useState(() => { localStorage.removeItem(ADMIN_TOKEN_KEY); return ""; });
  const [role,  setRole]  = useState(() => localStorage.getItem(ADMIN_ROLE_KEY)  || "superadmin");
  const [adminEmail, setAdminEmail] = useState(() => localStorage.getItem(ADMIN_EMAIL_KEY) || "");
  const [authed, setAuthed] = useState(false);
  const [activeTab, setActiveTab] = useState("analytics");
  const [modal, setModal] = useState(null);
  const [loading, setLoading] = useState(false);

  const [deposits, setDeposits] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [wallets, setWallets] = useState([]);
  const [virements, setVirements] = useState([]);
  const [p2pTransfers, setP2pTransfers] = useState([]);
  const [intlTransfers, setIntlTransfers] = useState([]);
  const [kyc, setKyc] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [users, setUsers] = useState([]);
  const [koboBankForm, setKoboBankForm] = useState({ beneficiary: "", iban: "", bic: "", bank: "" });
  const [koboBankSaving, setKoboBankSaving] = useState(false);
  const [paymentProvider, setPaymentProvider] = useState("sharepay");
  const [paymentProviderSaving, setPaymentProviderSaving] = useState(false);
  const [serviceStatus, setServiceStatus] = useState({ withdrawals_enabled: true, deposits_enabled: true, withdrawals_message: "", deposits_message: "" });
  const [serviceStatusSaving, setServiceStatusSaving] = useState(false);
  const [settingsSection, setSettingsSection] = useState("maintenance");
  const [withdrawalThreshold, setWithdrawalThreshold] = useState(10000);
  const [thresholdInput, setThresholdInput] = useState("10000");
  const [thresholdSaving, setThresholdSaving] = useState(false);
  const [corridors, setCorridors] = useState([]);
  const [corridorToggling, setCorridorToggling] = useState(null);
  const [usdtVerifyTransfer, setUsdtVerifyTransfer] = useState(null);
  const [intlDetailTransfer, setIntlDetailTransfer] = useState(null);
  const [fiatDeposits, setFiatDeposits] = useState([]);
  const [fiatWithdrawals, setFiatWithdrawals] = useState([]);
  const [mobileMoneyTransfers, setMobileMoneyTransfers] = useState([]);
  const [fiatWFilter, setFiatWFilter] = useState("all");
  const [platformBalance, setPlatformBalance] = useState(null);
  const [pendingCryptoLinkTxs, setPendingCryptoLinkTxs] = useState([]);
  const [cryptoChainEvents, setCryptoChainEvents] = useState({ items: [], summary: [], runs: [] });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem("admin_sidebar_collapsed") === "1"; } catch { return false; }
  });
  const [sidebarGroupsOpen, setSidebarGroupsOpen] = useState(() => ({
    overview: true,
    money: true,
    crypto: false,
    clients: false,
    control: false,
  }));
  const [headerNow, setHeaderNow] = useState(() => new Date());

  const [selectedDeposit, setSelectedDeposit] = useState(null);
  const [walletModal, setWalletModal] = useState(null);
  const [kycFilter, setKycFilter] = useState("in_review");
  const [kycDecideUser, setKycDecideUser] = useState(null);
  const [kycDocsUser, setKycDocsUser] = useState(null);
  const [selectedConv, setSelectedConv] = useState(null);
  const [selectedUserId, setSelectedUserId] = useState(null);

  const load = async (tok = token) => {
    if (!tok) return;
    setLoading(true);
    try {
      const [dep, wit, wal, vir, p2pData, intl, kycData, convData, usersData, bankSettings, fiatDep, fiatWit, mmTransfers, providerSetting, thresholdSetting, corridorData, svcStatus, pendingCrypto, chainEvents] = await Promise.all([
        adminFetch("/admin/crypto/deposits", "GET", null, tok),
        adminFetch("/admin/crypto/withdrawals", "GET", null, tok),
        adminFetch("/admin/crypto/wallets", "GET", null, tok),
        adminFetch("/admin/withdrawals", "GET", null, tok),
        adminFetch("/admin/p2p-transfers?limit=500", "GET", null, tok),
        adminFetch("/admin/intl-transfers", "GET", null, tok),
        adminFetch("/admin/kyc", "GET", null, tok),
        adminFetch("/admin/support/conversations", "GET", null, tok),
        adminFetch("/admin/users?limit=200", "GET", null, tok),
        adminFetch("/admin/settings/kobo-bank", "GET", null, tok),
        adminFetch("/admin/fiat-deposits?limit=100", "GET", null, tok),
        adminFetch("/admin/fiat-withdrawals?limit=100", "GET", null, tok),
        adminFetch("/admin/mobile-money-transfers?limit=200", "GET", null, tok),
        adminFetch("/admin/settings/payment-provider", "GET", null, tok),
        adminFetch("/admin/settings/withdrawal-threshold", "GET", null, tok),
        adminFetch("/admin/corridors", "GET", null, tok),
        adminFetch("/admin/settings/service-status", "GET", null, tok),
        adminFetch("/admin/payment-links/txs/pending-crypto", "GET", null, tok).catch(() => ({ items: [] })),
        adminFetch("/admin/crypto/chain-events?limit=200", "GET", null, tok).catch(() => ({ items: [], summary: [], runs: [] })),
      ]);
      setDeposits(dep.items || []);
      setWithdrawals(wit.items || []);
      setWallets(wal.items || []);
      setVirements(vir.items || []);
      setP2pTransfers(p2pData.items || []);
      setIntlTransfers(intl.items || []);
      setKyc(kycData.items || []);
      setConversations(convData.items || []);
      setUsers(usersData.items || []);
      setKoboBankForm({ beneficiary: bankSettings.beneficiary || "", iban: bankSettings.iban || "", bic: bankSettings.bic || "", bank: bankSettings.bank || "" });
      setPaymentProvider(providerSetting.provider || "sharepay");
      const thresh = thresholdSetting.amount_fcfa ?? 10000;
      setWithdrawalThreshold(thresh);
      setThresholdInput(String(thresh));
      setFiatDeposits(fiatDep.items || []);
      setFiatWithdrawals(fiatWit.items || []);
      setMobileMoneyTransfers(mmTransfers.items || []);
      setCorridors(corridorData.corridors || []);
      setPendingCryptoLinkTxs(pendingCrypto.items || []);
      setCryptoChainEvents({ items: chainEvents.items || [], summary: chainEvents.summary || [], runs: chainEvents.runs || [] });
      setServiceStatus({ withdrawals_enabled: svcStatus.withdrawals_enabled ?? true, deposits_enabled: svcStatus.deposits_enabled ?? true, withdrawals_message: svcStatus.withdrawals_message || "", deposits_message: svcStatus.deposits_message || "" });
      // Balance plateforme (réutilise analytics déjà chargé)
      adminFetch("/admin/analytics", "GET", null, tok)
        .then((a) => setPlatformBalance(a?.summary?.platform_revenue_fcfa ?? null))
        .catch(() => {});
      setAuthed(true);
    } catch (e) {
      if (e.status === 401 || e.status === 403 || e.message.includes("401") || e.message.includes("403")) {
        setAuthed(false);
        setToken("");
        localStorage.removeItem(ADMIN_TOKEN_KEY);
        localStorage.removeItem(ADMIN_ROLE_KEY);
        localStorage.removeItem(ADMIN_EMAIL_KEY);
        toast.error(e.status === 403 ? "Accès admin refusé." : "Session admin expirée. Reconnectez-vous.");
        return;
      }
      toast.error(e.message);
    } finally { setLoading(false); }
  };

  const handleLogin = (tok) => {
    setToken("");
    const r = localStorage.getItem(ADMIN_ROLE_KEY) || "superadmin";
    const e = localStorage.getItem(ADMIN_EMAIL_KEY) || "";
    setRole(r);
    setAdminEmail(e);
    setAuthed(true);
    load(tok);
  };

  const can = (perm) => hasPermission(role, perm);

  useEffect(() => { if (token) load(); }, [token]);
  useEffect(() => {
    const timer = window.setInterval(() => setHeaderNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  // Si l'onglet actif n'est pas accessible avec le rôle courant, revenir au premier accessible
  useEffect(() => {
    if (!role) return;
    const allowed = Object.keys(TAB_PERM_MAP).filter((id) => hasPermission(role, TAB_PERM_MAP[id]));
    if (allowed.length > 0 && !allowed.includes(activeTab)) setActiveTab(allowed[0]);
  }, [role]);

  const deleteWallet = (id) => setModal({
    title: "Supprimer cette adresse ?",
    description: "Cette action est irréversible.",
    variant: "danger",
    confirmLabel: "Supprimer",
    onConfirm: async () => {
      await adminFetch(`/admin/crypto/wallets/${id}`, "DELETE", null, token);
      toast.success("Supprimée"); load();
    },
  });

  const actionBtn = (label, icon, onClick, variant = "ghost") => (
    <button onClick={onClick} title={label} className={`h-7 px-2 rounded-md text-xs font-medium flex items-center gap-1 transition-colors ${variant === "success" ? "bg-green-500/10 text-green-600 hover:bg-green-500/20" : variant === "danger" ? "bg-red-500/10 text-red-600 hover:bg-red-500/20" : variant === "warning" ? "bg-orange-500/10 text-orange-500 hover:bg-orange-500/20" : "hover:bg-secondary text-muted-foreground hover:text-foreground"}`}>
      {icon}{label}
    </button>
  );

  const quickAction = async (url, method, body, successMsg) => {
    try { await adminFetch(url, method, body, token); toast.success(successMsg); load(); }
    catch (e) { toast.error(e.message); }
  };

  if (!authed || !token) {
    return <AdminLogin onLogin={handleLogin} />;
  }

  const pendingDeposits = deposits.filter((d) => ["submitted", "pending", "processing"].includes(d.status)).length;
  const pendingFiatDeposits = fiatDeposits.filter((d) => ["pending", "processing"].includes(d.status)).length;
  const pendingFiatWithdrawals = fiatWithdrawals.filter((w) => ["pending", "processing", "pending_approval"].includes(w.status)).length;
  const pendingMobileMoneyTransfers = mobileMoneyTransfers.filter((t) => ["payin_processing", "payout_processing", "payout_failed", "manual_review"].includes(t.status)).length;
  const pendingWithdrawals = withdrawals.filter((w) => w.status === "pending").length;
  const pendingAllDeposits = pendingFiatDeposits + pendingDeposits;
  const pendingAllWithdrawals = pendingFiatWithdrawals + pendingWithdrawals;
  const pendingVirements = virements.filter((v) => ["pending", "processing"].includes(v.status)).length;
  const p2pToday = p2pTransfers.filter((t) => t.created_at && new Date(t.created_at).toDateString() === new Date().toDateString()).length;
  const pendingIntl = intlTransfers.filter((t) => ["pending_payment", "pending_funding", "pending_settlement"].includes(t.status)).length;
  const pendingKyc = kyc.filter((k) => k.status === "in_review").length;
  const openTickets = conversations.filter((c) => !c.ticket_status || c.ticket_status === "open").length;
  const cryptoChainReviewCount = (cryptoChainEvents.summary || [])
    .filter((r) => ["manual_review", "unmatched", "invalid", "hash_verified"].includes(r.status))
    .reduce((sum, r) => sum + Number(r.count || 0), 0);

  const ALL_TABS = [
    { id: "balance",           label: "Solde",            icon: Banknote,       badge: 0,                      perm: "*" },
    { id: "analytics",        label: "Analytiques",       icon: BarChart2,      badge: 0,                      perm: "analytics" },
    { id: "accounting",       label: "Comptabilité",      icon: Database,       badge: 0,                      perm: "*" },
    { id: "balance-audit",    label: "Audit soldes",      icon: AlertCircle,    badge: 0,                      perm: "*" },
    { id: "activity",         label: "Activité",          icon: Activity,       badge: 0,                      perm: "view_activity" },
    { id: "fiat-deposits",    label: "Dépôts fiat",       icon: Landmark,       badge: pendingFiatDeposits,    perm: "confirm_deposit" },
    { id: "fiat-withdrawals", label: "Sorties MM/fiat",   icon: Send,           badge: pendingFiatWithdrawals, perm: "confirm_withdrawal" },
    { id: "mm-bridge",        label: "Transferts MM",     icon: Smartphone,     badge: pendingMobileMoneyTransfers, perm: "confirm_withdrawal" },
    { id: "p2p-transfers",    label: "Transferts P2P",    icon: ArrowLeftRight, badge: p2pToday,               perm: "view_activity" },
    { id: "virements",        label: "Virements",         icon: ArrowLeftRight, badge: pendingVirements,       perm: "confirm_withdrawal" },
    { id: "intl",             label: "Transferts intl",   icon: Globe,          badge: pendingIntl,            perm: "intl" },
    { id: "deposits",         label: "Dépôts crypto",     icon: ArrowDownToLine,badge: pendingDeposits,                   perm: "crypto_ops" },
    { id: "withdrawals",      label: "Retraits USDT",     icon: ArrowDownToLine,badge: pendingWithdrawals,                perm: "crypto_ops" },
    { id: "crypto-link-txs",  label: "Crypto liens",      icon: Bitcoin,         badge: pendingCryptoLinkTxs.length,      perm: "crypto_ops" },
    { id: "crypto-onchain",   label: "Événements on-chain", icon: Database,      badge: cryptoChainReviewCount,           perm: "crypto_ops" },
    { id: "users",            label: "Utilisateurs",      icon: Users,          badge: 0,                      perm: "view_users" },
    { id: "kyc",              label: "KYC",               icon: UserCheck,      badge: pendingKyc,             perm: "kyc_decide" },
    { id: "support",          label: "Support",           icon: MessageSquare,  badge: openTickets,            perm: "reply_ticket" },
    { id: "wallets",          label: "Adresses crypto",   icon: Wallet,         badge: 0,                      perm: "crypto_ops" },
    { id: "payment-links",    label: "Liens paiement",    icon: Link2,          badge: 0,                      perm: "*" },
    { id: "corridors",        label: "Pays / Corridors",  icon: ArrowLeftRight, badge: 0,                      perm: "*" },
    { id: "compliance",       label: "Conformité",        icon: ShieldCheck,    badge: 0,                      perm: "*" },
    { id: "fees",             label: "Frais",             icon: TrendingUp,     badge: 0,                      perm: "*" },
    { id: "marketing",        label: "Marketing",         icon: Megaphone,      badge: 0,                      perm: "*" },
    { id: "fraud",            label: "Fraude / Cron",     icon: AlertCircle,    badge: 0,                      perm: "fraud_review" },
    { id: "api",              label: "API",               icon: Key,            badge: 0,                      perm: "*" },
    { id: "audit",            label: "Journal",           icon: History,        badge: 0,                      perm: "*" },
    { id: "admin-sessions",   label: "Sessions admin",    icon: Lock,           badge: 0,                      perm: "*" },
    { id: "exports",          label: "Exports",           icon: Database,       badge: 0,                      perm: "*" },
    { id: "team",             label: "Équipe",            icon: UserCog,        badge: 0,                      perm: "*" },
    { id: "settings",         label: "Paramètres",        icon: Settings,       badge: 0,                      perm: "*" },
  ];
  const TABS = ALL_TABS.filter((t) => can(t.perm));

  const SIDEBAR_GROUPS = [
    { key: "overview", label: "Pilotage financier", icon: BarChart2, ids: ["balance", "analytics", "accounting", "balance-audit", "activity"] },
    { key: "money",    label: "Mouvements d'argent", icon: ArrowUpDown, ids: ["fiat-deposits", "fiat-withdrawals", "mm-bridge", "p2p-transfers", "virements", "intl"] },
    { key: "crypto",   label: "Crypto", icon: Bitcoin, ids: ["deposits", "withdrawals", "crypto-link-txs", "crypto-onchain", "wallets"] },
    { key: "clients",  label: "Clients & support", icon: Users, ids: ["users", "kyc", "support"] },
    { key: "control",  label: "Contrôle plateforme", icon: ShieldCheck, ids: ["payment-links", "corridors", "compliance", "fees", "marketing", "fraud", "api", "audit", "admin-sessions", "exports", "team", "settings"] },
  ];
  const currentTabMeta = TABS.find((t) => t.id === activeTab);
  const opsQueueCount = pendingAllDeposits + pendingAllWithdrawals + pendingMobileMoneyTransfers + pendingVirements + pendingIntl + pendingKyc + openTickets + pendingCryptoLinkTxs.length;
  const headerTime = headerNow.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const headerDate = headerNow.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short" });

  const STAT_CARDS = [
    { label: "Dépôts",    value: pendingAllDeposits, icon: ArrowDownToLine, color: "text-blue-500",   bg: "bg-blue-500/10",   tabTarget: pendingFiatDeposits > 0 ? "fiat-deposits" : "deposits" },
    { label: "Retraits",  value: pendingAllWithdrawals, icon: Send,         color: "text-orange-500", bg: "bg-orange-500/10", tabTarget: pendingFiatWithdrawals > 0 ? "fiat-withdrawals" : "withdrawals" },
    { label: "P2P jour",  value: p2pToday,           icon: ArrowLeftRight, color: "text-violet-500", bg: "bg-violet-500/10", tabTarget: "p2p-transfers" },
    { label: "Virements", value: pendingVirements,   icon: Landmark,       color: "text-yellow-500", bg: "bg-yellow-500/10", tabTarget: "virements" },
    { label: "Intl",      value: pendingIntl,        icon: ArrowLeftRight, color: "text-indigo-500", bg: "bg-indigo-500/10", tabTarget: "intl" },
    { label: "KYC",       value: pendingKyc,         icon: UserCheck,      color: "text-purple-500", bg: "bg-purple-500/10", tabTarget: "kyc" },
    { label: "Tickets",   value: openTickets,        icon: MessageSquare,  color: "text-pink-500",   bg: "bg-pink-500/10",   tabTarget: "support" },
  ];

  return (
    <div className="admin-ops-shell min-h-screen bg-background flex flex-col text-[16px] text-slate-950 dark:text-slate-100">
      {/* Modals */}
      <ActionModal modal={modal} onClose={() => setModal(null)} />
      {selectedDeposit && <ConfirmDepositModal deposit={selectedDeposit} token={token} onClose={() => setSelectedDeposit(null)} onDone={() => { setSelectedDeposit(null); load(); }} />}
      {walletModal !== null && <WalletModal wallet={walletModal === "new" ? null : walletModal} token={token} onClose={() => setWalletModal(null)} onDone={() => { setWalletModal(null); load(); }} />}
      {kycDecideUser && <KycDecideModal user={kycDecideUser} token={token} onClose={() => setKycDecideUser(null)} onDone={() => { setKycDecideUser(null); load(); }} />}
      {kycDocsUser && <KycDocsModal user={kycDocsUser} token={token} onClose={() => setKycDocsUser(null)} />}
      {selectedConv && <ConversationPanel conv={selectedConv} token={token} onClose={() => setSelectedConv(null)} onRefresh={load} />}
      {selectedUserId && <UserDetailModal userId={selectedUserId} token={token} onClose={() => setSelectedUserId(null)} onBlock={load} />}
      {usdtVerifyTransfer && (
        <UsdtVerifyModal
          transfer={usdtVerifyTransfer}
          token={token}
          onClose={() => setUsdtVerifyTransfer(null)}
          onConfirmed={() => { setUsdtVerifyTransfer(null); load(); toast.success("Paiement USDT confirmé — transfert en cours"); }}
        />
      )}
      {intlDetailTransfer && (
        <IntlTransferDetailModal
          transfer={intlDetailTransfer}
          token={token}
          onClose={() => setIntlDetailTransfer(null)}
          onAction={(action, t) => {
            if (action === "verify-usdt") setUsdtVerifyTransfer(t);
            else if (action === "confirm-payment") quickAction(`/admin/intl-transfers/${t.id}/confirm-payment`, "POST", null, "Paiement confirmé");
            else if (action === "complete") quickAction(`/admin/intl-transfers/${t.id}/complete`, "POST", null, "Transfert complété");
          }}
        />
      )}

      {/* Header */}
      <header className="admin-ops-header sticky top-0 z-20 border-b px-5 h-[72px] flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-3 shrink-0 min-w-[220px]">
          <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center shrink-0 shadow-sm ring-1 ring-blue-400/20">
            <Shield size={18} className="text-white" />
          </div>
          <div className="min-w-0">
            <div className="font-display text-[18px] font-extrabold text-slate-950 dark:text-slate-50 leading-tight">Kobo Ops</div>
            <div className="text-[13px] font-semibold text-slate-600 dark:text-slate-300 leading-tight truncate">
              {currentTabMeta?.label || "Dashboard"}
            </div>
          </div>
        </div>
        <GlobalSearch token={token} onSelectUser={(id) => setSelectedUserId(id)} />
        <div className="admin-ops-header-metrics hidden xl:flex items-center gap-3 shrink-0">
          <button
            onClick={() => opsQueueCount > 0 && setActiveTab(pendingFiatDeposits > 0 ? "fiat-deposits" : pendingFiatWithdrawals > 0 ? "fiat-withdrawals" : openTickets > 0 ? "support" : "accounting")}
            className="admin-header-pill h-10 min-w-[86px] px-3 rounded-lg border bg-surface hover:bg-secondary transition-colors text-left"
            title="File opérationnelle"
          >
            <span className="block text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 leading-none">File ops</span>
            <span className="block text-[16px] font-extrabold text-slate-950 dark:text-slate-50 leading-tight mt-1">{fmt(opsQueueCount)}</span>
          </button>
          <div className="admin-header-pill h-10 px-3 rounded-lg border bg-surface flex items-center gap-2.5 min-w-[116px]">
            <Clock size={16} className="text-slate-500 dark:text-slate-400" />
            <div className="leading-tight">
              <div className="text-[16px] font-extrabold text-slate-950 dark:text-slate-50">{headerTime}</div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase">{headerDate}</div>
            </div>
          </div>
          <div className="admin-header-pill h-10 px-3 rounded-lg border bg-surface flex items-center gap-2.5">
            <span className={`h-2.5 w-2.5 rounded-full ${loading ? "bg-amber-500 animate-pulse" : "bg-emerald-500"}`} />
            <div className="leading-tight">
              <div className="text-[13px] font-bold text-slate-950 dark:text-slate-50">{loading ? "Sync en cours" : "Ops en ligne"}</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">API + dashboard</div>
            </div>
          </div>
          {adminEmail && (
            <div className="admin-header-pill admin-admin-chip h-10 max-w-[220px] px-3 rounded-lg border bg-surface flex items-center gap-2.5">
              <UserCog size={16} className="text-slate-500 dark:text-slate-400 shrink-0" />
              <div className="min-w-0 leading-tight">
                <div className="text-[13px] font-bold truncate text-slate-950 dark:text-slate-50">{adminEmail}</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Administrateur</div>
              </div>
            </div>
          )}
        </div>
        <button onClick={() => load()} className="admin-header-pill h-10 w-10 rounded-lg hover:bg-secondary flex items-center justify-center shrink-0 border bg-surface" disabled={loading} title="Rafraîchir">
          <RefreshCw size={17} className={loading ? "animate-spin" : ""} />
        </button>
      </header>

      {/* Body: sidebar + content */}
      <div className="admin-ops-body flex flex-1 min-h-0 h-[calc(100vh-78px)] overflow-hidden">

        {/* Left sidebar */}
        <aside className={`admin-ops-sidebar hidden md:flex flex-col shrink-0 self-stretch border-r transition-all duration-200 overflow-hidden ${sidebarCollapsed ? "w-16" : "w-[280px]"}`}>
          {/* Toggle button */}
          <div className={`flex items-center border-b border-white/10 shrink-0 h-10 ${sidebarCollapsed ? "justify-center" : "justify-end px-2"}`}>
            <button
              onClick={() => {
                const next = !sidebarCollapsed;
                setSidebarCollapsed(next);
                try { localStorage.setItem("admin_sidebar_collapsed", next ? "1" : "0"); } catch {}
              }}
              className="h-8 w-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-slate-300 transition-colors"
              title={sidebarCollapsed ? "Ouvrir le menu" : "Réduire le menu"}
            >
              {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            </button>
          </div>

          <nav className="admin-sidebar-nav flex-1 min-h-0 py-3 overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-width:thin]">
            {SIDEBAR_GROUPS.map((group) => {
              const groupTabs = group.ids
                .map((id) => TABS.find((t) => t.id === id))
                .filter(Boolean);
              if (groupTabs.length === 0) return null;
              const groupBadge = groupTabs.reduce((s, t) => s + (t.badge || 0), 0);
              const isGroupActive = groupTabs.some((t) => t.id === activeTab);
              const isOpen = sidebarCollapsed || sidebarGroupsOpen[group.key] || isGroupActive;
              const GroupIcon = group.icon;
              return (
                <div key={group.key} className="mb-1.5">
                  {!sidebarCollapsed && (
                    <button
                      type="button"
                      onClick={() => setSidebarGroupsOpen((prev) => ({ ...prev, [group.key]: !prev[group.key] }))}
                      className={`admin-sidebar-group w-[calc(100%-16px)] mx-2 flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors ${
                        isGroupActive ? "bg-blue-50 text-blue-700" : "hover:bg-slate-100 text-slate-600"
                      }`}
                    >
                      <GroupIcon size={15} className="shrink-0" />
                      <span className="flex-1 text-[11px] font-bold uppercase tracking-[0.08em] truncate">{group.label}</span>
                      {groupBadge > 0 && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500 text-white tabular-nums">
                          {groupBadge > 99 ? "99+" : groupBadge}
                        </span>
                      )}
                      <ChevronDown size={14} className={`transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </button>
                  )}
                  {sidebarCollapsed && groupBadge > 0 && <div className="h-2" />}
                  <div className={`${isOpen ? "block" : "hidden"} mt-1 space-y-1 ${sidebarCollapsed ? "px-2" : "px-3"}`}>
                    {groupTabs.map(({ id, label, icon: Icon, badge }) => {
                      const isActive = activeTab === id;
                      return (
                        <button
                          key={id}
                          onClick={() => setActiveTab(id)}
                          title={sidebarCollapsed ? label : undefined}
                          className={`admin-sidebar-item w-full flex items-center rounded-lg text-[14px] transition-colors text-left group
                            ${sidebarCollapsed ? "justify-center h-10 px-0" : "gap-2.5 px-3 py-2"}
                            ${isActive
                              ? "bg-primary text-white font-bold shadow-sm"
                              : "text-slate-700 hover:text-slate-950 hover:bg-slate-100"
                            }`}
                        >
                          <div className="relative shrink-0">
                            <Icon size={16} />
                            {sidebarCollapsed && badge > 0 && (
                              <span className="absolute -top-1 -right-1 h-3 min-w-[12px] px-0.5 rounded-full bg-red-500 text-white text-[8px] font-bold flex items-center justify-center">
                                {badge > 9 ? "9+" : badge}
                              </span>
                            )}
                          </div>
                          {!sidebarCollapsed && (
                            <>
                              <span className="flex-1 truncate leading-none font-medium">{label}</span>
                              {badge > 0 && (
                                <span className={`text-[10px] font-bold min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center shrink-0 tabular-nums ${
                                  isActive ? "bg-white/25 text-white" : "bg-red-500 text-white"
                                }`}>
                                  {badge > 99 ? "99+" : badge}
                                </span>
                              )}
                            </>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <div className="h-3" />
          </nav>
          <div className={`py-2 border-t border-border shrink-0 bg-white ${sidebarCollapsed ? "px-1" : "px-2"}`}>
            <button
              onClick={async () => { await fetch(`${API}/admin/auth/logout`, { method: "POST", credentials: "include", headers: { "X-CSRF-Token": csrfHeader() } }).catch(() => {}); localStorage.removeItem(ADMIN_TOKEN_KEY); setToken(""); setAuthed(false); }}
              title={sidebarCollapsed ? "Déconnexion" : undefined}
              className={`w-full flex items-center rounded-md text-sm text-slate-600 hover:text-destructive hover:bg-red-50 transition-colors
                ${sidebarCollapsed ? "justify-center h-10 px-0" : "gap-2 px-3 py-2.5"}`}
            >
              <LogOut size={16} className="shrink-0" />
              {!sidebarCollapsed && <span>Déconnexion</span>}
            </button>
          </div>
        </aside>

        {/* Mobile tab bar (top scrollable, only on small screens) */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 z-10 bg-background border-t border-border flex overflow-x-auto scrollbar-none shadow-[0_-8px_24px_rgba(15,23,42,0.08)]">
          {TABS.map(({ id, label, icon: Icon, badge }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex flex-col items-center justify-center gap-1 px-3 py-2 shrink-0 relative min-w-[86px] ${activeTab === id ? "text-primary font-semibold" : "text-slate-600 dark:text-slate-300"}`}
            >
              <Icon size={18} />
              <span className="text-[11px] leading-none truncate max-w-[76px]">{label}</span>
              {badge > 0 && (
                <span className="absolute top-1 right-1 h-4 min-w-[14px] px-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                  {badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Main content */}
        <main className="flex-1 min-w-0 min-h-0 overflow-y-auto pb-16 md:pb-0">
          {/* Stat cards */}
          <div className="admin-stat-grid grid gap-3 p-4">
            {STAT_CARDS.map(({ label, value, icon: Icon, color, bg, tabTarget }) => (
              <button
                key={label}
                onClick={() => setActiveTab(tabTarget)}
                className={`admin-stat-card rounded-xl p-3 text-left hover:ring-1 hover:ring-blue-200 transition-all ${activeTab === tabTarget ? "ring-1 ring-primary bg-primary/5" : "bg-white"}`}
              >
                <div className={`h-7 w-7 rounded-lg ${bg} flex items-center justify-center mb-1.5`}>
                  <Icon size={14} className={color} />
                </div>
                <p className="text-lg font-bold">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </button>
            ))}
          </div>

          <div className="px-4 pb-4">

        {/* ── Analytics ───────────────────────────────────────────────────── */}
        {activeTab === "balance" && <PlatformBalanceTab token={token} />}
        {activeTab === "analytics" && <AnalyticsTab token={token} />}
        {activeTab === "accounting" && <AccountingTab token={token} onViewUser={(id) => setSelectedUserId(id)} />}
        {activeTab === "balance-audit" && <BalanceAuditTab token={token} onViewUser={(id) => setSelectedUserId(id)} />}

        {/* ── Activité ────────────────────────────────────────────────────── */}
        {activeTab === "activity" && <ActivityFeedTab token={token} />}

        {/* ── Utilisateurs ────────────────────────────────────────────────── */}
        {activeTab === "users" && (
          <UsersTab token={token} onViewUser={(id) => setSelectedUserId(id)} />
        )}

        {/* ── Dépôts ──────────────────────────────────────────────────────── */}
        {activeTab === "deposits" && (
          <DataTable
            data={deposits}
            searchFields={["phone_e164", "user_id", "network", "tx_hash"]}
            emptyText="Aucun dépôt"
            exportFilename="kobo-depots.csv"
            columns={[
              { key: "created_at", label: "Date", sortable: true, render: (v) => <span className="text-xs text-muted-foreground">{fmtDate(v)}</span> },
              { key: "phone_e164", label: "Utilisateur", sortable: true, render: (v, row) => <span className="font-medium">{v || row.user_id}</span> },
              { key: "network",    label: "Réseau",      sortable: true, render: (v) => <span className="font-mono text-xs bg-secondary px-1.5 py-0.5 rounded">{v}</span> },
              { key: "amount_usdt",label: "USDT",        sortable: true, render: (v) => <span className="font-semibold">{v}</span> },
              { key: "amount_xaf", label: "FCFA",        sortable: true, render: (v) => <span>{fmt(v)}</span> },
              { key: "status",              label: "Statut",      sortable: true, render: (v) => <StatusBadge status={v} /> },
              { key: "verification_status", label: "Blockchain",  render: (v) => v ? <StatusBadge status={v} /> : <span className="text-xs text-muted-foreground">—</span> },
              { key: "tx_hash",             label: "TX Hash",     render: (v) => <span className="font-mono text-xs text-muted-foreground max-w-[100px] truncate block">{v || "—"}</span> },
            ]}
            actions={(r) => (
              <>
                {r.verification_status === "auto_confirmed"
                  ? <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1"><CheckCircle size={12} />Auto-vérifié</span>
                  : r.status === "submitted" || r.verification_status === "hash_verified"
                    ? <>{actionBtn("Confirmer", <CheckCircle size={12} />, () => setSelectedDeposit(r), "success")}{actionBtn("Rejeter", <XCircle size={12} />, () => setSelectedDeposit(r), "danger")}</>
                    : null}
                {actionBtn("Forcer statut", <SlidersHorizontal size={12} />, () => setModal({
                  title: "Forcer le statut — Dépôt crypto",
                  description: `Statut actuel : "${r.status}".`,
                  variant: "warning", icon: <SlidersHorizontal size={20} />, confirmLabel: "Forcer",
                  inputs: [
                    { key: "status", label: "Nouveau statut", type: "select", required: true,
                      options: ["submitted","confirmed","rejected","failed"].map((s) => ({ value: s, label: s })) },
                    { key: "note", label: "Note admin", placeholder: "Raison..." },
                  ],
                  onConfirm: async (v) => { await quickAction(`/admin/crypto/deposits/${r.deposit_id}/force-status`, "PATCH", { status: v.status, note: v.note || "" }, `Statut forcé → ${v.status}`); },
                }), "warning")}
              </>
            )}
          />
        )}

        {/* ── Dépôts Fiat ─────────────────────────────────────────────────── */}
        {activeTab === "fiat-deposits" && (
          <DataTable
            data={fiatDeposits}
            searchFields={["phone_e164", "user_id", "reference", "provider"]}
            emptyText="Aucun dépôt fiat"
            exportFilename="kobo-depots-fiat.csv"
            columns={[
              { key: "created_at", label: "Date",        sortable: true, render: (v) => <span className="text-xs text-muted-foreground">{fmtDate(v)}</span> },
              { key: "phone_e164", label: "Utilisateur", sortable: true, render: (v, row) => <span className="font-medium">{v || row.user_id}</span> },
              { key: "method",     label: "Méthode",     sortable: true, render: (v, row) => (
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${v === "mobile_money" ? "bg-yellow-500/10 text-yellow-400" : "bg-blue-500/10 text-blue-400"}`}>
                    {v === "mobile_money" ? `MM · ${(row.provider || "").toUpperCase()}` : "Virement"}
                  </span>
                )
              },
              { key: "amount",     label: "Montant",     sortable: true, render: (v, row) => <span className="font-semibold">{fmt(v)} {row.currency}</span> },
              { key: "reference",   label: "Référence",    render: (v) => <span className="font-mono text-xs text-muted-foreground">{v || "—"}</span> },
              { key: "sender_iban", label: "IBAN expéd.", render: (v, row) => v
                  ? <span className="font-mono text-xs text-blue-400">{v} {row.sender_name ? `· ${row.sender_name}` : ""}</span>
                  : <span className="text-xs text-muted-foreground">—</span>
              },
              { key: "status",     label: "Statut",      sortable: true, render: (v) => <StatusBadge status={v} /> },
            ]}
            actions={(r) => (
              <>
                {r.status === "pending" && <>
                  {actionBtn("Confirmer", <CheckCircle size={12} />, () => setModal({
                    title: "Confirmer le dépôt fiat",
                    description: `Créditer ${fmt(r.amount)} ${r.currency} sur le compte de ${r.email || r.phone_e164} ?`,
                    variant: "success", icon: <CheckCircle size={20} />, confirmLabel: "Confirmer le dépôt",
                    inputs: [{ key: "note", label: "Note (optionnel)", placeholder: "ex: virement reçu le..." }],
                    onConfirm: async (v) => { await quickAction(`/admin/fiat-deposits/${r.id}/confirm`, "POST", { note: v.note || "" }, "Dépôt confirmé"); },
                  }), "success")}
                  {actionBtn("Rejeter", <XCircle size={12} />, () => setModal({
                    title: "Rejeter le dépôt",
                    description: `Rejeter le dépôt de ${fmt(r.amount)} ${r.currency} ?`,
                    variant: "danger", icon: <XCircle size={20} />, confirmLabel: "Rejeter",
                    inputs: [{ key: "reject_reason", label: "Motif du rejet", placeholder: "Raison...", required: true }],
                    onConfirm: async (v) => { await quickAction(`/admin/fiat-deposits/${r.id}/reject`, "POST", { reject_reason: v.reject_reason }, "Dépôt rejeté"); },
                  }), "danger")}
                </>}
                {actionBtn("Forcer statut", <SlidersHorizontal size={12} />, () => setModal({
                  title: "Forcer le statut — Dépôt fiat",
                  description: `Statut actuel : "${r.status}". Si vous passez à "completed" depuis un état non-complété, le solde sera crédité.`,
                  variant: "warning", icon: <SlidersHorizontal size={20} />, confirmLabel: "Forcer",
                  inputs: [
                    { key: "status", label: "Nouveau statut", type: "select", required: true,
                      options: ["pending","processing","completed","failed","rejected"].map((s) => ({ value: s, label: s })) },
                    { key: "note", label: "Note admin", placeholder: "Raison..." },
                  ],
                  onConfirm: async (v) => { await quickAction(`/admin/fiat-deposits/${r.id}/force-status`, "PATCH", { status: v.status, note: v.note || "" }, `Statut forcé → ${v.status}`); },
                }), "warning")}
              </>
            )}
          />
        )}

        {/* ── Sorties Mobile Money / Fiat ──────────────────────────────────── */}
        {activeTab === "fiat-withdrawals" && (() => {
          const fw = fiatWithdrawals;
          const approval  = fw.filter((w) => w.status === "pending_approval");
          const filtered = fiatWFilter === "all"
            ? fw
            : fiatWFilter === "pending"
              ? fw.filter((w) => ["pending", "processing"].includes(w.status))
              : fw.filter((w) => w.status === fiatWFilter);
          const pending   = fw.filter((w) => ["pending", "processing"].includes(w.status));
          const completed = fw.filter((w) => w.status === "completed");
          const failed    = fw.filter((w) => w.status === "failed");
          const sumAmt    = (arr) => arr.reduce((s, w) => s + (w.total_debit || w.amount || 0), 0);
          const STATUS_FILTERS = [
            { id: "all",              label: "Tous",            count: fw.length },
            { id: "pending_approval", label: "A valider",       count: approval.length, highlight: true },
            { id: "pending",          label: "En attente",      count: pending.length },
            { id: "completed",        label: "Complétés",       count: completed.length },
            { id: "failed",           label: "Échoués",         count: failed.length },
            { id: "rejected",         label: "Rejetés",         count: fw.filter((w) => w.status === "rejected").length },
          ];
          return (
            <div className="space-y-5">
              {/* Stats cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {/* Solde Kobo */}
                <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl p-4 text-white col-span-2 sm:col-span-1">
                  <p className="text-xs opacity-75 mb-1 uppercase tracking-wide">Solde Kobo</p>
                  <p className="text-2xl font-extrabold">
                    {platformBalance !== null ? platformBalance.toLocaleString("fr") : "—"}
                    <span className="text-sm font-normal opacity-80 ml-1">FCFA</span>
                  </p>
                </div>
                {[
                  { label: "En attente", count: pending.length, amount: sumAmt(pending), color: "text-yellow-500", bg: "bg-yellow-500/10" },
                  { label: "Complétés",  count: completed.length, amount: sumAmt(completed), color: "text-green-500", bg: "bg-green-500/10" },
                  { label: "Échoués",    count: failed.length, amount: sumAmt(failed), color: "text-red-500", bg: "bg-red-500/10" },
                ].map(({ label, count, amount, color, bg }) => (
                  <div key={label} className={`${bg} rounded-xl p-4 border border-border`}>
                    <p className={`text-xs ${color} font-semibold mb-1`}>{label}</p>
                    <p className="text-xl font-bold">{count}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{fmt(Math.round(amount))} FCFA</p>
                  </div>
                ))}
              </div>

              {/* Alerte retraits à valider */}
              {approval.length > 0 && (
                <div className="flex items-center gap-3 rounded-xl bg-amber-500/10 border border-amber-400/30 px-4 py-3">
                  <ShieldCheck size={18} className="text-amber-500 shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                      {approval.length} retrait{approval.length > 1 ? "s" : ""} en attente de validation
                    </p>
                  <p className="text-xs text-muted-foreground">Montant total : {fmt(sumAmt(approval))} FCFA — Ces transferts Mobile Money dépassent le seuil d'approbation automatique.</p>
                  </div>
                  <button onClick={() => setFiatWFilter("pending_approval")}
                    className="text-xs font-semibold text-amber-600 dark:text-amber-400 underline underline-offset-2 shrink-0">
                    Voir
                  </button>
                </div>
              )}

              {/* Filtres statut */}
              <div className="flex gap-2 flex-wrap">
                {STATUS_FILTERS.map(({ id, label, count, highlight }) => (
                  <button key={id} onClick={() => setFiatWFilter(id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                      fiatWFilter === id
                        ? "bg-primary text-primary-foreground border-primary"
                        : highlight && count > 0
                          ? "border-amber-400/50 text-amber-600 dark:text-amber-400 bg-amber-500/5 hover:bg-amber-500/10"
                          : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                    }`}>
                    {label} <span className="opacity-60">({count})</span>
                  </button>
                ))}
              </div>

              {/* DataTable enrichi */}
              <DataTable
                data={filtered}
                searchFields={["phone_e164", "email", "recipient_name", "recipient_iban", "recipient_phone", "reference", "notchpay_txid"]}
                emptyText="Aucune sortie Mobile Money / fiat"
                exportFilename="kobo-sorties-mobile-money-fiat.csv"
                columns={[
                  { key: "created_at",     label: "Date",          sortable: true,
                    render: (v) => <span className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(v)}</span> },
                  { key: "phone_e164",     label: "Utilisateur",   sortable: true,
                    render: (v, row) => (
                      <div>
                        <p className="font-medium text-sm">{row.email || v}</p>
                        {row.email && v !== row.email && <p className="text-xs text-muted-foreground">{v}</p>}
                      </div>
                    )
                  },
                  { key: "method",         label: "Méthode",
                    render: (v, row) => (
                      <div className="space-y-0.5">
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${v === "mobile_money" ? "bg-yellow-500/10 text-yellow-400" : "bg-blue-500/10 text-blue-400"}`}>
                          {v === "mobile_money" ? `MM · ${(row.provider || "").toUpperCase()}` : "Virement"}
                        </span>
                      </div>
                    )
                  },
                  { key: "amount",         label: "Montant net",   sortable: true,
                    render: (v, row) => <span className="font-semibold text-sm">{fmt(v)} <span className="text-xs text-muted-foreground">{row.currency}</span></span> },
                  { key: "fee_fcfa",       label: "Frais",
                    render: (v) => <span className="text-xs text-muted-foreground">{v > 0 ? `${fmt(v)} FCFA` : "—"}</span> },
                  { key: "total_debit",    label: "Total débité",  sortable: true,
                    render: (v, row) => <span className="font-bold text-sm text-red-500">−{fmt(v || row.amount)} FCFA</span> },
                  { key: "recipient_name", label: "Bénéficiaire",
                    render: (v, row) => (
                      <div>
                        <p className="text-sm font-medium">{v}</p>
                        <p className="font-mono text-xs text-muted-foreground truncate max-w-[140px]">
                          {row.recipient_iban || row.recipient_phone || "—"}
                        </p>
                      </div>
                    )
                  },
                  { key: "reference",      label: "Référence",
                    render: (v, row) => (
                      <div className="space-y-0.5">
                        <p className="font-mono text-xs">{v || "—"}</p>
                        {row.notchpay_txid && <p className="font-mono text-xs text-muted-foreground">{row.notchpay_txid}</p>}
                      </div>
                    )
                  },
                  { key: "kyc_level_at_request", label: "KYC",
                    render: (v, row) => (
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${(v || row.kyc_level) >= 1 ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
                        Niv.{v || row.kyc_level || 0}
                      </span>
                    )
                  },
                  { key: "status",         label: "Statut",        sortable: true,
                    render: (v, row) => (
                      <div className="space-y-0.5">
                        <StatusBadge status={v} />
                        {(row.note || row.reject_reason) && (
                          <p className="text-xs text-muted-foreground max-w-[160px] truncate" title={row.note || row.reject_reason}>
                            {row.note || row.reject_reason}
                          </p>
                        )}
                      </div>
                    )
                  },
                ]}
                actions={(r) => (
                  <>
                    {actionBtn("Profil", <Eye size={12} />, () => setSelectedUserId(r.user_id))}
                    {r.status === "pending_approval" && can("confirm_withdrawal") && <>
                      {actionBtn("Approuver", <ShieldCheck size={12} />, () => setModal({
                        title: "Approuver ce transfert Mobile Money",
                        description: `Approuver l'envoi de ${fmt(r.amount)} FCFA vers ${r.recipient_name} (${r.recipient_phone || ""}) via ${(r.provider || "").toUpperCase()} ? Le paiement sera déclenché immédiatement.`,
                        variant: "success", icon: <ShieldCheck size={20} />, confirmLabel: "Approuver et envoyer",
                        inputs: [{ key: "note", label: "Note admin (optionnel)", placeholder: "ex: vérifié manuellement" }],
                        onConfirm: async (v) => { await quickAction(`/admin/fiat-withdrawals/${r.id}/approve`, "POST", { note: v.note || "" }, "Transfert approuvé — paiement déclenché"); },
                      }), "success")}
                      {actionBtn("Rejeter", <XCircle size={12} />, () => setModal({
                        title: "Rejeter et rembourser",
                        description: `Rejeter et rembourser ${fmt(r.total_debit || r.amount)} FCFA à l'utilisateur ?`,
                        variant: "danger", icon: <XCircle size={20} />, confirmLabel: "Rejeter et rembourser",
                        inputs: [{ key: "reject_reason", label: "Motif du refus", placeholder: "Raison...", required: true }],
                        onConfirm: async (v) => { await quickAction(`/admin/fiat-withdrawals/${r.id}/reject`, "POST", { reject_reason: v.reject_reason }, "Transfert refusé — remboursé"); },
                      }), "danger")}
                    </>}
                    {["pending", "processing"].includes(r.status) && can("confirm_withdrawal") && <>
                      {/* Mobile Money avec txid = géré auto par SharePay, pas besoin de confirmer manuellement */}
                      {(r.method !== "mobile_money" || !r.notchpay_txid) && actionBtn("Confirmer", <CheckCircle size={12} />, () => setModal({
                        title: "Confirmer le retrait",
                        description: `Confirmer l'envoi de ${fmt(r.amount)} FCFA vers ${r.recipient_name} (${r.recipient_phone || r.recipient_iban || ""}) ?`,
                        variant: "success", icon: <CheckCircle size={20} />, confirmLabel: "Confirmer le retrait",
                        inputs: [{ key: "note", label: "Note (optionnel)", placeholder: "ex: virement effectué le..." }],
                        onConfirm: async (v) => { await quickAction(`/admin/fiat-withdrawals/${r.id}/confirm`, "POST", { note: v.note || "" }, "Retrait confirmé"); },
                      }), "success")}
                      {r.method === "mobile_money" && r.notchpay_txid && (
                        <span className="text-xs text-muted-foreground italic px-1">Paiement auto en cours…</span>
                      )}
                      {actionBtn("Rejeter", <XCircle size={12} />, () => setModal({
                        title: "Rejeter le retrait",
                        description: `Rejeter et rembourser ${fmt(r.total_debit || r.amount)} FCFA à l'utilisateur ?`,
                        variant: "danger", icon: <XCircle size={20} />, confirmLabel: "Rejeter et rembourser",
                        inputs: [{ key: "reject_reason", label: "Motif du refus", placeholder: "Raison...", required: true }],
                        onConfirm: async (v) => { await quickAction(`/admin/fiat-withdrawals/${r.id}/reject`, "POST", { reject_reason: v.reject_reason }, "Retrait refusé — remboursé"); },
                      }), "danger")}
                    </>}
                    {/* Retry paiement : mobile_money sans txid bloqué, échoué, ou complété manuellement sans paiement réel */}
                    {r.method === "mobile_money" && !r.notchpay_txid && ["completed", "failed", "processing"].includes(r.status) && can("confirm_withdrawal") &&
                      actionBtn("Réessayer paiement", <RefreshCw size={12} />, () => setModal({
                        title: "Réessayer le paiement Mobile Money",
                        description: `Déclencher un nouveau paiement SharePay de ${fmt(r.amount)} FCFA vers ${r.recipient_name} (${r.recipient_phone || ""}) via ${(r.provider || "").toUpperCase()} ?`,
                        variant: "warning", icon: <RefreshCw size={20} />, confirmLabel: "Réessayer le paiement",
                        onConfirm: async () => { await quickAction(`/admin/fiat-withdrawals/${r.id}/retry-payout`, "POST", null, "Paiement relancé — en cours via SharePay"); },
                      }), "warning")
                    }
                    {can("force_status") && actionBtn("Forcer statut", <SlidersHorizontal size={12} />, () => setModal({
                      title: "Forcer le statut",
                      description: `Statut actuel : "${r.status}". Un remboursement sera effectué si on passe à "rejected" ou "failed" depuis un état non-remboursé.`,
                      variant: "warning", icon: <SlidersHorizontal size={20} />, confirmLabel: "Forcer le statut",
                      inputs: [
                        { key: "status", label: "Nouveau statut", type: "select", required: true,
                          options: ["pending","processing","completed","failed","rejected"].map((s) => ({ value: s, label: s })) },
                        { key: "note", label: "Note admin", placeholder: "Raison de cette modification..." },
                      ],
                      onConfirm: async (v) => { await quickAction(`/admin/fiat-withdrawals/${r.id}/force-status`, "PATCH", { status: v.status, note: v.note || "" }, `Statut forcé → ${v.status}`); },
                    }), "warning")}
                  </>
                )}
              />
            </div>
          );
        })()}

        {/* ── Retraits USDT ────────────────────────────────────────────────── */}
        {activeTab === "withdrawals" && (
          <DataTable
            data={withdrawals}
            searchFields={["user_email", "phone_e164", "destination_address", "network"]}
            emptyText="Aucun retrait"
            exportFilename="kobo-retraits-usdt.csv"
            columns={[
              { key: "created_at",          label: "Date",        sortable: true, render: (v) => <span className="text-xs text-muted-foreground">{fmtDate(v)}</span> },
              { key: "user_email",          label: "Utilisateur", sortable: true, render: (v) => <span className="font-medium">{v}</span> },
              { key: "network",             label: "Réseau",      sortable: true, render: (v) => <span className="font-mono text-xs bg-secondary px-1.5 py-0.5 rounded uppercase">{v}</span> },
              { key: "amount_usdt",         label: "USDT",        sortable: true, render: (v) => <span className="font-semibold">{v}</span> },
              { key: "destination_address", label: "Adresse",     render: (v) => <span className="font-mono text-xs text-muted-foreground max-w-[100px] truncate block">{v}</span> },
              { key: "status",              label: "Statut",      sortable: true, render: (v) => <StatusBadge status={v} /> },
            ]}
            actions={(r) => (
              <>
                {r.status === "pending" && <>
                  {actionBtn("Envoyé", <CheckCircle size={12} />, () => setModal({
                    title: "Confirmer le retrait crypto",
                    description: `Marquer le retrait de ${r.amount_usdt} USDT comme envoyé ?`,
                    variant: "success", confirmLabel: "Marquer envoyé",
                    inputs: [{ key: "tx_hash", label: "Hash de la transaction", placeholder: "0x...", required: true }],
                    onConfirm: async (v) => { await quickAction(`/admin/crypto/withdrawals/${r.withdrawal_id}/complete`, "POST", { tx_hash: v.tx_hash }, "Complété"); },
                  }), "success")}
                  {actionBtn("Rejeter", <XCircle size={12} />, () => setModal({
                    title: "Rejeter le retrait crypto",
                    variant: "danger", confirmLabel: "Rejeter",
                    inputs: [{ key: "reason", label: "Motif", placeholder: "Raison...", required: true }],
                    onConfirm: async (v) => { await quickAction(`/admin/crypto/withdrawals/${r.withdrawal_id}/reject`, "POST", { reason: v.reason }, "Rejeté"); },
                  }), "danger")}
                </>}
                {actionBtn("Forcer statut", <SlidersHorizontal size={12} />, () => setModal({
                  title: "Forcer le statut — Retrait USDT",
                  description: `Statut actuel : "${r.status}".`,
                  variant: "warning", icon: <SlidersHorizontal size={20} />, confirmLabel: "Forcer",
                  inputs: [
                    { key: "status", label: "Nouveau statut", type: "select", required: true,
                      options: ["pending","processing","completed","rejected","failed"].map((s) => ({ value: s, label: s })) },
                    { key: "note", label: "Note admin", placeholder: "Raison..." },
                  ],
                  onConfirm: async (v) => { await quickAction(`/admin/crypto/withdrawals/${r.withdrawal_id}/force-status`, "PATCH", { status: v.status, note: v.note || "" }, `Statut forcé → ${v.status}`); },
                }), "warning")}
              </>
            )}
          />
        )}

        {activeTab === "mm-bridge" && (() => {
          const rows = mobileMoneyTransfers;
          const payin = rows.filter((t) => ["payin_processing", "pending_payin"].includes(t.status));
          const payout = rows.filter((t) => t.status === "payout_processing");
          const failed = rows.filter((t) => ["payin_failed", "payout_failed"].includes(t.status));
          const completed = rows.filter((t) => t.status === "completed");
          const sum = (arr, key = "amount_fcfa") => arr.reduce((s, t) => s + Number(t[key] || 0), 0);
          const retryPayout = async (row) => {
            try {
              await adminFetch(`/admin/mobile-money-transfers/${row.id}/retry-payout`, "POST", null, token);
              toast.success("Envoi bénéficiaire relancé");
              load();
            } catch (e) {
              toast.error(e.message || "Relance impossible");
            }
          };
          const markRefunded = async (row) => {
            const note = window.prompt("Note de remboursement", "Remboursement manuel confirmé");
            if (note === null) return;
            try {
              await adminFetch(`/admin/mobile-money-transfers/${row.id}/mark-refunded`, "POST", { status: "refunded", note }, token);
              toast.success("Transfert marqué remboursé");
              load();
            } catch (e) {
              toast.error(e.message || "Mise à jour impossible");
            }
          };
          return (
            <div className="space-y-5">
              <div>
                <h1 className="text-xl font-bold tracking-tight">Transferts Mobile Money directs</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  MTN/Orange vers MTN/Orange sans débit du wallet Kobo. Le rapprochement suit le paiement source, l'envoi bénéficiaire, les frais Kobo et les cas à régulariser.
                </p>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                {[
                  { label: "Source en attente", value: payin.length, sub: `${fmt(sum(payin, "payin_total_fcfa"))} FCFA`, color: "text-blue-600", bg: "bg-blue-500/10" },
                  { label: "Envoi en cours", value: payout.length, sub: `${fmt(sum(payout))} FCFA`, color: "text-yellow-600", bg: "bg-yellow-500/10" },
                  { label: "Complétés", value: completed.length, sub: `${fmt(sum(completed))} FCFA`, color: "text-green-600", bg: "bg-green-500/10" },
                  { label: "À régulariser", value: failed.length, sub: `${fmt(sum(failed))} FCFA`, color: "text-red-600", bg: "bg-red-500/10" },
                  { label: "Frais Kobo", value: fmt(sum(completed, "fee_fcfa")), sub: "FCFA encaissés", color: "text-purple-600", bg: "bg-purple-500/10" },
                ].map((card) => (
                  <div key={card.label} className={`${card.bg} border border-border rounded-xl p-4`}>
                    <p className={`text-xs font-semibold ${card.color}`}>{card.label}</p>
                    <p className="text-2xl font-extrabold mt-1">{card.value}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{card.sub}</p>
                  </div>
                ))}
              </div>

              <DataTable
                data={rows}
                searchFields={["id", "user_email", "source_phone", "dest_phone", "dest_name", "payin_reference", "payin_provider_reference", "payout_reference", "payout_provider_reference", "status"]}
                emptyText="Aucun transfert Mobile Money direct"
                exportFilename="kobo-transferts-mobile-money-directs.csv"
                tableTitle="Transferts Mobile Money directs"
                expandable
                columns={[
                  { key: "created_at", label: "Date", sortable: true, render: (v) => <span className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(v)}</span> },
                  { key: "user_email", label: "Utilisateur", sortable: true, render: (v, row) => (
                    <div>
                      <p className="font-semibold text-sm">{v || row.user_id}</p>
                      <p className="font-mono text-xs text-muted-foreground">{row.id}</p>
                    </div>
                  ) },
                  { key: "source_provider", label: "Source", render: (v, row) => (
                    <div>
                      <p className="font-semibold text-sm">{String(v).toUpperCase()}</p>
                      <p className="font-mono text-xs text-muted-foreground">{row.source_phone}</p>
                      {row.payer_name && <p className="text-xs text-muted-foreground">{row.payer_name}</p>}
                    </div>
                  ) },
                  { key: "dest_provider", label: "Bénéficiaire", render: (v, row) => (
                    <div>
                      <p className="font-semibold text-sm">{row.dest_name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{String(v).toUpperCase()} · {row.dest_phone}</p>
                    </div>
                  ) },
                  { key: "amount_fcfa", label: "Reçu bénéficiaire", sortable: true, render: (v) => <span className="font-bold">{fmt(v)} FCFA</span> },
                  { key: "fee_fcfa", label: "Frais Kobo", sortable: true, render: (v) => <span className="font-semibold text-purple-600">{fmt(v)} FCFA</span> },
                  { key: "payin_total_fcfa", label: "Payé source", sortable: true, render: (v) => <span className="font-bold text-blue-600">{fmt(v)} FCFA</span> },
                  { key: "status", label: "Statut", sortable: true, render: (v) => <StatusBadge status={v} /> },
                  { key: "payin_reference", label: "Réf. pay-in", render: (v, row) => (
                    <div className="space-y-0.5">
                      <p className="font-mono text-xs">{v}</p>
                      <p className="font-mono text-xs text-muted-foreground">{row.payin_provider_reference || "—"}</p>
                    </div>
                  ) },
                  { key: "payout_reference", label: "Réf. payout", render: (v, row) => (
                    <div className="space-y-0.5">
                      <p className="font-mono text-xs">{v}</p>
                      <p className="font-mono text-xs text-muted-foreground">{row.payout_provider_reference || "—"}</p>
                    </div>
                  ) },
                  { key: "failure_reason", label: "Rapprochement", render: (v, row) => (
                    <div className="max-w-[260px]">
                      <p className="text-sm whitespace-normal">{row.note || "—"}</p>
                      {v && <p className="text-xs text-red-600 whitespace-normal mt-1">{v}</p>}
                    </div>
                  ) },
                ]}
                actions={(row) => (
                  <>
                    {["payout_failed", "payin_confirmed"].includes(row.status) && (
                      <button onClick={() => retryPayout(row)} className="px-2.5 py-1 rounded-md bg-blue-500/10 text-blue-600 text-xs font-semibold hover:bg-blue-500/15">
                        Relancer
                      </button>
                    )}
                    {["payout_failed", "payin_failed"].includes(row.status) && (
                      <button onClick={() => markRefunded(row)} className="px-2.5 py-1 rounded-md bg-purple-500/10 text-purple-600 text-xs font-semibold hover:bg-purple-500/15">
                        Remboursé
                      </button>
                    )}
                  </>
                )}
              />
            </div>
          );
        })()}

        {/* ── Transferts P2P ─────────────────────────────────────────────── */}
        {activeTab === "p2p-transfers" && (() => {
          const totalVolume = p2pTransfers.reduce((sum, t) => sum + Number(t.amount || 0), 0);
          const completedCount = p2pTransfers.filter((t) => t.status === "completed").length;
          const uniqueUsers = new Set(p2pTransfers.flatMap((t) => [t.sender_user_id, t.recipient_user_id].filter(Boolean))).size;
          const stats = [
            { label: "Transferts", value: fmt(p2pTransfers.length), icon: ArrowLeftRight, color: "text-violet-500", bg: "bg-violet-500/10" },
            { label: "Volume", value: `${fmt(totalVolume)} FCFA`, icon: Banknote, color: "text-emerald-500", bg: "bg-emerald-500/10" },
            { label: "Complétés", value: fmt(completedCount), icon: CheckCircle, color: "text-green-500", bg: "bg-green-500/10" },
            { label: "Aujourd'hui", value: fmt(p2pToday), icon: Activity, color: "text-blue-500", bg: "bg-blue-500/10" },
            { label: "Utilisateurs", value: fmt(uniqueUsers), icon: Users, color: "text-orange-500", bg: "bg-orange-500/10" },
          ];
          return (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h1 className="text-xl font-bold tracking-tight">Transferts P2P</h1>
                  <p className="text-sm text-muted-foreground">Suivi des mouvements Kobo vers Kobo entre utilisateurs.</p>
                </div>
                <button onClick={() => load()} className="h-8 px-3 rounded-md border border-border text-xs flex items-center gap-1.5 hover:bg-secondary transition-colors">
                  <RefreshCw size={13} /> Rafraîchir
                </button>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                {stats.map(({ label, value, icon: Icon, color, bg }) => (
                  <div key={label} className="rounded-xl border border-border bg-background p-4">
                    <div className={`h-8 w-8 rounded-lg ${bg} flex items-center justify-center mb-3`}>
                      <Icon size={15} className={color} />
                    </div>
                    <p className="text-lg font-bold">{value}</p>
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>

              <DataTable
                data={p2pTransfers}
                searchFields={["id", "sender_name", "sender_phone", "sender_email", "recipient_name", "recipient_phone", "recipient_email", "status"]}
                emptyText="Aucun transfert P2P"
                exportFilename="kobo-transferts-p2p.csv"
                columns={[
                  { key: "created_at", label: "Date", sortable: true,
                    render: (v) => <span className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(v)}</span> },
                  { key: "sender_name", label: "Expéditeur", sortable: true,
                    render: (v, row) => (
                      <div>
                        <p className="font-medium text-sm">{v || row.sender_phone || "—"}</p>
                        <p className="text-xs text-muted-foreground">{row.sender_phone || row.sender_email || "—"}</p>
                      </div>
                    )
                  },
                  { key: "recipient_name", label: "Destinataire", sortable: true,
                    render: (v, row) => (
                      <div>
                        <p className="font-medium text-sm">{v || row.recipient_phone || "—"}</p>
                        <p className="text-xs text-muted-foreground">{row.recipient_phone || row.recipient_email || "—"}</p>
                      </div>
                    )
                  },
                  { key: "amount", label: "Montant", sortable: true,
                    render: (v, row) => <span className="font-semibold">{fmt(v)} <span className="text-xs text-muted-foreground">{row.currency}</span></span> },
                  { key: "id", label: "Référence",
                    render: (v) => <span className="font-mono text-xs text-muted-foreground">{v}</span> },
                  { key: "status", label: "Statut", sortable: true,
                    render: (v) => <StatusBadge status={v} /> },
                ]}
                actions={(r) => (
                  <>
                    {actionBtn("Expéditeur", <Eye size={12} />, () => setSelectedUserId(r.sender_user_id))}
                    {actionBtn("Destinataire", <Users size={12} />, () => setSelectedUserId(r.recipient_user_id))}
                  </>
                )}
              />
            </div>
          );
        })()}

        {/* ── Virements ───────────────────────────────────────────────────── */}
        {activeTab === "virements" && (
          <DataTable
            data={virements}
            searchFields={["user_name", "user_email", "counterpart", "provider", "iban"]}
            emptyText="Aucun virement"
            exportFilename="kobo-virements.csv"
            columns={[
              { key: "created_at", label: "Date",         sortable: true, render: (v) => <span className="text-xs text-muted-foreground">{fmtDate(v)}</span> },
              { key: "user_name",  label: "Utilisateur",  sortable: true, render: (v, row) => <span className="font-medium">{v || row.user_email || row.user_id}</span> },
              { key: "provider",   label: "Type",         sortable: true, render: (v) => <span className="font-mono text-xs bg-secondary px-1.5 py-0.5 rounded uppercase">{v}</span> },
              { key: "amount",     label: "Montant",      sortable: true, render: (v, row) => <span className="font-semibold">{fmt(v)} {row.currency}</span> },
              { key: "counterpart",label: "Destinataire", render: (v) => <span>{v || "—"}</span> },
              { key: "iban",       label: "IBAN",         render: (v) => v ? <span className="font-mono text-xs text-muted-foreground">{v}</span> : null },
              { key: "status",     label: "Statut",       sortable: true, render: (v) => <StatusBadge status={v} /> },
            ]}
            actions={(r) => (
              <>
                {["pending","processing"].includes(r.status) && <>
                  {actionBtn("Fait", <CheckCircle size={12} />, () => quickAction(`/admin/withdrawals/${r.id}/complete`, "POST", null, "Complété"), "success")}
                  {actionBtn("Rejeter", <XCircle size={12} />, () => quickAction(`/admin/withdrawals/${r.id}/reject`, "POST", null, "Rejeté"), "danger")}
                </>}
                {actionBtn("Forcer statut", <SlidersHorizontal size={12} />, () => setModal({
                  title: "Forcer le statut — Virement",
                  description: `Statut actuel : "${r.status}".`,
                  variant: "warning", icon: <SlidersHorizontal size={20} />, confirmLabel: "Forcer",
                  inputs: [
                    { key: "status", label: "Nouveau statut", type: "select", required: true,
                      options: ["pending","processing","completed","rejected","failed","cancelled"].map((s) => ({ value: s, label: s })) },
                    { key: "note", label: "Note admin", placeholder: "Raison..." },
                  ],
                  onConfirm: async (v) => { await quickAction(`/admin/virements/${r.id}/force-status`, "PATCH", { status: v.status, note: v.note || "" }, `Statut forcé → ${v.status}`); },
                }), "warning")}
              </>
            )}
          />
        )}

        {/* ── Transferts intl ──────────────────────────────────────────────── */}
        {activeTab === "intl" && (
          <DataTable
            data={intlTransfers}
            searchFields={["id", "sender_name", "sender_phone", "recipient_name", "recipient_phone"]}
            emptyText="Aucun transfert"
            exportFilename="kobo-transferts-intl.csv"
            columns={[
              { key: "created_at",    label: "Date",         sortable: true, render: (v) => <span className="text-xs text-muted-foreground">{fmtDate(v)}</span> },
              { key: "id",            label: "Référence",    render: (v) => <span className="font-mono text-xs">{v}</span> },
              { key: "sender_name",   label: "Expéditeur",   sortable: true, render: (v, row) => <div><p className="font-medium">{v || "—"}</p><p className="text-xs text-muted-foreground">{row.sender_phone}</p></div> },
              { key: "recipient_name",label: "Destinataire", render: (v, row) => <div><p className="font-medium">{v || "—"}</p><p className="text-xs text-muted-foreground">{row.recipient_phone}</p></div> },
              { key: "source_amount", label: "Montant",      sortable: true, render: (v, row) => <span className="font-semibold">{fmt(v)} {row.source_currency} → {fmt(row.target_amount)} {row.target_currency}</span> },
              { key: "funding_method",label: "Paiement",     render: (v) => v === "usdt"
                ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full"><Banknote size={10} />USDT</span>
                : <span className="text-xs text-muted-foreground">{v || "—"}</span>
              },
              { key: "status",        label: "Statut",       sortable: true, render: (v) => <StatusBadge status={v} /> },
            ]}
            onRowClick={(r) => setIntlDetailTransfer(r)}
            actions={(r) => (
              <div className="flex gap-1 flex-wrap">
                {actionBtn("Détails", <Eye size={12} />, () => setIntlDetailTransfer(r))}
                {["pending_payment","pending_funding"].includes(r.status) && r.funding_method === "usdt" && actionBtn(
                  "Vérifier USDT",
                  <ShieldCheck size={12} />,
                  () => setUsdtVerifyTransfer(r),
                  "success"
                )}
                {["pending_payment","pending_funding"].includes(r.status) && r.funding_method !== "usdt" && actionBtn("Paiement reçu", <CheckCircle size={12} />, () => quickAction(`/admin/intl-transfers/${r.id}/confirm-payment`, "POST", null, "Confirmé"), "success")}
                {r.status === "pending_settlement" && actionBtn("Fonds envoyés", <Send size={12} />, () => quickAction(`/admin/intl-transfers/${r.id}/complete`, "POST", null, "Complété"), "success")}
                {!["completed","cancelled","rejected"].includes(r.status) && actionBtn("Rejeter", <XCircle size={12} />, () => quickAction(`/admin/intl-transfers/${r.id}/reject`, "POST", null, "Rejeté"), "danger")}
                {actionBtn("Forcer", <SlidersHorizontal size={12} />, () => setModal({
                  title: "Forcer le statut — Transfert intl",
                  description: `Statut actuel : "${r.status}".`,
                  variant: "warning", icon: <SlidersHorizontal size={20} />, confirmLabel: "Forcer",
                  inputs: [
                    { key: "status", label: "Nouveau statut", type: "select", required: true,
                      options: ["pending_payment","pending_settlement","completed","cancelled","rejected","failed"].map((s) => ({ value: s, label: s })) },
                    { key: "note", label: "Note admin", placeholder: "Raison..." },
                  ],
                  onConfirm: async (v) => { await quickAction(`/admin/intl-transfers/${r.id}/force-status`, "PATCH", { status: v.status, note: v.note || "" }, `Statut forcé → ${v.status}`); },
                }), "warning")}
              </div>
            )}
          />
        )}

        {/* ── KYC ─────────────────────────────────────────────────────────── */}
        {activeTab === "kyc" && (() => {
          const KYC_TABS = [
            { key: "in_review", label: "À valider", color: "text-yellow-600" },
            { key: "approved",  label: "Approuvés", color: "text-green-600" },
            { key: "rejected",  label: "Rejetés",   color: "text-red-600" },
            { key: "all",       label: "Tous",      color: "" },
          ];
          const filteredKyc = kycFilter === "all" ? kyc : kyc.filter((k) => k.status === kycFilter);
          return (
            <div className="space-y-4">
              <div className="flex gap-1 border-b border-border">
                {KYC_TABS.map((t) => {
                  const count = t.key === "all" ? kyc.length : kyc.filter((k) => k.status === t.key).length;
                  return (
                    <button key={t.key} onClick={() => setKycFilter(t.key)}
                      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${kycFilter === t.key ? `border-primary ${t.color || "text-foreground"}` : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                      {t.label} {count > 0 && <span className="ml-1 text-xs bg-secondary px-1.5 py-0.5 rounded-full">{count}</span>}
                    </button>
                  );
                })}
              </div>
              <DataTable
                data={filteredKyc}
                searchFields={["phone_e164", "user_id", "full_name"]}
                emptyText="Aucun profil KYC"
                exportFilename="kobo-kyc.csv"
                columns={[
                  { key: "updated_at", label: "Mis à jour",  sortable: true, render: (v) => <span className="text-xs text-muted-foreground">{fmtDate(v)}</span> },
                  { key: "full_name",  label: "Utilisateur", sortable: true, render: (v, row) => (
                    <div>
                      <p className="font-medium">{v || row.phone_e164 || row.user_id}</p>
                      {v && <p className="text-xs text-muted-foreground">{row.phone_e164}</p>}
                    </div>
                  )},
                  { key: "level", label: "Niveau demandé", sortable: true, render: (v, row) => (
                    <div className="flex items-center gap-1.5">
                      <span className={`inline-flex items-center justify-center h-6 w-6 rounded-full text-xs font-bold ${v > 0 ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-secondary text-muted-foreground"}`}>{v}</span>
                      {row.doc_count > 0 && <span className="text-xs text-muted-foreground">{row.doc_count} doc{row.doc_count > 1 ? "s" : ""}</span>}
                    </div>
                  )},
                  { key: "status", label: "Statut", sortable: true, render: (v) => <StatusBadge status={v} /> },
                ]}
                actions={(r) => (
                  <div className="flex gap-1 flex-wrap">
                    {actionBtn("Documents", <Eye size={12} />, () => setKycDocsUser(r))}
                    {actionBtn("Décider", <UserCheck size={12} />, () => setKycDecideUser(r), r.status === "in_review" ? "success" : "ghost")}
                    {actionBtn("Forcer statut", <SlidersHorizontal size={12} />, () => setModal({
                      title: "Forcer le statut KYC",
                      description: `Statut actuel : "${r.status}". Passer à "approved" mettra à jour le niveau KYC de l'utilisateur.`,
                      variant: "warning", icon: <SlidersHorizontal size={20} />, confirmLabel: "Forcer",
                      inputs: [
                        { key: "status", label: "Nouveau statut", type: "select", required: true,
                          options: ["pending","in_review","approved","rejected"].map((s) => ({ value: s, label: s })) },
                        { key: "note", label: "Note admin", placeholder: "Raison..." },
                      ],
                      onConfirm: async (v) => { await quickAction(`/admin/kyc/${r.id}/force-status`, "PATCH", { status: v.status, note: v.note || "" }, `Statut KYC forcé → ${v.status}`); },
                    }), "warning")}
                  </div>
                )}
              />
            </div>
          );
        })()}

        {/* ── Support ─────────────────────────────────────────────────────── */}
        {activeTab === "support" && (
          <DataTable
            data={conversations}
            searchFields={["phone_e164", "full_name", "last_message", "ticket_subject"]}
            emptyText="Aucune conversation"
            columns={[
              { key: "last_at",       label: "Dernier msg",     sortable: true, render: (v) => <span className="text-xs text-muted-foreground">{fmtDate(v)}</span> },
              { key: "phone_e164",    label: "Utilisateur",     sortable: true, render: (v, row) => <div><p className="font-medium">{row.full_name || v}</p>{row.full_name && <p className="text-xs text-muted-foreground">{v}</p>}</div> },
              { key: "last_message",  label: "Dernier message", render: (v, row) => (
                <div className="flex items-center gap-1.5 max-w-[240px]">
                  {row.last_from === "user" && <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />}
                  <span className="text-xs text-muted-foreground truncate">{row.last_from === "agent" ? "Vous : " : ""}{v}</span>
                </div>
              )},
              { key: "ticket_subject", label: "Ticket", render: (v, row) => v
                ? <div><p className="text-xs truncate max-w-[160px]">{v}</p><StatusBadge status={row.ticket_status} /></div>
                : <span className="inline-flex items-center gap-1 text-xs text-blue-500"><MessageSquare size={11} />Chat direct</span>
              },
              { key: "ticket_status", label: "Action", render: (v, row) => {
                const canClose = !row.ticket_subject || v !== "closed";
                return canClose ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      quickAction(`/admin/support/conversations/${row.user_id}/close`, "POST", {}, row.ticket_subject ? "Ticket fermé" : "Conversation archivée");
                    }}
                    className="h-7 px-2.5 rounded-md text-xs font-semibold inline-flex items-center gap-1 bg-red-500/10 text-red-600 hover:bg-red-500/20 transition-colors"
                  >
                    <XCircle size={12} /> Fermer
                  </button>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                );
              }},
            ]}
            actions={(r) => (
              <>
                {actionBtn("Ouvrir", <MessageSquare size={12} />, () => setSelectedConv(r), r.last_from === "user" && (!r.ticket_status || r.ticket_status === "open") ? "success" : "ghost")}
              </>
            )}
          />
        )}

        {/* ── Wallets ──────────────────────────────────────────────────────── */}
        {activeTab === "wallets" && (
          <div className="space-y-4 mb-8">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Adresses de réception des dépôts crypto</p>
              <Button size="sm" onClick={() => setWalletModal("new")} className="gap-1.5"><Plus size={14} />Ajouter</Button>
            </div>
            <DataTable
              data={wallets}
              searchFields={["network", "address", "label"]}
              emptyText="Aucune adresse"
              exportFilename="kobo-wallets.csv"
              columns={[
                { key: "network", label: "Réseau",  sortable: true, render: (v) => <span className="font-mono font-bold text-sm">{v}</span> },
                { key: "address", label: "Adresse", render: (v) => <span className="font-mono text-xs text-muted-foreground max-w-[200px] truncate block">{v}</span> },
                { key: "label",   label: "Label",   render: (v) => <span>{v || "—"}</span> },
                { key: "active",  label: "Statut",  sortable: true, render: (v, row) => (
                  <button onClick={() => quickAction(`/admin/crypto/wallets/${row.id}`, "PUT", { active: !v }, v ? "Désactivée" : "Activée")} className={`px-2 py-0.5 rounded-full text-xs font-semibold cursor-pointer ${v ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-secondary text-muted-foreground"}`}>{v ? "Actif" : "Inactif"}</button>
                )},
              ]}
              actions={(r) => (
                <>{actionBtn("", <Pencil size={13} />, () => setWalletModal(r))}{actionBtn("", <Trash2 size={13} />, () => deleteWallet(r.id), "danger")}</>
              )}
            />
          </div>
        )}

        {/* ── Liens de paiement ───────────────────────────────────────────── */}
        {activeTab === "payment-links" && <PaymentLinksAdminTab token={token} />}

        {/* ── Crypto liens en attente ──────────────────────────────────────── */}
        {activeTab === "crypto-link-txs" && (
          <PendingCryptoLinkTxsTab
            items={pendingCryptoLinkTxs}
            token={token}
            onRefresh={load}
          />
        )}

        {activeTab === "crypto-onchain" && (
          <CryptoOnChainEventsTab
            data={cryptoChainEvents}
            token={token}
            onRefresh={load}
          />
        )}

        {/* ── Marketing ────────────────────────────────────────────────────── */}
        {activeTab === "marketing" && <MarketingTab token={token} />}

        {/* ── Fraude ───────────────────────────────────────────────────────── */}
        {activeTab === "fraud" && <FraudTab token={token} onViewUser={(id) => setSelectedUserId(id)} />}

        {/* ── Frais ────────────────────────────────────────────────────────── */}
        {activeTab === "fees" && <FeesTab token={token} />}

        {/* ── Pays / Corridors ──────────────────────────────────────────────── */}
        {activeTab === "corridors" && (
          <CorridorsPanel
            corridors={corridors}
            setCorridors={setCorridors}
            corridorToggling={corridorToggling}
            setCorridorToggling={setCorridorToggling}
            token={token}
          />
        )}

        {/* ── Conformité pays ─────────────────────────────────────────────── */}
        {activeTab === "compliance" && <ComplianceTab token={token} />}

        {/* ── API publique ─────────────────────────────────────────────────── */}
        {activeTab === "api" && <ApiTab token={token} />}

        {/* ── Journal admin ───────────────────────────────────────────────── */}
        {activeTab === "audit" && <AuditLogTab token={token} />}

        {activeTab === "admin-sessions" && <AdminSessionsTab token={token} />}

        {/* ── Exports & Sauvegardes ────────────────────────────────────────── */}
        {activeTab === "exports" && <ExportsTab token={token} />}

        {activeTab === "team" && <AdminTeamTab token={token} role={role} />}

        {/* ── Paramètres ──────────────────────────────────────────────────── */}
        {activeTab === "settings" && (() => {
          const Toggle = ({ enabled, disabled: dis, onToggle }) => (
            <button disabled={dis} onClick={onToggle}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none disabled:opacity-40 ${enabled ? "bg-green-500" : "bg-muted"}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          );

          const SNAV = [
            { id: "maintenance", label: "Maintenance",  icon: AlertCircle,  badge: (!serviceStatus.withdrawals_enabled || !serviceStatus.deposits_enabled) ? "!" : null, badgeColor: "bg-orange-500" },
            { id: "payment",     label: "Paiement",     icon: Zap,          badge: null },
            { id: "threshold",   label: "Seuils",       icon: ShieldCheck,  badge: null },
            { id: "bank",        label: "Coordonnées bancaires", icon: Landmark, badge: null },
          ];

          return (
            <div className="flex gap-6 pb-10">
              {/* Sidebar nav */}
              <nav className="w-52 shrink-0">
                <div className="sticky top-4 space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-3 mb-2">Paramètres</p>
                  {SNAV.map(({ id, label, icon: Icon, badge, badgeColor }) => (
                    <button key={id} onClick={() => setSettingsSection(id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                        settingsSection === id
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                      }`}>
                      <Icon size={15} className="shrink-0" />
                      <span className="flex-1 text-left">{label}</span>
                      {badge && <span className={`h-4 w-4 rounded-full text-[9px] font-bold flex items-center justify-center text-white ${badgeColor}`}>{badge}</span>}
                    </button>
                  ))}
                </div>
              </nav>

              {/* Content panel */}
              <div className="flex-1 min-w-0 max-w-xl">

                {/* ══ MAINTENANCE ═══════════════════════════════════════ */}
                {settingsSection === "maintenance" && (
                  <div className="space-y-4">
                    <div>
                      <h2 className="font-display font-bold text-base">Maintenance des services</h2>
                      <p className="text-xs text-muted-foreground mt-0.5">Activez ou désactivez retraits et dépôts en temps réel. Un message personnalisé sera affiché aux utilisateurs.</p>
                    </div>
                    {[
                      { key: "withdrawals_enabled", msgKey: "withdrawals_message", label: "Retraits", sub: "Permettre aux utilisateurs de retirer leurs fonds", icon: ArrowDownToLine, defaultMsg: "Les retraits sont temporairement indisponibles. Nous travaillons à résoudre le problème au plus vite." },
                      { key: "deposits_enabled",    msgKey: "deposits_message",    label: "Dépôts",   sub: "Permettre aux utilisateurs de déposer des fonds",  icon: Banknote,       defaultMsg: "Les dépôts sont temporairement indisponibles. Nous travaillons à résoudre le problème au plus vite." },
                    ].map(({ key, msgKey, label, sub, icon: Icon, defaultMsg }) => {
                      const enabled = serviceStatus[key];
                      return (
                        <div key={key} className={`rounded-xl border transition-colors ${enabled ? "border-border bg-card" : "border-orange-300/60 bg-orange-50/50 dark:border-orange-700/40 dark:bg-orange-950/20"}`}>
                          <div className="flex items-center justify-between gap-3 px-4 py-4">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${enabled ? "bg-green-500/10" : "bg-orange-500/10"}`}>
                                <Icon size={16} className={enabled ? "text-green-600" : "text-orange-500"} />
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="font-semibold text-sm">{label}</p>
                                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${enabled ? "bg-green-500/10 text-green-600" : "bg-orange-500/10 text-orange-500"}`}>{enabled ? "Actif" : "Désactivé"}</span>
                                </div>
                                <p className="text-xs text-muted-foreground">{sub}</p>
                              </div>
                            </div>
                            <Toggle enabled={enabled} dis={serviceStatusSaving} onToggle={async () => {
                              const next = { ...serviceStatus, [key]: !enabled };
                              setServiceStatus(next);
                              setServiceStatusSaving(true);
                              try {
                                await adminFetch("/admin/settings/service-status", "PUT", next, token);
                                toast.success(`${label} ${!enabled ? "activés" : "désactivés"}`);
                              } catch (e) { setServiceStatus(serviceStatus); toast.error(e.message); }
                              finally { setServiceStatusSaving(false); }
                            }} />
                          </div>
                          {!enabled && (
                            <div className="px-4 pb-4 space-y-2 border-t border-orange-200/60 dark:border-orange-700/30 pt-3">
                              <label className="text-[11px] text-muted-foreground font-medium block">Message affiché aux utilisateurs</label>
                              <textarea rows={2} value={serviceStatus[msgKey]} placeholder={defaultMsg}
                                onChange={(e) => setServiceStatus((s) => ({ ...s, [msgKey]: e.target.value }))}
                                className="w-full text-xs rounded-lg border border-border bg-background px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary" />
                              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={serviceStatusSaving}
                                onClick={async () => {
                                  setServiceStatusSaving(true);
                                  try { await adminFetch("/admin/settings/service-status", "PUT", serviceStatus, token); toast.success("Message mis à jour"); }
                                  catch (e) { toast.error(e.message); }
                                  finally { setServiceStatusSaving(false); }
                                }}>
                                {serviceStatusSaving ? <Loader2 size={11} className="animate-spin mr-1.5 inline" /> : null}
                                Enregistrer le message
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* ══ FOURNISSEUR DE PAIEMENT ═══════════════════════════ */}
                {settingsSection === "payment" && (
                  <div className="space-y-4">
                    <div>
                      <h2 className="font-display font-bold text-base">Fournisseur de paiement</h2>
                      <p className="text-xs text-muted-foreground mt-0.5">Sélectionnez le fournisseur pour les dépôts Mobile Money. Ce choix affecte uniquement les nouveaux dépôts.</p>
                    </div>
                    <div className="flex gap-3">
                      {[
                        { id: "notchpay", label: "NotchPay", sub: "USSD push direct — frais côté client", color: "blue" },
                        { id: "sharepay", label: "SharePay", sub: "Page de paiement hébergée",            color: "green" },
                      ].map(({ id, label, sub, color }) => {
                        const isActive = paymentProvider === id;
                        const ring = color === "blue" ? "ring-blue-500 bg-blue-500/5 border-blue-500/40" : "ring-green-500 bg-green-500/5 border-green-500/40";
                        const badge = color === "blue" ? "bg-blue-500/10 text-blue-500" : "bg-green-500/10 text-green-600";
                        return (
                          <button key={id} onClick={() => setPaymentProvider(id)}
                            className={`flex-1 border rounded-xl p-4 text-left transition-all ${isActive ? `ring-2 ${ring}` : "border-border bg-card hover:bg-secondary"}`}>
                            <div className="flex items-start justify-between gap-2 mb-1.5">
                              <span className="font-semibold text-sm">{label}</span>
                              {isActive && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${badge}`}>ACTIF</span>}
                            </div>
                            <p className="text-xs text-muted-foreground">{sub}</p>
                          </button>
                        );
                      })}
                    </div>
                    <Button className="w-full" disabled={paymentProviderSaving}
                      onClick={async () => {
                        setPaymentProviderSaving(true);
                        try {
                          await adminFetch("/admin/settings/payment-provider", "PUT", { provider: paymentProvider }, token);
                          toast.success(`Fournisseur basculé sur ${paymentProvider === "sharepay" ? "SharePay" : "NotchPay"}`);
                        } catch (e) { toast.error(e.message); }
                        finally { setPaymentProviderSaving(false); }
                      }}>
                      {paymentProviderSaving ? <RefreshCw size={14} className="animate-spin mr-2 inline" /> : <Check size={14} className="mr-2 inline" />}
                      Appliquer le fournisseur
                    </Button>
                  </div>
                )}

                {/* ══ SEUIL D'APPROBATION ════════════════════════════════ */}
                {settingsSection === "threshold" && (
                  <div className="space-y-4">
                    <div>
                      <h2 className="font-display font-bold text-base">Seuil d'approbation des retraits</h2>
                      <p className="text-xs text-muted-foreground mt-0.5">Tout retrait Mobile Money dépassant ce montant passe en attente et nécessite une validation manuelle. Mettre 0 pour tout traiter automatiquement.</p>
                    </div>
                    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
                      <ShieldCheck size={16} className={withdrawalThreshold > 0 ? "text-orange-500" : "text-muted-foreground"} />
                      <div>
                        <p className="text-[11px] text-muted-foreground">Seuil actuel</p>
                        <p className="font-bold text-sm tabular-nums">
                          {withdrawalThreshold === 0
                            ? <span className="text-muted-foreground font-medium">Désactivé — tous automatiques</span>
                            : <>{withdrawalThreshold.toLocaleString("fr-FR")} <span className="font-normal text-muted-foreground">FCFA</span></>}
                        </p>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground block mb-1.5">Nouveau seuil (FCFA)</label>
                      <div className="flex gap-2 items-center">
                        <Input type="text" inputMode="numeric" value={thresholdInput}
                          onChange={(e) => setThresholdInput(e.target.value.replace(/[^\d]/g, ""))}
                          placeholder="ex : 10 000" className="font-mono text-base font-bold tabular-nums" />
                        <span className="text-sm text-muted-foreground shrink-0">FCFA</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1.5">
                        {!thresholdInput || thresholdInput === "0"
                          ? "Valeur 0 → approbation désactivée, tous les retraits sont traités en temps réel."
                          : `Retraits > ${Number(thresholdInput).toLocaleString("fr-FR")} FCFA → validation admin requise avant envoi.`}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground mb-1.5">Valeurs rapides</p>
                      <div className="flex gap-1.5 flex-wrap">
                        {[0, 5000, 10000, 25000, 50000, 100000].map((v) => (
                          <button key={v} onClick={() => setThresholdInput(String(v))}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
                              thresholdInput === String(v) ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                            }`}>
                            {v === 0 ? "Désactivé" : `${v.toLocaleString("fr-FR")} F`}
                          </button>
                        ))}
                      </div>
                    </div>
                    <Button className="w-full" disabled={thresholdSaving || thresholdInput === String(withdrawalThreshold)}
                      onClick={async () => {
                        const amount = parseInt(thresholdInput || "0", 10);
                        if (isNaN(amount) || amount < 0) { toast.error("Montant invalide"); return; }
                        setThresholdSaving(true);
                        try {
                          await adminFetch("/admin/settings/withdrawal-threshold", "PUT", { amount_fcfa: amount }, token);
                          setWithdrawalThreshold(amount);
                          toast.success(amount === 0 ? "Approbation désactivée" : `Seuil mis à jour : ${amount.toLocaleString("fr-FR")} FCFA`);
                        } catch (e) { toast.error(e.message); }
                        finally { setThresholdSaving(false); }
                      }}>
                      {thresholdSaving ? <RefreshCw size={14} className="animate-spin mr-2 inline" /> : <ShieldCheck size={14} className="mr-2 inline" />}
                      Enregistrer le seuil
                    </Button>
                  </div>
                )}

                {/* ══ COORDONNÉES BANCAIRES ══════════════════════════════ */}
                {settingsSection === "bank" && (
                  <div className="space-y-4">
                    <div>
                      <h2 className="font-display font-bold text-base">Coordonnées bancaires Kobo</h2>
                      <p className="text-xs text-muted-foreground mt-0.5">Ces informations sont affichées aux clients qui souhaitent effectuer un virement bancaire (EUR / USD) vers Kobo.</p>
                    </div>
                    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
                      {[
                        { key: "beneficiary", label: "Bénéficiaire",  placeholder: "KOBO ONLINE SAS",     mono: false },
                        { key: "bank",        label: "Banque",         placeholder: "Afriland First Bank",  mono: false },
                        { key: "iban",        label: "IBAN",           placeholder: "CM21 1000 2000 …",     mono: true  },
                        { key: "bic",         label: "BIC / SWIFT",    placeholder: "CCEICMCX",             mono: true  },
                      ].map(({ key, label, placeholder, mono }) => (
                        <div key={key}>
                          <label className="text-xs font-medium text-muted-foreground block mb-1">{label}</label>
                          <Input value={koboBankForm[key]}
                            onChange={(e) => setKoboBankForm((p) => ({ ...p, [key]: e.target.value }))}
                            placeholder={placeholder}
                            className={mono ? "font-mono text-sm tracking-wider" : "text-sm"} />
                        </div>
                      ))}
                    </div>
                    <Button className="w-full" disabled={koboBankSaving}
                      onClick={async () => {
                        setKoboBankSaving(true);
                        try { await adminFetch("/admin/settings/kobo-bank", "PUT", koboBankForm, token); toast.success("Coordonnées mises à jour"); }
                        catch (e) { toast.error(e.message); }
                        finally { setKoboBankSaving(false); }
                      }}>
                      {koboBankSaving ? <RefreshCw size={14} className="animate-spin mr-2 inline" /> : <Check size={14} className="mr-2 inline" />}
                      Enregistrer les coordonnées
                    </Button>
                  </div>
                )}

              </div>
            </div>
          );
        })()}
          </div>
        </main>
      </div>
    </div>
  );
}
