import { Shield, FileText, AlertCircle, Users, Lock, Globe2, CreditCard, Scale } from "lucide-react";
import { Link } from "react-router-dom";

const LAST_UPDATED = "10 juin 2026";

const Section = ({ icon: Icon, title, children }) => (
  <div className="mb-10">
    <div className="flex items-center gap-3 mb-4">
      <div className="p-2 rounded-lg bg-blue-600/10">
        <Icon size={20} className="text-blue-600 dark:text-blue-400" />
      </div>
      <h2 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h2>
    </div>
    <div className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed space-y-3 pl-11">
      {children}
    </div>
  </div>
);

export default function Terms() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link to="/" className="text-xl font-extrabold text-blue-600 tracking-tight">Kobo</Link>
          <Link to="/" className="text-sm text-gray-500 hover:text-blue-600 transition-colors">Retour à l'accueil</Link>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-12">
        {/* Title */}
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 bg-blue-600 rounded-xl">
              <FileText size={22} className="text-white" />
            </div>
            <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white">Conditions Générales d'Utilisation</h1>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 pl-14">
            Dernière mise à jour : {LAST_UPDATED} &nbsp;·&nbsp; Version 1.0
          </p>
        </div>

        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-5 mb-10 flex gap-3">
          <AlertCircle size={18} className="text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-blue-800 dark:text-blue-200 leading-relaxed">
            Veuillez lire attentivement ces conditions avant d'utiliser les services Kobo. En créant un compte ou en utilisant nos services, vous acceptez l'intégralité de ces conditions.
          </p>
        </div>

        <Section icon={Globe2} title="1. Présentation du service">
          <p>Kobo est une plateforme de paiement et de transfert d'argent opérée par <strong>Kobo Fintech SARL</strong>, société enregistrée en République du Cameroun.</p>
          <p>Nos services comprennent : les dépôts via Mobile Money (MTN, Orange), les virements bancaires (SEPA / SWIFT), les transferts P2P entre utilisateurs Kobo, les retraits vers comptes Mobile Money ou comptes bancaires, et les dépôts/retraits en cryptomonnaies (USDT, BTC).</p>
          <p>Les services sont accessibles aux personnes physiques et morales résidant dans les zones géographiques couvertes, sous réserve de validation de leur identité (KYC).</p>
        </Section>

        <Section icon={Users} title="2. Conditions d'accès et d'inscription">
          <p>Pour utiliser Kobo, vous devez :</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Être âgé d'au moins 18 ans</li>
            <li>Disposer d'un numéro de téléphone valide ou d'une adresse e-mail</li>
            <li>Fournir des informations exactes, complètes et à jour</li>
            <li>Ne pas avoir été préalablement banni ou suspendu de la plateforme</li>
          </ul>
          <p>L'inscription est soumise à une vérification d'identité (KYC) pour accéder aux fonctionnalités de retrait et de transfert international. Les niveaux KYC déterminent les plafonds de transaction applicables.</p>
        </Section>

        <Section icon={Lock} title="3. Sécurité et responsabilités du compte">
          <p>Vous êtes responsable de la confidentialité de vos identifiants de connexion (OTP, PIN de transaction). Kobo ne vous demandera jamais votre mot de passe par téléphone ou e-mail.</p>
          <p>Vous vous engagez à notifier immédiatement Kobo de toute utilisation non autorisée de votre compte via le support intégré ou à l'adresse <strong>service@koboonline.com</strong>.</p>
          <p>Kobo se réserve le droit de suspendre temporairement un compte présentant des signes d'activité frauduleuse ou inhabituelle, sans préavis, dans l'intérêt de la sécurité de la plateforme.</p>
          <p>Des codes de récupération à usage unique sont fournis à l'inscription. Conservez-les en lieu sûr — ils permettent de récupérer l'accès à votre compte en cas de perte d'accès à votre numéro.</p>
        </Section>

        <Section icon={CreditCard} title="4. Frais et tarification">
          <p>Les frais applicables à chaque type d'opération sont consultables dans votre espace client, section <strong>Tarifs</strong>, et sur la page d'accueil de Kobo. Ils sont exprimés en pourcentage du montant ou en montant fixe selon la catégorie d'opération.</p>
          <p>Les frais sont prélevés au moment de l'exécution de l'opération. Pour les transferts P2P, les frais sont à la charge de l'expéditeur.</p>
          <p>Kobo se réserve le droit de modifier sa grille tarifaire avec un préavis de 30 jours communiqué par e-mail et/ou notification dans l'application.</p>
          <p>Les dépôts sont actuellement gratuits (0%). Des frais pourront être appliqués ultérieurement selon les coûts d'infrastructure.</p>
        </Section>

        <Section icon={Globe2} title="5. Transferts et délais d'exécution">
          <p><strong>Mobile Money :</strong> Les dépôts sont crédités instantanément après confirmation du paiement par l'opérateur. Les retraits vers Mobile Money sont traités sous 1 à 24 heures ouvrées.</p>
          <p><strong>Virements bancaires SEPA :</strong> Les dépôts sont crédités après réception des fonds (1 à 3 jours ouvrés). Les retraits SEPA sont exécutés sous 1 à 3 jours ouvrés.</p>
          <p><strong>Transferts P2P :</strong> Instantanés entre comptes Kobo vérifiés.</p>
          <p><strong>Crypto :</strong> Les dépôts sont crédités après confirmation sur la blockchain (généralement 1 à 3 confirmations). Les retraits sont traités sous 1 heure ouvrée.</p>
          <p>Ces délais sont indicatifs et peuvent être affectés par des contraintes techniques, réglementaires ou de compliance.</p>
        </Section>

        <Section icon={Shield} title="6. Utilisation acceptable et interdictions">
          <p>Il est strictement interdit d'utiliser Kobo pour :</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Des activités illégales, frauduleuses ou de blanchiment d'argent</li>
            <li>Le financement du terrorisme ou d'activités criminelles</li>
            <li>Des transactions liées aux jeux d'argent non réglementés</li>
            <li>Des opérations de change non autorisées ou d'arbitrage abusif</li>
            <li>L'utilisation de comptes multiples pour contourner les limites KYC</li>
            <li>Toute tentative de manipulation ou d'exploitation du système de solde</li>
          </ul>
          <p>Kobo dispose d'un système automatisé de détection des fraudes. Tout compte présentant des anomalies de solde inexpliquées sera automatiquement suspendu et signalé aux autorités compétentes.</p>
        </Section>

        <Section icon={Scale} title="7. Limitation de responsabilité">
          <p>Kobo s'engage à mettre tout en œuvre pour assurer la disponibilité et la sécurité de ses services. Cependant, Kobo ne pourra être tenu responsable :</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Des interruptions de service dues à des facteurs hors de son contrôle (pannes d'opérateurs, incidents réseau)</li>
            <li>Des pertes résultant d'une utilisation frauduleuse du compte par un tiers suite à une négligence de l'utilisateur</li>
            <li>Des délais ou refus de traitement imposés par des partenaires bancaires ou opérateurs Mobile Money</li>
            <li>Des fluctuations de taux de change affectant la valeur des transactions</li>
          </ul>
          <p>La responsabilité maximale de Kobo est limitée au montant des frais payés par l'utilisateur au cours des 12 derniers mois précédant l'incident.</p>
        </Section>

        <Section icon={Lock} title="8. Protection des données personnelles">
          <p>Kobo collecte et traite vos données personnelles conformément à la législation camerounaise sur la protection des données et aux normes internationales (RGPD).</p>
          <p>Les données collectées comprennent : identité, coordonnées, documents KYC, historique des transactions. Ces données sont utilisées exclusivement pour la fourniture des services, la lutte contre la fraude et le respect des obligations légales.</p>
          <p>Vous disposez d'un droit d'accès, de rectification et de suppression de vos données en contactant <strong>privacy@koboonline.com</strong>.</p>
          <p>Vos données ne sont jamais vendues à des tiers commerciaux.</p>
        </Section>

        <Section icon={FileText} title="9. Résiliation et clôture de compte">
          <p>Vous pouvez clôturer votre compte à tout moment depuis les paramètres de l'application ou en contactant le support. Toute clôture de compte implique le retrait préalable du solde disponible.</p>
          <p>Kobo se réserve le droit de résilier ou suspendre un compte sans préavis en cas de violation des présentes conditions, d'activité frauduleuse avérée, ou d'inactivité prolongée supérieure à 24 mois.</p>
          <p>En cas de résiliation par Kobo, les fonds disponibles seront restitués à l'utilisateur dans un délai de 30 jours, sous réserve de la levée de tout blocage réglementaire.</p>
        </Section>

        <Section icon={Scale} title="10. Droit applicable et juridiction">
          <p>Les présentes conditions sont régies par le droit camerounais. En cas de litige, les parties s'engagent à rechercher une solution amiable dans un délai de 30 jours avant toute action judiciaire.</p>
          <p>À défaut de résolution amiable, le litige sera soumis aux tribunaux compétents de Yaoundé, Cameroun.</p>
          <p>Pour toute réclamation ou question relative aux présentes conditions, contactez notre service juridique : <strong>legal@koboonline.com</strong>.</p>
        </Section>

        {/* Footer links */}
        <div className="border-t border-gray-200 dark:border-gray-800 pt-8 flex flex-wrap gap-4 text-sm text-gray-500 dark:text-gray-400">
          <Link to="/refund" className="hover:text-blue-600 transition-colors">Politique de remboursement</Link>
          <span>·</span>
          <a href="mailto:legal@koboonline.com" className="hover:text-blue-600 transition-colors">legal@koboonline.com</a>
          <span>·</span>
          <Link to="/" className="hover:text-blue-600 transition-colors">koboonline.com</Link>
        </div>
      </div>
    </div>
  );
}
