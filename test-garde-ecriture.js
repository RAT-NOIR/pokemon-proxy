// Banc de la garde d'écriture de STAFF-DETECT. Chemins FABRIQUÉS uniquement (aucun dossier du testeur). GARDE_MODULE permet de viser un mutant.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const G = require(process.env.GARDE_MODULE || './collecte-cartes/garde-ecriture');

let ok = 0, ko = 0;
function t(nom, cond, d) { if (cond) ok++; else { ko++; console.log('ECHEC', nom, d === undefined ? '' : String(d)); } }
function leve(f) { try { f(); return false; } catch (e) { return true; } }

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'garde-banc-'));
const racine = path.join(base, 'sortie-autorisee'), source = path.join(base, 'CARDMARKET IMAGE fabrique');
fs.mkdirSync(racine); fs.mkdirSync(path.join(source, 'sous'), { recursive: true });
const R = [racine];

t('sous la racine autorisée', !leve(() => G.autoriser(path.join(racine, 'a', 'b.png'), R)));
t('la racine elle-même', !leve(() => G.autoriser(racine, R)));
t('chemin relatif résolu hors racine', leve(() => G.autoriser(path.relative(process.cwd(), path.join(base, 'ailleurs')), R)));
t('dossier source fabriqué refusé', leve(() => G.autoriser(path.join(source, 'sous', 'x.png'), R)));
t('remontée .. refusée', leve(() => G.autoriser(path.join(racine, '..', 'CARDMARKET IMAGE fabrique', 'x'), R)));
t('préfixe frère refusé', leve(() => G.autoriser(racine + '-evil', R)));
t('chemin vide refusé', leve(() => G.autoriser('', R)));
t('aucune racine = tout refusé', leve(() => G.autoriser(path.join(racine, 'a'), [])));
t('défaut : le dossier source du testeur n est jamais autorisé (test sur chaîne, sans toucher au disque)', leve(() => G.autoriser('C:\\Users\\Yung\\Desktop\\CARDMARKET IMAGE\\x.png')));
t('défaut : un chemin quelconque refusé', leve(() => G.autoriser('C:\\Users\\Yung\\Desktop\\ailleurs\\x.png')));
t('défaut : le dossier temporaire système est autorisé', !leve(() => G.autoriser(path.join(os.tmpdir(), 'staff-detect-x', 'a.png'))));
t('retourne le chemin résolu', G.autoriser(path.join(racine, 'a', '..', 'b'), R) === path.join(racine, 'b'));

fs.rmSync(base, { recursive: true, force: true });
console.log(`${ok} passes, ${ko} en echec`);
process.exit(ko ? 1 : 0);
