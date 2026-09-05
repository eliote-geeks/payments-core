import React, { useEffect, useRef, useState } from "react";
import {
  Send, HelpCircle, MessageCircle, TicketCheck, Plus, Loader2,
  ChevronRight, X, ChevronDown,
} from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../components/ui/accordion";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Button } from "../components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { Label } from "../components/ui/label";
import { useI18n } from "../context/I18nContext";
import { createTicket, getFaq, getSupportChat, getTickets, sendSupportChat } from "../api/support";
import { toast } from "sonner";

// ─── Static FAQ fallback ──────────────────────────────────────────────────────

const STATIC_FAQ = [
  {
    q_fr: "Comment créer un compte Kobo ?",
    q_en: "How do I create a Kobo account?",
    a_fr: "Rendez-vous sur koboonline.com, cliquez sur 'Créer un compte', entrez votre email, votre nom complet et votre date de naissance. Vous recevrez un code OTP par email — pas de mot de passe à retenir.",
    a_en: "Go to koboonline.com, click 'Create account', enter your email, full name and date of birth. You'll receive an OTP code by email — no password to remember.",
  },
  {
    q_fr: "Comment déposer de l'argent sur Kobo ?",
    q_en: "How do I deposit money on Kobo?",
    a_fr: "Trois méthodes disponibles : (1) Virement bancaire SEPA en EUR ou USD — Kobo vous fournit un IBAN de destination + une référence unique à mentionner obligatoirement. Crédit sous 1 à 3 jours ouvrés. (2) Crypto (USDT TRC20 ou BTC) — copiez l'adresse de dépôt, envoyez depuis votre wallet, soumettez le hash de transaction. (3) Mobile Money FCFA — dans l'onglet Portefeuille > Déposer.",
    a_en: "Three methods available: (1) SEPA bank transfer in EUR or USD — Kobo gives you a destination IBAN + a unique reference you must include. Credit in 1–3 business days. (2) Crypto (USDT TRC20 or BTC) — copy the deposit address, send from your wallet, submit the transaction hash. (3) Mobile Money FCFA — in Wallet > Deposit tab.",
  },
  {
    q_fr: "Combien de temps prend un dépôt ?",
    q_en: "How long does a deposit take?",
    a_fr: "Dépôt crypto (USDT/BTC) : confirmé sous 15 à 60 minutes après validation sur la blockchain. Virement bancaire SEPA : 1 à 3 jours ouvrés après réception par Kobo. Mobile Money : quelques minutes après confirmation.",
    a_en: "Crypto deposit (USDT/BTC): confirmed within 15–60 minutes after blockchain validation. SEPA bank transfer: 1–3 business days after Kobo receives it. Mobile Money: a few minutes after confirmation.",
  },
  {
    q_fr: "Quels sont les frais pour un retrait ?",
    q_en: "What are the fees for a withdrawal?",
    a_fr: "Retrait Mobile Money (MTN/Orange) : 1,5% du montant, minimum 100 FCFA. Virement bancaire sortant : frais affichés avant confirmation selon le montant. Retrait crypto (USDT/BTC) : frais réseau uniquement. Tous les frais sont affichés avant validation.",
    a_en: "Mobile Money (MTN/Orange) withdrawal: 1.5% of the amount, min 100 FCFA. Outgoing bank transfer: fees shown before confirming based on amount. Crypto withdrawal (USDT/BTC): network fees only. All fees are displayed before you confirm.",
  },
  {
    q_fr: "Comment vérifier mon identité (KYC) ?",
    q_en: "How do I verify my identity (KYC)?",
    a_fr: "Allez dans 'Plus > Vérification d'identité'. Téléchargez une photo recto et verso de votre CNI ou passeport, ainsi qu'un selfie. La vérification prend entre 1 et 24 heures. Le KYC est requis pour effectuer des retraits et des virements.",
    a_en: "Go to 'More > Identity Verification'. Upload front and back photos of your national ID or passport, plus a selfie. Verification takes 1 to 24 hours. KYC is required for withdrawals and bank transfers.",
  },
  {
    q_fr: "Puis-je envoyer de l'argent à quelqu'un sans compte Kobo ?",
    q_en: "Can I send money to someone without a Kobo account?",
    a_fr: "Non. Les transferts P2P nécessitent que le destinataire soit inscrit sur Kobo. Le minimum est 500 FCFA avec des frais de 1,5%. Invitez votre contact à créer un compte sur koboonline.com.",
    a_en: "No. P2P transfers require the recipient to be registered on Kobo. The minimum is 500 FCFA with 1.5% fees. Invite your contact to create an account at koboonline.com.",
  },
  {
    q_fr: "Comment fonctionne le transfert international ?",
    q_en: "How does the international transfer work?",
    a_fr: "Vous ou quelqu'un de l'étranger pouvez envoyer EUR, USD ou GBP vers un compte Kobo. Les fonds sont convertis en FCFA au taux du marché. Allez dans 'Transfert > International' pour obtenir les instructions de virement et un devis en temps réel.",
    a_en: "You or someone abroad can send EUR, USD or GBP to a Kobo account. Funds are converted to FCFA at the market rate. Go to 'Transfer > International' for wire transfer instructions and a real-time quote.",
  },
  {
    q_fr: "Comment récupérer mon compte si je n'ai plus accès à mon email ?",
    q_en: "How do I recover my account without email access?",
    a_fr: "Kobo dispose d'un système de codes de récupération d'urgence (format KOBO-XXXX-XXXX). Générez-les dans Profil > Sécurité > Codes de secours avant d'en avoir besoin. Sur la page de connexion, cliquez sur 'Accès de secours' pour les utiliser.",
    a_en: "Kobo has an emergency recovery code system (KOBO-XXXX-XXXX format). Generate them in Profile > Security > Recovery codes before you need them. On the sign-in page, click 'Emergency access' to use them.",
  },
  {
    q_fr: "Mon solde n'a pas été crédité après mon dépôt. Que faire ?",
    q_en: "My balance wasn't credited after my deposit. What should I do?",
    a_fr: "Pour un dépôt crypto, vérifiez que votre transaction est confirmée sur la blockchain (TronScan pour TRC20). Si confirmée et non créditée après 2h, ouvrez un ticket avec le hash. Pour un virement bancaire, vérifiez que la référence unique était bien dans le libellé.",
    a_en: "For a crypto deposit, check that your transaction is confirmed on the blockchain (TronScan for TRC20). If confirmed but not credited after 2h, open a ticket with the hash. For a bank transfer, check that the unique reference was in the payment description.",
  },
  {
    q_fr: "Est-ce que Kobo est sécurisé ?",
    q_en: "Is Kobo secure?",
    a_fr: "Oui. Connexion par OTP email (pas de mot de passe à voler), code PIN à 6 chiffres pour les opérations sensibles, journal des sessions actives dans Profil > Sécurité, codes de récupération d'urgence, et système anti-fraude automatique.",
    a_en: "Yes. OTP email sign-in (no password to steal), 6-digit PIN for sensitive operations, active session log in Profile > Security, emergency recovery codes, and automatic fraud detection.",
  },
  {
    q_fr: "Comment changer mon code PIN ou mes informations ?",
    q_en: "How do I change my PIN or account details?",
    a_fr: "Tout se gère dans Profil > Sécurité : changement de PIN, gestion des sessions actives, génération de codes de secours, et modification de l'email de contact (validation par OTP).",
    a_en: "Everything is managed in Profile > Security: PIN change, active session management, recovery code generation, and contact email update (OTP validation required).",
  },
];

// ─── Chatbot ──────────────────────────────────────────────────────────────────

const BOT_RULES = [
  { keywords: ["dépôt", "depot", "deposit", "crédité", "credit"], answer: "Les dépôts crypto USDT sont confirmés manuellement par notre équipe sous 15 à 60 min. Si votre solde n'est pas crédité après 2h, ouvrez un ticket avec votre hash de transaction." },
  { keywords: ["retrait", "withdraw", "mobile money", "mtn", "orange"], answer: "Les retraits Mobile Money (MTN/Orange) ont des frais de 1,5% minimum 100 FCFA. Ils sont traités en quelques minutes après validation." },
  { keywords: ["transfer", "transfert", "envoyer", "send", "p2p"], answer: "Les transferts P2P (FCFA) sont instantanés entre utilisateurs Kobo. Le minimum est 500 FCFA. Des frais de 1,5% s'appliquent." },
  { keywords: ["international", "eur", "usd", "gbp", "virement"], answer: "Kobo permet l'envoi EUR/USD/GBP → FCFA. Allez dans Transfert > International pour obtenir un devis en temps réel." },
  { keywords: ["kyc", "vérif", "verif", "identité", "identite", "passeport", "cni"], answer: "La vérification KYC se fait dans 'Plus > Vérification'. Téléchargez votre pièce d'identité et un selfie. Délai : 1 à 24h." },
  { keywords: ["pin", "code", "mot de passe", "password"], answer: "Changez votre PIN dans Profil > Sécurité > Changer le code PIN. Si vous l'avez oublié, contactez notre support." },
  { keywords: ["session", "connecté", "appareil", "device", "déconnecter"], answer: "Consultez vos sessions actives dans Profil > Sécurité. Vous pouvez déconnecter toute session à distance." },
  { keywords: ["frais", "commission", "fee", "combien coute", "coût"], answer: "Les frais varient selon l'opération : P2P 1,5% (min 100 FCFA), retraits mobile money 1,5%, dépôts crypto 0%. Les frais sont toujours affichés avant confirmation." },
  { keywords: ["compte", "inscri", "registr", "signup", "créer"], answer: "Créez votre compte Kobo en 2 minutes sur koboonline.com. Entrez votre email, votre nom et activez votre compte par code OTP." },
  { keywords: ["bonjour", "salut", "hello", "hi"], answer: "Bonjour ! Je suis l'assistant Kobo. Comment puis-je vous aider ? Posez votre question en français ou en anglais." },
];

function getBotAnswer(input) {
  const lower = input.toLowerCase();
  for (const rule of BOT_RULES) {
    if (rule.keywords.some((k) => lower.includes(k))) return rule.answer;
  }
  return "Je n'ai pas trouvé de réponse précise à votre question. N'hésitez pas à ouvrir un ticket de support dans l'onglet 'Mes tickets' — notre équipe vous répond sous 24h.";
}

function FloatingChatbot() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([
    { from: "bot", text: "Bonjour ! Je suis l'assistant Kobo. Posez-moi une question sur les dépôts, retraits, transferts, KYC…" },
  ]);
  const [input, setInput] = useState("");
  const bottomRef = useRef(null);

  useEffect(() => {
    if (open) setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 60);
  }, [open, msgs.length]);

  const send = (e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text) return;
    const userMsg = { from: "user", text };
    const botMsg = { from: "bot", text: getBotAnswer(text) };
    setMsgs((prev) => [...prev, userMsg, botMsg]);
    setInput("");
  };

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-50 h-13 w-13 rounded-full bg-primary text-white shadow-lg flex items-center justify-center hover:bg-primary/90 transition-all hover:scale-105"
        style={{ height: 52, width: 52 }}
        aria-label="Assistant Kobo"
      >
        {open ? <X size={22} /> : <Bot size={22} />}
      </button>

      {/* Chat window */}
      {open && (
        <div className="fixed bottom-36 right-4 md:bottom-24 md:right-6 z-50 w-80 shadow-2xl rounded-2xl overflow-hidden border border-border bg-background flex flex-col" style={{ maxHeight: 420 }}>
          <div className="flex items-center gap-2.5 px-4 py-3 bg-primary text-white">
            <div className="h-7 w-7 rounded-full bg-white/20 flex items-center justify-center shrink-0">
              <Bot size={15} className="text-white" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">Assistant Kobo</p>
              <p className="text-[10px] opacity-70">Répond automatiquement</p>
            </div>
            <button onClick={() => setOpen(false)} className="opacity-70 hover:opacity-100"><X size={15} /></button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5" style={{ maxHeight: 300 }}>
            {msgs.map((m, i) => (
              <div key={i} className={`flex gap-2 ${m.from === "user" ? "justify-end" : "justify-start"}`}>
                {m.from === "bot" && (
                  <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot size={12} className="text-primary" />
                  </div>
                )}
                <div className={`px-3 py-2 rounded-xl text-xs leading-relaxed max-w-[85%] ${m.from === "user" ? "bg-primary text-white rounded-br-sm" : "bg-secondary text-foreground rounded-bl-sm"}`}>
                  {m.text}
                </div>
                {m.from === "user" && (
                  <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <UserIcon size={12} className="text-primary" />
                  </div>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={send} className="border-t border-border px-3 py-2.5 flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Posez votre question…"
              className="flex-1 text-xs bg-secondary rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-primary/40"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            />
            <button type="submit" disabled={!input.trim()} className="h-8 w-8 rounded-lg bg-primary text-white flex items-center justify-center hover:bg-primary/90 disabled:opacity-40">
              <Send size={13} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

function ChatTab({ t, lang }) {
  const [messages, setMessages] = useState(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);
  const pollRef = useRef(null);

  const scrollBottom = (behavior = "smooth") =>
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior }), 60);

  const load = async () => {
    try {
      const items = await getSupportChat();
      setMessages(items || []);
    } catch {
      setMessages([]);
    }
  };

  useEffect(() => {
    load().then(() => scrollBottom("instant"));
    pollRef.current = setInterval(() => {
      getSupportChat()
        .then((items) => {
          setMessages((prev) => {
            if (!prev || items.length > prev.length) { scrollBottom(); return items; }
            return prev;
          });
        })
        .catch(() => {});
    }, 8000);
    return () => clearInterval(pollRef.current);
  }, []); // eslint-disable-line

  useEffect(() => { if (messages?.length) scrollBottom(); }, [messages?.length]); // eslint-disable-line

  const handleSend = async (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    setSending(true);
    const optimistic = { from: "user", text, time: new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }), ts: new Date().toISOString() };
    setMessages((prev) => [...(prev || []), optimistic]);
    try {
      await sendSupportChat(text);
      const updated = await getSupportChat();
      setMessages(updated);
    } catch {
      toast.error("Impossible d'envoyer le message");
      setMessages((prev) => prev?.filter((m) => m !== optimistic) ?? []);
    } finally {
      setSending(false);
    }
  };

  const loading = messages === null;

  return (
    <div className="rounded-xl bg-surface border border-border flex flex-col" style={{ height: "520px" }}>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <MessageCircle size={15} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Support Kobo</p>
          <p className="text-xs text-success">● En ligne</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" data-testid="chat-messages">
        {loading && <div className="flex justify-center py-8"><Loader2 size={22} className="animate-spin text-primary" /></div>}
        {!loading && messages.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-12 text-center text-muted-foreground">
            <MessageCircle size={32} className="opacity-30" />
            <p className="text-sm">Envoyez un message pour démarrer la conversation.</p>
          </div>
        )}
        {(messages || []).map((m, i) => (
          <div key={m.ts || i} className={`flex ${m.from === "user" ? "justify-end" : "justify-start"}`}>
            {m.from !== "user" && (
              <div className="h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0 mr-2 mt-0.5 text-xs font-bold">
                {(m.name || "S").charAt(0).toUpperCase()}
              </div>
            )}
            <div className="max-w-[75%] space-y-0.5">
              {m.from !== "user" && m.name && <p className="text-[10px] font-semibold text-muted-foreground px-1">{m.name}</p>}
              <div className={`px-3 py-2 rounded-xl text-sm leading-relaxed ${m.from === "user" ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-secondary text-foreground rounded-bl-sm"}`}>
                <p>{m.text}</p>
              </div>
              <p className={`text-[10px] px-1 ${m.from === "user" ? "text-right text-muted-foreground" : "text-muted-foreground"}`}>
                {m.time}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="border-t border-border p-3 flex items-center gap-2">
        <Input
          data-testid="chat-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("support.typeMessage")}
          className="flex-1 rounded-md"
          disabled={sending}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(e); } }}
        />
        <Button type="submit" disabled={!draft.trim() || sending} data-testid="chat-send" className="bg-primary hover:bg-primary/90 rounded-md text-primary-foreground h-9 w-9 p-0">
          {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </Button>
      </form>
    </div>
  );
}

// ─── Tickets ──────────────────────────────────────────────────────────────────

const STATUS_STYLES = {
  open: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  resolved: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  closed: "bg-secondary text-muted-foreground",
};
const STATUS_LABELS = { open: "Ouvert", resolved: "Résolu", closed: "Fermé" };

function TicketsTab({ t, lang }) {
  const [tickets, setTickets] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getTickets()
      .then((items) => setTickets(items || []))
      .catch(() => setTickets([]));
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!subject.trim() || !body.trim()) return;
    setSubmitting(true);
    try {
      const tk = await createTicket(subject.trim(), body.trim());
      setTickets((prev) => [tk, ...(prev || [])]);
      setFormOpen(false);
      setSubject("");
      setBody("");
      toast.success("Ticket créé — notre équipe vous répondra sous 24h");
    } catch (err) {
      toast.error(err?.response?.data?.detail || t("common.retry"));
    } finally {
      setSubmitting(false);
    }
  };

  const loading = tickets === null;

  return (
    <div className="space-y-4" data-testid="tickets-list">
      {/* New ticket button / form */}
      <div className="rounded-xl border border-border overflow-hidden bg-surface">
        <button
          data-testid="new-ticket-btn"
          onClick={() => setFormOpen((v) => !v)}
          className="w-full flex items-center gap-3 p-4 hover:bg-secondary/50 transition-colors text-left"
        >
          <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Plus size={18} className="text-primary" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-sm">Ouvrir un nouveau ticket</p>
            <p className="text-xs text-muted-foreground">Décrivez votre problème — réponse sous 24h</p>
          </div>
          <ChevronDown size={16} className={`text-muted-foreground transition-transform ${formOpen ? "rotate-180" : ""}`} />
        </button>

        {/* Inline collapsible form */}
        {formOpen && (
          <form onSubmit={handleCreate} className="border-t border-border px-4 pb-4 pt-4 space-y-4 bg-secondary/20">
            <div>
              <Label className="text-sm font-medium">Sujet</Label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Ex : Problème de retrait"
                className="rounded-lg mt-1.5"
                maxLength={140}
                autoFocus
              />
            </div>
            <div>
              <Label className="text-sm font-medium">Description</Label>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Décrivez votre problème en détail…"
                className="rounded-lg mt-1.5 min-h-[100px] resize-none"
                maxLength={2000}
              />
              <p className="text-xs text-muted-foreground mt-1 text-right">{body.length}/2000</p>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)} className="flex-1 rounded-lg">Annuler</Button>
              <Button type="submit" disabled={submitting || !subject.trim() || !body.trim()} className="flex-1 rounded-lg">
                {submitting ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <Send size={14} className="mr-1.5" />}
                Envoyer
              </Button>
            </div>
          </form>
        )}
      </div>

      {/* Ticket list */}
      {loading && <div className="flex justify-center py-10"><Loader2 size={22} className="animate-spin text-primary" /></div>}

      {!loading && tickets.length === 0 && (
        <div className="rounded-xl bg-surface border border-border py-12 flex flex-col items-center gap-3 text-muted-foreground">
          <TicketCheck size={32} className="opacity-30" />
          <p className="text-sm">Aucun ticket pour le moment</p>
        </div>
      )}

      {(tickets || []).map((tk) => (
        <div key={tk.id} className="rounded-xl bg-surface border border-border p-4 flex items-start gap-3" data-testid={`ticket-${tk.id}`}>
          <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${tk.status === "open" ? "bg-amber-100 text-amber-600 dark:bg-amber-900/30" : "bg-secondary text-muted-foreground"}`}>
            <TicketCheck size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold text-sm leading-snug">{tk.subject}</p>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${STATUS_STYLES[tk.status] || STATUS_STYLES.closed}`}>
                {STATUS_LABELS[tk.status] || tk.status}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              #{tk.id.slice(-8).toUpperCase()} · {new Date(tk.updatedAt || tk.created_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "2-digit" })}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── FAQ ──────────────────────────────────────────────────────────────────────

function FaqTab({ t, lang }) {
  const [faq, setFaq] = useState(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    getFaq()
      .then((items) => setFaq(items && items.length > 0 ? items : STATIC_FAQ))
      .catch(() => setFaq(STATIC_FAQ));
  }, []);

  const loading = faq === null;

  const filtered = (faq || []).filter((f) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (f.q_fr || "").toLowerCase().includes(q) || (f.a_fr || "").toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4" data-testid="faq-list">
      <div className="relative">
        <HelpCircle size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher une question…"
          className="pl-9 rounded-lg"
        />
      </div>

      {loading && <div className="flex justify-center py-10"><Loader2 size={22} className="animate-spin text-primary" /></div>}

      {!loading && filtered.length === 0 && (
        <div className="rounded-xl bg-surface border border-border py-12 flex flex-col items-center gap-3 text-muted-foreground">
          <HelpCircle size={32} className="opacity-30" />
          <p className="text-sm">Aucun résultat pour "{search}"</p>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="rounded-xl bg-surface border border-border overflow-hidden divide-y divide-border">
          <Accordion type="single" collapsible>
            {filtered.map((f, i) => (
              <AccordionItem key={i} value={`item-${i}`} data-testid={`faq-item-${i}`} className="px-4">
                <AccordionTrigger className="text-left text-sm font-medium py-4 hover:no-underline">
                  {lang === "fr" ? f.q_fr : f.q_en}
                </AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground pb-4 leading-relaxed">
                  {lang === "fr" ? f.a_fr : f.a_en}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Support() {
  const { t, lang } = useI18n();

  return (
    <div className="space-y-6 max-w-3xl mx-auto" data-testid="support-page">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">{t("support.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">Chat direct · Tickets · FAQ</p>
      </div>

      <Tabs defaultValue="chat" className="w-full">
        <TabsList className="bg-secondary rounded-lg p-1 w-full grid grid-cols-3" data-testid="support-tabs">
          <TabsTrigger value="chat" data-testid="support-tab-chat" className="rounded-md data-[state=active]:bg-surface data-[state=active]:text-primary gap-1.5">
            <MessageCircle size={14} />{t("support.chat")}
          </TabsTrigger>
          <TabsTrigger value="tickets" data-testid="support-tab-tickets" className="rounded-md data-[state=active]:bg-surface data-[state=active]:text-primary gap-1.5">
            <TicketCheck size={14} />{t("support.tickets")}
          </TabsTrigger>
          <TabsTrigger value="faq" data-testid="support-tab-faq" className="rounded-md data-[state=active]:bg-surface data-[state=active]:text-primary gap-1.5">
            <HelpCircle size={14} />{t("support.faq")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="mt-5">
          <ChatTab t={t} lang={lang} />
        </TabsContent>
        <TabsContent value="tickets" className="mt-5">
          <TicketsTab t={t} lang={lang} />
        </TabsContent>
        <TabsContent value="faq" className="mt-5">
          <FaqTab t={t} lang={lang} />
        </TabsContent>
      </Tabs>

    </div>
  );
}
