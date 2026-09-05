import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowUpRight, ChevronDown, ChevronUp, Copy, Edit2,
  ExternalLink, Link2, Loader2, MoreVertical, Pause, Play,
  Plus, QrCode, Trash2, TrendingUp, Users, X, CheckCircle2,
  AlertTriangle, Zap, ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import {
  createPaymentLink, deleteLink, duplicateLink, editLink,
  getLinkTransactions, listMyLinks, pauseLink,
} from "../api/paymentLinks";

/* ── Formatters ─────────────────────────────────────────────────────────── */
const fmtFcfa = (n) => new Intl.NumberFormat("fr-FR").format(n ?? 0) + " FCFA";
const fmtDate = (iso) => iso
  ? new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
  : "—";

/* ── Badges ─────────────────────────────────────────────────────────────── */
function StatusBadge({ status }) {
  if (status === "active")
    return <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Actif
    </span>;
  return <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/20">
    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> En pause
  </span>;
}

function TxStatusDot({ status }) {
  const cls = { completed: "bg-emerald-500", processing: "bg-blue-500 animate-pulse", pending: "bg-amber-400 animate-pulse", failed: "bg-red-500" };
  return <span className={`w-2 h-2 rounded-full shrink-0 ${cls[status] ?? "bg-muted-foreground"}`} />;
}

function ProviderBadge({ provider }) {
  const mtn = provider?.toLowerCase().includes("mtn");
  return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${mtn ? "bg-yellow-500/10 text-yellow-600" : "bg-orange-500/10 text-orange-600"}`}>
    {mtn ? "MTN" : "Orange"}
  </span>;
}

/* ── Confirm Modal ──────────────────────────────────────────────────────── */
function ConfirmModal({ title, description, confirmLabel = "Confirmer", onConfirm, onClose }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 space-y-4">
          <div className="flex items-start gap-4">
            <div className="w-11 h-11 rounded-2xl bg-destructive/10 flex items-center justify-center shrink-0">
              <Trash2 size={20} className="text-destructive" />
            </div>
            <div className="pt-0.5">
              <p className="font-semibold text-foreground">{title}</p>
              <p className="text-sm text-muted-foreground mt-1">{description}</p>
            </div>
          </div>
        </div>
        <div className="flex gap-2 px-6 pb-6">
          <button onClick={onClose}
            className="flex-1 h-10 rounded-xl border border-border text-sm text-muted-foreground hover:bg-secondary transition-colors font-medium">
            Annuler
          </button>
          <button onClick={() => { onConfirm(); onClose(); }}
            className="flex-1 h-10 rounded-xl bg-destructive hover:bg-destructive/90 text-destructive-foreground text-sm font-semibold transition-colors flex items-center justify-center gap-1.5">
            <Trash2 size={13} /> {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── QR Modal ───────────────────────────────────────────────────────────── */
function QrModal({ url, onClose }) {
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="bg-background border border-border rounded-2xl shadow-2xl p-6 w-full max-w-xs text-center space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="font-semibold text-foreground text-sm">QR Code de paiement</p>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-secondary flex items-center justify-center transition-colors">
            <X size={14} className="text-muted-foreground" />
          </button>
        </div>
        <div className="flex items-center justify-center bg-secondary/40 rounded-xl p-4 border border-border">
          <img src={qrSrc} alt="QR Code" className="w-44 h-44 rounded-lg" />
        </div>
        <p className="text-xs text-muted-foreground break-all font-mono">{url}</p>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => { navigator.clipboard.writeText(url); toast.success("Lien copié !"); }}
            className="h-9 rounded-xl border border-border text-muted-foreground text-xs font-medium hover:bg-secondary transition-colors flex items-center justify-center gap-1.5">
            <Copy size={12} /> Copier le lien
          </button>
          <a href={qrSrc} download="kobo-qr.png" target="_blank" rel="noreferrer"
            className="h-9 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-medium transition-colors flex items-center justify-center gap-1.5">
            <ArrowUpRight size={12} /> Télécharger
          </a>
        </div>
      </div>
    </div>
  );
}

/* ── Edit Modal ─────────────────────────────────────────────────────────── */
function EditModal({ link, onClose, onSaved }) {
  const [desc, setDesc] = useState(link.description);
  const [maxUses, setMaxUses] = useState(link.max_uses ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!desc.trim()) { toast.error("Description requise"); return; }
    setSaving(true);
    try {
      await editLink(link.id, { description: desc.trim(), max_uses: maxUses ? parseInt(maxUses) : null });
      toast.success("Lien mis à jour");
      onSaved();
      onClose();
    } catch { toast.error("Erreur lors de la mise à jour"); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
              <Edit2 size={14} className="text-primary" />
            </div>
            <p className="font-semibold text-foreground">Modifier le lien</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-secondary flex items-center justify-center transition-colors">
            <X size={14} className="text-muted-foreground" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">Description</label>
            <input value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={200}
              className="w-full h-10 px-3 rounded-xl border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 bg-secondary/40 placeholder:text-muted-foreground" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">Utilisations max</label>
            <div className="grid grid-cols-4 gap-2">
              {["", "1", "5", "10"].map((v) => (
                <button key={v} onClick={() => setMaxUses(v)}
                  className={`h-9 rounded-xl border text-sm font-medium transition-all ${maxUses === v ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-border/80 hover:bg-secondary"}`}>
                  {v === "" ? "∞" : `×${v}`}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 h-10 rounded-xl border border-border text-sm text-muted-foreground hover:bg-secondary transition-colors">Annuler</button>
            <button onClick={save} disabled={saving}
              className="flex-1 h-10 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold disabled:opacity-50 transition-colors">
              {saving ? <Loader2 size={14} className="animate-spin mx-auto" /> : "Enregistrer"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Transactions ───────────────────────────────────────────────────────── */
function TransactionsPanel({ linkId }) {
  const [txs, setTxs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getLinkTransactions(linkId)
      .then((d) => setTxs(d.items ?? []))
      .catch(() => toast.error("Impossible de charger les transactions"))
      .finally(() => setLoading(false));
  }, [linkId]);

  if (loading) return <div className="flex justify-center py-4"><Loader2 size={15} className="animate-spin text-muted-foreground" /></div>;
  if (!txs.length) return <p className="text-xs text-muted-foreground text-center py-4">Aucune transaction pour ce lien.</p>;

  return (
    <div className="space-y-0.5">
      <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-3 px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
        <span /> <span>Numéro</span> <span>Réseau</span> <span>Montant</span> <span>Date</span>
      </div>
      {txs.map((t, i) => (
        <div key={i} className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-3 items-center px-3 py-2 rounded-lg hover:bg-secondary/50 transition-colors">
          <TxStatusDot status={t.status} />
          <span className="font-mono text-xs text-foreground truncate">{t.payer_phone_display}</span>
          <ProviderBadge provider={t.provider} />
          <span className={`text-xs font-semibold ${t.status === "completed" ? "text-emerald-600" : "text-muted-foreground"}`}>
            {t.status === "completed" ? `+${fmtFcfa(t.net_fcfa)}` : fmtFcfa(t.amount)}
          </span>
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">{fmtDate(t.created_at)}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Menu contextuel (trois points) ─────────────────────────────────────── */
function ContextMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((v) => !v)}
        className="w-8 h-8 rounded-lg hover:bg-secondary flex items-center justify-center transition-colors">
        <MoreVertical size={15} className="text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-background border border-border rounded-xl shadow-lg py-1 z-30">
          {items.map(({ label, icon: Icon, onClick, danger }) => (
            <button key={label} onClick={() => { onClick(); setOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-secondary
                ${danger ? "text-destructive" : "text-foreground"}`}>
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Card lien ──────────────────────────────────────────────────────────── */
function LinkCard({ l, onRefresh }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pausing, setPausing] = useState(false);

  const copy = () => { navigator.clipboard.writeText(l.url); toast.success("Lien copié !"); };
  const shareWa = () => window.open(`https://wa.me/?text=${encodeURIComponent(`Payez-moi via ce lien Kobo : ${l.url}`)}`, "_blank");

  const handlePause = async () => {
    setPausing(true);
    try { await pauseLink(l.id); onRefresh(); }
    catch { toast.error("Erreur"); }
    finally { setPausing(false); }
  };

  const handleDuplicate = async () => {
    try { await duplicateLink(l.id); toast.success("Lien dupliqué !"); onRefresh(); }
    catch { toast.error("Erreur lors de la duplication"); }
  };

  const handleDelete = async () => {
    try { await deleteLink(l.id); toast.success("Lien supprimé"); onRefresh(); }
    catch { toast.error("Erreur lors de la suppression"); }
  };

  const menuItems = [
    { label: "Modifier", icon: Edit2, onClick: () => setEditOpen(true) },
    { label: "Dupliquer", icon: Copy, onClick: handleDuplicate },
    { label: l.status === "active" ? "Mettre en pause" : "Réactiver", icon: l.status === "active" ? Pause : Play, onClick: handlePause },
    { label: "Supprimer", icon: Trash2, onClick: () => setConfirmDelete(true), danger: true },
  ];

  return (
    <>
      {qrOpen && <QrModal url={l.url} onClose={() => setQrOpen(false)} />}
      {editOpen && <EditModal link={l} onClose={() => setEditOpen(false)} onSaved={onRefresh} />}
      {confirmDelete && (
        <ConfirmModal
          title="Supprimer ce lien ?"
          description={`Le lien "${l.description}" (${fmtFcfa(l.amount)}) sera définitivement supprimé. Cette action est irréversible.`}
          confirmLabel="Supprimer"
          onConfirm={handleDelete}
          onClose={() => setConfirmDelete(false)}
        />
      )}

      <div className="bg-background rounded-2xl border border-border shadow-sm hover:shadow-md transition-shadow overflow-hidden">
        {/* Header card */}
        <div className="px-5 pt-4 pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1.5">
                <StatusBadge status={l.status} />
                {l.max_uses && (
                  <span className="text-[10px] text-muted-foreground font-medium bg-secondary px-1.5 py-0.5 rounded-full">
                    {l.use_count ?? 0}/{l.max_uses} util.
                  </span>
                )}
              </div>
              <p className="text-foreground text-sm font-medium truncate">{l.description}</p>
              <p className="text-foreground font-bold text-2xl tracking-tight mt-0.5">{fmtFcfa(l.amount)}</p>
            </div>
            <ContextMenu items={menuItems} />
          </div>
        </div>

        {/* Stats bar */}
        <div className="px-5 py-2.5 bg-secondary/50 border-y border-border grid grid-cols-3 gap-2">
          <div className="flex items-center gap-1.5">
            <Users size={12} className="text-primary shrink-0" />
            <div>
              <p className="text-[10px] text-muted-foreground leading-none">Paiements</p>
              <p className="text-xs font-bold text-foreground">{l.paid_count ?? 0}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <TrendingUp size={12} className="text-emerald-500 shrink-0" />
            <div>
              <p className="text-[10px] text-muted-foreground leading-none">Collecté</p>
              <p className="text-xs font-bold text-emerald-600">{fmtFcfa(l.total_collected ?? 0)}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground leading-none">Expiration</p>
            <p className="text-xs font-semibold text-foreground mt-0.5">
              {l.expires_at ? fmtDate(l.expires_at) : "∞"}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="px-4 py-3 flex items-center gap-2">
          <button onClick={copy}
            className="flex-1 h-9 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors">
            <Copy size={12} /> Copier le lien
          </button>
          <button onClick={() => navigate(`/payment-links/${l.id}`)}
            className="h-9 px-3 rounded-lg border border-border hover:bg-secondary text-foreground text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors">
            <ArrowRight size={13} /> Détails
          </button>
          <button onClick={shareWa} title="Partager sur WhatsApp"
            className="h-9 w-9 rounded-lg border border-border hover:bg-secondary flex items-center justify-center transition-colors">
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-green-600">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
              <path d="M12 0C5.373 0 0 5.373 0 12c0 2.124.558 4.118 1.535 5.847L.057 23.7a.75.75 0 0 0 .92.921l5.944-1.478A11.954 11.954 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75A9.726 9.726 0 0 1 6.31 20.1l-.343-.204-3.532.878.892-3.44-.225-.356A9.72 9.72 0 0 1 2.25 12C2.25 6.615 6.615 2.25 12 2.25S21.75 6.615 21.75 12 17.385 21.75 12 21.75z"/>
            </svg>
          </button>
          <button onClick={() => setQrOpen(true)} title="QR Code"
            className="h-9 w-9 rounded-lg border border-border hover:bg-secondary flex items-center justify-center transition-colors">
            <QrCode size={14} className="text-muted-foreground" />
          </button>
        </div>

        {/* Transactions inline (si déjà payé) */}
        {l.paid_count > 0 && (
          <>
            <div className="border-t border-border">
              <button onClick={() => setExpanded((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-secondary/40 transition-colors text-xs font-medium text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <TrendingUp size={12} /> Voir les transactions ({l.paid_count})
                </span>
                {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
            </div>
            {expanded && (
              <div className="border-t border-border px-2 py-2">
                <TransactionsPanel linkId={l.id} />
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

/* ── Modal de création ──────────────────────────────────────────────────── */
const EXPIRY_OPTIONS = [
  { label: "Sans exp.",  value: null },
  { label: "24 h",       value: 24 },
  { label: "7 jours",    value: 168 },
  { label: "30 jours",   value: 720 },
];
const MAX_USES_OPTIONS = [
  { label: "Illimité", value: null },
  { label: "×1",       value: 1 },
  { label: "×5",       value: 5 },
  { label: "×10",      value: 10 },
];
const QUICK_AMOUNTS = [500, 1000, 5000, 10000, 50000];

function CreateModal({ onClose, onCreated }) {
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [expiryIdx, setExpiryIdx] = useState(0);
  const [maxUsesIdx, setMaxUsesIdx] = useState(0);
  const [creating, setCreating] = useState(false);
  const [done, setDone] = useState(null);
  const amountRef = useRef(null);

  useEffect(() => { setTimeout(() => amountRef.current?.focus(), 80); }, []);

  const numericAmount = parseInt(amount.replace(/\D/g, "") || "0", 10);
  const isValid = numericAmount >= 100 && desc.trim().length > 0;

  const handleCreate = async () => {
    if (numericAmount < 100) { toast.error("Montant minimum 100 FCFA"); return; }
    if (!desc.trim()) { toast.error("Description requise"); return; }
    setCreating(true);
    try {
      const link = await createPaymentLink({
        amount: numericAmount,
        description: desc.trim(),
        max_uses: MAX_USES_OPTIONS[maxUsesIdx].value,
        expires_in_hours: EXPIRY_OPTIONS[expiryIdx].value,
      });
      setDone(link);
      onCreated();
    } catch (e) { toast.error(e.response?.data?.detail || "Erreur lors de la création"); }
    finally { setCreating(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-4 pb-4 sm:pb-0"
      onClick={onClose}>
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>

        {/* Header gradient */}
        <div className="bg-primary px-5 pt-5 pb-4 relative overflow-hidden">
          <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "radial-gradient(circle at 80% 20%, white 0%, transparent 60%)" }} />
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center">
                <Link2 size={16} className="text-white" />
              </div>
              <div>
                <p className="font-bold text-white text-base leading-tight">Nouveau lien</p>
                <p className="text-white/60 text-xs">Recevez des paiements Mobile Money</p>
              </div>
            </div>
            <button onClick={onClose} className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">
              <X size={14} className="text-white" />
            </button>
          </div>
        </div>

        {!done ? (
          <div className="px-5 py-5 space-y-5">

            {/* Montant */}
            <div>
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-2">Montant</label>
              <div className="relative">
                <input
                  ref={amountRef}
                  type="text" inputMode="numeric"
                  value={numericAmount > 0 ? numericAmount.toLocaleString("fr-FR") : ""}
                  onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
                  placeholder="0"
                  className="w-full h-14 pl-4 pr-16 rounded-xl border border-border text-2xl font-bold text-foreground
                    focus:outline-none focus:ring-2 focus:ring-primary/40 bg-secondary/40 placeholder:text-muted-foreground/40
                    transition-all"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">FCFA</span>
              </div>
              {/* Montants rapides */}
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {QUICK_AMOUNTS.map((v) => (
                  <button key={v} onClick={() => setAmount(String(v))}
                    className={`h-7 px-2.5 rounded-lg text-xs font-semibold border transition-all
                      ${numericAmount === v
                        ? "bg-primary/10 border-primary/40 text-primary"
                        : "bg-secondary/60 border-border text-muted-foreground hover:bg-secondary hover:text-foreground"}`}>
                    {v >= 1000 ? `${v / 1000}k` : v}
                  </button>
                ))}
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-2">
                Titre / Description
              </label>
              <input
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                maxLength={100}
                placeholder="Ex : Commande pizza, Inscription cours…"
                className="w-full h-10 px-3 rounded-xl border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 bg-secondary/40 placeholder:text-muted-foreground/50 transition-all"
              />
            </div>

            {/* Options */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-2">Expiration</label>
                <div className="grid grid-cols-2 gap-1">
                  {EXPIRY_OPTIONS.map((opt, i) => (
                    <button key={i} onClick={() => setExpiryIdx(i)}
                      className={`h-8 rounded-lg text-xs font-medium border transition-all
                        ${expiryIdx === i ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-secondary"}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-2">Utilisations max</label>
                <div className="grid grid-cols-2 gap-1">
                  {MAX_USES_OPTIONS.map((opt, i) => (
                    <button key={i} onClick={() => setMaxUsesIdx(i)}
                      className={`h-8 rounded-lg text-xs font-medium border transition-all
                        ${maxUsesIdx === i ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-secondary"}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Prévisualisation */}
            {numericAmount >= 100 && desc.trim() && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                  <Link2 size={14} className="text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-primary/80 font-medium truncate">{desc}</p>
                  <p className="text-base font-bold text-primary">
                    {numericAmount.toLocaleString("fr-FR")} FCFA
                  </p>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-primary/60 font-medium shrink-0">
                  <Zap size={10} />
                  {EXPIRY_OPTIONS[expiryIdx].value ? EXPIRY_OPTIONS[expiryIdx].label : "∞"}
                </div>
              </div>
            )}

            {/* CTA */}
            <button onClick={handleCreate} disabled={creating || !isValid}
              className={`w-full h-11 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2
                ${isValid
                  ? "bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm shadow-primary/20"
                  : "bg-secondary text-muted-foreground cursor-not-allowed"}`}>
              {creating
                ? <><Loader2 size={15} className="animate-spin" /> Création en cours…</>
                : <>Créer le lien <ArrowUpRight size={15} /></>}
            </button>
          </div>
        ) : (
          /* Succès */
          <div className="px-5 py-6 text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto">
              <CheckCircle2 size={28} className="text-emerald-500" />
            </div>
            <div>
              <p className="font-bold text-foreground text-lg">Lien créé !</p>
              <p className="text-muted-foreground text-sm mt-1">{fmtFcfa(done.amount)} · {done.description}</p>
              {done.gross_amount && done.gross_amount !== done.amount && (
                <p className="text-xs text-muted-foreground mt-1">
                  Le payeur sera facturé <strong className="text-foreground">{fmtFcfa(done.gross_amount)}</strong>
                </p>
              )}
            </div>
            <div className="bg-secondary/60 rounded-xl border border-border p-3 text-left">
              <p className="font-mono text-xs text-muted-foreground break-all">{done.url}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => { navigator.clipboard.writeText(done.url); toast.success("Copié !"); }}
                className="h-10 rounded-xl border border-border text-sm text-foreground font-medium hover:bg-secondary transition-colors flex items-center justify-center gap-1.5">
                <Copy size={13} /> Copier
              </button>
              <button onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(`Payez-moi : ${done.url}`)}`, "_blank")}
                className="h-10 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition-colors flex items-center justify-center gap-1.5">
                <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                  <path d="M12 0C5.373 0 0 5.373 0 12c0 2.124.558 4.118 1.535 5.847L.057 23.7a.75.75 0 0 0 .92.921l5.944-1.478A11.954 11.954 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75A9.726 9.726 0 0 1 6.31 20.1l-.343-.204-3.532.878.892-3.44-.225-.356A9.72 9.72 0 0 1 2.25 12C2.25 6.615 6.615 2.25 12 2.25S21.75 6.615 21.75 12 17.385 21.75 12 21.75z"/>
                </svg>
                WhatsApp
              </button>
            </div>
            <button onClick={onClose} className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors">Fermer</button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Page principale ────────────────────────────────────────────────────── */
const PAGE_SIZE = 5;

export default function PaymentLinksPage() {
  const [links, setLinks]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShow] = useState(false);
  const [page, setPage]       = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await listMyLinks(); setLinks(d.items ?? []); }
    catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* Pagination */
  const totalPages  = Math.max(1, Math.ceil(links.length / PAGE_SIZE));
  const safePage    = Math.min(page, totalPages);
  const pageLinks   = links.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  /* Stats globales */
  const totalCollected = links.reduce((s, l) => s + (l.total_collected ?? 0), 0);
  const totalPayments  = links.reduce((s, l) => s + (l.paid_count ?? 0), 0);
  const activeCount    = links.filter((l) => l.status === "active").length;

  return (
    <div className="max-w-xl mx-auto px-4 py-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <Link2 size={18} className="text-primary" />
            <h1 className="text-lg font-bold text-foreground">Liens de paiement</h1>
          </div>
          <p className="text-sm text-muted-foreground">Partagez un lien pour recevoir des paiements Mobile Money.</p>
        </div>
        <button onClick={() => setShow(true)}
          className="h-9 px-4 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold
            flex items-center gap-1.5 transition-colors shadow-sm shadow-primary/20">
          <Plus size={15} /> Créer
        </button>
      </div>

      {/* Stats globales */}
      {links.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Total collecté", value: fmtFcfa(totalCollected), color: "text-emerald-600" },
            { label: "Paiements",      value: totalPayments,           color: "text-primary" },
            { label: "Liens actifs",   value: activeCount,             color: "text-foreground" },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-background rounded-xl border border-border shadow-sm px-4 py-3">
              <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-1">{label}</p>
              <p className={`text-base font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Liste */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={22} className="animate-spin text-muted-foreground/40" />
        </div>
      ) : links.length === 0 ? (
        <div className="bg-background rounded-2xl border border-border shadow-sm py-14 text-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-primary/5 border border-primary/10 flex items-center justify-center mx-auto">
            <Link2 size={24} className="text-primary/50" />
          </div>
          <div>
            <p className="font-semibold text-foreground">Aucun lien de paiement</p>
            <p className="text-sm text-muted-foreground mt-1">Créez votre premier lien et commencez à recevoir des paiements.</p>
          </div>
          <button onClick={() => setShow(true)}
            className="inline-flex items-center gap-1.5 text-sm text-primary font-semibold hover:underline">
            <Plus size={14} /> Créer un lien
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {pageLinks.map((l) => <LinkCard key={l.id} l={l} onRefresh={load} />)}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-muted-foreground">
                {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, links.length)} sur {links.length} liens
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className="h-8 w-8 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:bg-secondary disabled:opacity-30 transition-colors"
                >
                  <ChevronDown size={14} className="rotate-90" />
                </button>
                <span className="text-xs font-medium text-muted-foreground px-2">{safePage} / {totalPages}</span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                  className="h-8 w-8 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:bg-secondary disabled:opacity-30 transition-colors"
                >
                  <ChevronDown size={14} className="-rotate-90" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {showCreate && <CreateModal onClose={() => setShow(false)} onCreated={() => { setShow(false); load(); }} />}
    </div>
  );
}
