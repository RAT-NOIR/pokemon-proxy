// Banc (2026-10-13) : l'export des logos et la pose des logos de decks ne dependent plus de la PRESENCE des copies Pokecardex
// (decision du testeur : « il doit lire la TABLE DES DECISIONS, pas la presence d'un fichier »). Aucune base, aucun reseau, aucun fichier lu.
const fs = require('fs');
const path = require('path');
const { LOGOS_COPIES } = require('./collecte-cartes/langue-logo');
let ok = 0, ko = 0;
const egal = (n, a, b) => { const sa = JSON.stringify(a), sb = JSON.stringify(b); if (sa === sb) ok++; else { ko++; console.log(`❌ ${n} : ${sa} ≠ ${sb}`); } };

// tout acces disque aux logos est une faute : le lecteur de fichiers leve s'il est appele sur un « Logo FR »
const lireOrig = fs.readFileSync, existeOrig = fs.existsSync;
const interdit = p => /Logo FR/.test(String(p));
fs.readFileSync = function (p, ...r) { if (interdit(p)) throw new Error(`lecture interdite : ${p}`); return lireOrig.call(this, p, ...r); };
fs.existsSync = function (p, ...r) { if (interdit(p)) throw new Error(`existsSync interdit : ${p}`); return existeOrig.call(this, p, ...r); };

const { wcdDepuisLaTable, ANNEES_WCD } = require('./collecte-cartes/wcd-logos-table');
const RACINE = path.join(__dirname, 'racine-inexistante-pour-le-banc');
const lusReel = JSON.parse(lireOrig(path.join(__dirname, 'collecte-cartes', 'logos-manuels-lus.json'), 'utf8')).lignes;

// 1. vingt WCD, depuis la table seule, un dossier qui n'existe pas
const wcd = wcdDepuisLaTable({ racine: RACINE, copies: LOGOS_COPIES, lus: lusReel });
egal('1 vingt entrees', wcd.length, 20);
egal('1b annees', wcd.map(w => w.annee), ANNEES_WCD.map(([a]) => a));
egal('1c toutes refusees par la table, sans fichier', wcd.every(w => w.copiePokecardex === true && typeof w.refus === 'string' && w.refus.length > 20), true);
egal('1d sha1 = celui de LOGOS_COPIES pour ce fichier', wcd.every(w => (LOGOS_COPIES.get(w.sha1) || '').startsWith(w.fichier)), true);
egal('1e dimensions de la table des logos lus', wcd.every(w => Number.isInteger(w.w) && w.w > 0 && Number.isInteger(w.h) && w.h > 0), true);
egal('1f forme historique des champs', Object.keys(wcd[0]), ['set', 'annee', 'anneeLueSurLeLogo', 'fichier', 'cheminAbsolu', 'sha1', 'w', 'h', 'copiePokecardex', 'refus']);
egal('1g WCD-2004 = jap_076', [wcd[0].set, wcd[0].fichier, wcd[0].sha1], ['WCD-2004', 'Logo FR/WCD/jap_076.png', 'a097312bc56fb04c1594e7c96b3cd637c92f1258']);
// 2. une annee absente de la table des decisions : on LEVE (une entree sans decision n'est pas une entree vide)
let leve = null; try { wcdDepuisLaTable({ racine: RACINE, copies: new Map([...LOGOS_COPIES].filter(([, v]) => !/jap_080/.test(v))), lus: lusReel }); } catch (e) { leve = e.message; }
egal('2 copie absente de LOGOS_COPIES : leve', /jap_080/.test(leve || ''), true);
leve = null; try { wcdDepuisLaTable({ racine: RACINE, copies: LOGOS_COPIES, lus: lusReel.filter(l => l.fichier !== 'WCD/jap_081.png') }); } catch (e) { leve = e.message; }
egal('2b dimensions absentes de la table des logos lus : leve', /jap_081/.test(leve || ''), true);

// 3. la pose des logos de decks : un WCD sort refuse par la table, fichier present ou non, jamais lu
const { planifier, TABLE } = require('./poser-logos-composes-decks');
const sets = [{ _id: 'WCD-2004', region: 'intl', tirage: 'intl', nomAffichage: 'World Championships 2004' }, { _id: 'Intro-Pack-Bulbasaur', region: 'jp', tirage: 'jp', nomAffichage: 'Intro Pack Bulbasaur' }];
const fW = TABLE['WCD-2004'].fichiers[0];
const lusDecks = new Map([['apport-manuel/Deck JP/IPB.png', 'aaa']]);
const plan = (fichiers) => planifier(sets, lusDecks, fichiers, LOGOS_COPIES).filter(p => p.slug === 'WCD-2004' || p.slug === 'Intro-Pack-Bulbasaur');
for (const [nom, fichiers] of [['fichier absent', new Map()], ['fichier present avec le sha1 de la table', new Map([[fW, 'a097312bc56fb04c1594e7c96b3cd637c92f1258']])]]) {
    const p = plan(fichiers).find(x => x.slug === 'WCD-2004');
    egal(`3 WCD (${nom}) : refus par la table`, [p.action, /LOGOS_COPIES|table des décisions/.test(p.raison), /fichier absent/.test(p.raison)], ['refus', true, false]);
}
const ipb = plan(new Map()).find(x => x.slug === 'Intro-Pack-Bulbasaur');
egal('3b un fichier d\'apport manquant reste « fichier absent » (on ne l\'invente pas)', [ipb.action, /fichier absent/.test(ipb.raison)], ['refus', true]);
// 4. l'outil des decks ne lit plus aucun fichier WCD : meme avec un map de fichiers vide, aucun lus.set sur un jap_0NN
egal('4 la table des decks garde ses 20 WCD (le refus est dit, pas tu)', Object.keys(TABLE).filter(k => /^WCD-/.test(k)).length, 20);

// 5. (tour 1, §21 bis) UNE seule liste années/fichiers : une divergence fabriquée doit lever
const { coherenceWcd } = require('./poser-logos-composes-decks');
const { ANNEES_WCD: ANNEES, fichierWcd } = require('./collecte-cartes/wcd-logos-table');
const leve5 = (table, annees) => { try { coherenceWcd(table, annees); return null; } catch (e) { return e.message; } };
egal('5 la table des decks et la liste unique concordent', leve5(TABLE), null);
egal('5b un WCD de la table des decks dont le fichier diverge : leve', /divergent/.test(leve5({ ...TABLE, 'WCD-2004': { ...TABLE['WCD-2004'], fichiers: ['Logo FR/WCD/jap_999.png'] } }) || ''), true);
egal('5c une année en trop dans la table des decks : leve', /divergent/.test(leve5({ ...TABLE, 'WCD-2020': { cas: 'WCD', fichiers: [fichierWcd(96)], annee: 2020 } }) || ''), true);
egal('5d une année de la liste unique absente de la table des decks : leve', /divergent/.test(leve5(TABLE, [...ANNEES, [2030, 99]]) || ''), true);
egal('5e les clés WCD de la table des decks = les années de la liste unique', Object.keys(TABLE).filter(k => /^WCD-/.test(k)), ANNEES.map(([a]) => `WCD-${a}`));

fs.readFileSync = lireOrig; fs.existsSync = existeOrig;
console.log(`${ko ? '🔴' : '✅'} ${ok} passes, ${ko} en echec`);
process.exit(ko ? 1 : 0);
