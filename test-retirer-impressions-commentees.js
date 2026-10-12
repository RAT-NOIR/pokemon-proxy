// TEST — retirer-impressions-commentees.js : liste fermée de 33 impressions (22 cartes) tirées de texte en commentaire HTML.
// Pur : fausse base, wikitexts RÉELS (Oddish SVP 102, Mega Malamar ex Delta Reign 69).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const R = require('./retirer-impressions-commentees');
const W = require('./collecte-cartes/wikitext');
const { validerAnnonces, compterEtat, comparer } = require('./collecte-cartes/garde-lot');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) ok++; else { ko++; console.log(`  ✗ ${nom}\n     obtenu  ${a}\n     attendu ${b}`); }
};
const fx = nom => fs.readFileSync(path.join(__dirname, 'collecte-cartes', 'r47-fixtures', `${nom}.wikitext`), 'utf8');

// 1. la liste fermée
verifier('22 cartes', R.CIBLES.length, 22);
verifier('33 impressions', R.CIBLES.reduce((a, c) => a + c.impressions.length, 0), 33);
verifier('2 japonaises + 31 « Delta Reign »', [R.CIBLES.flatMap(c => c.impressions).filter(i => i.tirage === 'jp').length, R.CIBLES.flatMap(c => c.impressions).filter(i => i.expansion === 'Delta Reign').length], [2, 31]);
verifier('la liste est gelée', [Object.isFrozen(R.CIBLES), Object.isFrozen(R.CIBLES[0]), Object.isFrozen(R.CIBLES[0].impressions), Object.isFrozen(R.CIBLES[0].impressions[0])], [true, true, true, true]);
verifier('ids distincts', new Set(R.CIBLES.map(c => c.id)).size, 22);

// 2. planifier sur de VRAIES pages
const ODDISH = R.CIBLES.find(c => c.id === 295618), MALAMAR = R.CIBLES.find(c => c.id === 358758);
const imp = (tirage, expansion, numero, total, rarete, extra = {}) => ({ tirage, expansion, deck: null, numero, total, rarete, illustrateur: null, illustrateurPreuve: 'x', ...extra });
const oddish = () => ({ _id: 295618, nomEn: 'Oddish', bulba: { titre: 'Oddish (SVP Promo 102)', cleR2: 'x' }, impressions: [imp('intl', 'SVP Black Star Promos', '102', null, null), imp('jp', 'SV-P Promotional cards', '???', 'SV-P-->', null)] });
const malamar = () => ({ _id: 358758, nomEn: 'Mega Malamar ex', bulba: { titre: 'Mega Malamar ex (Delta Reign 69)', cleR2: 'x' }, impressions: [
    imp('intl', 'Delta Reign', '069', '103', 'Double Rare'), imp('jp', 'Storm Emeralda', '048', '076', 'RR'), imp('intl', 'Delta Reign', 'XXX', '103-->', 'Ultra Rare'), imp('jp', 'Storm Emeralda', '094', '076', 'SR')] });
const po = R.planifier(ODDISH, { carte: oddish(), texte: fx('oddish-svp-102') });
verifier('Oddish : pas de refus, la fantôme jp est retirée', [po.refus, po.carteApres.impressions.map(i => `${i.tirage}|${i.expansion}|${i.numero}`)], [null, ['intl|SVP Black Star Promos|102']]);
const pm = R.planifier(MALAMAR, { carte: malamar(), texte: fx('mega-malamar-ex-delta-reign-69') });
verifier('Malamar : seule XXX/103--> est retirée, les 3 autres restent dans l\'ordre', [pm.refus, pm.carteApres.impressions.map(i => `${i.tirage}|${i.expansion}|${i.numero}`)], [null, ['intl|Delta Reign|069', 'jp|Storm Emeralda|048', 'jp|Storm Emeralda|094']]);
// la page archivée sert de prémisse : le parseur d'aujourd'hui ne lit aucune des listées
verifier('prémisse : le parseur ne lit aucune des 33 sur les deux pages', [po, pm].map(p => p.relues), [0, 0]);

// 3. refus : l'état diffère de la liste
const refus = (nom, cible, etat, motif) => { const p = R.planifier(cible, etat); verifier(`refus : ${nom}`, [typeof p.refus === 'string' && p.refus.includes(motif), p.carteApres], [true, null]); };
refus('carte introuvable', MALAMAR, { carte: null, texte: fx('mega-malamar-ex-delta-reign-69') }, 'introuvable');
refus('nom différent', MALAMAR, { carte: { ...malamar(), nomEn: 'Autre' }, texte: fx('mega-malamar-ex-delta-reign-69') }, 'nomEn');
refus('page archivée illisible', MALAMAR, { carte: malamar(), texte: null }, 'illisible');
refus('impression listée absente', MALAMAR, { carte: { ...malamar(), impressions: malamar().impressions.filter(i => i.numero !== 'XXX') }, texte: fx('mega-malamar-ex-delta-reign-69') }, 'au lieu de');
refus('impression listée en double', MALAMAR, { carte: { ...malamar(), impressions: [...malamar().impressions, imp('intl', 'Delta Reign', 'XXX', '103-->', 'Ultra Rare')] }, texte: fx('mega-malamar-ex-delta-reign-69') }, 'au lieu de');
// 🔴 le parseur d'aujourd'hui LIT cette impression : elle n'est pas fantôme (ex. : la page a été corrigée et lue autrement)
const lisible = { ...MALAMAR, impressions: [Object.freeze({ tirage: 'intl', expansion: 'Delta Reign', deck: null, numero: '069', total: '103', rarete: 'Double Rare' })] };
refus('l\'impression listée est lue par le parseur (pas un fantôme)', lisible, { carte: malamar(), texte: fx('mega-malamar-ex-delta-reign-69') }, 'lit');
// une impression qui ressemble sans être exacte n'est pas retirée : la rareté change -> elle n'est pas dans la liste
refus('contenu exact : rareté différente', MALAMAR, { carte: { ...malamar(), impressions: malamar().impressions.map(i => i.numero === 'XXX' ? { ...i, rarete: 'Common' } : i) }, texte: fx('mega-malamar-ex-delta-reign-69') }, 'au lieu de');

// 4. l'annonce : la fonction de la garde ; toute la liste sur des cartes fabriquées conformes
const cartes = R.CIBLES.map(c => ({ _id: c.id, nomEn: c.nomEn, sets: [], impressions: [...c.impressions.map(i => ({ ...i, illustrateur: null })), imp('intl', 'Delta Reign', '001', '103', 'Common')] }));
const annonce = R.annonceDe(cartes);
verifier('annonce : impressions Delta Reign −31', annonce['impressions imp:intl|Delta Reign'], 31);
verifier('annonce : illustrateurs Delta Reign −31 (le champ existe, null)', annonce['illustrateurs imp:intl|Delta Reign'], 31);
verifier('annonce : jp SV-P −1 et jp M-P −1', [annonce['impressions imp:jp|SV-P Promotional cards'], annonce['impressions imp:jp|M-P Promotional cards']], [1, 1]);
verifier('annonce : aucun autre compteur (pas de nom, pas d\'image, pas de fiche)', Object.keys(annonce).filter(k => !/^(impressions|illustrateurs) imp:/.test(k)), []);
let valide = true; try { validerAnnonces(annonce); } catch { valide = false; }
verifier('annonce : acceptée par validerAnnonces', valide, true);
const apres = cartes.map(c => { const cible = R.CIBLES.find(x => x.id === c._id); return { ...c, impressions: c.impressions.filter(i => !cible.impressions.some(s => s.tirage === i.tirage && s.expansion === i.expansion && s.numero === i.numero && s.total === i.total && s.rarete === i.rarete)) }; });
const cmp = comparer(compterEtat({ cartes }), compterEtat({ cartes: apres }), { annonces: annonce });
verifier('garde : aucune baisse non autorisée, aucune annonce non réalisée', [cmp.nonAutorisees.length, cmp.annoncesNonRealisees.length], [0, 0]);
// une impression ne porte qu'un NOM d'expansion : le site revalide TOUS les sets de la carte (setsTouches) — l'outil imprime cette union
verifier('sets à revalider : l\'union des sets des cartes de la liste', R.setsARevalider([{ _id: 295618, sets: ['B', 'A'] }, { _id: 358758, sets: ['A', 'C'] }, { _id: 1, sets: ['Z'] }]), ['A', 'B', 'C']);

// 5. écriture sur fausse base : un $pull par impression listée, identifiée par son contenu, jamais par une position
const appels = [];
const fausse = { collection: nom => ({ updateOne: async (f, u, o) => { appels.push([nom, f, u, o]); return { modifiedCount: 1 }; } }) };
(async () => {
    const n = await R.appliquer(fausse, MALAMAR);
    verifier('écriture : une opération sur cartes', [n, appels.length, appels[0][0]], [1, 1, 'cartes']);
    verifier('écriture : filtre = _id', appels[0][1], { _id: 358758 });
    verifier('écriture : $pull par contenu exact, rien d\'autre', appels[0][2], { $pull: { impressions: { $or: [{ tirage: 'intl', expansion: 'Delta Reign', deck: null, numero: 'XXX', total: '103-->', rarete: 'Ultra Rare' }] } } });
    verifier('écriture : aucune position dans l\'opération', /\.\d|\$\[|\$position|\$slice/.test(JSON.stringify(appels[0][2])), false);
    // 6. relecture, comparée à l'attendu
    const avant = malamar(), attendu = pm.carteApres;
    verifier('relue : conforme', R.verifierRelu(MALAMAR, avant, attendu), []);
    verifier('relue : fantôme encore là', R.verifierRelu(MALAMAR, avant, avant).some(e => e.includes('encore présente')), true);
    verifier('relue : une impression légitime perdue', R.verifierRelu(MALAMAR, avant, { ...attendu, impressions: attendu.impressions.slice(1) }).length, 1);
    verifier('relue : carte disparue', R.verifierRelu(MALAMAR, avant, null).length, 1);
    // 7. argument inconnu refusé avant toute connexion
    const s = spawnSync(process.execPath, ['retirer-impressions-commentees.js', '--bidon'], { cwd: __dirname, encoding: 'utf8', timeout: 20000 });
    verifier('argument inconnu : code 2, sans connexion', s.status, 2);
    console.log(`${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
