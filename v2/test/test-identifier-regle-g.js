'use strict';
// Banc B1a.4 — la règle G enveloppée : mêmes décisions que ratmarket/decision-g.js::decider, traduites en issues du contrat 2.
// Fixtures du labo : si elles manquent, le banc le DIT et sort en code 1 (pas en vert).
const fs = require('fs'), path = require('path');
const { v, vrai, bilan } = require('./_harnais');
const G = require('../../ratmarket/decision-g');
const { decisionRegleG, regleGActive } = require('../identifier/regle-g');

// ── faux contexte minimal pour piloter `decider` sur des cas fabriqués (une photo, un visuel, des produits)
const ctxG = (produits, extra = {}) => G.contexte({ groupe: {}, carte: { v1: [1], v2: [2], v3: [3] }, invisibles: {}, produits, ...extra });
const ligne = (top, essai = 0) => ({ top, essai });
const mes = { comparerPaire: () => [0, 1], scoresZones: () => ({ haut: 1, bas: 1, inliers: 100 }) };
const dec = (produits, top, extra) => decisionRegleG({ ligne: ligne(top), nEssais: 1, mesures: mes, contexteG: ctxG(produits, extra) });
const leve = f => { try { f(); return false; } catch { return true; } };
const avant = JSON.stringify(G.SEUILS_G);

// (1) affirme
{
    const r = dec({ v1: [[500, 9.0]] }, [['v1', 0.95], ['v2', 0.40], ['v3', 0.30]]);
    v('affirmé -> affirmee + produit', [r.issue, r.produit], ['affirmee', 500]);
    vrai('affirmée : pas de candidats', r.candidats === undefined);
}
// (2) réponse commune -> QUESTION (code visuel), jamais une issue « réponse commune »
{
    const plus = dec({ v1: [[500, 9.0], [501, 9.0], [502, 9.1], [503, 9.0]] }, [['v1', 0.95], ['v2', 0.40], ['v3', 0.30]]);
    v('réponse commune à 4 indiscernables : pas une question à 3 choix, pas une cause inventée -> null (chaîne héritée)', plus, null);
    const r = dec({ v1: [[500, 9.0], [501, 9.0], [502, 9.1]] }, [['v1', 0.95], ['v2', 0.40], ['v3', 0.30]]);
    v('réponse commune -> question', r.issue, 'question');
    v('réponse commune : jusqu\'à 3 candidats', r.candidats, [500, 501, 502]);
    v('réponse commune : code de question visuel', r.codeQuestion, 'visuel');
    vrai('pas de produit affirmé', r.produit === undefined);
}
// (3) question: [...]
{
    const r = dec({ v1: [[500, 9.0], [501, 20.0]] }, [['v1', 0.95], ['v2', 0.40], ['v3', 0.30]]);
    v('question -> question avec ces candidats', [r.issue, r.candidats, r.codeQuestion], ['question', [500, 501], 'visuel']);
    const r2 = dec({ v1: [[500, 9.0], [501, 20.0], [502, 30.0], [503, 40.0]] }, [['v1', 0.95], ['v2', 0.40], ['v3', 0.30]]);
    v('question à 4 -> 3 premiers', r2.candidats, [500, 501, 502]);
}
// (4) ni produit ni deux candidats -> null : la chaîne héritée décide (la règle G remplace une décision par une décision, jamais par une absence)
{
    const r = dec({ v1: [] }, [['v1', 0.95], ['v2', 0.40], ['v3', 0.30]]);
    v('visuel sans produit -> null', r, null);
    const r2 = dec({ v1: [[500, 9.0]] }, [['v1', 0.50], ['v2', 0.49], ['v3', 0.30]]);   // marge carte trop faible : decider n'affirme pas
    v('marge faible -> null (jamais « hors catalogue »)', r2, null);
    const un = decisionRegleG({ ligne: ligne([['v1', 0.9]]), nEssais: 1, mesures: mes, contexteG: ctxG({ v1: [[500, 9]] }) });
    vrai('résultat : null ou issue de la liste fermée, jamais hors-catalogue', un === null || ['affirmee', 'question'].includes(un.issue));
    vrai('aucune sortie ne porte la raison hors-catalogue', ![r, r2, un].some(x => x && x.raison === 'hors-catalogue'));
}
// sans voisins la règle ne fait rien
{
    v('ligne absente -> null (la chaîne héritée décide)', decisionRegleG({ ligne: null, nEssais: 1, mesures: mes, contexteG: ctxG({}) }), null);
    v('top vide -> null', decisionRegleG({ ligne: { top: [], essai: 0 }, nEssais: 1, mesures: mes, contexteG: ctxG({}) }), null);
    v('entrée absente -> null', decisionRegleG(undefined), null);
    vrai('contexte G absent avec voisins -> lève (jamais une absence inventée)', leve(() => decisionRegleG({ ligne: ligne([['v1', 0.9]]), nEssais: 1, mesures: mes, contexteG: null })));
}
// (7) branchement : cfg.regleG et fournisseur de voisins
{
    v('regleG éteinte -> inactive', regleGActive({ regleG: false }, { voisins: () => [] }), false);
    v('regleG allumée sans voisins -> inactive (§5 Q10)', regleGActive({ regleG: true }, {}), false);
    v('regleG allumée, voisins non fonction -> inactive', regleGActive({ regleG: true }, { voisins: 'oui' }), false);
    v('regleG allumée + voisins -> active', regleGActive({ regleG: true }, { voisins: async () => [] }), true);
    v('cfg absente -> inactive', regleGActive(undefined, { voisins: () => [] }), false);
    v('deps absentes -> inactive', regleGActive({ regleG: true }, undefined), false);
    v('regleG === "1" (chaîne) -> inactive : seul true allume', regleGActive({ regleG: '1' }, { voisins: () => [] }), false);
}
// (6) SEUILS_G gelé et intact
vrai('SEUILS_G gelé', Object.isFrozen(G.SEUILS_G));
v('SEUILS_G inchangé par l\'enveloppe', JSON.stringify(G.SEUILS_G), avant);
vrai('l\'enveloppe ne peut pas modifier SEUILS_G', leve(() => { 'use strict'; G.SEUILS_G.delta = 9; }) );

// (5) 0 faux affirmé : on rejoue les fixtures du labo À TRAVERS l'enveloppe
{
    const dossier = process.argv.find((a, i) => i > 1 && !a.startsWith('--')) || 'C:/Users/Yung/Desktop/labo-embedding/rm/fixtures-g';
    if (!fs.existsSync(path.join(dossier, 'contexte.json'))) {
        console.log(`❌ fixtures du labo ABSENTES (${dossier}) : le banc ne peut pas conclure sur « 0 faux affirmé » -> code 1`);
        process.exitCode = 1;
    } else {
        const ctx = G.contexte(JSON.parse(fs.readFileSync(path.join(dossier, 'contexte.json'), 'utf8')));
        let total = 0, identiques = 0, affirmes = 0, faux = 0, questions = 0, introuvables = 0, manquantes = 0, hors = 0, heritees = 0, grosses = 0;
        for (const jeu of ['reel', 'auto', 'dracaufeu']) {
            const f = path.join(dossier, `${jeu}.json`);
            if (!fs.existsSync(f)) { console.log(`❌ jeu ${jeu} absent`); process.exitCode = 1; continue; }
            const F = JSON.parse(fs.readFileSync(f, 'utf8'));
            let n = 0, ok = 0, aff = 0, fx = 0;
            for (const l of F.lignes) {
                const fichier = k => { const x = F.fichierDe[k]; if (!x) throw new Error('fichier inconnu ' + k); return x; };
                const mesures = {
                    comparerPaire: (a, b) => { const p = l.paires[`${fichier(a)}|${fichier(b)}`]; if (!p) { manquantes++; throw new Error('paire'); } return p; },
                    scoresZones: x => { const z = l.zones[fichier(x)]; if (!z) { manquantes++; throw new Error('zones'); } return z; }
                };
                let d, w;
                try { d = G.decider(ctx, l, l.nEssais, mesures, F.seuils); } catch { hors++; continue; }
                w = decisionRegleG({ ligne: l, nEssais: l.nEssais, mesures, contexteG: ctx }, F.seuils);
                n++;
                // Attendu écrit depuis la sortie de decider seul : affirme -> affirmee ; 2 ou 3 indiscernables ou une question -> question
                // (mêmes ids, même ordre) ; plus de 3 indiscernables -> introuvable photo-illisible ; sinon null (chaîne héritée).
                const commune = Array.isArray(d.reponseCommune) ? d.reponseCommune : [];
                const quest = Array.isArray(d.question) ? [...new Set(d.question)] : [];
                let bon;
                if (d.affirme) bon = w && w.issue === 'affirmee' && w.produit === d.produit;
                else if (commune.length > 3) { grosses++; bon = w === null; }
                else if (commune.length >= 2) bon = w && w.issue === 'question' && JSON.stringify(w.candidats) === JSON.stringify([...new Set(commune)]);
                else if (quest.length >= 2) bon = w && w.issue === 'question' && JSON.stringify(w.candidats) === JSON.stringify(quest.slice(0, 3));
                else bon = w === null;
                if (bon) ok++;
                if (w && w.issue === 'affirmee') { aff++; if (!new Set(l.verite).has(w.produit)) fx++; }
                if (w === null) heritees++; else if (w.issue === 'question') questions++; else if (w.issue === 'introuvable') introuvables++;
            }
            console.log(`   ${jeu} : ${n} requêtes rejouées, ${ok} décisions identiques à decider seul, ${aff} affirmés, ${fx} faux`);
            total += n; identiques += ok; affirmes += aff; faux += fx;
            v(`${jeu} : mêmes décisions que decider seul (${ok}/${n}, et ${F.lignes.length} lignes au fichier)`, ok === n && n === F.lignes.length, true);
        }
        console.log(`   TOTAL : ${total} requêtes · ${identiques} identiques · ${affirmes} affirmés · ${faux} faux · questions ${questions} · introuvables ${introuvables} (dont réponses communes > 3 : ${grosses}) · décision HÉRITÉE (null) ${heritees} · mesures manquantes ${manquantes} · lignes où decider lève ${hors}`);
        v('0 faux affirmé à travers l\'enveloppe', faux, 0);
        vrai(`dénominateur non vide (${total})`, total > 0);
        vrai('au moins un affirmé (sinon la mesure ne mord sur rien)', affirmes > 0);
    }
}
v('SEUILS_G toujours intact après les fixtures', JSON.stringify(G.SEUILS_G), avant);
bilan();
