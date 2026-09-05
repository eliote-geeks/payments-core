import { RefreshCw, AlertCircle, Clock, CheckCircle, XCircle, HelpCircle, ArrowLeftRight, FileText } from "lucide-react";
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

const CaseRow = ({ icon: Icon, color, title, eligible, delay, notes }) => (
  <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden mb-3">
    <div className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-gray-900/50">
      <div className={`p-1.5 rounded-lg ${color}`}>
        <Icon size={16} className="text-white" />
      </div>
      <span className="font-semibold text-gray-900 dark:text-white text-sm">{title}</span>
      <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${eligible ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"}`}>
        {eligible ? "Remboursable" : "Non remboursable"}
      </span>
    </div>
    <div className="px-4 pb-4 pt-3 grid grid-cols-2 gap-3 text-xs text-gray-500 dark:text-gray-400">
      <div><span className="font-medium text-gray-700 dark:text-gray-300">Délai : </span>{delay}</div>
      <div className="col-span-2">{notes}</div>
    </div>
  </div>
);

export default function Refund() {
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
              <RefreshCw size={22} className="text-white" />
            </div>
            <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white">Politique de Remboursement</h1>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 pl-14">
            Dernière mise à jour : {LAST_UPDATED} &nbsp;·&nbsp; Version 1.0
          </p>
        </div>

        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-5 mb-10 flex gap-3">
          <AlertCircle size={18} className="text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-blue-800 dark:text-blue-200 leading-relaxed">
            Kobo s'engage à traiter toute demande de remboursement avec équité et transparence. Cette politique décrit les cas où un remboursement est possible, les délais applicables et la procédure à suivre.
          </p>
        </div>

        <Section icon={ArrowLeftRight} title="1. Cas éligibles au remboursement">
          <p>Un remboursement peut être accordé dans les situations suivantes :</p>

          <CaseRow
            icon={AlertCircle}
            color="bg-red-500"
            title="Erreur technique — double débit"
            eligible={true}
            delay="24 à 72 heures ouvrées"
            notes="Si votre compte a été débité deux fois pour une seule opération en raison d'un bug technique, Kobo rembourse automatiquement le montant en double."
          />
          <CaseRow
            icon={XCircle}
            color="bg-orange-500"
            title="Transaction échouée — fonds non restitués"
            eligible={true}
            delay="Automatique sous 1 heure / Manuel sous 24h"
            notes="Si une transaction échoue (rejet Mobile Money, virement rejeté) et que les fonds ne sont pas automatiquement restitués sur votre solde, soumettez une demande de remboursement."
          />
          <CaseRow
            icon={Clock}
            color="bg-yellow-500"
            title="Dépôt non crédité après 72h"
            eligible={true}
            delay="Après investigation, sous 5 jours ouvrés"
            notes="Si un dépôt Mobile Money ou virement bancaire reste non crédité après 72 heures, contactez le support avec votre preuve de paiement. Une investigation est ouverte."
          />
          <CaseRow
            icon={CheckCircle}
            color="bg-green-500"
            title="Transfert P2P vers mauvais destinataire"
            eligible={false}
            delay="Non applicable"
            notes="Les transferts P2P confirmés sont irréversibles. Vérifiez soigneusement le destinataire avant de confirmer. Kobo peut tenter une médiation si le destinataire accepte de restituer les fonds."
          />
          <CaseRow
            icon={XCircle}
            color="bg-gray-500"
            title="Retrait déjà envoyé à l'opérateur"
            eligible={false}
            delay="Non applicable"
            notes="Une fois un retrait transmis à l'opérateur Mobile Money ou à la banque, Kobo ne peut pas l'annuler. L'opération est définitive."
          />
          <CaseRow
            icon={XCircle}
            color="bg-gray-500"
            title="Frais de service"
            eligible={false}
            delay="Non applicable"
            notes="Les frais perçus pour des transactions complétées avec succès ne sont pas remboursables."
          />
        </Section>

        <Section icon={FileText} title="2. Procédure de demande de remboursement">
          <p>Pour soumettre une demande de remboursement :</p>
          <ol className="list-decimal pl-5 space-y-2">
            <li>Connectez-vous à votre compte Kobo et accédez à <strong>Support &gt; Soumettre une demande</strong></li>
            <li>Sélectionnez la catégorie <strong>"Problème de transaction / Remboursement"</strong></li>
            <li>Fournissez l'identifiant de la transaction concernée (visible dans votre historique)</li>
            <li>Joignez tout justificatif : capture d'écran, SMS de confirmation de l'opérateur, relevé bancaire</li>
            <li>Décrivez précisément le problème</li>
          </ol>
          <p>Vous pouvez aussi contacter directement : <strong>remboursements@koboonline.com</strong> avec les mêmes informations.</p>
        </Section>

        <Section icon={Clock} title="3. Délais de traitement">
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                  <th className="text-left px-4 py-3 font-semibold">Type de remboursement</th>
                  <th className="text-left px-4 py-3 font-semibold">Délai</th>
                  <th className="text-left px-4 py-3 font-semibold">Mode</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {[
                  ["Double débit technique", "Automatique sous 1h", "Crédit solde Kobo"],
                  ["Transaction échouée", "Automatique sous 1h / Manuel sous 24h", "Crédit solde Kobo"],
                  ["Dépôt non crédité", "3 à 5 jours ouvrés", "Crédit solde Kobo"],
                  ["Remboursement vers Mobile Money", "1 à 3 jours ouvrés", "Virement opérateur"],
                  ["Remboursement vers compte bancaire", "3 à 7 jours ouvrés", "Virement SEPA/SWIFT"],
                ].map(([type, delay, mode]) => (
                  <tr key={type} className="bg-white dark:bg-gray-900/30 text-gray-600 dark:text-gray-400">
                    <td className="px-4 py-3">{type}</td>
                    <td className="px-4 py-3">{delay}</td>
                    <td className="px-4 py-3">{mode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section icon={CheckCircle} title="4. Modalités de remboursement">
          <p>Les remboursements sont effectués par défaut sur le <strong>solde de votre portefeuille Kobo</strong>, ce qui permet un traitement immédiat.</p>
          <p>Si vous souhaitez un remboursement vers votre compte Mobile Money ou bancaire, précisez-le explicitement dans votre demande. Des frais de traitement standards s'appliquent dans ce cas.</p>
          <p>Les remboursements sont toujours effectués dans la devise d'origine de la transaction.</p>
        </Section>

        <Section icon={HelpCircle} title="5. Litiges et escalade">
          <p>Si votre demande de remboursement n'a pas reçu de réponse dans les délais indiqués, ou si vous n'êtes pas satisfait de la décision :</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Contactez notre service des litiges : <strong>disputes@koboonline.com</strong></li>
            <li>Un responsable senior traitera votre dossier dans un délai de 5 jours ouvrés</li>
            <li>En dernier recours, vous pouvez saisir l'autorité de régulation financière compétente au Cameroun</li>
          </ul>
        </Section>

        <Section icon={AlertCircle} title="6. Prévention des fraudes et remboursements">
          <p>Kobo se réserve le droit de refuser un remboursement si l'investigation révèle :</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Une utilisation frauduleuse ou malveillante du système de remboursement</li>
            <li>Des abus répétés de demandes de remboursement</li>
            <li>Des tentatives de double remboursement (chargeback + demande directe)</li>
            <li>Une violation des Conditions Générales d'Utilisation</li>
          </ul>
          <p>Tout abus avéré entraînera la suspension immédiate du compte et pourra faire l'objet de poursuites.</p>
        </Section>

        {/* Footer links */}
        <div className="border-t border-gray-200 dark:border-gray-800 pt-8 flex flex-wrap gap-4 text-sm text-gray-500 dark:text-gray-400">
          <Link to="/terms" className="hover:text-blue-600 transition-colors">Conditions générales</Link>
          <span>·</span>
          <a href="mailto:remboursements@koboonline.com" className="hover:text-blue-600 transition-colors">remboursements@koboonline.com</a>
          <span>·</span>
          <Link to="/" className="hover:text-blue-600 transition-colors">koboonline.com</Link>
        </div>
      </div>
    </div>
  );
}
