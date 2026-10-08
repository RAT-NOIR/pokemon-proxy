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
    return gele({
        actif: env.RM_API_V2 === '1',
        base,
        quotas: { essai: entier('V2_ESSAIS', env.V2_ESSAIS, 3), accueil: entier('V2_ACCUEIL', env.V2_ACCUEIL, 25),
                  hebdo: entier('V2_HEBDO', env.V2_HEBDO, 2), aboMensuel: entier('V2_ABO_MENSUEL', env.V2_ABO_MENSUEL, 100) },
        ordrePoches: [...ordre],
        plafonds: { panne: entier('V2_PLAFOND_PANNES', env.V2_PLAFOND_PANNES, 5), question: entier('V2_PLAFOND_QUESTIONS', env.V2_PLAFOND_QUESTIONS, 30) },
        questionDelaiMs: 24 * 3600 * 1000,
        lot: { tranche: 10 },
        limites: { installationParIpJour: 2, essaisGlobauxJour: entier('V2_ESSAIS_GLOBAUX_JOUR', env.V2_ESSAIS_GLOBAUX_JOUR, 500),
                   identifierParCompteHeure: 120, codeEssaisInstallationHeure: 5, codeEssaisIpHeure: 20, connexionParCompteHeure: 10 },
        comptes: { motDePasseMin: 10, lienHeures: 24, codeLongueur: 6, codeMinutes: 10, codesVivants: 3, sessionJours: 30, libelleMax: 60 },
        origines: { extension: 'chrome-extension://fgibgdgmadfejkaapeohbhaoolhgpkhb',
                    extensionDev: base === 'test_scratch' ? (env.V2_ORIGINE_EXTENSION_DEV || null) : null,
                    site: 'https://rat-market.fr' },
        images: { hotesPublics: ['pub-7d992e666c3d4a2b870b680a920045b6.r2.dev', 'rat-market.fr'], imageUrlsMax: 20, scannerOctetsMax: 12 * 1024 * 1024 },
        retention: { annonceJours: 90, analysesMois: 24, mouvementsMois: 24, bancMois: 24, idempotenceHeures: 24, idempotenceEnCoursMinutes: 2 },
        annonce: { conservee: booleen('V2_DESCRIPTION_CONSERVEE', env.V2_DESCRIPTION_CONSERVEE, true), auModele: booleen('V2_DESCRIPTION_AU_MODELE', env.V2_DESCRIPTION_AU_MODELE, false) },
        banc: { versionsTexte: ['2026-10-07-v1'] },
        verdict: { bonneAffaireSous: -30, cherAuDela: 15 },
        devises: ['EUR', 'GBP', 'USD', 'PLN', 'CZK', 'HUF', 'RON', 'SEK', 'DKK'],
        marches: (env.V2_MARCHES ? env.V2_MARCHES.split(',').map(s => s.trim()) :
            ['fr', 'be', 'com', 'de', 'es', 'it', 'nl', 'lu', 'at', 'pl', 'pt', 'se', 'cz', 'sk', 'lt', 'uk'].map(t => `vinted.${t}`)),
        versionMinExtension: env.V2_VERSION_MIN_EXTENSION || '2.0.0',
        regleG: booleen('V2_REGLE_G', env.V2_REGLE_G, false),
        turnstile: (() => { const t = env.V2_TURNSTILE; if (t === undefined || t === '') return 'on'; if (t === 'on' || t === 'off') return t; throw new Error(`configuration invalide : V2_TURNSTILE="${t}" (attendu on ou off)`); })(),
        cookieSecure: booleen('V2_COOKIE_SECURE', env.V2_COOKIE_SECURE, true)
    });
}
module.exports = { lireConfig, POCHES };
