import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, ChevronLeft, ChevronRight, Copy, Edit2, ExternalLink, Link2, Loader2,
  MoreVertical, Pause, Play, QrCode, Trash2, TrendingUp,
  Users, X, CheckCircle2, AlertTriangle, Info, Calendar,
  Hash, Ban,
} from "lucide-react";
import { toast } from "sonner";
import {
  deleteLink, duplicateLink, editLink, getLinkById,
  getLinkTransactions, pauseLink,
} from "../api/paymentLinks";

const fmtFcfa = (n) => new Intl.NumberFormat("fr-FR").format(n ?? 0) + " FCFA";
const fmtDate = (iso) =>
  iso
    ? new Date(iso).toLocaleString("fr-FR", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      })
    : "—";

function StatusBadge({ status }) {
  const map = {
    active:    { cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20", dot: "bg-emerald-500", label: "Actif" },
    paused:    { cls: "bg-amber-500/10 text-amber-600 border-amber-500/20",       dot: "bg-amber-500",   label: "En pause" },
    suspended: { cls: "bg-red-500/10 text-red-600 border-red-500/20",             dot: "bg-red-500",     label: "Suspendu" },
    expired:   { cls: "bg-secondary text-muted-foreground border-border",         dot: "bg-muted-foreground", label: "Expiré" },
  };
  const s = map[status] || map.paused;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${s.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function TxStatusDot({ status }) {
  const cls = {
    completed: "bg-emerald-500",
    processing: "bg-blue-500 animate-pulse",
    pending: "bg-amber-400 animate-pulse",
    failed: "bg-red-500",
  };
  return <span className={`w-2 h-2 rounded-full shrink-0 mt-0.5 ${cls[status] ?? "bg-muted-foreground"}`} />;
}

function ProviderBadge({ provider }) {
  const mtn = provider?.toLowerCase().includes("mtn");
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${mtn ? "bg-yellow-500/10 text-yellow-600" : "bg-orange-500/10 text-orange-600"}`}>
      {mtn ? "MTN" : "Orange"}
    </span>
  );
}

function QrModal({ url, onClose }) {
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}`;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="bg-background border border-border rounded-2xl shadow-2xl p-6 w-full max-w-xs text-center space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="font-semibold text-foreground text-sm">QR Code de paiement</p>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-secondary flex items-center justify-center">
            <X size={14} className="text-muted-foreground" />
          </button>
        </div>
        <div className="flex items-center justify-center bg-secondary/40 rounded-xl p-4 border border-border">
          <img src={qrSrc} alt="QR Code" className="w-48 h-48 rounded-lg" />
        </div>
        <p className="text-xs text-muted-foreground break-all font-mono">{url}</p>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => { navigator.clipboard.writeText(url); toast.success("Lien copié !"); }}
            className="h-9 rounded-xl border border-border text-muted-foreground text-xs font-medium hover:bg-secondary transition-colors flex items-center justify-center gap-1.5">
            <Copy size={12} /> Copier
          </button>
          <a href={qrSrc} download="kobo-qr.png" target="_blank" rel="noreferrer"
            className="h-9 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-medium transition-colors flex items-center justify-center gap-1.5">
            Télécharger
          </a>
        </div>
      </div>
    </div>
  );
}

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
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-secondary flex items-center justify-center">
            <X size={14} className="text-muted-foreground" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">Description</label>
            <input value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={200}
              className="w-full h-10 px-3 rounded-xl border border-border text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 bg-secondary/40" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">Utilisations max</label>
            <div className="grid grid-cols-4 gap-2">
              {["", "1", "5", "10"].map((v) => (
                <button key={v} onClick={() => setMaxUses(v)}
                  className={`h-9 rounded-xl border text-sm font-medium transition-all ${String(maxUses) === v ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-secondary"}`}>
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

function ConfirmModal({ title, description, confirmLabel = "Confirmer", danger, onConfirm, onClose }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={onClose}>
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 space-y-4">
          <div className="flex items-start gap-4">
            <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${danger ? "bg-destructive/10" : "bg-amber-500/10"}`}>
              {danger ? <Trash2 size={20} className="text-destructive" /> : <AlertTriangle size={20} className="text-amber-600" />}
            </div>
            <div className="pt-0.5">
              <p className="font-semibold text-foreground">{title}</p>
              <p className="text-sm text-muted-foreground mt-1">{description}</p>
            </div>
          </div>
        </div>
        <div className="flex gap-2 px-6 pb-6">
          <button onClick={onClose} className="flex-1 h-10 rounded-xl border border-border text-sm text-muted-foreground hover:bg-secondary transition-colors font-medium">
            Annuler
          </button>
          <button onClick={() => { onConfirm(); onClose(); }}
            className={`flex-1 h-10 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 ${danger ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground" : "bg-amber-500 hover:bg-amber-600 text-white"}`}>
            {danger && <Trash2 size={13} />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PaymentLinkDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [link, setLink] = useState(null);
  const [txs, setTxs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [txLoading, setTxLoading] = useState(true);
  const [txPage, setTxPage] = useState(1);
  const TX_PAGE_SIZE = 10;
  const [qrOpen, setQrOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmPause, setConfirmPause] = useState(false);
  const [pausing, setPausing] = useState(false);

  const loadLink = useCallback(async () => {
    try {
      const d = await getLinkById(id);
      setLink(d);
    } catch {
      toast.error("Lien introuvable");
      navigate("/payment-links");
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  const loadTxs = useCallback(async () => {
    setTxLoading(true);
    try {
      const d = await getLinkTransactions(id);
      setTxs(d.items ?? []);
    } catch {
      toast.error("Impossible de charger les transactions");
    } finally {
      setTxLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadLink();
    loadTxs();
  }, [loadLink, loadTxs]);

  const handlePause = async () => {
    setPausing(true);
    try {
      await pauseLink(id);
      await loadLink();
      toast.success(link?.status === "active" ? "Lien mis en pause" : "Lien réactivé");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Erreur");
    } finally {
      setPausing(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteLink(id);
      toast.success("Lien supprimé");
      navigate("/payment-links");
    } catch {
      toast.error("Erreur lors de la suppression");
    }
  };

  const handleDuplicate = async () => {
    try {
      await duplicateLink(id);
      toast.success("Lien dupliqué !");
      navigate("/payment-links");
    } catch {
      toast.error("Erreur lors de la duplication");
    }
  };

  const txTotalPages = Math.max(1, Math.ceil(txs.length / TX_PAGE_SIZE));
  const pageTxs = txs.slice((txPage - 1) * TX_PAGE_SIZE, txPage * TX_PAGE_SIZE);

  const copy = () => { navigator.clipboard.writeText(link.url); toast.success("Lien copié !"); };
  const shareWa = () => window.open(`https://wa.me/?text=${encodeURIComponent(`Payez-moi via ce lien Kobo : ${link.url}`)}`, "_blank");

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={24} className="animate-spin text-muted-foreground/50" />
      </div>
    );
  }

  if (!link) return null;

  const isSuspended = link.status === "suspended";
  const isActive = link.status === "active";
  const hasGross = link.gross_amount && link.gross_amount !== link.amount;
  const koboFee = hasGross ? (link.gross_amount - link.amount) : null;

  return (
    <>
      {qrOpen && <QrModal url={link.url} onClose={() => setQrOpen(false)} />}
      {editOpen && <EditModal link={link} onClose={() => setEditOpen(false)} onSaved={loadLink} />}
      {confirmDelete && (
        <ConfirmModal danger
          title="Supprimer ce lien ?"
          description={`"${link.description}" (${fmtFcfa(link.amount)}) sera définitivement supprimé.`}
          confirmLabel="Supprimer"
          onConfirm={handleDelete}
          onClose={() => setConfirmDelete(false)}
        />
      )}
      {confirmPause && (
        <ConfirmModal
          title={isActive ? "Mettre en pause ?" : "Réactiver le lien ?"}
          description={isActive
            ? "Le lien sera temporairement désactivé. Les payeurs ne pourront plus l'utiliser."
            : "Le lien sera de nouveau actif et acceptera les paiements."}
          confirmLabel={isActive ? "Mettre en pause" : "Réactiver"}
          onConfirm={handlePause}
          onClose={() => setConfirmPause(false)}
        />
      )}

      <div className="max-w-xl mx-auto px-4 py-6 space-y-5">

        {/* Header nav */}
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/payment-links")}
            className="p-2 rounded-full hover:bg-secondary transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-foreground text-lg truncate">{link.description}</h1>
              <StatusBadge status={link.status} />
            </div>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">{link.id}</p>
          </div>
          <div className="relative">
            <ContextMenu items={[
              { label: "Modifier", icon: Edit2, onClick: () => setEditOpen(true), disabled: isSuspended },
              { label: "Dupliquer", icon: Copy, onClick: handleDuplicate },
              { label: isActive ? "Mettre en pause" : "Réactiver", icon: isActive ? Pause : Play, onClick: () => setConfirmPause(true), disabled: isSuspended },
              { label: "Supprimer", icon: Trash2, onClick: () => setConfirmDelete(true), danger: true },
            ]} />
          </div>
        </div>

        {/* Suspended banner */}
        {isSuspended && (
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20">
            <Ban size={16} className="text-red-500 shrink-0 mt-0.5" />
            <p className="text-sm text-red-600 dark:text-red-400">
              Ce lien a été <strong>suspendu par l'administration</strong>. Les paiements sont bloqués. Contactez le support pour plus d'informations.
            </p>
          </div>
        )}

        {/* Montant card */}
        <div className="bg-background rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="bg-gradient-to-br from-primary/5 to-primary/10 px-6 py-5 border-b border-border">
            <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-1">Vous recevez</p>
            <p className="font-bold text-4xl text-foreground tracking-tight">{fmtFcfa(link.amount)}</p>
            {hasGross && (
              <div className="mt-2 flex items-center gap-1.5">
                <Info size={12} className="text-muted-foreground shrink-0" />
                <p className="text-xs text-muted-foreground">
                  Le payeur est facturé <strong className="text-foreground">{fmtFcfa(link.gross_amount)}</strong>
                  <span className="text-muted-foreground"> (frais inclus : {fmtFcfa(koboFee)})</span>
                </p>
              </div>
            )}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 divide-x divide-border">
            <div className="px-4 py-3 text-center">
              <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-1">Paiements</p>
              <p className="text-xl font-bold text-foreground">{link.paid_count ?? 0}</p>
              {link.max_uses && <p className="text-[10px] text-muted-foreground">/ {link.max_uses} max</p>}
            </div>
            <div className="px-4 py-3 text-center">
              <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-1">Collecté</p>
              <p className="text-xl font-bold text-emerald-600">{fmtFcfa(link.total_collected ?? 0)}</p>
            </div>
            <div className="px-4 py-3 text-center">
              <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-1">Expiration</p>
              <p className="text-xs font-semibold text-foreground mt-1">
                {link.expires_at ? new Date(link.expires_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : "∞"}
              </p>
            </div>
          </div>
        </div>

        {/* Actions partage */}
        <div className="grid grid-cols-2 gap-2">
          <button onClick={copy}
            className="h-10 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold flex items-center justify-center gap-2 transition-colors shadow-sm shadow-primary/20">
            <Copy size={14} /> Copier le lien
          </button>
          <button onClick={shareWa}
            className="h-10 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors">
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white shrink-0">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
              <path d="M12 0C5.373 0 0 5.373 0 12c0 2.124.558 4.118 1.535 5.847L.057 23.7a.75.75 0 0 0 .92.921l5.944-1.478A11.954 11.954 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75A9.726 9.726 0 0 1 6.31 20.1l-.343-.204-3.532.878.892-3.44-.225-.356A9.72 9.72 0 0 1 2.25 12C2.25 6.615 6.615 2.25 12 2.25S21.75 6.615 21.75 12 17.385 21.75 12 21.75z"/>
            </svg>
            WhatsApp
          </button>
          <button onClick={() => setQrOpen(true)}
            className="h-10 rounded-xl border border-border hover:bg-secondary text-foreground text-sm font-medium flex items-center justify-center gap-2 transition-colors">
            <QrCode size={14} /> QR Code
          </button>
          <a href={link.url} target="_blank" rel="noreferrer"
            className="h-10 rounded-xl border border-border hover:bg-secondary text-foreground text-sm font-medium flex items-center justify-center gap-2 transition-colors">
            <ExternalLink size={14} /> Voir la page
          </a>
        </div>

        {/* Infos du lien */}
        <div className="bg-background rounded-2xl border border-border shadow-sm divide-y divide-border overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3">
            <Hash size={14} className="text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground">Identifiant</p>
              <p className="font-mono text-xs text-foreground truncate">{link.id}</p>
            </div>
            <button onClick={() => { navigator.clipboard.writeText(link.id); toast.success("ID copié"); }}
              className="p-1.5 rounded-lg hover:bg-secondary transition-colors">
              <Copy size={12} className="text-muted-foreground" />
            </button>
          </div>
          <div className="flex items-center gap-3 px-4 py-3">
            <Calendar size={14} className="text-muted-foreground shrink-0" />
            <div className="flex-1">
              <p className="text-xs text-muted-foreground">Créé le</p>
              <p className="text-sm text-foreground">{fmtDate(link.created_at)}</p>
            </div>
          </div>
          {link.expires_at && (
            <div className="flex items-center gap-3 px-4 py-3">
              <AlertTriangle size={14} className="text-amber-500 shrink-0" />
              <div className="flex-1">
                <p className="text-xs text-muted-foreground">Expire le</p>
                <p className="text-sm text-foreground">{fmtDate(link.expires_at)}</p>
              </div>
            </div>
          )}
          {link.max_uses && (
            <div className="flex items-center gap-3 px-4 py-3">
              <Users size={14} className="text-muted-foreground shrink-0" />
              <div className="flex-1">
                <p className="text-xs text-muted-foreground">Utilisations</p>
                <p className="text-sm text-foreground">{link.use_count ?? 0} / {link.max_uses}</p>
              </div>
            </div>
          )}
        </div>

        {/* Actions secondaires */}
        {!isSuspended && (
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setConfirmPause(true)}
              disabled={pausing}
              className="h-10 rounded-xl border border-border hover:bg-secondary text-sm font-medium flex items-center justify-center gap-2 text-foreground transition-colors disabled:opacity-50"
            >
              {isActive ? <Pause size={14} /> : <Play size={14} />}
              {isActive ? "Mettre en pause" : "Réactiver"}
            </button>
            <button onClick={() => setEditOpen(true)}
              className="h-10 rounded-xl border border-border hover:bg-secondary text-sm font-medium flex items-center justify-center gap-2 text-foreground transition-colors">
              <Edit2 size={14} /> Modifier
            </button>
          </div>
        )}

        {/* Transactions */}
        <div className="bg-background rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp size={14} className="text-muted-foreground" />
              <p className="font-semibold text-sm text-foreground">Transactions</p>
            </div>
            <span className="text-xs text-muted-foreground">{txs.length} au total</span>
          </div>

          {txLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 size={16} className="animate-spin text-muted-foreground/50" />
            </div>
          ) : txs.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center mx-auto">
                <Users size={16} className="text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">Aucune transaction pour ce lien.</p>
              <p className="text-xs text-muted-foreground">Partagez votre lien pour recevoir des paiements.</p>
            </div>
          ) : (
            <>
              <div className="divide-y divide-border">
                {pageTxs.map((t, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/30 transition-colors">
                    <TxStatusDot status={t.status} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-foreground">{t.payer_phone_display}</span>
                        <ProviderBadge provider={t.provider} />
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{fmtDate(t.created_at)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-semibold ${t.status === "completed" ? "text-emerald-600" : "text-muted-foreground"}`}>
                        {t.status === "completed" ? `+${fmtFcfa(t.net_fcfa)}` : fmtFcfa(t.amount)}
                      </p>
                      <p className={`text-[10px] font-medium ${
                        t.status === "completed" ? "text-emerald-500" :
                        t.status === "pending" || t.status === "processing" ? "text-amber-500" :
                        "text-red-500"
                      }`}>
                        {t.status === "completed" ? "Complété" :
                         t.status === "processing" ? "En cours" :
                         t.status === "pending" ? "En attente" : "Échoué"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              {txTotalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                  <p className="text-xs text-muted-foreground">
                    {(txPage - 1) * TX_PAGE_SIZE + 1}–{Math.min(txPage * TX_PAGE_SIZE, txs.length)} sur {txs.length}
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setTxPage((p) => Math.max(1, p - 1))}
                      disabled={txPage === 1}
                      className="h-7 w-7 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:bg-secondary disabled:opacity-30 transition-colors"
                    >
                      <ChevronLeft size={13} />
                    </button>
                    <span className="text-xs font-medium text-muted-foreground px-2">{txPage} / {txTotalPages}</span>
                    <button
                      onClick={() => setTxPage((p) => Math.min(txTotalPages, p + 1))}
                      disabled={txPage === txTotalPages}
                      className="h-7 w-7 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:bg-secondary disabled:opacity-30 transition-colors"
                    >
                      <ChevronRight size={13} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Zone danger */}
        <div className="pt-2">
          <button onClick={() => setConfirmDelete(true)}
            className="w-full h-10 rounded-xl border border-destructive/30 text-destructive text-sm font-medium hover:bg-destructive/5 transition-colors flex items-center justify-center gap-2">
            <Trash2 size={14} /> Supprimer ce lien
          </button>
        </div>

      </div>
    </>
  );
}

/* ── Context menu ─────────────────────────────────────────────────────────── */
function ContextMenu({ items }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((v) => !v)}
        className="w-9 h-9 rounded-xl hover:bg-secondary flex items-center justify-center transition-colors">
        <MoreVertical size={16} className="text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-background border border-border rounded-xl shadow-lg py-1 z-30">
          {items.map(({ label, icon: Icon, onClick, danger, disabled }) => (
            <button key={label}
              onClick={() => { if (!disabled) { onClick(); setOpen(false); } }}
              disabled={disabled}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors
                ${disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-secondary"}
                ${danger ? "text-destructive" : "text-foreground"}`}>
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
