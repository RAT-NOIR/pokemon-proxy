// node test-rarete-rejeu.js — PHASE 3b, T2 : un rejeu (--reparser) ou une recollecte n'EFFACE jamais une rareté existante. Pur : vrais wikitexts archivés, fausse base. Aucun réseau.
// Le fait : `rarete: impCible?.rarete ?? null` (collecteur-texte.js l. 316, --reparser ; collecte-cartes/page-de-carte.js l. 69, collecte normale) écrasait par null la rareté d'une carte
// dont l'impression cible n'est pas retrouvée dans la page ou n'y porte pas de rareté (mesuré en phase 3a : 6 cartes, CSV5C et smK).
// TOOL_DIR=<dossier> rejoue le banc contre une copie MUTÉE.
const fs = require('fs');
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
const { rareteDeLaCarte, champsDuRejeu } = require(path.join(DIR, 'collecte-cartes', 'champs-du-rejeu'));
const PDC = require(path.join(DIR, 'collecte-cartes', 'page-de-carte'));
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };
const fx = nom => fs.readFileSync(path.join(DIR, 'collecte-cartes', 'r47-fixtures', `${nom}.wikitext`), 'utf8');

// ── la règle, pure ──
verifier('la page ne donne rien (impression cible introuvable) : la rareté en base est GARDÉE', rareteDeLaCarte(undefined, 'RR'), 'RR');
verifier('la page donne une impression SANS rareté (null) : la rareté en base est GARDÉE', rareteDeLaCarte({ rarete: null }, 'Common'), 'Common');
verifier('la page donne une chaîne vide ou blanche : traitée comme ABSENTE, la rareté en base est gardée', [rareteDeLaCarte({ rarete: '' }, 'Rare'), rareteDeLaCarte({ rarete: '  ' }, 'Rare')], ['Rare', 'Rare']);
verifier('la page donne une rareté DIFFÉRENTE non nulle : la page (la source de ce champ) la remplace', rareteDeLaCarte({ rarete: 'RA' }, 'RR'), 'RA');
verifier('la page donne la même rareté : inchangée', rareteDeLaCarte({ rarete: 'RR' }, 'RR'), 'RR');
verifier('ni la page ni la base : null (le comportement d\'avant, pour une carte neuve)', [rareteDeLaCarte(undefined, undefined), rareteDeLaCarte({ rarete: null }, null)], [null, null]);

// ── le chemin du --reparser (la fonction que collecteur-texte.js ET controler-reparse.js appellent) sur de VRAIES pages ──
const impCibleMalamar = faits => faits.impressions.find(x => x.tirage === 'intl' && x.expansion === 'Delta Reign');
const carteMalamar = { _id: 1, bulba: { titre: 'Mega Malamar-ex (Delta Reign 69)' }, impressions: [], rarete: 'Double Rare' };
let R = champsDuRejeu({ carte: carteMalamar, epure: fx('mega-malamar-ex-delta-reign-69'), impressionCible: impCibleMalamar });
verifier('reparse : impression cible RETROUVÉE avec sa rareté -> la rareté de la page', R.champs.rarete, 'Double Rare');
R = champsDuRejeu({ carte: { ...carteMalamar, rarete: 'Rare' }, epure: fx('mega-malamar-ex-delta-reign-69'), impressionCible: impCibleMalamar });
verifier('reparse : la page porte une autre rareté non nulle -> elle remplace (la page est la source)', R.champs.rarete, 'Double Rare');
R = champsDuRejeu({ carte: carteMalamar, epure: fx('mega-malamar-ex-delta-reign-69'), impressionCible: () => undefined });
verifier('reparse : impression cible INTROUVABLE dans la page -> la rareté en base survit (le lot 3b : 6 cartes la perdaient)', R.champs.rarete, 'Double Rare');
R = champsDuRejeu({ carte: { _id: 2, bulba: { titre: 'Oddish (SVP Promo 102)' }, impressions: [], rarete: 'Common' }, epure: fx('oddish-svp-102'), impressionCible: faits => faits.impressions[0] });
verifier('reparse : impression cible trouvée mais SANS rareté à la page -> la rareté en base survit', R.champs.rarete, 'Common');
R = champsDuRejeu({ carte: { _id: 3, bulba: { titre: 'Oddish (SVP Promo 102)' }, impressions: [] }, epure: fx('oddish-svp-102'), impressionCible: faits => faits.impressions[0] });
verifier('reparse : carte sans rareté ET page sans rareté -> null, comme avant', R.champs.rarete, null);
verifier('reparse : les autres champs de la page sont inchangés (nom, impressions, champsNuls)', [R.champs.nomEn, R.champs.impressions.length, Array.isArray(R.champs.champsNuls)], ['Oddish', 1, true]);

// ── le chemin de la COLLECTE NORMALE (page-de-carte.js), fausse base ──
async function collecter({ existante, impressionCible }) {
    const appels = [];
    const M = { Carte: { updateOne: async (...a) => { appels.push(a); return {}; }, findById: () => ({ select: () => ({ lean: async () => existante }) }) }, Etat: { updateOne: async () => ({}) }, Reste: { updateOne: async () => ({}) } };
    const R2 = { cleWikitext: (p, r) => `bulba/${p}/${r}.wikitext`, deposerTexte: async () => ({ ecrit: true }) };
    await PDC.ecrirePageDeCarte({ M, r2: R2, bucket: 'B', pg: { title: 'Oddish (SVP Promo 102)', pageid: 295618, revid: 9, content: fx('oddish-svp-102') }, slug: 'Set-Test', lot: ['Oddish (SVP Promo 102)'], redirigeDepuisTout: new Map(), D: { epure: {} }, textesEpures: new Map(), compter: () => { }, impressionCible, compteRequetes: () => 1 });
    return appels[0][1].$set.rarete;
}
(async () => {
    verifier('collecte normale : impression cible introuvable, carte déjà en base avec une rareté -> GARDÉE', await collecter({ existante: { impressions: [], rarete: 'RR' }, impressionCible: () => undefined }), 'RR');
    verifier('collecte normale : la page donne une rareté -> la page', await collecter({ existante: { impressions: [], rarete: 'RR' }, impressionCible: () => ({ rarete: 'SAR' }) }), 'SAR');
    verifier('collecte normale : carte neuve (rien en base), page sans rareté -> null', await collecter({ existante: null, impressionCible: () => undefined }), null);

    // ── les deux outils passent par la fonction commune : plus aucune copie de la formule qui efface ──
    const sans = f => fs.readFileSync(path.join(DIR, f), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    for (const f of ['collecteur-texte.js', 'controler-reparse.js', path.join('collecte-cartes', 'page-de-carte.js')]) verifier(`${f} : aucune formule « ?.rarete ?? null » (la rareté ne s'écrase plus par null)`, /\?\.rarete\s*\?\?\s*null/.test(sans(f)), false);
    verifier('collecteur-texte.js et controler-reparse.js appellent champsDuRejeu (UNE définition, §21 bis)', [/champsDuRejeu\(/.test(sans('collecteur-texte.js')), /champsDuRejeu\(/.test(sans('controler-reparse.js'))], [true, true]);
    verifier('page-de-carte.js appelle rareteDeLaCarte', /rareteDeLaCarte\(/.test(sans(path.join('collecte-cartes', 'page-de-carte.js'))), true);
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ ERREUR DU BANC', e); process.exit(1); });
