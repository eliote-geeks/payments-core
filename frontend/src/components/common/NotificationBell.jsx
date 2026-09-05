import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellOff, Check, CheckCheck, Trash2, X, CheckCircle, XCircle, ShieldCheck, ShieldX, MessageSquare, ArrowLeftRight } from "lucide-react";
import {
  deleteAllNotifications,
  deleteNotification,
  getNotifications,
  markAllRead,
  markOneRead,
} from "../../api/notifications";
import { toast } from "sonner";

const TYPE_ICONS = {
  deposit_confirmed:    { icon: CheckCircle,   color: "text-green-500" },
  deposit_rejected:     { icon: XCircle,        color: "text-red-500" },
  withdrawal_completed: { icon: CheckCircle,   color: "text-green-500" },
  withdrawal_rejected:  { icon: XCircle,        color: "text-red-500" },
  kyc_approved:         { icon: ShieldCheck,   color: "text-green-500" },
  kyc_rejected:         { icon: ShieldX,        color: "text-red-500" },
  ticket_reply:         { icon: MessageSquare, color: "text-blue-500" },
  p2p_received:         { icon: ArrowLeftRight,color: "text-purple-500" },
  transfer_completed:   { icon: CheckCircle,   color: "text-green-500" },
};

const TYPE_COLORS = {
  deposit_confirmed: "text-green-600 dark:text-green-400",
  withdrawal_completed: "text-green-600 dark:text-green-400",
  kyc_approved: "text-green-600 dark:text-green-400",
  deposit_rejected: "text-red-500",
  withdrawal_rejected: "text-red-500",
  kyc_rejected: "text-red-500",
  ticket_reply: "text-blue-500",
  p2p_received: "text-purple-500",
};

function formatRelative(iso) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "À l'instant";
  if (diff < 3600) return `Il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `Il y a ${Math.floor(diff / 3600)}h`;
  if (diff < 172800) return "Hier";
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

export function NotificationBell({ className = "" }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const ref = useRef(null);

  const load = useCallback(async () => {
    try {
      const data = await getNotifications(50);
      setItems(data.items || []);
      setUnread(data.unread || 0);
    } catch {
      // silent - user might not be auth'd yet
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Poll every 30s
  useEffect(() => {
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleOpen = async () => {
    setOpen((v) => !v);
    if (!open && unread > 0) {
      try { await markAllRead(); setUnread(0); setItems((prev) => prev.map((n) => ({ ...n, read: true }))); }
      catch { /* silent */ }
    }
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    try {
      await deleteNotification(id);
      setItems((prev) => prev.filter((n) => n.id !== id));
    } catch { toast.error("Impossible de supprimer"); }
  };

  const handleDeleteAll = async () => {
    try {
      await deleteAllNotifications();
      setItems([]);
      setUnread(0);
    } catch { toast.error("Impossible de supprimer"); }
  };

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        type="button"
        onClick={handleOpen}
        className="relative h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-base"
        aria-label="Notifications"
      >
        <Bell size={16} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 min-w-[16px] px-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 w-80 max-w-[calc(100vw-16px)] bg-background border border-border rounded-2xl shadow-2xl z-50 overflow-hidden" style={{ maxHeight: "calc(100vh - 80px)" }}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Bell size={14} className="text-muted-foreground" />
              <span className="text-sm font-semibold">Notifications</span>
              {unread > 0 && (
                <span className="h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center">{unread}</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {items.length > 0 && (
                <button onClick={handleDeleteAll} className="h-7 px-2 rounded-md text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex items-center gap-1 transition-colors" title="Tout supprimer">
                  <Trash2 size={12} /> Tout effacer
                </button>
              )}
              <button onClick={() => setOpen(false)} className="h-7 w-7 rounded-md hover:bg-secondary flex items-center justify-center text-muted-foreground">
                <X size={14} />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="overflow-y-auto divide-y divide-border" style={{ maxHeight: "calc(100vh - 160px)" }}>
            {items.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-10 text-muted-foreground">
                <BellOff size={28} className="opacity-30" />
                <p className="text-sm">Aucune notification</p>
              </div>
            ) : (
              items.map((notif) => (
                <div
                  key={notif.id}
                  className={`flex items-start gap-3 px-4 py-3 hover:bg-secondary/30 transition-colors group ${!notif.read ? "bg-primary/3" : ""}`}
                >
                  {(() => { const t = TYPE_ICONS[notif.type]; const Icon = t ? t.icon : Bell; const color = t ? t.color : "text-muted-foreground"; return <Icon size={16} className={`mt-0.5 shrink-0 ${color}`} />; })()}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-1">
                      <p className={`text-xs font-semibold leading-snug ${!notif.read ? "text-foreground" : "text-muted-foreground"}`}>
                        {notif.title}
                      </p>
                      {!notif.read && <span className="h-2 w-2 rounded-full bg-primary shrink-0 mt-1" />}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{notif.body}</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-1">{formatRelative(notif.created_at)}</p>
                  </div>
                  <button
                    onClick={(e) => handleDelete(notif.id, e)}
                    className="opacity-0 group-hover:opacity-100 h-6 w-6 rounded-md hover:bg-destructive/10 hover:text-destructive flex items-center justify-center text-muted-foreground shrink-0 transition-all"
                    title="Supprimer"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))
            )}
          </div>

          {items.length > 0 && (
            <div className="px-4 py-2 border-t border-border text-center">
              <p className="text-xs text-muted-foreground">{items.length} notification{items.length > 1 ? "s" : ""}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
