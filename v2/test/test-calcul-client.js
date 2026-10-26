'use strict';
// Banc CALCUL-CLIENT (1) — le module pur des mesures calculées par le client (contrat « calcul client », DEMANDE-SERVEUR-EXTENSION.md, entrée « API — 26/10 (nuit) ») :
//   · ensembleFerme : TOUTES les mesures que la règle G pourrait lire pour une ligne de voisins (le client ne peut pas deviner le chemin de la règle : il les calcule toutes) ;
//   · le jeton signé qui lie le scan, la liste exacte des mesures et les références ;
//   · la validation des résultats envoyés (forme, bornes, cohérence), écrite par ce qu'elle AUTORISE ;
//   · la décision rejouée sur ces résultats, identique à celle que G rend sur les mêmes mesures.
// Module sans base ni réseau : contextes et mesures FABRIQUÉS.
const H = require('./_harnais');
const G = require('../../ratmarket/decision-g');
const M = require('../identifier/calcul-client');

const SECRET = 'secret-de-banc-' + 'mesures-client-0123456789';      // secret FABRIQUÉ de banc, en deux morceaux (contrôle d'avant push)
function graine(s) { let x = s >>> 0; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; }; }

// le contexte : v1…v5 sont cinq visuels du MÊME dessin (groupe 0, même carte 1 : cinq tirages d'un texte) ; s1 est seul ; f1 a un frère f2 hors du top ; i1 a une impression sans visuel
const ctx = G.contexte({
    groupe: { v1: 0, v2: 0, v3: 0, v4: 0, v5: 0, f1: 1, f2: 1 },
    carte: { v1: [1], v2: [1], v3: [1], v4: [1], v5: [1], s1: [10], f1: [11], f2: [12], i1: [13], a: [20], b: [21], c: [22], d: [23], e: [24], f: [25], g: [26], h: [27] },
    invisibles: { 13: [9013] },
    produits: { v1: [[101, 1]], v2: [[102, 2]], v3: [[103, 3]], v4: [[104, 4]], v5: [[105, 5]], s1: [[110, 1]], f1: [[111, 1]], f2: [[112, 1]], i1: [[113, 1]] }
});
const loin = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const ligne = (tete) => { const top = [...tete]; for (const k of loin) { if (top.length >= 10) break; top.push([k, 0.2]); } return { top: top.slice(0, 10), essai: 1 }; };
const cleDe = m => (m.type === 'paire' ? `paire:${m.a}|${m.b}` : `zones:${m.ref}`);

(async () => {
    // ── 1. l'ensemble fermé
    const e1 = M.ensembleFerme(ctx, ligne([['s1', 0.9]]));
    H.v('1a. un premier voisin seul, sans jumeau ni impression sans visuel, marge large : rien à mesurer (la règle décide sans pixels)', e1, { mesures: [], refs: [] });
    const e1b = M.ensembleFerme(ctx, ligne([['s1', 0.5], ['a', 0.45]]));
    H.v('1b. un premier voisin seul dont la marge est sous le plancher : rien à mesurer (la règle refuse avant toute mesure)', e1b, { mesures: [], refs: [] });
    const e2 = M.ensembleFerme(ctx, ligne([['f1', 0.9]]));
    H.v('1c. un premier voisin dont le FRÈRE de groupe n\'est pas dans le top : la zone clé seule', e2 && e2.mesures.map(cleDe), ['zones:f1']);
    const e2b = M.ensembleFerme(ctx, ligne([['i1', 0.9]]));
    H.v('1d. un premier voisin dont la carte a une impression sans visuel : la zone clé seule', e2b && e2b.mesures.map(cleDe), ['zones:i1']);
    const e3 = M.ensembleFerme(ctx, ligne([['v1', 0.9], ['v2', 0.88]]));
    H.v('1e. un jumeau : les deux paires ordonnées, puis les zones des deux', e3 && e3.mesures.map(cleDe), ['paire:v1|v2', 'paire:v2|v1', 'zones:v1', 'zones:v2']);
    H.v('1f. les références : les visuels mesurés, dans l\'ordre du top', e3 && e3.refs, ['v1', 'v2']);
    const e4 = M.ensembleFerme(ctx, ligne([['v1', 0.9], ['v2', 0.88], ['v3', 0.87]]));
    H.v('1g. deux jumeaux : 6 paires ordonnées + 3 zones = 9 mesures', e4 && [e4.mesures.length, e4.refs], [9, ['v1', 'v2', 'v3']]);
    H.v('1h. trois jumeaux : 12 paires + 4 zones = 16 > 12 : PAS de complément (null)', M.ensembleFerme(ctx, ligne([['v1', 0.9], ['v2', 0.88], ['v3', 0.87], ['v4', 0.86]])), null);
    H.v('1i. un concurrent par la seule PROXIMITÉ (autre dessin, à moins de delta), sans vrai jumeau : les paires, pas de zone clé', (M.ensembleFerme(ctx, ligne([['s1', 0.9], ['a', 0.89]])) || {}).mesures?.map(cleDe), ['paire:s1|a', 'paire:a|s1']);
    H.v('1i2. un concurrent de proximité ET un vrai jumeau du premier : la zone clé vaut pour chaque visuel retenu', (M.ensembleFerme(ctx, ligne([['v1', 0.9], ['s1', 0.89], ['v2', 0.6]])) || {}).mesures?.filter(m => m.type === 'zones').map(m => m.ref), ['v1', 's1', 'v2']);
    H.v('1j. une ligne mal formée : null (jamais d\'exception)', [M.ensembleFerme(ctx, null), M.ensembleFerme(ctx, { top: [] }), M.ensembleFerme(null, ligne([['v1', 0.9]]))], [null, null, null]);

    // 🔑 la propriété qui fait tenir le contrat : sous N jeux de mesures tirés au hasard, chaque mesure que G DEMANDE est dans l'ensemble fermé
    {
        const scenarios = [[['v1', 0.9], ['v2', 0.88]], [['v1', 0.9], ['v2', 0.88], ['v3', 0.87]], [['s1', 0.9], ['a', 0.89]], [['f1', 0.9]], [['i1', 0.9]], [['v1', 0.9], ['s1', 0.89], ['v2', 0.6]]];
        let demandes = 0, hors = 0;
        for (const [n, tete] of scenarios.entries()) {
            const l = ligne(tete), ens = M.ensembleFerme(ctx, l);
            const dans = new Set((ens ? ens.mesures : []).map(cleDe));
            const r = graine(7 + n);
            for (let t = 0; t < 200; t++) {
                const mes = {
                    comparerPaire: (a, b) => { demandes++; if (!dans.has(`paire:${a}|${b}`)) hors++; return [r() * 0.4 - 0.2, r() < 0.1 ? 0 : r()]; },
                    scoresZones: c => { demandes++; if (!dans.has(`zones:${c}`)) hors++; return { haut: r(), illustration: r(), bandeau: r(), texte: r(), bas: r(), inliers: Math.floor(r() * 120) }; }
                };
                G.decider(ctx, l, 1, mes, G.SEUILS_G);
            }
        }
        H.v('1k. 🔑 1 200 décisions sous des mesures tirées au hasard : AUCUNE mesure demandée par G hors de l\'ensemble fermé', [demandes > 1000, hors], [true, 0]);
    }

    // ── 2. le jeton
    const mes = e3.mesures, refs = [{ ref: 'v1', sha256: 'a'.repeat(64) }, { ref: 'v2', sha256: 'b'.repeat(64) }];
    const T0 = 1_800_000_000_000, exp = T0 + 120e3;
    const j = M.signerJeton({ scanId: '42', mesures: mes, refs, exp }, SECRET);
    const ver = (o = {}, s = SECRET) => M.verifierJeton(o.jeton ?? j, { scanId: '42', mesures: mes, refs, maintenant: T0 + 1000, ...o }, s);
    H.v('2a. un jeton signé se vérifie', ver(), true);
    H.v('2b. un autre scan : refusé', ver({ scanId: '43' }), false);
    H.v('2c. une autre liste de mesures (ordre changé) : refusé', ver({ mesures: [mes[1], mes[0], mes[2], mes[3]] }), false);
    H.v('2d. une autre référence (sha256) : refusé', ver({ refs: [refs[0], { ref: 'v2', sha256: 'c'.repeat(64) }] }), false);
    H.v('2e. expiré : refusé', ver({ maintenant: exp + 1 }), false);
    H.v('2f. un autre secret : refusé', ver({}, SECRET + 'x'), false);
    H.v('2g. mal formé (vide, sans point, signature tronquée, date falsifiée) : refusé', [ver({ jeton: '' }), ver({ jeton: 'abc' }), ver({ jeton: j.slice(0, -2) }), ver({ jeton: String(exp + 9e6) + j.slice(j.indexOf('.')) })], [false, false, false, false]);
    H.v('2h. le jeton ne porte ni le secret ni le scan en clair, et tient en 100 caractères', [j.includes(SECRET), j.length <= 100], [false, true]);

    // ── 3. la validation des résultats
    const bons = [
        { type: 'paire', a: 'v1', b: 'v2', ecart: 0.12, couverture: 0.08 },
        { type: 'paire', a: 'v2', b: 'v1', ecart: -0.12, couverture: 0.081 },
        { type: 'zones', ref: 'v1', haut: 0.8, illustration: 0.7, bandeau: 0.6, texte: 0.5, bas: 0.9, inliers: 140 },
        { type: 'zones', ref: 'v2', haut: 0.4, illustration: 0.7, bandeau: 0.6, texte: 0.5, bas: 0.3, inliers: 90 }
    ];
    const val = (r, o) => M.validerResultats(mes, r, o);
    const avec = (i, champ, x) => bons.map((b, k) => (k === i ? { ...b, [champ]: x } : b));
    H.v('3a. les résultats exacts : acceptés', val(bons), { ok: true });
    H.v('3b. pas un tableau, trop court, trop long : forme', [val(null).code, val(bons.slice(1)).code, val([...bons, bons[0]]).code], ['forme', 'forme', 'forme']);
    H.v('3c. un ordre différent de la demande : forme', val([bons[1], bons[0], bons[2], bons[3]]).code, 'forme');
    H.v('3d. une clé inconnue, un type inconnu : forme', [val([{ ...bons[0], extra: 1 }, ...bons.slice(1)]).code, val(avec(0, 'type', 'autre')).code], ['forme', 'forme']);
    H.v('3e. un ncc non fini ou hors de [−1 ; 1] : valeur', [val(avec(2, 'bas', NaN)).code, val(avec(2, 'haut', 1.2)).code, val(avec(3, 'texte', -1.01)).code, val(avec(2, 'bas', '0.9')).code], ['valeur', 'valeur', 'valeur', 'valeur']);
    H.v('3f. des appuis non entiers, négatifs ou au-delà de 300 : valeur', [val(avec(2, 'inliers', 3.5)).code, val(avec(2, 'inliers', -1)).code, val(avec(2, 'inliers', 301)).code], ['valeur', 'valeur', 'valeur']);
    H.v('3g. un écart hors de [−2 ; 2], une couverture hors de [0 ; 1] : valeur', [val(avec(0, 'ecart', 2.5)).code, val(avec(0, 'couverture', 1.2)).code, val(avec(0, 'couverture', -0.1)).code], ['valeur', 'valeur', 'valeur']);
    H.v('3h. 🔑 une couverture nulle avec un écart non nul : cohérence (le calcul rend 0 quand rien ne diffère)', val(avec(0, 'couverture', 0)).code, 'coherence');
    H.v('3i. 🔑 une couverture que le serveur CONNAÎT, à plus de 1e-4 : cohérence ; à moins : acceptée', [val(bons, { couvertures: { 'v1|v2': 0.09 } }).code, val(bons, { couvertures: { 'v1|v2': 0.08005 } }).ok], ['coherence', true]);
    H.v('3j. un résultat qui n\'est pas un objet : forme', val([bons[0], 'x', bons[2], bons[3]]).code, 'forme');

    // ── 4. la décision rejouée sur les résultats du client
    {
        const l = ligne([['v1', 0.9], ['v2', 0.88]]);
        const parCle = new Map(bons.map(b => [b.type === 'paire' ? `paire:${b.a}|${b.b}` : `zones:${b.ref}`, b]));
        const direct = G.decider(ctx, l, 1, { comparerPaire: (a, b) => { const x = parCle.get(`paire:${a}|${b}`); return [x.ecart, x.couverture]; }, scoresZones: c => parCle.get(`zones:${c}`) }, G.SEUILS_G);
        const rejoue = M.deciderAvecResultats(ctx, l, mes, bons);
        H.v('4a. la décision sur les résultats du client = celle de G sur les mêmes mesures', [rejoue.ok, JSON.stringify(rejoue.decision) === JSON.stringify(direct), direct.affirme], [true, true, true]);
        H.v('4b. une mesure manquante (liste demandée plus courte que ce que G lit) : muette, jamais une exception', M.deciderAvecResultats(ctx, l, mes.slice(0, 1), bons.slice(0, 1)), { ok: false, code: 'muette' });
    }

    H.bilan();
})().catch(e => { console.error('❌', e); process.exitCode = 1; });
