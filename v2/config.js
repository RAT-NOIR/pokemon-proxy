'use strict';
const POCHES = Object.freeze(['essai', 'accueil', 'hebdo', 'abonnement', 'achete']);
const entier = (nom, v, defaut, min = 0) => {
    if (v === undefined || v === '') return defaut;
    const n = String(v).trim() === '' ? NaN : Number(v);   // Number(' ') vaut 0 : un nombre fait d'espaces n'est pas un nombre
    if (!Number.isInteger(n) || n < min) throw new Error(`configuration invalide : ${nom}="${v}"`);
    return n;
};
const gele = o => { Object.values(o).forEach(x => { if (x && typeof x === 'object') gele(x); }); return Object.freeze(o); };
// Variable booléenne : seulement '0' ou '1' (absente ou vide = défaut). Toute autre valeur rend la configuration invalide.
const booleen = (nom, v, defaut) => {
    if (v === undefined || v === '') return defaut;
    if (v === '1') return true;
    if (v === '0') return false;
    throw new Error(`configuration invalide : ${nom}="${v}" (attendu 0 ou 1)`);
};

function lireConfig(env = process.env) {
    const ordre = env.V2_ORDRE_POCHES ? env.V2_ORDRE_POCHES.split(',').map(s => s.trim()) : ['essai', 'accueil', 'hebdo', 'abonnement', 'achete'];
    for (const p of ordre) if (!POCHES.includes(p)) throw new Error(`configuration invalide : poche inconnue "${p}"`);
    if (new Set(ordre).size !== ordre.length) throw new Error('configuration invalide : doublon dans V2_ORDRE_POCHES');
    const base = (env.MONGODB_BASE || '').trim() || null;
    const actif = env.RM_API_V2 === '1';
    // B8 (tour 1, m4) — le MODE BANC (secret de bac, Turnstile off, cookie sans Secure, origine d'extension de développement) exige DEUX témoins : le nom `test_scratch` (une étiquette,
    // qui existe aussi sur la production : v2/db.js:21-23) ET `BANC_ISOLE=1`, que seul le harnais des bancs pose (test/_env-banc.js, purgerEnv) — lu sur process.env, car les bancs passent des
    // objets d'environnement littéraux à lireConfig. Un `MONGODB_BASE=test_scratch` posé par erreur sur Render n'ouvre donc plus rien. Un nom n'est pas une preuve (CLAUDE.md §50).
    const banc = base === 'test_scratch' && process.env.BANC_ISOLE === '1';
    // Lot B2. Secret d'empreinte des adresses (HMAC) : v2 allumée sans secret = configuration invalide (fail-closed). Seul le bac de test_scratch
    // reçoit un secret de bac, jamais la production.
    const secretEmpreinte = (() => {
        const s = env.V2_SECRET_EMPREINTE;
        if (s !== undefined && s !== '') { if (String(s).length < 16) throw new Error('configuration invalide : V2_SECRET_EMPREINTE trop court (16 caractères au moins)'); return String(s); }
        if (banc) return 'secret-de-bac-test_scratch-uniquement';
        if (!actif) return null;
        throw new Error('configuration invalide : V2_SECRET_EMPREINTE absent (v2 allumée)');
    })();
    const url = (nom, v, defaut) => { if (v === undefined || v === '') return defaut; if (!/^https:\/\/\S+$/.test(v)) throw new Error(`configuration invalide : ${nom} doit commencer par https://`); return v; };
    const turnstile = (() => { const t = env.V2_TURNSTILE; if (t === undefined || t === '') return 'on'; if (t === 'on' || t === 'off') return t; throw new Error(`configuration invalide : V2_TURNSTILE="${t}" (attendu on ou off)`); })();
    if (actif && turnstile === 'off' && !banc) throw new Error('configuration invalide : V2_TURNSTILE=off n\'est accepté que sur une base de banc (MONGODB_BASE=test_scratch ET BANC_ISOLE=1)');
    // B8.1 : même garde que Turnstile — un cookie de session SANS Secure n'est admis que sur un banc (test_scratch) ; en production allumée, V2_COOKIE_SECURE=0 est une configuration invalide.
    const cookieSecure = booleen('V2_COOKIE_SECURE', env.V2_COOKIE_SECURE, true);
    if (actif && !cookieSecure && !banc) throw new Error('configuration invalide : V2_COOKIE_SECURE=0 n\'est accepté que sur une base de banc (MONGODB_BASE=test_scratch ET BANC_ISOLE=1)');
    return gele({
        actif,
        base,
        quotas: { essai: entier('V2_ESSAIS', env.V2_ESSAIS, 3), accueil: entier('V2_ACCUEIL', env.V2_ACCUEIL, 25),
                  hebdo: entier('V2_HEBDO', env.V2_HEBDO, 2), aboMensuel: entier('V2_ABO_MENSUEL', env.V2_ABO_MENSUEL, 100) },
        ordrePoches: [...ordre],
        plafonds: { panne: entier('V2_PLAFOND_PANNES', env.V2_PLAFOND_PANNES, 5), question: entier('V2_PLAFOND_QUESTIONS', env.V2_PLAFOND_QUESTIONS, 30) },
        questionDelaiMs: 24 * 3600 * 1000,
        // lectureLiveMax : combien de prix en direct l'extension lit pour un lot (§5 Q35, défaut 5). Rendu tel quel dans `analyse.lot.lectureLiveMax`.
        lot: { tranche: 10, lectureLiveMax: entier('V2_LECTURE_LIVE_MAX', env.V2_LECTURE_LIVE_MAX, 5) },
        limites: { installationParIpJour: 2, essaisGlobauxJour: entier('V2_ESSAIS_GLOBAUX_JOUR', env.V2_ESSAIS_GLOBAUX_JOUR, 500),
                   identifierParCompteHeure: 120, codeEssaisInstallationHeure: 5, codeEssaisIpHeure: 20, connexionParCompteHeure: 10,
                   inscriptionIpHeure: entier('V2_INSCRIPTION_IP_HEURE', env.V2_INSCRIPTION_IP_HEURE, 10, 1), oubliIpHeure: entier('V2_OUBLI_IP_HEURE', env.V2_OUBLI_IP_HEURE, 10, 1),
                   reinitIpHeure: entier('V2_REINIT_IP_HEURE', env.V2_REINIT_IP_HEURE, 10, 1), verificationIpHeure: entier('V2_VERIFICATION_IP_HEURE', env.V2_VERIFICATION_IP_HEURE, 30, 1),
                   connexionIpHeure: entier('V2_CONNEXION_IP_HEURE', env.V2_CONNEXION_IP_HEURE, 30, 1), suppressionParCompteHeure: entier('V2_SUPPRESSION_COMPTE_HEURE', env.V2_SUPPRESSION_COMPTE_HEURE, 10, 1),
                   renvoiParCompteHeure: entier('V2_RENVOI_COMPTE_HEURE', env.V2_RENVOI_COMPTE_HEURE, 3, 1),
                   collectionEcrituresParCompteHeure: 1000 },
        // « Ma collection » (COLLECTION-COMPACTE) : bornes écrites par ce qu'elles protègent. Pas de variable d'environnement : une borne qu'on desserre se décide.
        //   · clesParCompte = le CATALOGUE COMPLET avec une MARGE : 100 000 pour le plus grand compte MESURÉ le 2026-10-11 (68 792 fiches par la règle du site sur la sauvegarde du 10/10 — 64 858 fiches liées de
        //     l'archive plus 3 934 fiches sans produit ; le contrat annonçait 39 648, un dénominateur qui ne contenait pas ces fiches), soit +45 % : le catalogue grandit (141 fiches simples au lot 6, un set récent compte
        //     200 à 300 fiches) ; la place est de toute façon bornée par le budget d'octets ; test-collection-compacte.js échoue si le défaut passe sous 1,4 × le mesuré ;
        //   · horsCatalogueParCompte = 6 000 : les fiches que la règle du site donne et que l'archive ne porte pas (mesuré : 3 934, 128 sets, tous sets confondus), +52 % ; `hors` ne reçoit plus que les clés qu'un catalogue CHARGÉ ne connaît pas ;
        //   · quantitesParCompte = 10 000 : le nombre de clés à quantité ≥ 2 par compte (registre et hors) — sans lui un compte pèse ~3 fois plus (une quantité sur chacune de ses clés) ;
        //   · setsParCompte : 1 000 (le coût d'un document dépasse celui d'une clé) ; quantiteMax : 99, posée SANS mesure d'usage réel ;
        //   · octetsService : le budget GLOBAL, en OCTETS mesurés par collStats (données + index des deux collections), VALEUR PROVISOIRE (10 Mo) : relevé au passage en Flex. Un compteur unique, voir collection/service.js.
        collection: { clesParCompte: 100000, horsCatalogueParCompte: 6000, quantitesParCompte: 10000, setsParCompte: 1000, quantiteMax: 99, octetsService: 10485760 },
        comptes: { motDePasseMin: 10, lienHeures: 24, codeLongueur: 6, codeMinutes: 10, codesVivants: 3, sessionJours: 30, libelleMax: 60, glissementHeures: 24 },
        urls: { verification: url('V2_URL_VERIFICATION', env.V2_URL_VERIFICATION, 'https://rat-market.fr/fr/verification'), reinit: url('V2_URL_REINIT', env.V2_URL_REINIT, 'https://rat-market.fr/fr/reinitialisation') },
        empreinte: { secret: secretEmpreinte, jours: entier('V2_EMPREINTE_JOURS', env.V2_EMPREINTE_JOURS, 365, 1) },
        origines: { extension: 'chrome-extension://fgibgdgmadfejkaapeohbhaoolhgpkhb',
                    extensionDev: banc ? (env.V2_ORIGINE_EXTENSION_DEV || null) : null,
                    site: 'https://rat-market.fr' },
        // COTES-VISUELS : d'où l'API charge la décision des visuels et le lien fiche → produits. 'fichier' (défaut) : l'archive compacte précalculée HORS de l'API, objet R2 PRIVÉ lu avec des clés de lecture
        // dédiées et authentifié par un HMAC (variables V2_VISUELS_R2_* et V2_VISUELS_HMAC, lues par chargeur/montage.js, fermées par défaut : absentes ⇒ « sans visuel ») ; 'calcul' : calculée dans un fil plafonné
        // depuis `cartes` en lecture seule (pic mesuré ~320 Mo : à n'allumer que sur un service qui l'accepte).
        // `fichierBanc` : une archive LOCALE, honorée SEULEMENT en mode banc (comme extensionDev) — c'est ce qui permet aux bancs de semer des visuels sans toucher `cartes`.
        visuels: { source: (() => { const s = env.V2_VISUELS_SOURCE; if (s === undefined || s === '') return 'fichier'; if (s === 'fichier' || s === 'calcul') return s; throw new Error(`configuration invalide : V2_VISUELS_SOURCE="${s}" (attendu fichier ou calcul)`); })(),
                   fichierBanc: banc ? (env.V2_VISUELS_BANC_FICHIER || null) : null },
        images: { hotesPublics: ['pub-7d992e666c3d4a2b870b680a920045b6.r2.dev', 'rat-market.fr'], imageUrlsMax: 20, scannerOctetsMax: 12 * 1024 * 1024 },
        retention: { octroiJours: 730, annonceJours: 90, analysesMois: 24, mouvementsMois: 24, bancMois: 24, idempotenceHeures: 24, idempotenceEnCoursMinutes: 2, idempotenceBattementMs: 30000, idempotenceBattementMaxMinutes: 10 },
        annonce: { conservee: booleen('V2_DESCRIPTION_CONSERVEE', env.V2_DESCRIPTION_CONSERVEE, true), auModele: booleen('V2_DESCRIPTION_AU_MODELE', env.V2_DESCRIPTION_AU_MODELE, false) },
        banc: { versionsTexte: ['2026-10-07-v1'] },
        verdict: { bonneAffaireSous: -30, cherAuDela: 15 },
        devises: ['EUR', 'GBP', 'USD', 'PLN', 'CZK', 'HUF', 'RON', 'SEK', 'DKK'],
        marches: (env.V2_MARCHES ? env.V2_MARCHES.split(',').map(s => s.trim()) :
            ['fr', 'be', 'com', 'de', 'es', 'it', 'nl', 'lu', 'at', 'pl', 'pt', 'se', 'cz', 'sk', 'lt', 'uk'].map(t => `vinted.${t}`)),
        versionMinExtension: env.V2_VERSION_MIN_EXTENSION || '2.0.0',
        regleG: booleen('V2_REGLE_G', env.V2_REGLE_G, false),
        turnstile,
        cookieSecure
    });
}
module.exports = { lireConfig, POCHES };
