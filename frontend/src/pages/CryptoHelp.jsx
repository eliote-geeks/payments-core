import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, ArrowDownToLine, Send, ShieldCheck, Clock, HelpCircle,
  ChevronDown, ChevronUp, AlertTriangle, CheckCircle, ExternalLink, Coins
} from "lucide-react";
import { Button } from "../components/ui/button";

function Faq({ question, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-secondary/50 transition-colors"
      >
        <span className="font-medium text-sm">{question}</span>
        {open ? <ChevronUp size={16} className="shrink-0 text-muted-foreground" /> : <ChevronDown size={16} className="shrink-0 text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-5 pb-4 text-sm text-muted-foreground space-y-2 border-t border-border pt-3">
          {children}
        </div>
      )}
    </div>
  );
}

function Step({ number, title, children }) {
  return (
    <div className="flex gap-4">
      <div className="shrink-0 w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">
        {number}
      </div>
      <div className="flex-1 pb-6 border-l border-dashed border-border pl-4 -ml-[1px]">
        <p className="font-semibold text-sm mb-1">{title}</p>
        <div className="text-sm text-muted-foreground space-y-1">{children}</div>
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, color, children }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className={`h-9 w-9 rounded-xl flex items-center justify-center ${color}`}>
          <Icon size={18} className="text-white" />
        </div>
        <h2 className="font-display font-bold text-lg">{title}</h2>
      </div>
      {children}
    </div>
  );
}

export default function CryptoHelp() {
  const navigate = useNavigate();

  return (
    <div className="max-w-2xl mx-auto space-y-10 pb-10">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-2 rounded-full hover:bg-secondary transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="font-display text-2xl font-bold">Aide — Crypto USDT</h1>
          <p className="text-xs text-muted-foreground">Tout comprendre sur les dépôts et retraits</p>
        </div>
      </div>

      {/* Intro */}
      <div className="bg-primary/5 border border-primary/20 rounded-2xl p-5 flex gap-4">
        <Coins size={24} className="text-primary shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold text-sm">Comment fonctionne le système crypto Kobo ?</p>
          <p className="text-sm text-muted-foreground">
            Kobo te permet d'alimenter ton compte en FCFA en envoyant des <strong>USDT</strong> (un stablecoin qui vaut toujours 1 dollar), et inversement de récupérer des USDT depuis ton solde FCFA. Toutes les opérations sont traitées manuellement par l'équipe Kobo sous 24h.
          </p>
          <p className="text-sm font-medium mt-2">Taux actuel : <span className="text-primary">1 USDT = 550 FCFA</span></p>
        </div>
      </div>

      {/* Dépôt */}
      <Section icon={ArrowDownToLine} title="Faire un dépôt crypto (USDT → FCFA)" color="bg-blue-500">
        <p className="text-sm text-muted-foreground">
          Tu envoies des USDT depuis ton wallet ou une plateforme d'échange (Binance, Coinbase, etc.) vers l'adresse Kobo, et Kobo crédite l'équivalent en FCFA sur ton compte.
        </p>
        <div className="mt-4 ml-1">
          <Step number="1" title="Choisis le montant en FCFA à créditer">
            <p>Entre le montant que tu veux avoir sur ton compte Kobo. L'app calcule automatiquement le montant USDT équivalent.</p>
            <p className="mt-1">Exemple : 5 500 FCFA → 10 USDT</p>
          </Step>
          <Step number="2" title="Choisis le réseau blockchain">
            <p>Sélectionne le réseau que tu vas utiliser pour envoyer tes USDT :</p>
            <ul className="list-disc list-inside mt-1 space-y-0.5">
              <li><strong>TRC20 (TRON)</strong> — recommandé, frais quasi nuls (~0.01$), rapide</li>
              <li><strong>BEP20 (BSC)</strong> — frais faibles (~0.10$)</li>
              <li><strong>ERC20 (Ethereum)</strong> — frais élevés (~2–20$)</li>
            </ul>
          </Step>
          <Step number="3" title="Envoie exactement le montant USDT indiqué">
            <p>L'app t'affiche l'adresse wallet de Kobo pour le réseau choisi. Copie cette adresse et envoie <strong>exactement</strong> le montant USDT indiqué depuis ton wallet.</p>
            <div className="mt-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 flex gap-2">
              <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
              <p className="text-amber-700 dark:text-amber-300 text-xs">Utilise <strong>impérativement</strong> le bon réseau. Envoyer du TRC20 sur une adresse ERC20 ou vice-versa = fonds définitivement perdus.</p>
            </div>
          </Step>
          <Step number="4" title="Soumets le hash de ta transaction">
            <p>Une fois l'envoi effectué, tu reçois un <strong>hash de transaction</strong> (identifiant unique sur la blockchain). Colle-le dans l'app.</p>
            <p className="mt-1">Tu trouves le hash :</p>
            <ul className="list-disc list-inside space-y-0.5 mt-1">
              <li>Dans l'historique de ton wallet (Trust Wallet, etc.)</li>
              <li>Sur TronScan.org pour TRC20</li>
              <li>Sur l'email de confirmation de Binance/Coinbase</li>
            </ul>
          </Step>
          <Step number="5" title="Attends la confirmation Kobo (moins de 24h)">
            <p>L'équipe Kobo vérifie ta transaction sur la blockchain. Si tout est correct, ton solde FCFA est crédité. Tu seras notifié.</p>
          </Step>
        </div>
      </Section>

      {/* Retrait */}
      <Section icon={Send} title="Faire un retrait crypto (FCFA → USDT)" color="bg-orange-500">
        <p className="text-sm text-muted-foreground">
          Tu demandes à Kobo de convertir ton solde FCFA en USDT et de les envoyer sur ton adresse crypto personnelle.
        </p>
        <div className="mt-4 ml-1">
          <Step number="1" title="Choisis le montant FCFA à retirer">
            <p>Minimum : <strong>5 500 FCFA</strong> (= 10 USDT).</p>
            <p>L'app calcule automatiquement le montant USDT que tu recevras.</p>
          </Step>
          <Step number="2" title="Entre ton adresse USDT de destination">
            <p>Saisis l'adresse de ton wallet personnel où tu veux recevoir les USDT. Vérifie-la soigneusement — <strong>une erreur d'adresse = fonds perdus définitivement</strong>.</p>
          </Step>
          <Step number="3" title="Confirme — ton solde est débité immédiatement">
            <p>En confirmant, le montant FCFA est <strong>débité instantanément</strong> de ton compte. C'est normal : cela garantit que tu ne peux pas utiliser les mêmes fonds pour autre chose pendant le traitement.</p>
            <div className="mt-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 flex gap-2">
              <CheckCircle size={14} className="text-blue-500 shrink-0 mt-0.5" />
              <p className="text-blue-700 dark:text-blue-300 text-xs">Si Kobo ne peut pas effectuer le virement pour une raison quelconque, ton solde FCFA est <strong>automatiquement remboursé</strong>.</p>
            </div>
          </Step>
          <Step number="4" title="Kobo envoie les USDT (moins de 24h)">
            <p>L'équipe Kobo envoie manuellement les USDT sur ton adresse. Tu reçois un hash de transaction pour suivre l'envoi sur la blockchain.</p>
          </Step>
        </div>
      </Section>

      {/* Réseaux */}
      <Section icon={ShieldCheck} title="Les réseaux blockchain : TRC20, BEP20, ERC20" color="bg-purple-500">
        <p className="text-sm text-muted-foreground">
          L'USDT existe sur plusieurs blockchains différentes. Ce sont des réseaux séparés, incompatibles entre eux. Chaque réseau a sa propre adresse chez Kobo.
        </p>
        <div className="mt-3 grid sm:grid-cols-3 gap-3">
          {[
            { name: "TRC20", chain: "TRON", fee: "~0.01$", speed: "~3 secondes", addr: "Commence par T…", rec: true },
            { name: "BEP20", chain: "Binance Smart Chain", fee: "~0.10$", speed: "~3 secondes", addr: "Commence par 0x…", rec: false },
            { name: "ERC20", chain: "Ethereum", fee: "2 à 20$", speed: "~15 secondes", addr: "Commence par 0x…", rec: false },
          ].map((n) => (
            <div key={n.name} className={`rounded-xl border p-4 space-y-2 ${n.rec ? "border-primary bg-primary/5" : "border-border"}`}>
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm">{n.name}</span>
                {n.rec && <span className="text-[10px] bg-primary text-white px-2 py-0.5 rounded-full">Recommandé</span>}
              </div>
              <p className="text-xs text-muted-foreground">{n.chain}</p>
              <div className="text-xs space-y-0.5">
                <p>Frais réseau : <strong>{n.fee}</strong></p>
                <p>Vitesse : <strong>{n.speed}</strong></p>
                <p>Format : <code className="text-[10px]">{n.addr}</code></p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 p-4 rounded-xl bg-destructive/5 border border-destructive/20 flex gap-3">
          <AlertTriangle size={16} className="text-destructive shrink-0 mt-0.5" />
          <p className="text-sm text-destructive">
            <strong>Règle absolue :</strong> l'adresse et le réseau doivent correspondre. Ne jamais envoyer du TRC20 vers une adresse ERC20 ou BEP20, et inversement. Les fonds seraient perdus sans possibilité de récupération.
          </p>
        </div>
      </Section>

      {/* Hash de transaction */}
      <Section icon={HelpCircle} title="C'est quoi un hash de transaction ?" color="bg-green-500">
        <p className="text-sm text-muted-foreground">
          C'est l'<strong>identifiant unique</strong> de ta transaction sur la blockchain. Chaque envoi de crypto génère automatiquement un hash, comme un numéro de reçu.
        </p>
        <div className="mt-3 p-4 rounded-xl bg-secondary font-mono text-xs break-all">
          Exemple TRC20 :<br />
          <span className="text-primary">a3f9b2c1d4e5f678901234567890abcdef1234567890abcdef1234567890ab12</span>
        </div>
        <p className="text-sm text-muted-foreground mt-3">
          Kobo utilise ce hash pour vérifier sur la blockchain que tu as bien envoyé les USDT, dans le bon montant, vers la bonne adresse. Sans hash valide, la demande ne peut pas être traitée.
        </p>
        <p className="text-sm text-muted-foreground">
          Tu trouves ton hash dans l'historique de ton wallet, sur l'email de confirmation de ta plateforme d'échange, ou sur un explorateur blockchain comme{" "}
          <a
            href="https://tronscan.org"
            target="_blank"
            rel="noreferrer"
            className="text-primary underline inline-flex items-center gap-0.5"
          >
            TronScan <ExternalLink size={11} />
          </a>
          {" "}(pour TRC20).
        </p>
      </Section>

      {/* Délais */}
      <Section icon={Clock} title="Délais de traitement" color="bg-slate-500">
        <div className="space-y-3">
          {[
            { label: "Dépôt crypto", delay: "Moins de 24h", detail: "Après soumission du hash, l'équipe vérifie et crédite ton compte." },
            { label: "Retrait crypto", delay: "Moins de 24h", detail: "Après confirmation de ta demande, l'équipe envoie les USDT sur ton adresse." },
          ].map((item) => (
            <div key={item.label} className="flex gap-4 p-4 rounded-xl bg-secondary">
              <div className="shrink-0 text-center">
                <p className="font-bold text-primary text-lg leading-none">{item.delay}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">en général</p>
              </div>
              <div>
                <p className="font-semibold text-sm">{item.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Les traitements se font du lundi au dimanche. En dehors des heures de bureau, le délai peut atteindre 24h.
        </p>
      </Section>

      {/* FAQ */}
      <Section icon={HelpCircle} title="Questions fréquentes" color="bg-teal-500">
        <div className="space-y-2">
          <Faq question="Que se passe-t-il si j'envoie le mauvais montant USDT ?">
            <p>Si tu envoies un montant différent de celui indiqué, l'admin pourra rejeter la demande ou créditer le montant réellement reçu. Contacte le support via l'app.</p>
          </Faq>
          <Faq question="Puis-je annuler un dépôt après avoir envoyé les USDT ?">
            <p>Non. Les transactions blockchain sont irréversibles. Une fois les USDT envoyés, l'admin devra les vérifier et les créditer. En cas de problème, contacte le support.</p>
          </Faq>
          <Faq question="Mon solde FCFA a été débité mais je n'ai pas reçu mes USDT">
            <p>Le délai est inférieur à 24h. Si tu n'as rien reçu après 24h, contacte le support depuis la section Aide de l'app en mentionnant ton numéro de référence de retrait.</p>
          </Faq>
          <Faq question="Pourquoi mon solde est débité avant que Kobo envoie les USDT ?">
            <p>C'est une mesure de sécurité pour éviter qu'un utilisateur utilise les mêmes fonds plusieurs fois simultanément. En cas de rejet ou de problème, le remboursement est automatique et immédiat.</p>
          </Faq>
          <Faq question="Quel réseau dois-je utiliser ?">
            <p>TRC20 est recommandé : frais quasi nuls (moins de 1 FCFA) et confirmation en 3 secondes. Assure-toi que ta plateforme d'envoi supporte TRC20 (Binance, Bybit, et la plupart des exchanges le supportent).</p>
          </Faq>
          <Faq question="Mon wallet ne supporte pas TRC20, que faire ?">
            <p>Utilise BEP20 ou ERC20 selon ce que ton wallet propose. L'adresse Kobo sera différente selon le réseau. L'app affiche automatiquement la bonne adresse pour le réseau que tu sélectionnes.</p>
          </Faq>
          <Faq question="C'est quoi l'USDT exactement ?">
            <p>L'USDT (Tether) est un stablecoin — une cryptomonnaie dont la valeur est indexée sur le dollar américain. 1 USDT = environ 1 dollar. Il n'est pas soumis aux fluctuations comme le Bitcoin ou l'Ethereum. Kobo l'utilise pour sa stabilité.</p>
          </Faq>
        </div>
      </Section>

      {/* CTA support */}
      <div className="rounded-2xl bg-secondary p-6 text-center space-y-3">
        <p className="font-semibold">Tu n'as pas trouvé ta réponse ?</p>
        <p className="text-sm text-muted-foreground">Notre équipe est disponible pour t'aider sur toutes les questions relatives aux paiements crypto.</p>
        <Button onClick={() => navigate("/support")} variant="outline" className="gap-2">
          <HelpCircle size={15} /> Contacter le support
        </Button>
      </div>
    </div>
  );
}
