// TEST — retirer-homonymies-des-sets.js : liste fermée de 6 pages d'homonymie, 12 appartenances, 9 sets. Pur : fausse base, wikitexts réels.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const R = require('./retirer-homonymies-des-sets');
const { validerAnnonces, compterEtat, comparer } = require('./collecte-cartes/garde-lot');
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) ok++; else { ko++; console.log(`  ✗ ${nom}\n     obtenu  ${a}\n     attendu ${b}`); }
};
const fx = nom => fs.readFileSync(path.join(__dirname, 'collecte-cartes', 'r47-fixtures', `${nom}.wikitext`), 'utf8');

// 1. la liste fermée
verifier('6 cibles', R.CIBLES.map(c => c.id), [23486, 23489, 282531, 294565, 262602, 350467]);
verifier('12 appartenances', R.CIBLES.reduce((a, c) => a + c.sets.length, 0), 12);
verifier('9 sets distincts', new Set(R.CIBLES.flatMap(c => c.sets)).size, 9);
verifier('la liste est gelée', [Object.isFrozen(R.CIBLES), Object.isFrozen(R.CIBLES[0]), Object.isFrozen(R.CIBLES[0].sets)], [true, true, true]);

// 2. planifier : un état conforme
const SD = R.CIBLES.find(c => c.id === 282531);        // Pikachu (SV-P Promo 1)
const ED = R.CIBLES.find(c => c.id === 23486);         // Darkness Energy (TCG)
const carteDe = c => ({ _id: c.id, bulba: { titre: c.titre, cleR2: 'x' }, sets: [...c.sets], impressions: [], liens: { idProduct: [], idMetacards: [] } });
const etatConforme = c => ({ carte: carteDe(c), lignes: 0, texte: fx(c.id === 23486 ? 'homonymie-energie' : 'homonymie-tcg') });
const ok1 = R.planifier(SD, etatConforme(SD));
verifier('conforme : pas de refus, 2 sets à retirer', [ok1.refus, ok1.aRetirer], [null, SD.sets]);
const ok2 = R.planifier(ED, etatConforme(ED));
verifier('conforme ({{disambig}}) : pas de refus', ok2.refus, null);

// 3. refus : l'état diffère de la liste
const refus = (nom, cible, etat, motif) => { const p = R.planifier(cible, etat); verifier(`refus : ${nom}`, [typeof p.refus === 'string' && p.refus.length > 0 && (!motif || p.refus.includes(motif)), p.aRetirer], [true, []]); };
refus('carte introuvable', SD, { ...etatConforme(SD), carte: null }, 'introuvable');
refus('titre différent', SD, { ...etatConforme(SD), carte: { ...carteDe(SD), bulba: { titre: 'Pikachu (autre)', cleR2: 'x' } } }, 'titre');
refus('la carte porte un nom', SD, { ...etatConforme(SD), carte: { ...carteDe(SD), nomEn: 'Pikachu' } }, 'nomEn');
refus('la carte porte une impression', SD, { ...etatConforme(SD), carte: { ...carteDe(SD), impressions: [{ tirage: 'intl' }] } }, 'impression');
refus('un produit est joint', SD, { ...etatConforme(SD), lignes: 1 }, 'joint');
refus('un set hors liste', SD, { ...etatConforme(SD), carte: { ...carteDe(SD), sets: [...SD.sets, 'Autre-Set'] } }, 'Autre-Set');
refus('la page archivée n\'est plus une homonymie', SD, { ...etatConforme(SD), texte: fx('oddish-svp-102') }, 'homonymie');
refus('page archivée illisible', SD, { ...etatConforme(SD), texte: null }, 'illisible');
// reprise : un seul des deux sets reste -> on retire celui-là
const reprise = R.planifier(SD, { ...etatConforme(SD), carte: { ...carteDe(SD), sets: [SD.sets[1]] } });
verifier('reprise : seul le set restant est retiré', [reprise.refus, reprise.aRetirer, reprise.dejaFait], [null, [SD.sets[1]], 1]);
const fait = R.planifier(SD, { ...etatConforme(SD), carte: { ...carteDe(SD), sets: [] } });
verifier('déjà fait : rien à retirer, pas un refus', [fait.refus, fait.aRetirer], [null, []]);

// 4. l'annonce : la fonction même de la garde, validée comme lot-additif.js la valide
const cartes = R.CIBLES.map(carteDe);
const annonce = R.annonceDe(cartes);
verifier('annonce : 9 groupes', Object.keys(annonce).length, 9);
verifier('annonce : somme = 12 appartenances', Object.values(annonce).reduce((a, n) => a + n, 0), 12);
verifier('annonce : les 3 pages de Scarlet-Violet-Promos ne sont que 2', annonce['cartes set:Scarlet-Violet-Promos'], 2);
verifier('annonce : M-Master Speed = 2 (les deux énergies)', annonce['cartes set:M-Master-Deck-Build-Box-Speed-Style'], 2);
let valide = true; try { validerAnnonces(annonce); } catch { valide = false; }
verifier('annonce : acceptée par validerAnnonces', valide, true);
const apres = cartes.map(c => ({ ...c, sets: [] }));
const cmp = comparer(compterEtat({ cartes }), compterEtat({ cartes: apres }), { annonces: annonce });
verifier('garde : aucune baisse non autorisée, aucune annonce non réalisée', [cmp.nonAutorisees.length, cmp.annoncesNonRealisees.length], [0, 0]);
verifier('liste des sets à revalider', R.setsARevalider(), [...new Set(R.CIBLES.flatMap(c => c.sets))].sort());

// 5. écriture sur fausse base : un $pull de sets, rien d'autre
const appels = [];
const fausse = { collection: nom => ({ updateOne: async (f, u, o) => { appels.push([nom, f, u, o]); return { modifiedCount: 1 }; } }) };
(async () => {
    const n = await R.appliquer(fausse, SD, SD.sets);
    verifier('écriture : une seule opération sur cartes', [n, appels.length, appels[0][0]], [1, 1, 'cartes']);
    verifier('écriture : filtre = _id + aucune impression', appels[0][1], { _id: 282531, 'impressions.0': { $exists: false } });
    verifier('écriture : uniquement $pull de sets listés', appels[0][2], { $pull: { sets: { $in: SD.sets } } });
    verifier('écriture : ni nomFr ni idMetacards touchés', JSON.stringify(appels[0][2]).includes('nomFr') || JSON.stringify(appels[0][2]).includes('idMetacards'), false);
    // 6. relecture
    verifier('relue : conforme', R.verifierRelu(SD, { ...carteDe(SD), sets: [] }), []);
    verifier('relue : un set resté', R.verifierRelu(SD, { ...carteDe(SD), sets: [SD.sets[0]] }).length, 1);
    verifier('relue : carte disparue', R.verifierRelu(SD, null).length, 1);
    verifier('relue : un autre champ a bougé (nomFr)', R.verifierRelu(SD, { ...carteDe(SD), sets: [], nomFr: 'x' }, { ...carteDe(SD), nomFr: undefined }).length, 1);
    // 7. un argument inconnu est refusé avant toute connexion
    const s = spawnSync(process.execPath, ['retirer-homonymies-des-sets.js', '--bidon'], { cwd: __dirname, encoding: 'utf8', timeout: 20000 });
    verifier('argument inconnu : code 2, sans connexion', s.status, 2);
    console.log(`${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
