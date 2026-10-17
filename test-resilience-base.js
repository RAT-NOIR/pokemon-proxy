// TEST — le worker survit à une coupure de la base (collecte-cartes/resilience-base.js). Aucun réseau, aucune base : faux objets.
//   node test-resilience-base.js      -> code 0 si tout passe
// Demande du testeur (2026-10-17) : « une file vide n'est pas une panne… ne passe jamais Failed sur Render pour ça ».
// Cause mesurée : la base injoignable remontait au catch global (`exit 1`). La garde s'écrit par ce qu'elle AUTORISE : liste fermée de noms.
const fs = require('fs');
const path = require('path');
const { fabriquerVerrou } = require('./collecte-cartes/verrou-source');
const R = require('./collecte-cartes/resilience-base');

let ok = 0, ko = 0;
const verifier = (nom, cond, detail) => { if (cond) { ok++; console.log(`  ✅ ${nom}`); } else { ko++; console.log(`  ❌ ${nom}${detail ? ' — ' + detail : ''}`); } };
const erreur = (name, message = 'boom') => { const e = new Error(message); e.name = name; return e; };
const journalFactice = () => { const lignes = []; return { lignes, error: m => lignes.push(String(m)), warn: m => lignes.push(String(m)), log: m => lignes.push(String(m)) }; };

// --- modèle en mémoire du verrou (copie réduite de test-verrou-source.js), avec une PANNE commutable ---
const lire = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
function correspond(doc, f) {
    return Object.entries(f).every(([k, v]) => {
        if (k === '$or') return v.some(s => correspond(doc, s));
        const val = lire(doc, k);
        if (v && typeof v === 'object' && !(v instanceof Date)) {
            if ('$exists' in v) return (val !== undefined) === v.$exists;
            if ('$lt' in v) return val !== undefined && val < v.$lt;
        }
        return val instanceof Date && v instanceof Date ? +val === +v : val === v;
    });
}
function ecrire(o, p, v) { const ks = p.split('.'); let a = o; for (const k of ks.slice(0, -1)) a = a[k] ??= {}; a[ks.at(-1)] = v; }
function effacer(o, p) { const ks = p.split('.'); let a = o; for (const k of ks.slice(0, -1)) { a = a?.[k]; } if (a) delete a[ks.at(-1)]; }
function appliquer(doc, u, insertion) {
    for (const [p, v] of Object.entries(u.$set || {})) ecrire(doc, p, structuredClone(v));
    for (const p of Object.keys(u.$unset || {})) effacer(doc, p);
    if (insertion) for (const [p, v] of Object.entries(u.$setOnInsert || {})) ecrire(doc, p, structuredClone(v));
}
function modeleFactice() {
    const docs = new Map(); const etat = { panne: false };
    const coupure = () => { if (etat.panne) throw erreur('MongoServerSelectionError', 'connection <monitor> to 65.62.0.42:27017 closed'); };
    const lean = v => ({ lean: async () => { coupure(); return v ? structuredClone(v) : null; } });
    return {
        docs, etat,
        findOneAndUpdate: (f, u, o) => ({
            lean: async () => {
                coupure();
                const d = docs.get(f._id);
                if (d && correspond(d, f)) { appliquer(d, u, false); return structuredClone(d); }
                if (d) { const e = new Error('E11000'); e.code = 11000; throw e; }
                if (!o.upsert) return null;
                const n = { _id: f._id }; appliquer(n, u, true); docs.set(f._id, n); return structuredClone(n);
            }
        }),
        updateOne: async (f, u) => {
            coupure();
            const d = docs.get(f._id);
            if (!d || !correspond(d, f)) return { matchedCount: 0, modifiedCount: 0 };
            appliquer(d, u, false); return { matchedCount: 1, modifiedCount: 1 };
        },
        findById: id => lean(docs.get(id))
    };
}

(async () => {
    const silence = { error: console.error, warn: console.warn, log: console.log };
    // ---------------------------------------------------------------- 1. la liste fermée
    console.log('— estPassagere : liste FERMÉE par nom');
    for (const n of ['MongoServerSelectionError', 'MongooseServerSelectionError', 'MongoNetworkError', 'MongoNetworkTimeoutError', 'MongoNotConnectedError'])
        verifier(`${n} est passagère`, R.estPassagere(erreur(n)));
    for (const n of ['TypeError', 'Error', 'MongoServerError', 'MongoParseError', 'MongoInvalidArgumentError', 'ValidationError', 'MongoServerSelectionErrorBis'])
        verifier(`${n} n'est PAS passagère`, !R.estPassagere(erreur(n)));
    verifier('null / chaîne / objet sans nom : non', !R.estPassagere(null) && !R.estPassagere('MongoServerSelectionError') && !R.estPassagere({}));

    // ---------------------------------------------------------------- 2. connexion : échoue 2 fois puis réussit
    console.log('— superviser : la connexion échoue 2 fois puis réussit');
    {
        const j = journalFactice(); let tentatives = 0, boucleTournee = false, attentes = [];
        let sorti = null; const vraiExit = process.exit; process.exit = c => { sorti = c; };
        try {
            await R.superviser({
                executer: async ({ reussi }) => { tentatives++; if (tentatives < 3) throw erreur('MongooseServerSelectionError', 'connect ECONNREFUSED 65.62.0.42:27017'); reussi(); boucleTournee = true; },
                journal: j, arret: () => false, attendre: async ms => { attentes.push(ms); }
            });
        } finally { process.exit = vraiExit; }
        const alertes = j.lignes.filter(l => /🔴 base injoignable/.test(l));
        verifier('aucun exit', sorti === null);
        verifier('2 lignes d\'alerte', alertes.length === 2, JSON.stringify(j.lignes));
        verifier('format « nouvel essai dans N s »', /base injoignable : .+ — nouvel essai dans 30 s/.test(alertes[0] || '') && /dans 60 s/.test(alertes[1] || ''), alertes.join(' | '));
        verifier('la boucle tourne ensuite', boucleTournee && tentatives === 3);
        verifier('délais 30 s puis 60 s', JSON.stringify(attentes) === '[30000,60000]', JSON.stringify(attentes));
    }

    // ---------------------------------------------------------------- 3. délai borné et croissant, sans limite de durée
    console.log('— superviser : délai croissant, plafonné à 5 min, remis à zéro après un succès');
    {
        const j = journalFactice(); let n = 0; const attentes = [];
        await R.superviser({
            executer: async ({ reussi }) => { n++; if (n === 9) { reussi(); throw erreur('MongoNetworkError'); } if (n < 10) throw erreur('MongoNetworkError'); },
            journal: j, arret: () => false, attendre: async ms => { attentes.push(ms); }
        });
        verifier('30, 60, 120, 240, 300, 300, 300, 300', JSON.stringify(attentes.slice(0, 8)) === '[30000,60000,120000,240000,300000,300000,300000,300000]', JSON.stringify(attentes));
        verifier('après un succès (reussi), le délai repart de 30 s', attentes[8] === 30000, JSON.stringify(attentes));
        verifier('9 pannes survécues, sans limite de nombre', n === 10);
    }

    // ---------------------------------------------------------------- 4. une opération de boucle lève, alerte, attente, reprise
    console.log('— superviser : une opération de boucle lève MongoServerSelectionError');
    {
        const j = journalFactice(); let passes = 0, nettoyages = 0, travail = 0;
        await R.superviser({
            executer: async () => { passes++; if (passes === 1) { travail++; throw erreur('MongoServerSelectionError', 'timed out'); } travail++; },
            nettoyer: async () => { nettoyages++; },
            journal: j, arret: () => false, attendre: async () => { }
        });
        verifier('alerte écrite', j.lignes.some(l => /🔴 base injoignable : timed out — nouvel essai dans 30 s/.test(l)), JSON.stringify(j.lignes));
        verifier('nettoyage (connexions, battement) avant l\'attente', nettoyages === 1);
        verifier('reprise : le travail continue', passes === 2 && travail === 2);
    }

    // ---------------------------------------------------------------- 5. erreur non passagère : comportement d'avant
    console.log('— superviser : une erreur NON passagère remonte (donc exit 1 au catch global)');
    {
        const j = journalFactice(); let rejet = null, attendu = false;
        try { await R.superviser({ executer: async () => { throw new TypeError('défaut réel'); }, journal: j, arret: () => false, attendre: async () => { attendu = true; } }); }
        catch (e) { rejet = e; }
        verifier('l\'erreur est relancée telle quelle', rejet instanceof TypeError && /défaut réel/.test(rejet.message));
        verifier('ni alerte « base injoignable » ni attente', !attendu && !j.lignes.some(l => /base injoignable/.test(l)));
    }
    {
        // ET le catch global de collecteur-images.js garde `exit(1)` (lecture du code : la garde ne vit pas que dans le module)
        const src = fs.readFileSync(path.join(__dirname, 'collecteur-images.js'), 'utf8');
        verifier('collecteur-images.js : le catch global fait toujours exit(1)', /console\.error\('❌ ERREUR', e\);\s*process\.exit\(1\)/.test(src));
        verifier('collecteur-images.js : superviser n\'enveloppe QUE --boucle', /--boucle[\s\S]{0,400}superviser|superviser[\s\S]{0,400}--boucle/.test(src) && /resilience-base/.test(src));
    }

    // ---------------------------------------------------------------- 6. SIGTERM pendant l'attente : sortie rapide, code 0
    console.log('— SIGTERM pendant l\'attente');
    {
        const j = journalFactice(); let arret = false, sorti = null, passes = 0;
        const vraiExit = process.exit; process.exit = c => { sorti = c; };
        const code0 = process.exitCode;
        const t0 = Date.now();
        try {
            await R.superviser({
                executer: async () => { passes++; throw erreur('MongoServerSelectionError'); },
                journal: j, arret: () => arret,
                attendre: async (ms, arreter) => { arret = true; return R.dormirInterrompu(ms, arreter); }   // le signal arrive pendant l'attente
            });
        } finally { process.exit = vraiExit; }
        verifier('retour rapide (< 2 s) au lieu de 30 s', Date.now() - t0 < 2000, `${Date.now() - t0} ms`);
        verifier('aucun exit, aucun code non nul', sorti === null && (process.exitCode === code0 || !process.exitCode));
        verifier('pas de nouvel essai après le signal', passes === 1);
        const t1 = Date.now(); await R.dormirInterrompu(60000, () => true);
        verifier('dormirInterrompu rend la main aussitôt si l\'arrêt est déjà demandé', Date.now() - t1 < 500);
    }

    // ---------------------------------------------------------------- 7. verrou expiré pendant la coupure : repris AVANT toute collecte
    console.log('— le verrou global expiré pendant la coupure est repris avant toute collecte');
    {
        const M = modeleFactice(); const id = 'artofpkm/__collecteur__';
        const identite = { pid: 52, hote: 'srv-x', jeton: 'J1', commit: 'abc' };
        const evenements = [];
        let verrou = null;
        const fabriquer = () => fabriquerVerrou({ Modele: M, id, dureeMs: 180000, battementMs: 3600000, surInsertion: { phase: 'collecteur' }, nom: 'verrou global artofpkm', identite });
        const reprendre = async () => { verrou = fabriquer(); const t = await verrou.prendre(); evenements.push(t ? 'tenu-par-autre' : 'verrou-repris'); return !t; };
        console.error = () => { }; console.warn = () => { }; console.log = () => { };
        let passage = 0, nettoyages = 0;
        try {
            await R.superviser({
                executer: async ({ reussi }) => {
                    passage++;
                    await reprendre();                                              // comme attendreVerrouGlobal au démarrage
                    for (let tour = 0; tour < 2; tour++) {
                        if (passage === 1 && tour === 1) {                           // la base tombe, le verrou expire pendant la coupure
                            M.etat.panne = true; M.docs.get(id).verrou.depuis = new Date(Date.now() - 600000);
                        }
                        const etat = await R.garantirVerrou({ verrou: () => verrou, reprendre });
                        if (etat !== 'ok') throw new Error(`état inattendu ${etat}`);
                        reussi(); evenements.push(`collecte-${passage}-${tour}`);
                    }
                },
                nettoyer: async () => { nettoyages++; await verrou.rendre(); M.etat.panne = false; },   // la base revient pendant l'attente
                journal: journalFactice(), arret: () => false, attendre: async () => { }
            });
        } finally { console.error = silence.error; console.warn = silence.warn; console.log = silence.log; }
        verifier('la revérification en panne n\'est PAS une perte (exception passagère relancée, pas de code 1)', nettoyages === 1 && passage === 2, `passages=${passage} nettoyages=${nettoyages}`);
        const iReprise = evenements.lastIndexOf('verrou-repris'), iCollecte = evenements.indexOf('collecte-2-0');
        verifier('verrou repris avant la collecte suivante', iReprise > -1 && iCollecte > iReprise, JSON.stringify(evenements));
        verifier('aucune collecte pendant la coupure', !evenements.includes('collecte-1-1'), JSON.stringify(evenements));
        verifier('verrou à nous en base, battement frais', M.docs.get(id).verrou.jeton === 'J1' && Date.now() - +new Date(M.docs.get(id).verrou.depuis) < 5000);
    }

    // ---------------------------------------------------------------- 8. une VRAIE perte garde son comportement
    console.log('— une vraie perte (un autre détenteur frais) reste une perte');
    {
        const M = modeleFactice(); const id = 'artofpkm/__collecteur__'; let perdu = null;
        const moi = { pid: 52, hote: 'srv-a', jeton: 'A', commit: 'x' };
        const verrou = fabriquerVerrou({ Modele: M, id, dureeMs: 180000, battementMs: 3600000, surPerte: m => { perdu = m; }, identite: moi, nom: 'verrou global artofpkm' });
        console.error = () => { }; console.warn = () => { };
        let etat;
        try {
            await verrou.prendre();
            M.docs.get(id).verrou = { pid: 52, hote: 'srv-b', jeton: 'B', depuis: new Date() };   // un autre pod l'a pris
            etat = await R.garantirVerrou({ verrou, reprendre: async () => true });
        } finally { console.error = silence.error; console.warn = silence.warn; }
        verifier('garantirVerrou rend « perdu » (pas d\'exception passagère)', etat === 'perdu', String(etat));
        verifier('surPerte appelée', !!perdu);
    }

    // ---------------------------------------------------------------- 9. la file vide ne change pas
    console.log('— la file vide : sommeil, ligne, alerte — jamais de sortie non nulle');
    {
        const src = fs.readFileSync(path.join(__dirname, 'collecteur-images.js'), 'utf8');
        const debut = src.indexOf('if (!suivant) {'), fin = src.indexOf('continue;', debut);
        const bloc = src.slice(debut, fin);
        verifier('la branche « file vide » dort 10 min (interruptible) et reboucle', /10 \* 60 \* 1000/.test(bloc) && !/exit|exitCode|throw/.test(bloc), bloc.slice(0, 80));
        const ali = fs.readFileSync(path.join(__dirname, 'collecte-cartes', 'alimentateur.js'), 'utf8');
        verifier('alimentateur : l\'alerte file-vide et la ligne « FILE VIDE » existent toujours', /file-vide/.test(ali) && /FILE VIDE/.test(ali));
        verifier('« FILE VIDE » n\'est pas une erreur passagère (aucune confusion de listes)', !R.estPassagere(erreur('FILE VIDE')));
    }

    console.log(`\n${ok} réussis, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ERREUR DU BANC', e); process.exit(2); });
