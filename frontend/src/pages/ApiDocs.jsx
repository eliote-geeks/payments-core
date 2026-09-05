import React, { useState, useEffect, useRef } from "react";

const BASE_URL = "https://pay-api.koboonline.com/api/v1";

const SECTIONS = [
  { id: "intro",        label: "Introduction" },
  { id: "auth",         label: "Authentification" },
  { id: "errors",       label: "Erreurs" },
  { id: "me",           label: "GET /me" },
  { id: "balance",      label: "GET /balance" },
  { id: "create-pay",   label: "POST /payment-requests" },
  { id: "get-pay",      label: "GET /payment-requests/:id" },
  { id: "list-pay",     label: "GET /payment-requests" },
  { id: "keys",         label: "Clés API" },
  { id: "webhooks",     label: "Webhooks" },
  { id: "verify",       label: "Vérifier la signature" },
  { id: "fees",         label: "Structure des frais" },
];

function Method({ type }) {
  const colors = {
    GET:    { bg: "#dbeafe", text: "#1d4ed8" },
    POST:   { bg: "#dcfce7", text: "#15803d" },
    DELETE: { bg: "#fee2e2", text: "#dc2626" },
  };
  const c = colors[type] || { bg: "#f3f4f6", text: "#374151" };
  return (
    <span style={{
      background: c.bg, color: c.text,
      fontFamily: "monospace", fontWeight: 700,
      fontSize: 11, padding: "2px 7px", borderRadius: 4,
      letterSpacing: "0.05em",
    }}>{type}</span>
  );
}

function Code({ children, lang = "bash" }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(children.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div style={{ position: "relative", marginTop: 12, marginBottom: 16 }}>
      <pre style={{
        background: "#0f172a", color: "#e2e8f0",
        borderRadius: 8, padding: "16px 20px",
        fontSize: 13, lineHeight: 1.7,
        overflowX: "auto", margin: 0,
        fontFamily: "'Fira Code', 'Cascadia Code', monospace",
      }}>{children.trim()}</pre>
      <button
        onClick={copy}
        style={{
          position: "absolute", top: 10, right: 10,
          background: copied ? "#22c55e" : "#334155",
          border: "none", borderRadius: 5, color: "#fff",
          fontSize: 11, padding: "4px 10px", cursor: "pointer",
          transition: "background .2s",
        }}
      >{copied ? "Copié !" : "Copier"}</button>
    </div>
  );
}

function EndpointHeader({ method, path, title }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <h3 style={{ margin: 0, fontSize: 18, color: "#0f172a", fontWeight: 600 }}>{title}</h3>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
        <Method type={method} />
        <code style={{ fontSize: 14, color: "#475569", fontFamily: "monospace" }}>{BASE_URL}{path}</code>
      </div>
    </div>
  );
}

function Param({ name, type, required, desc }) {
  return (
    <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
      <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 13, color: "#1e293b", whiteSpace: "nowrap" }}>
        {name}
        {required && <span style={{ color: "#ef4444", marginLeft: 4 }}>*</span>}
      </td>
      <td style={{ padding: "8px 12px", fontSize: 12, color: "#64748b", fontFamily: "monospace" }}>{type}</td>
      <td style={{ padding: "8px 12px", fontSize: 13, color: "#475569" }}>{desc}</td>
    </tr>
  );
}

function Section({ id, children }) {
  return (
    <section id={id} style={{ paddingTop: 32, paddingBottom: 8, borderBottom: "1px solid #e2e8f0", marginBottom: 8 }}>
      {children}
    </section>
  );
}

function H2({ children }) {
  return <h2 style={{ fontSize: 22, fontWeight: 700, color: "#0f172a", marginBottom: 16 }}>{children}</h2>;
}

function P({ children, style }) {
  return <p style={{ color: "#475569", lineHeight: 1.7, fontSize: 14, ...style }}>{children}</p>;
}

function Table({ children }) {
  return (
    <div style={{ overflowX: "auto", marginTop: 12, marginBottom: 4 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead style={{ background: "#f8fafc" }}>
          {children[0]}
        </thead>
        <tbody>{children.slice(1)}</tbody>
      </table>
    </div>
  );
}

function Th({ children }) {
  return <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: "#64748b", fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase" }}>{children}</th>;
}

function Alert({ type = "info", children }) {
  const styles = {
    info:    { bg: "#eff6ff", border: "#bfdbfe", icon: "ℹ️" },
    warning: { bg: "#fffbeb", border: "#fde68a", icon: "⚠️" },
    success: { bg: "#f0fdf4", border: "#bbf7d0", icon: "✅" },
  };
  const s = styles[type];
  return (
    <div style={{
      background: s.bg, border: `1px solid ${s.border}`,
      borderRadius: 8, padding: "12px 16px",
      fontSize: 13, color: "#374151", lineHeight: 1.6,
      marginTop: 12, marginBottom: 16,
    }}>
      {children}
    </div>
  );
}

export default function ApiDocs() {
  const [activeSection, setActiveSection] = useState("intro");
  const contentRef = useRef(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setActiveSection(e.target.id);
        });
      },
      { rootMargin: "-20% 0px -70% 0px" }
    );
    SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  const scrollTo = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div style={{ minHeight: "100vh", background: "#fff", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {/* Top bar */}
      <div style={{ background: "#0f172a", color: "#fff", padding: "0 32px", height: 56, display: "flex", alignItems: "center", gap: 16, position: "sticky", top: 0, zIndex: 100, boxShadow: "0 1px 3px rgba(0,0,0,.3)" }}>
        <a href="/" style={{ textDecoration: "none", color: "#fff", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 28, height: 28, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 14 }}>K</div>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Kobo</span>
        </a>
        <span style={{ color: "#475569", fontSize: 14 }}>/</span>
        <span style={{ color: "#94a3b8", fontSize: 14 }}>Documentation API</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 12 }}>
          <a href="https://koboonline.com/payment-links" style={{ color: "#94a3b8", fontSize: 13, textDecoration: "none" }}>Dashboard</a>
          <span style={{ background: "#1e293b", color: "#818cf8", fontSize: 12, padding: "2px 8px", borderRadius: 4, fontFamily: "monospace" }}>v1</span>
        </div>
      </div>

      <div style={{ display: "flex", maxWidth: 1200, margin: "0 auto" }}>
        {/* Sidebar */}
        <nav style={{
          width: 220, flexShrink: 0, padding: "24px 0",
          position: "sticky", top: 56, height: "calc(100vh - 56px)",
          overflowY: "auto", borderRight: "1px solid #f1f5f9",
        }}>
          <div style={{ padding: "0 16px 8px", fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.1em", textTransform: "uppercase" }}>Référence</div>
          {SECTIONS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => scrollTo(id)}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "7px 20px", border: "none", cursor: "pointer",
                fontSize: 13, background: activeSection === id ? "#eff6ff" : "transparent",
                color: activeSection === id ? "#2563eb" : "#475569",
                fontWeight: activeSection === id ? 600 : 400,
                borderLeft: activeSection === id ? "3px solid #2563eb" : "3px solid transparent",
                transition: "all .15s",
              }}
            >{label}</button>
          ))}
        </nav>

        {/* Main content */}
        <main ref={contentRef} style={{ flex: 1, padding: "32px 48px", maxWidth: 820 }}>

          {/* ── Introduction ── */}
          <Section id="intro">
            <H2>API Kobo — Guide de démarrage</H2>
            <P>L'API Kobo permet à vos applications d'accepter des paiements Mobile Money (MTN, Orange) au Cameroun, de gérer vos liens de paiement, et de recevoir des notifications en temps réel via des webhooks.</P>
            <P>L'API est accessible à l'adresse suivante :</P>
            <Code>{BASE_URL}</Code>
            <Alert type="info">
              Toutes les requêtes sont en <strong>HTTPS</strong>. Les montants sont toujours en <strong>FCFA</strong>. Les réponses sont en <strong>JSON</strong>.
            </Alert>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 16 }}>
              {[
                { label: "Opérateurs", value: "MTN · Orange CM" },
                { label: "Devise", value: "FCFA (XAF)" },
                { label: "Montant minimum", value: "100 FCFA" },
                { label: "Frais Kobo", value: "5 % par transaction" },
              ].map(({ label, value }) => (
                <div key={label} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "12px 16px", minWidth: 140 }}>
                  <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>{label}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#0f172a", marginTop: 4 }}>{value}</div>
                </div>
              ))}
            </div>
          </Section>

          {/* ── Authentification ── */}
          <Section id="auth">
            <H2>Authentification</H2>
            <P>L'API utilise des clés API de type Bearer token. Chaque requête doit inclure l'en-tête <code>Authorization</code>.</P>
            <Code>{`Authorization: Bearer kb_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`}</Code>
            <P>Il existe deux types de clés :</P>
            <Table>
              <tr><Th>Préfixe</Th><Th>Environnement</Th><Th>Usage</Th></tr>
              <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#15803d" }}>kb_live_</td>
                <td style={{ padding: "8px 12px" }}>Production</td>
                <td style={{ padding: "8px 12px", fontSize: 13, color: "#475569" }}>Paiements réels, déboguez en production</td>
              </tr>
              <tr>
                <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#7c3aed" }}>kb_test_</td>
                <td style={{ padding: "8px 12px" }}>Test</td>
                <td style={{ padding: "8px 12px", fontSize: 13, color: "#475569" }}>Simulation sans débit, pour les intégrations</td>
              </tr>
            </Table>
            <Alert type="warning">
              <strong>Sécurité :</strong> Ne partagez jamais votre clé API et ne la stockez pas dans votre code source. Utilisez des variables d'environnement. La clé en clair n'est affichée <strong>qu'une seule fois</strong> à la création.
            </Alert>
            <P>Les clés sont gérées depuis votre dashboard ou via l'endpoint <code>/keys</code>.</P>
            <Code>{`curl ${BASE_URL}/me \\
  -H "Authorization: Bearer kb_live_votre_cle_api"`}</Code>
          </Section>

          {/* ── Erreurs ── */}
          <Section id="errors">
            <H2>Codes d'erreur</H2>
            <P>L'API retourne des codes HTTP standards. En cas d'erreur, le corps de la réponse contient un champ <code>detail</code>.</P>
            <Code>{`{
  "detail": "Clé API invalide ou révoquée"
}`}</Code>
            <Table>
              <tr><Th>Code</Th><Th>Signification</Th></tr>
              {[
                [200, "OK — Succès"],
                [201, "Created — Ressource créée"],
                [400, "Bad Request — Paramètre manquant ou invalide"],
                [401, "Unauthorized — Clé API manquante ou invalide"],
                [403, "Forbidden — Accès refusé (KYC, permissions)"],
                [404, "Not Found — Ressource introuvable"],
                [422, "Unprocessable Entity — Validation du corps de la requête échouée"],
                [500, "Internal Server Error — Erreur côté serveur"],
              ].map(([code, msg]) => (
                <tr key={code} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", fontWeight: 600,
                    color: code < 300 ? "#15803d" : code < 500 ? "#d97706" : "#dc2626" }}>{code}</td>
                  <td style={{ padding: "8px 12px", fontSize: 13, color: "#475569" }}>{msg}</td>
                </tr>
              ))}
            </Table>
          </Section>

          {/* ── GET /me ── */}
          <Section id="me">
            <EndpointHeader method="GET" path="/me" title="Informations du compte" />
            <P>Retourne les informations du marchand associé à la clé API.</P>
            <Code>{`curl ${BASE_URL}/me \\
  -H "Authorization: Bearer kb_live_votre_cle_api"`}</Code>
            <P style={{ marginBottom: 4, fontWeight: 600, fontSize: 13 }}>Réponse</P>
            <Code lang="json">{`{
  "merchant_name": "Ma Boutique SARL",
  "email": "contact@maboutique.cm",
  "is_test": false,
  "balance_fcfa": 125000.0
}`}</Code>
          </Section>

          {/* ── GET /balance ── */}
          <Section id="balance">
            <EndpointHeader method="GET" path="/balance" title="Solde disponible" />
            <P>Retourne le solde FCFA disponible sur votre compte Kobo.</P>
            <Code>{`curl ${BASE_URL}/balance \\
  -H "Authorization: Bearer kb_live_votre_cle_api"`}</Code>
            <Code lang="json">{`{
  "balance_fcfa": 125000.0,
  "currency": "FCFA"
}`}</Code>
          </Section>

          {/* ── POST /payment-requests ── */}
          <Section id="create-pay">
            <EndpointHeader method="POST" path="/payment-requests" title="Créer un lien de paiement" />
            <P>Crée un lien de paiement Mobile Money. Redirigez votre client vers <code>payment_url</code> pour qu'il effectue le paiement.</P>
            <P style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Paramètres du corps (JSON)</P>
            <Table>
              <tr><Th>Champ</Th><Th>Type</Th><Th>Description</Th></tr>
              <Param name="amount"           type="number"  required desc="Montant en FCFA (minimum 100)" />
              <Param name="description"      type="string"  required desc="Description de la commande (2–200 caractères)" />
              <Param name="reference"        type="string"  required={false} desc="Votre référence interne (commande, facture…)" />
              <Param name="success_url"      type="string"  required={false} desc="URL de redirection après paiement réussi" />
              <Param name="cancel_url"       type="string"  required={false} desc="URL de redirection si le client annule" />
              <Param name="expires_in_hours" type="integer" required={false} desc="Durée de validité en heures (1–8760)" />
              <Param name="max_uses"         type="integer" required={false} desc="Nombre maximum de paiements sur ce lien" />
            </Table>
            <Code>{`curl -X POST ${BASE_URL}/payment-requests \\
  -H "Authorization: Bearer kb_live_votre_cle_api" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 5000,
    "description": "Commande #1042 — Chemise batik",
    "reference": "CMD-1042",
    "success_url": "https://maboutique.cm/merci?ref={reference}",
    "expires_in_hours": 24
  }'`}</Code>
            <P style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Réponse</P>
            <Code lang="json">{`{
  "id": "pl_a3f8c2d1e4b5",
  "reference": "CMD-1042",
  "payment_url": "https://koboonline.com/pay/pl_a3f8c2d1e4b5",
  "amount": 5000.0,
  "currency": "FCFA",
  "description": "Commande #1042 — Chemise batik",
  "kobo_fee": 250.0,
  "net_estimate": 4750.0,
  "status": "active",
  "expires_at": "2025-06-16T14:30:00+00:00"
}`}</Code>
            <Alert type="info">
              <strong>Frais :</strong> <code>kobo_fee</code> est une estimation (5 %). Le montant exact est calculé à la réception du paiement en tenant compte des frais opérateur réels.
            </Alert>
            <P style={{ fontWeight: 600, fontSize: 13, marginTop: 16, marginBottom: 4 }}>Exemple JavaScript</P>
            <Code lang="js">{`const response = await fetch("${BASE_URL}/payment-requests", {
  method: "POST",
  headers: {
    "Authorization": "Bearer kb_live_votre_cle_api",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    amount: 5000,
    description: "Commande #1042 — Chemise batik",
    reference: "CMD-1042",
    expires_in_hours: 24,
  }),
});

const { payment_url, id, net_estimate } = await response.json();
window.location.href = payment_url; // rediriger le client`}</Code>
          </Section>

          {/* ── GET /payment-requests/:id ── */}
          <Section id="get-pay">
            <EndpointHeader method="GET" path="/payment-requests/:id" title="Statut d'un lien de paiement" />
            <P>Récupère le statut et les statistiques d'un lien de paiement.</P>
            <Code>{`curl ${BASE_URL}/payment-requests/pl_a3f8c2d1e4b5 \\
  -H "Authorization: Bearer kb_live_votre_cle_api"`}</Code>
            <Code lang="json">{`{
  "id": "pl_a3f8c2d1e4b5",
  "status": "active",
  "amount": 5000.0,
  "currency": "FCFA",
  "description": "Commande #1042 — Chemise batik",
  "payment_url": "https://koboonline.com/pay/pl_a3f8c2d1e4b5",
  "paid_count": 1,
  "total_collected": 4750.0,
  "expires_at": "2025-06-16T14:30:00+00:00",
  "created_at": "2025-06-15T14:30:00+00:00"
}`}</Code>
            <P style={{ marginTop: 12 }}>Valeurs possibles pour <code>status</code> :</P>
            <Table>
              <tr><Th>Statut</Th><Th>Description</Th></tr>
              {[
                ["active",  "Lien actif, accepte les paiements"],
                ["paused",  "Lien suspendu temporairement"],
                ["deleted", "Lien supprimé (n'apparaît plus dans la liste)"],
              ].map(([s, d]) => (
                <tr key={s} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 13 }}>{s}</td>
                  <td style={{ padding: "8px 12px", fontSize: 13, color: "#475569" }}>{d}</td>
                </tr>
              ))}
            </Table>
          </Section>

          {/* ── GET /payment-requests ── */}
          <Section id="list-pay">
            <EndpointHeader method="GET" path="/payment-requests" title="Lister les liens de paiement" />
            <P>Retourne la liste paginée de vos liens de paiement.</P>
            <P style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Paramètres de query</P>
            <Table>
              <tr><Th>Paramètre</Th><Th>Type</Th><Th>Description</Th></tr>
              <Param name="limit"  type="integer" desc="Nombre de résultats (défaut : 20, max : 100)" />
              <Param name="offset" type="integer" desc="Décalage pour la pagination (défaut : 0)" />
            </Table>
            <Code>{`curl "${BASE_URL}/payment-requests?limit=10&offset=0" \\
  -H "Authorization: Bearer kb_live_votre_cle_api"`}</Code>
            <Code lang="json">{`{
  "total": 42,
  "items": [
    {
      "id": "pl_a3f8c2d1e4b5",
      "status": "active",
      "amount": 5000.0,
      "description": "Commande #1042",
      "payment_url": "https://koboonline.com/pay/pl_a3f8c2d1e4b5",
      "paid_count": 1,
      "total_collected": 4750.0,
      "created_at": "2025-06-15T14:30:00+00:00"
    }
  ]
}`}</Code>
          </Section>

          {/* ── Clés API ── */}
          <Section id="keys">
            <H2>Gestion des clés API</H2>
            <P>Créez, listez et révoquez vos clés API directement depuis l'API. Vous pouvez aussi les gérer depuis le dashboard Kobo.</P>

            <div style={{ marginTop: 20 }}>
              <EndpointHeader method="POST" path="/keys" title="Créer une clé" />
              <Code>{`curl -X POST ${BASE_URL}/keys \\
  -H "Authorization: Bearer kb_live_votre_cle_api" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Serveur production", "is_test": false}'`}</Code>
              <Code lang="json">{`{
  "id": "key_c1d2e3f4",
  "key": "kb_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "name": "Serveur production",
  "is_test": false
}`}</Code>
              <Alert type="warning">La clé en clair est affichée <strong>une seule fois</strong>. Sauvegardez-la immédiatement.</Alert>
            </div>

            <div style={{ marginTop: 20 }}>
              <EndpointHeader method="GET" path="/keys" title="Lister les clés" />
              <Code>{`curl ${BASE_URL}/keys \\
  -H "Authorization: Bearer kb_live_votre_cle_api"`}</Code>
              <Code lang="json">{`{
  "items": [
    {
      "id": "key_c1d2e3f4",
      "name": "Serveur production",
      "is_test": false,
      "created_at": "2025-06-15T10:00:00+00:00",
      "last_used_at": "2025-06-15T14:32:00+00:00"
    }
  ]
}`}</Code>
            </div>

            <div style={{ marginTop: 20 }}>
              <EndpointHeader method="DELETE" path="/keys/:key_id" title="Révoquer une clé" />
              <Code>{`curl -X DELETE ${BASE_URL}/keys/key_c1d2e3f4 \\
  -H "Authorization: Bearer kb_live_votre_cle_api"`}</Code>
              <Code lang="json">{`{ "ok": true }`}</Code>
            </div>
          </Section>

          {/* ── Webhooks ── */}
          <Section id="webhooks">
            <H2>Webhooks</H2>
            <P>Les webhooks permettent à votre serveur d'être notifié automatiquement à chaque événement de paiement. Configurez une URL HTTPS accessible publiquement.</P>

            <div style={{ marginTop: 20 }}>
              <EndpointHeader method="POST" path="/webhooks" title="Enregistrer un webhook" />
              <Table>
                <tr><Th>Champ</Th><Th>Type</Th><Th>Description</Th></tr>
                <Param name="url"    type="string"   required desc="URL HTTPS de votre endpoint webhook" />
                <Param name="events" type="string[]" required={false} desc={`Événements à recevoir (défaut : tous). Ex: ["payment.completed"]`} />
              </Table>
              <Code>{`curl -X POST ${BASE_URL}/webhooks \\
  -H "Authorization: Bearer kb_live_votre_cle_api" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://maboutique.cm/api/kobo-webhook",
    "events": ["payment.completed", "payment.failed"]
  }'`}</Code>
              <Code lang="json">{`{
  "id": "wh_e5f6a7b8",
  "url": "https://maboutique.cm/api/kobo-webhook",
  "events": ["payment.completed", "payment.failed"],
  "secret": "whsec_a1b2c3d4...",
  "created_at": "2025-06-15T10:00:00+00:00"
}`}</Code>
            </div>

            <P style={{ fontWeight: 600, fontSize: 14, marginTop: 24 }}>Événements disponibles</P>
            <Table>
              <tr><Th>Événement</Th><Th>Description</Th></tr>
              {[
                ["payment.completed", "Paiement confirmé, fonds créditésur votre compte Kobo"],
                ["payment.failed",    "Tentative de paiement échouée"],
                ["payment.pending",   "Paiement initié, en attente de confirmation"],
              ].map(([e, d]) => (
                <tr key={e} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 13, color: "#1e293b" }}>{e}</td>
                  <td style={{ padding: "8px 12px", fontSize: 13, color: "#475569" }}>{d}</td>
                </tr>
              ))}
            </Table>

            <P style={{ fontWeight: 600, fontSize: 14, marginTop: 24 }}>Exemple de payload reçu</P>
            <Code lang="json">{`{
  "event": "payment.completed",
  "payment_link_id": "pl_a3f8c2d1e4b5",
  "transaction_id": "plt_x1y2z3",
  "amount": 5000.0,
  "kobo_fee": 250.0,
  "net_amount": 4750.0,
  "currency": "FCFA",
  "payer_phone": "237690000000",
  "provider": "mtn",
  "reference": "CMD-1042",
  "status": "completed",
  "created_at": "2025-06-15T14:35:00+00:00"
}`}</Code>
            <Alert type="info">
              Votre endpoint doit retourner un code <strong>2xx</strong> dans les 10 secondes. En cas d'échec, une nouvelle tentative est effectuée après 5 minutes.
            </Alert>
          </Section>

          {/* ── Vérifier la signature ── */}
          <Section id="verify">
            <H2>Vérifier la signature</H2>
            <P>Chaque webhook est signé avec HMAC-SHA256 en utilisant le secret retourné à la création. Vérifiez toujours la signature pour vous assurer que la requête provient bien de Kobo.</P>
            <P>L'en-tête <code>X-Kobo-Signature</code> contient la signature au format <code>sha256=...</code>.</P>

            <P style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Node.js / JavaScript</P>
            <Code lang="js">{`const crypto = require("crypto");

function verifyKoboWebhook(payload, signature, secret) {
  const expected = "sha256=" + crypto
    .createHmac("sha256", secret)
    .update(payload, "utf8")
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signature)
  );
}

// Dans votre handler Express :
app.post("/api/kobo-webhook", express.raw({ type: "application/json" }), (req, res) => {
  const sig = req.headers["x-kobo-signature"];
  const isValid = verifyKoboWebhook(req.body, sig, process.env.KOBO_WEBHOOK_SECRET);

  if (!isValid) return res.status(400).send("Signature invalide");

  const event = JSON.parse(req.body);
  if (event.event === "payment.completed") {
    // Marquer la commande comme payée
    fulfillOrder(event.reference, event.net_amount);
  }

  res.sendStatus(200);
});`}</Code>

            <P style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Python</P>
            <Code lang="python">{`import hmac
import hashlib
from flask import Flask, request, abort

app = Flask(__name__)
KOBO_SECRET = os.environ["KOBO_WEBHOOK_SECRET"]

@app.route("/api/kobo-webhook", methods=["POST"])
def kobo_webhook():
    sig = request.headers.get("X-Kobo-Signature", "")
    expected = "sha256=" + hmac.new(
        KOBO_SECRET.encode(),
        request.data,
        hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(expected, sig):
        abort(400, "Signature invalide")

    event = request.json
    if event["event"] == "payment.completed":
        fulfill_order(event["reference"], event["net_amount"])

    return "", 200`}</Code>
          </Section>

          {/* ── Frais ── */}
          <Section id="fees">
            <H2>Structure des frais</H2>
            <P>Kobo applique deux niveaux de frais sur chaque paiement via l'API :</P>
            <Table>
              <tr><Th>Type de frais</Th><Th>Taux</Th><Th>Prélevé par</Th></tr>
              <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "8px 12px", fontSize: 13 }}>Frais opérateur (MTN / Orange)</td>
                <td style={{ padding: "8px 12px", fontFamily: "monospace", fontWeight: 600, color: "#d97706" }}>~1,5–1,6 %</td>
                <td style={{ padding: "8px 12px", fontSize: 13, color: "#475569" }}>Agrégateur (SharePay / NotchPay)</td>
              </tr>
              <tr>
                <td style={{ padding: "8px 12px", fontSize: 13 }}>Frais Kobo API</td>
                <td style={{ padding: "8px 12px", fontFamily: "monospace", fontWeight: 600, color: "#dc2626" }}>5 %</td>
                <td style={{ padding: "8px 12px", fontSize: 13, color: "#475569" }}>Kobo (prélevé sur le net reçu)</td>
              </tr>
            </Table>

            <P style={{ marginTop: 16 }}>Exemple pour un paiement de <strong>10 000 FCFA</strong> :</P>
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 16, fontFamily: "monospace", fontSize: 13, lineHeight: 2 }}>
              <div>Montant payé par le client&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <strong>10 000 FCFA</strong></div>
              <div style={{ color: "#d97706" }}>− Frais opérateur (~1,6 %)&nbsp;&nbsp;&nbsp;&nbsp; − 160 FCFA</div>
              <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 4 }}>Net reçu de l'opérateur&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 9 840 FCFA</div>
              <div style={{ color: "#dc2626" }}>− Frais Kobo (5 %)&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; − 492 FCFA</div>
              <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 4, fontWeight: 700, color: "#15803d" }}>Crédit sur votre compte Kobo&nbsp;&nbsp; 9 348 FCFA</div>
            </div>
            <Alert type="info" style={{ marginTop: 12 }}>
              Le champ <code>net_estimate</code> retourné à la création du lien est une <strong>estimation avant frais opérateur</strong>. Le montant exact crédité dépend des frais réels prélevés par l'agrégateur lors du paiement.
            </Alert>
          </Section>

          <div style={{ height: 80 }} />
        </main>
      </div>
    </div>
  );
}
