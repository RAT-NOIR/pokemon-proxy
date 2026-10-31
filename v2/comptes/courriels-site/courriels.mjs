/**
 * LES COURRIELS TRANSACTIONNELS — TEXTES ET GABARITS PRÊTS, SANS ENVOI (lots L4 et L6, 2026-10-18).
 *
 * Qui envoie : l'API des comptes, jamais le site (« L'API est la SEULE propriétaire de Stripe », le site n'a ni clé ni service
 * d'envoi). Ce module PUR (aucun import de Next ni de paquet, seulement des modules de lib/) rend, pour chaque courriel, trois
 * choses que l'API reprendra telles quelles : l'objet, le texte brut et le HTML. Les données sont celles que l'API a déjà (adresse,
 * dates ISO, montant en CENTIMES, liens qu'elle fournit) ; le module ne calcule aucun calendrier de facturation. Le calendrier, les
 * destinataires et le moment d'envoi sont des demandes à l'API : DEMANDE-SERVEUR-SITE.md, entrée du lot L4.
 *
 * Les règles de texte du site, tenues par lib/courriels.test.ts :
 *  - l'offre et ses chiffres sont LUS dans lib/tarifs.ts (essai, quota gratuit, maintien après un impayé) ; un montant vient des
 *    centimes de l'API, jamais d'une constante écrite ici ;
 *  - aucun prix de cote, aucun nom de source d'image, aucun identifiant du prestataire de paiement, pas de ligne des marques (elle
 *    est dans le pied de page du site et les mentions légales seulement) ;
 *  - espaces insécables françaises (`typo`), apostrophe typographique ;
 *  - un lien n'est rendu que s'il est en https et d'un hôte attendu ; un lien sans lequel le courriel ne sert à rien fait REFUSER
 *    le courriel (`LienCourrielInvalide`), un lien facultatif invalide est omis ;
 *  - une donnée obligatoire illisible (date, montant, adresse) fait refuser le courriel (`RangeError`) : mieux vaut une erreur côté
 *    API qu'un courriel qui ment ; une donnée facultative absente retire sa ligne, jamais « undefined ».
 * Lot L6 : onze courriels (les sept de L4, dont les trois de l'essai refaits pour l'essai SANS carte bancaire — décision de l'éditeur du
 * 2026-10-18 —, plus les deux du parrain, la réinitialisation du mot de passe et la suppression du compte). Le HTML est un gabarit « de
 * type MJML » écrit à la main (lib/courrielsGabarit.ts) : tables imbriquées, styles en ligne, enveloppe Outlook, bouton VML, mode sombre.
 */
import { SITE } from "./site.mjs";
import {
  ANALYSES_PAR_JOUR_COMPTE_GRATUIT,
  AVANTAGES_PRO,
  FIN_D_ESSAI,
  PARRAINAGE_MOIS_PRO,
  PARRAINAGE_PLAFOND_MOIS_PAR_AN,
  PRO_MAINTIEN_IMPAYE_JOURS,
  SANS_CARTE_BANCAIRE,
  UN_SEUL_ESSAI,
  moisAffiche,
  prixAffiche,
} from "./tarifs.mjs";
import { rendreHtml, rendreTexte, typo,                         } from "./courrielsGabarit.mjs";

export { typo };

// ── Les liens ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Les hôtes que l'API peut mettre dans un courriel : le site (les liens de confirmation et du compte sont des pages du SITE) et le portail
 * du prestataire de paiement. Aucune adresse de l'API elle-même : lib/comptesV2.test.ts n'en admet que dans le module de la cible.
 */
const HOTES_SITE = ["rat-market.fr", "www.rat-market.fr"]         ;
const HOTES_PORTAIL = ["billing.stripe.com"]         ;
export const HOTES_LIENS_ATTENDUS = [...HOTES_SITE, ...HOTES_PORTAIL]         ;

/** Le genre d'un lien fixe ses hôtes : un lien du site (confirmation, compte) ne peut pas mener au portail, ni l'inverse. */
                                           

export class LienCourrielInvalide extends Error {
  constructor(nom        ) {
    super(`Lien « ${nom} » refusé : il doit être en https et d'un hôte attendu`);
    this.name = "LienCourrielInvalide";
  }
}

/** Vrai si `lien` est une adresse https d'un hôte attendu, sans identifiants, sans port, sans espace ni guillemet. */
export function lienAutorise(lien         , genre            )                 {
  if (typeof lien !== "string" || lien.length === 0 || lien.length > 2000) return false;
  if (/[\s"'<>\\\u0000-\u001f\u007f]/.test(lien)) return false;
  let url     ;
  try {
    url = new URL(lien);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.port === "" &&
    ((genre === undefined ? HOTES_LIENS_ATTENDUS : genre === "site" ? HOTES_SITE : HOTES_PORTAIL)                     ).includes(url.hostname)
  );
}

/** Le lien normalisé (ce que le HTML et le texte écrivent), ou `null` s'il est refusé. */
function lienOuNul(lien         , genre           )                {
  return lienAutorise(lien, genre) ? new URL(lien).href : null;
}

function lienObligatoire(nom        , lien         , genre           )         {
  const propre = lienOuNul(lien, genre);
  if (propre === null) throw new LienCourrielInvalide(nom);
  return propre;
}

// ── Les données ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

                                              

/** Une date ISO 8601 (« 2026-11-15T10:00:00Z ») telle que l'API la donne. */
                      

                                        
                  
                                                                                      
                           
 
                                    
                  
                                                                                                                                                                                                              
                              
                    
                                                                                                                                                                              
                                     
                                  
                             
 
/**
 * Le rappel J−3 a DEUX cas, choisis par `carteEnregistree` (donnée OBLIGATOIRE de l'API : le courriel ne devine pas). Décision de l'éditeur,
 * 2026-10-18 nuit : ajouter sa carte pendant l'essai, c'est choisir de continuer ; le débit à la fin de l'essai est correct, « sans prélèvement »
 * ne vaut que sans carte ; un courriel de rappel part 3 jours avant la fin de l'essai (QUAND : l'API, `RAPPEL_FIN_ESSAI_JOURS`).
 */
                      
                  
                    
 
                                   
                   
                              
                                                                                                                                     
                                         
                                      
                                                                                                                                      
                             
      
                   
                             
                                                                 
                              
                                                                                                  
                       
                                                                                 
                          
       
/**
 * La fin d'essai n'existe que SANS carte : l'essai s'achève sans abonnement, le compte repasse en gratuit. AVEC une carte, il n'y a pas de
 * courriel de fin d'essai : c'est le reçu du premier paiement (`paiementReussi`) qui part, quand le paiement est encaissé.
 */
                                  
                  
                                     
                                  
                                                                                                            
                                 
                             
 
                                        
                  
                          
                                
                      
                                     
                              
                             
 
                                       
                  
                          
                                                                                                       
                          
                                                                                                                                     
                                 
                      
 
                                     
                  
                                                                
                      
                             
 

/**
 * QUAND : à l'ouverture de l'essai du filleul avec le code de parrainage. ⚠️ Déclencheur à CONFIRMER par l'API (le contrat applique le code au
 * Checkout ; aucun événement « filleul inscrit » n'y figure) : DEMANDE-SERVEUR-SITE.md, entrée L6.
 */
                                             
                  
                             
 
/**
 * QUAND : une fois l'AVOIR posé sur le compte du parrain (la prime attend tant que son abonnement n'est pas vivant, CONTRAT-STRIPE-V2.md) :
 * alors « déduit de votre prochaine facture » est vrai. Jamais avant.
 */
                                          
                  
                                                                                                                           
                                       
                             
 
                                                    
                  
                                                                                             
                               
                                                                                                                                                      
                                 
 
/**
 * La suppression du compte (RGPD). Les trois conservations sont OBLIGATOIRES : la clé doit être là, la valeur peut être `null` (« l'API ne garde
 * rien de ce genre »). Quand l'API garde quelque chose, elle donne la durée ET le « pourquoi » (une phrase, sans point final) : le site n'écrit
 * aucune raison de lui-même. Le courriel ne s'écrit pas sans elles.
 */
                                           
                  
                      
                                                                                                  
                                                              
                                                                                         
                                                      
                                                                                                          
                                                                     
 

                           
                
                
               
 

// ── Les validations et les formats ─────────────────────────────────────────────────────────────────────────────────────────────

function adresseValide(adresse         )         {
  const propre = typeof adresse === "string" ? adresse.trim() : "";
  // La forme d'une adresse : un seul @, un domaine pointé, ni espace, ni saut de ligne, ni < > ni guillemet.
  if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>".]+$/.test(propre) || /[\r\n]/.test(propre)) throw new RangeError("adresse illisible");
  return propre;
}

function dateValide(nom        , valeur         )       {
  const d = typeof valeur === "string" ? new Date(valeur) : null;
  if (d === null || Number.isNaN(d.getTime())) throw new RangeError(`date illisible : ${nom}`);
  return d;
}

function dateFacultative(nom        , valeur         )              {
  return valeur === null || valeur === undefined ? null : dateValide(nom, valeur);
}

function centimesValides(nom        , valeur         )         {
  if (typeof valeur !== "number" || !Number.isInteger(valeur) || valeur < 0) throw new RangeError(`montant illisible : ${nom}`);
  return valeur;
}

const FORMAT_DATE = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" });

/** « 15 novembre 2026 », « 1er décembre 2026 » — le jour civil À PARIS, en hiver comme en été. */
function jour(date      )         {
  const texte = FORMAT_DATE.format(date);
  // Le français écrit « 1er décembre » ; Intl écrit « 1 décembre ».
  return typo(/^1 /.test(texte) ? `1er${texte.slice(1)}` : texte);
}

/** « 4,99 € par mois », « 39 € par an ». */
function prixParPeriode(centimes        , periode                   )         {
  const prix = prixAffiche(centimes / 100);
  if (prix === null) throw new RangeError("montant illisible");
  return typo(`${prix} par ${periode === "an" ? "an" : "mois"}`);
}

function montant(centimes        )         {
  const prix = prixAffiche(centimes / 100);
  if (prix === null) throw new RangeError("montant illisible");
  return prix;
}

function assembler(c         )           {
  return { objet: typo(c.objet), texte: rendreTexte(c), html: rendreHtml(c) };
}

// ── Les courriels de L4 (les trois de l'essai refaits en L6) ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const QUOTA_GRATUIT = `${ANALYSES_PAR_JOUR_COMPTE_GRATUIT} analyses par jour`;
const RETOUR_GRATUIT = `votre compte revient au forfait gratuit (${QUOTA_GRATUIT})`;

/** Un bouton si l'un des liens (dans l'ordre) est valable, sinon un renvoi écrit vers le site. */
function boutonOuRenvoi(libelle        , ...candidats                        )       {
  for (const [l, genre] of candidats) {
    const propre = lienOuNul(l, genre);
    if (propre !== null) return { t: "bouton", libelle, lien: propre };
  }
  return { t: "note", texte: "Retrouvez votre compte sur rat-market.fr." };
}

function creationCompte(d                       )           {
  const adresse = adresseValide(d.adresse);
  const lien = lienObligatoire("lienConfirmation", d.lienConfirmation, "site");
  return assembler({
    adresse,
    objet: "Confirmez votre adresse pour activer votre compte Rat-Market",
    resume: "Le lien est valable 24 heures.",
    titre: "Confirmez votre adresse",
    blocs: [
      { t: "p", texte: `Un compte Rat-Market vient d’être créé avec l’adresse ${adresse}. Pour l’activer, confirmez cette adresse.` },
      { t: "bouton", libelle: "Confirmer mon adresse", lien },
      { t: "p", texte: `Avec un compte gratuit, vous disposez de ${QUOTA_GRATUIT} dans le scanner et dans l’extension.` },
      { t: "note", texte: "Ce lien est valable 24 heures." },
      { t: "note", texte: "Si vous n’êtes pas à l’origine de cette demande, ignorez ce message : aucun compte ne sera activé." },
    ],
  });
}

/** « 4,99 € par mois » si les DEUX données du prix sont là, `null` si aucune, un refus si une seule (le courriel ne s'écrit pas avec la moitié d'un prix). */
function prixFacultatif(periode         , centimes         )                {
  const sansPeriode = periode === null || periode === undefined;
  const sansMontant = centimes === null || centimes === undefined;
  if (sansPeriode && sansMontant) return null;
  if (sansPeriode || sansMontant) throw new RangeError("le prix de Pro exige la période ET le montant");
  if (periode !== "mois" && periode !== "an") throw new RangeError("période illisible");
  return prixParPeriode(centimesValides("montantCentimes", centimes), periode);
}

/** « l'offre gratuite (10 analyses par jour) » : ce que le compte retrouve à la fin d'un essai sans abonnement. */
const OFFRE_GRATUITE = `l’offre gratuite (${QUOTA_GRATUIT})`;

function debutEssai(d                   )           {
  const adresse = adresseValide(d.adresse);
  const fin = dateValide("finEssai", d.finEssai);
  const prix = prixFacultatif(d.periode, d.montantCentimes);
  const debut = dateFacultative("debutEssai", d.debutEssai);
  if (debut !== null && fin.getTime() <= debut.getTime()) throw new RangeError("l'essai finit avant de commencer");
  const jours = debut === null ? null : Math.round((fin.getTime() - debut.getTime()) / (24 * 3600 * 1000));
  // « 14 jours d'essai, sans carte bancaire » : les mots de l'éditeur, avec la durée DE L'API (30 jours pour un filleul).
  const sansCarte = jours === null ? SANS_CARTE_BANCAIRE : `${jours === 1 ? "1 jour" : `${jours} jours`} d’essai, ${SANS_CARTE_BANCAIRE}`;
  const lignes                     = [
    ["Offre", "Rat-Market Pro"],
    ["Fin de l’essai", jour(fin)],
  ];
  if (prix !== null) lignes.push(["Pour garder Pro", prix]);
  return assembler({
    adresse,
    objet: "Votre essai de Rat-Market Pro a commencé",
    resume: jours === null ? `Votre essai se termine le ${jour(fin)}.` : `${sansCarte}. Il se termine le ${jour(fin)}.`,
    titre: "Bienvenue dans Rat-Market Pro",
    blocs: [
      {
        t: "p",
        texte:
          jours === null
            ? `Votre essai de Rat-Market Pro commence aujourd’hui, ${sansCarte}, et se termine le ${jour(fin)}. Pendant cette période, vous profitez de tout ce que comprend Pro :`
            : `Votre essai de Rat-Market Pro commence aujourd’hui : ${sansCarte}. Il se termine le ${jour(fin)}. Pendant cette période, vous profitez de tout ce que comprend Pro :`,
      },
      { t: "liste", items: [...AVANTAGES_PRO] },
      { t: "details", lignes },
      { t: "p", texte: FIN_D_ESSAI },
      boutonOuRenvoi("Gérer mon compte", [d.lienCompte, "site"]),
    ],
  });
}

/** « 15/11 » : le jour et le mois du débit, au jour civil de Paris (la phrase de l'éditeur : « le JJ/MM »). */
const FORMAT_JJMM = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit" });

function rappelFinEssai(d                       )           {
  const adresse = adresseValide(d.adresse);
  const fin = dateValide("finEssai", d.finEssai);
  // Le drapeau est OBLIGATOIRE : le courriel ne devine pas si une carte est enregistrée (les deux cas disent des choses opposées).
  const carte          = (d                                  ).carteEnregistree;
  if (typeof carte !== "boolean") throw new RangeError("donnée obligatoire illisible : carteEnregistree");
  if (carte) {
    // AVEC une carte (décision de l'éditeur, 2026-10-18 nuit) : « ajouter sa carte, c'est choisir de continuer ». Le débit à la fin de l'essai est
    // dit tel quel, avec de quoi résilier ; jamais « sans prélèvement », qui ne vaut que sans carte.
    const avec = d                                                              ;
    const somme = montant(entierPositif("montantCentimes", avec.montantCentimes));
    const debit = dateValide("debitLe", avec.debitLe);
    const portail = lienObligatoire("lienPortail", avec.lienPortail, "portail");
    const phrase = `Votre carte sera débitée de ${somme} le ${FORMAT_JJMM.format(debit)}, sauf si vous résiliez avant.`;
    return assembler({
      adresse,
      objet: `Votre essai de Rat-Market Pro se termine le ${jour(fin)}`,
      resume: phrase,
      titre: "Votre essai se termine bientôt",
      blocs: [
        { t: "p", texte: `Votre essai de Rat-Market Pro se termine le ${jour(fin)}.` },
        { t: "p", texte: phrase },
        { t: "details", lignes: [["Fin de l’essai", jour(fin)], ["Débit prévu", `${somme} le ${FORMAT_JJMM.format(debit)}`]] },
        { t: "bouton", libelle: "Résilier ou gérer mon abonnement", lien: portail },
        { t: "note", texte: "Si vous résiliez avant cette date, rien ne vous est prélevé." },
      ],
    });
  }
  const sans = d                                                               ;
  const prix = prixFacultatif(sans.periode, sans.montantCentimes);
  const abonnement = lienObligatoire("lienAbonnement", sans.lienAbonnement, "site");
  const lignes                     = [
    ["Fin de l’essai", jour(fin)],
    ["Ensuite", OFFRE_GRATUITE],
  ];
  if (prix !== null) lignes.push(["Pour garder Pro", prix]);
  return assembler({
    adresse,
    objet: `Votre essai de Rat-Market Pro se termine le ${jour(fin)}`,
    resume: `Pour garder Pro après le ${jour(fin)}, abonnez-vous.`,
    titre: "Votre essai se termine bientôt",
    blocs: [
      { t: "p", texte: `Votre essai de Rat-Market Pro se termine le ${jour(fin)}.` },
      { t: "details", lignes },
      { t: "p", texte: "Vous n’avez rien à faire pour passer à l’offre gratuite. Si Pro vous plaît, abonnez-vous pour le garder." },
      { t: "bouton", libelle: "Garder Rat-Market Pro", lien: abonnement },
      { t: "note", texte: FIN_D_ESSAI },
    ],
  });
}

/** La fin d'essai n'existe que SANS carte : l'essai s'achève sans abonnement. Avec une carte, c'est le reçu du premier paiement (`paiementReussi`) qui part. */
function finEssai(d                 )           {
  const adresse = adresseValide(d.adresse);
  const prix = prixFacultatif(d.periode, d.montantCentimes);
  return assembler({
    adresse,
    objet: "Votre essai de Rat-Market Pro est terminé",
    resume: "Votre compte revient à l’offre gratuite.",
    titre: "Votre essai est terminé",
    blocs: [
      { t: "p", texte: `Votre essai de Rat-Market Pro est terminé. Votre compte revient à ${OFFRE_GRATUITE}, sans aucun prélèvement.` },
      { t: "p", texte: `Pour garder Pro, abonnez-vous à tout moment depuis votre compte${prix === null ? "" : ` : ${prix}`}.` },
      boutonOuRenvoi("Garder Rat-Market Pro", [d.lienAbonnement, "site"], [d.lienCompte, "site"]),
      { t: "note", texte: UN_SEUL_ESSAI },
    ],
  });
}

function paiementReussi(d                       )           {
  const adresse = adresseValide(d.adresse);
  const somme = montant(centimesValides("montantCentimes", d.montantCentimes));
  const debut = dateFacultative("debutPeriode", d.debutPeriode);
  const fin = dateValide("finPeriode", d.finPeriode);
  const suivante = dateFacultative("prochaineEcheance", d.prochaineEcheance);
  const lignes                     = [
    ["Offre", "Rat-Market Pro"],
    ["Montant", somme],
    ["Période couverte", debut === null ? `jusqu’au ${jour(fin)}` : `du ${jour(debut)} au ${jour(fin)}`],
  ];
  if (suivante !== null) lignes.push(["Prochaine échéance", jour(suivante)]);
  if (d.montantCentimes === 0) {
    // Une période offerte (mois offert du parrainage) : aucun paiement n'a eu lieu, le courriel ne parle ni de reçu ni de montant.
    const offerte = lignes.filter(([l]) => l !== "Montant");
    return assembler({
      adresse,
      objet: "Votre période Rat-Market Pro est offerte",
      resume: `Aucun paiement n’a été prélevé : Pro est actif jusqu’au ${jour(fin)}.`,
      titre: "Votre période est offerte",
      blocs: [
        { t: "p", texte: "Cette période de votre abonnement Rat-Market Pro est offerte : aucun paiement n’a été prélevé." },
        { t: "details", lignes: offerte },
        boutonOuRenvoi("Gérer mon abonnement", [d.lienPortail, "portail"], [d.lienCompte, "site"]),
      ],
    });
  }
  return assembler({
    adresse,
    objet: "Reçu de votre paiement Rat-Market Pro",
    resume: `Paiement de ${somme} reçu, merci.`,
    titre: "Merci pour votre paiement",
    blocs: [
      { t: "p", texte: "Nous avons bien reçu votre paiement pour votre abonnement Rat-Market Pro. Voici votre reçu." },
      { t: "details", lignes },
      // Franchise en base de TVA (CONTRAT-STRIPE-V2 §2 quinquies, décision de l'éditeur du 18/10) : la mention des factures.
      { t: "note", texte: "TVA non applicable, art.\u00a0293\u00a0B du CGI." },
      { t: "p", texte: "Le paiement est traité par Stripe, notre prestataire de paiement. Vos factures et votre moyen de paiement se gèrent depuis le portail." },
      boutonOuRenvoi("Voir mes factures et gérer mon abonnement", [d.lienPortail, "portail"], [d.lienCompte, "site"]),
    ],
  });
}

/** Ajoute des jours calendaires (en UTC : la date d'échec est un instant, le maintien se compte en jours de 24 heures). */
function plusDesJours(date      , jours        )       {
  return new Date(date.getTime() + jours * 24 * 3600 * 1000);
}

function echecPaiement(d                      )           {
  const adresse = adresseValide(d.adresse);
  const somme = montant(centimesValides("montantCentimes", d.montantCentimes));
  const echec = dateValide("premierEchecLe", d.premierEchecLe);
  const portail = lienObligatoire("lienPortail", d.lienPortail, "portail");
  const tentative = dateFacultative("dateTentative", d.dateTentative);
  const jusquau = plusDesJours(echec, PRO_MAINTIEN_IMPAYE_JOURS);
  return assembler({
    adresse,
    objet: "Le paiement de votre abonnement Rat-Market Pro a échoué",
    resume: `Pro reste actif jusqu’au ${jour(jusquau)}. Mettez à jour votre moyen de paiement.`,
    titre: "Votre paiement n’a pas abouti",
    blocs: [
      { t: "p", texte: `Nous n’avons pas pu prélever ${somme} pour votre abonnement Rat-Market Pro${tentative === null ? "" : ` le ${jour(tentative)}`}.` },
      { t: "p", texte: `Pro reste actif jusqu’au ${jour(jusquau)}, soit ${PRO_MAINTIEN_IMPAYE_JOURS} jours après le premier échec de paiement. Pour le conserver, mettez à jour votre moyen de paiement.` },
      { t: "bouton", libelle: "Mettre à jour mon moyen de paiement", lien: portail },
      { t: "note", texte: `Si le paiement n’a pas abouti d’ici là, ${RETOUR_GRATUIT}.` },
    ],
  });
}

function resiliation(d                    )           {
  const adresse = adresseValide(d.adresse);
  const fin = dateValide("finPeriode", d.finPeriode);
  return assembler({
    adresse,
    objet: "Votre abonnement Rat-Market Pro est résilié",
    resume: `Vous gardez Pro jusqu’au ${jour(fin)}.`,
    titre: "Votre résiliation est enregistrée",
    blocs: [
      { t: "p", texte: "Nous avons bien enregistré la résiliation de votre abonnement Rat-Market Pro. Il ne sera pas renouvelé et aucun nouveau paiement ne sera prélevé." },
      {
        t: "details",
        lignes: [
          ["Pro actif jusqu’au", jour(fin)],
          ["Ensuite", `forfait gratuit (${QUOTA_GRATUIT})`],
        ],
      },
      { t: "p", texte: `Jusqu’au ${jour(fin)}, vous gardez tous les avantages de Pro. Ensuite, ${RETOUR_GRATUIT}. Vous pouvez vous réabonner à tout moment depuis votre compte.` },
      boutonOuRenvoi("Ouvrir mon compte", [d.lienCompte, "site"]),
    ],
  });
}

// ── Les quatre courriels du lot L6 ─────────────────────────────────────────────────────────────────────────────────────────────

/** Un entier STRICTEMENT positif (une durée, un nombre de mois) ; `max` facultatif. */
function entierPositif(nom        , valeur         , max         )         {
  if (typeof valeur !== "number" || !Number.isInteger(valeur) || valeur < 1 || (max !== undefined && valeur > max)) throw new RangeError(`nombre illisible : ${nom}`);
  return valeur;
}

const MOIS_OFFERT = moisAffiche(PARRAINAGE_MOIS_PRO);
const PLAFOND_PARRAINAGE = `${PARRAINAGE_PLAFOND_MOIS_PAR_AN} mois par an`;
/** Ce que dit la décision de l'éditeur (2026-10-18) d'un mois gagné : sans valeur monétaire ; le contrat de l'API : « jamais de remboursement ni de virement ». */
const SANS_VALEUR = "Les mois offerts n’ont aucune valeur monétaire : ils ne sont ni remboursés ni versés.";

function parrainFilleulEssai(d                            )           {
  const adresse = adresseValide(d.adresse);
  return assembler({
    adresse,
    objet: "Votre filleul a commencé son essai avec votre code",
    resume: "Votre mois de Pro viendra à la première échéance payée de votre filleul.",
    titre: "Votre filleul a commencé son essai",
    blocs: [
      { t: "p", texte: "Quelqu’un a commencé son essai de Rat-Market Pro avec votre code de parrainage : merci d’avoir fait connaître Rat-Market." },
      {
        t: "p",
        texte: `Aucun mois n’est encore gagné. Quand votre filleul paiera sa première échéance, ${MOIS_OFFERT} de Pro vous sera offert.`,
      },
      { t: "p", texte: "Pour que ce mois vous soit offert, votre abonnement Pro doit être actif à ce moment-là, sinon le mois attend." },
      boutonOuRenvoi("Voir mon compte", [d.lienCompte, "site"]),
      { t: "note", texte: `Le parrainage offre jusqu’à ${PLAFOND_PARRAINAGE}. ${SANS_VALEUR}` },
    ],
  });
}

function parrainMoisGagne(d                         )           {
  const adresse = adresseValide(d.adresse);
  const cumul = d.moisGagnesCetteAnnee === null || d.moisGagnesCetteAnnee === undefined ? null : entierPositif("moisGagnesCetteAnnee", d.moisGagnesCetteAnnee, PARRAINAGE_PLAFOND_MOIS_PAR_AN);
  const blocs         = [
    { t: "p", texte: `Votre filleul vient de payer sa première échéance : vous gagnez ${MOIS_OFFERT} de Pro offert. Merci de faire connaître Rat-Market.` },
    { t: "p", texte: "Ce mois est déduit de votre prochaine facture Pro." },
  ];
  if (cumul !== null) blocs.push({ t: "details", lignes: [["Mois gagnés grâce au parrainage", `${cumul} sur ${PARRAINAGE_PLAFOND_MOIS_PAR_AN} par an`]] });
  if (cumul === PARRAINAGE_PLAFOND_MOIS_PAR_AN) blocs.push({ t: "p", texte: `Vous avez atteint le plafond de ${PLAFOND_PARRAINAGE}.` });
  blocs.push(boutonOuRenvoi("Voir mon compte", [d.lienCompte, "site"]));
  blocs.push({ t: "note", texte: SANS_VALEUR });
  return assembler({
    adresse,
    objet: `Vous avez gagné ${MOIS_OFFERT} de Rat-Market Pro`,
    resume: "Votre filleul a payé sa première échéance.",
    titre: `${MOIS_OFFERT[0].toUpperCase()}${MOIS_OFFERT.slice(1)} de Pro vous est offert`,
    blocs,
  });
}

function reinitialisationMotDePasse(d                                   )           {
  const adresse = adresseValide(d.adresse);
  const lien = lienObligatoire("lienReinitialisation", d.lienReinitialisation, "site");
  const heures = d.validiteHeures === null || d.validiteHeures === undefined ? null : entierPositif("validiteHeures", d.validiteHeures);
  const blocs         = [
    { t: "p", texte: `Une demande de nouveau mot de passe a été faite pour le compte Rat-Market associé à l’adresse ${adresse}. Pour en choisir un, ouvrez le lien ci-dessous.` },
    { t: "bouton", libelle: "Choisir un nouveau mot de passe", lien },
  ];
  // La durée n'est écrite que si l'API la fournit : une durée écrite sans source est une promesse.
  if (heures !== null) blocs.push({ t: "note", texte: `Ce lien est valable ${heures === 1 ? "1 heure" : `${heures} heures`}.` });
  blocs.push({ t: "note", texte: "Ne transmettez ce lien à personne : il permet de choisir le mot de passe de votre compte." });
  blocs.push({ t: "note", texte: "Si vous n’êtes pas à l’origine de cette demande, ignorez ce message : votre mot de passe actuel reste inchangé." });
  return assembler({
    adresse,
    objet: "Choisissez un nouveau mot de passe Rat-Market",
    resume: "Le lien pour choisir un nouveau mot de passe.",
    titre: "Choisissez un nouveau mot de passe",
    blocs,
  });
}

/**
 * Une conservation de la suppression : `null` = l'API ne garde rien de ce genre ; sinon la durée ET le « pourquoi », fournis ensemble par l'API.
 * Le site n'écrit aucune raison de lui-même (une raison sans source est une promesse) ; la clé absente fait refuser le courriel.
 */
function conservation(nom        , valeur         , cleDuree                   )                                             {
  if (valeur === undefined) throw new RangeError(`donnée obligatoire absente : ${nom}`);
  if (valeur === null) return null;
  const o = valeur                           ;
  const duree = entierPositif(`${nom}.${cleDuree}`, o[cleDuree]);
  const brut = typeof o.pourquoi === "string" ? o.pourquoi.trim().replace(/[.\s]+$/, "") : "";
  if (brut.length === 0 || brut.length > 400) throw new RangeError(`le pourquoi de la conservation est obligatoire : ${nom}`);
  return { duree, pourquoi: brut };
}

function suppressionCompte(d                          )           {
  const adresse = adresseValide(d.adresse);
  const supprime = dateValide("supprimeLe", d.supprimeLe);
  const empreinte = conservation("empreinteAdresse", d.empreinteAdresse, "mois");
  const journaux = conservation("journaux", d.journaux, "mois");
  const comptable = conservation("conservationComptable", d.conservationComptable, "annees");
  // Ce qui est gardé : chaque durée ET chaque raison viennent de l'API (sources proposées : la politique de confidentialité v2 et CONTRAT-STRIPE-V2.md).
  const gardes           = [];
  if (empreinte !== null) {
    gardes.push(`Une empreinte cryptographique de votre adresse e-mail, conservée pendant ${empreinte.duree} mois : ${empreinte.pourquoi}.`);
  }
  if (journaux !== null) {
    gardes.push(`Dans le journal technique des analyses, l’identifiant de votre compte et l’adresse des annonces analysées, pendant ${journaux.duree} mois au plus : ${journaux.pourquoi}.`);
  }
  if (comptable !== null) {
    gardes.push(
      `Vos factures, conservées ${comptable.duree === 1 ? "1 an" : `${comptable.duree} ans`} : ${comptable.pourquoi}. Votre client chez notre prestataire de paiement est anonymisé (adresse e-mail, nom, téléphone et adresses effacés).`,
    );
  }
  const blocs         = [
    { t: "p", texte: `Le compte Rat-Market associé à l’adresse ${adresse} a été supprimé le ${jour(supprime)}.` },
    { t: "sous-titre", texte: "Ce qui est supprimé" },
    {
      t: "liste",
      items: ["Votre compte et votre adresse e-mail", "L’historique de vos analyses", "Le lien avec vos extensions : elles redeviennent des installations sans compte"],
    },
  ];
  if (gardes.length > 0) {
    blocs.push({ t: "sous-titre", texte: "Ce qui est conservé, et pourquoi" });
    blocs.push({ t: "liste", items: gardes });
  }
  blocs.push({ t: "p", texte: `Si vous n’êtes pas à l’origine de cette suppression, écrivez-nous sans attendre à ${SITE.contactEmail}.` });
  return assembler({
    adresse,
    compteSupprime: true,
    objet: "Votre compte Rat-Market a été supprimé",
    resume: `Suppression effectuée le ${jour(supprime)}.`,
    titre: "Votre compte est supprimé",
    blocs,
  });
}

/** Les onze courriels, par nom : `COURRIELS.echecPaiement(données)`. */
export const COURRIELS = {
  creationCompte,
  debutEssai,
  rappelFinEssai,
  finEssai,
  paiementReussi,
  echecPaiement,
  resiliation,
  parrainFilleulEssai,
  parrainMoisGagne,
  reinitialisationMotDePasse,
  suppressionCompte,
};

                                                 
                                                                                          
