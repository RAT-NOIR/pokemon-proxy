'use strict';
// BANC-12 — la durée du lien entre une contribution du banc réel et un compte : V2_BANC_LIEN_MOIS, défaut 12, jamais au-delà de 12 (ni de bancMois).
// Une seule source : analysesMois (la ligne `analyses` porte le scanId et le compte) s'y aligne.
const H = require('./_harnais');                      // pour v()/bilan() seulement : ce banc n'ouvre pas la base
const { lireConfig } = require('../config');

const refus = env => { try { lireConfig(env); return null; } catch (e) { return e.message; } };
const c = lireConfig({});
H.v('défaut : le lien dure 12 mois', c.retention.bancLienMois, 12);
H.v('défaut : l\'image du banc reste 24 mois au plus (la politique §4)', c.retention.bancMois, 24);
H.v('une seule source : analysesMois = bancLienMois par défaut', c.retention.analysesMois, c.retention.bancLienMois);
H.v('V2_BANC_LIEN_MOIS=6 s\'applique', lireConfig({ V2_BANC_LIEN_MOIS: '6' }).retention.bancLienMois, 6);
H.v('   et analysesMois la suit (6)', lireConfig({ V2_BANC_LIEN_MOIS: '6' }).retention.analysesMois, 6);
H.v('V2_BANC_LIEN_MOIS=12 accepté (le plafond)', lireConfig({ V2_BANC_LIEN_MOIS: '12' }).retention.bancLienMois, 12);
for (const mauvaise of ['13', '24', '0', '-1', 'beaucoup', ' ', '1.5']) {
    H.vrai(`V2_BANC_LIEN_MOIS="${mauvaise}" rend la configuration invalide`, /configuration invalide/.test(refus({ V2_BANC_LIEN_MOIS: mauvaise }) || ''));
}
H.vrai('le message de refus nomme la variable', /V2_BANC_LIEN_MOIS/.test(refus({ V2_BANC_LIEN_MOIS: '13' }) || ''));
H.vrai('configuration gelée (retention comprise)', Object.isFrozen(c.retention));
H.bilan();
