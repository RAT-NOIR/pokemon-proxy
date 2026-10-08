// ============================================================================
// LA RÈGLE DU TAUX DE LIGNES « AVEC PRIX » DU GUIDE — une seule, pure, partagée par l'import quotidien (le juge) et l'import
// (qui écrit le taux dans la méta). Décision du testeur, 2026-10-08 : « 85 % fixe ET refus si le taux chute de plus de 3 points par
// rapport au dernier guide importé (taux stocké dans la méta). Le premier import après ce changement n'applique que le seuil de 85 %. »
// (Mesure : le taux réel est stable à 89 % — 12/07 89,00 · 27/09 89,07 · 03/10 89,01 · 08/10 89,13 — le seuil de 90 % ne pouvait pas passer.)
// Écrite par ce qu'elle AUTORISE : passe seulement un taux mesurable, ≥ 85 %, et — si un taux du dernier guide est connu — qui ne
// chute pas de plus de 3 points. Un taux du dernier guide ILLISIBLE n'est pas « absent » : il refuse.
// Les taux sont en POURCENTS (0–100), dans la méta : `tauxPrix`, avec `avecPrix` et `lignes`.
// ============================================================================
const SEUIL_PCT = 85;
const CHUTE_MAX_POINTS = 3;

/** Le prédicat « cette ligne porte un prix » — celui de l'import quotidien depuis toujours (trend OU avg numérique fini). */
const porteUnPrix = g => Number.isFinite(g?.trend) || Number.isFinite(g?.avg);

const pct = x => `${x.toFixed(2).replace('.', ',')} %`;

/** @returns {{ passe: boolean, taux: number|null, raison: string }} */
function jugerTauxPrix({ avecPrix, lignes, tauxDernier } = {}) {
    if (!Number.isInteger(avecPrix) || !Number.isInteger(lignes) || lignes <= 0 || avecPrix < 0 || avecPrix > lignes) {
        return { passe: false, taux: null, raison: `taux non mesurable (avecPrix=${String(avecPrix)}, lignes=${String(lignes)})` };
    }
    const taux = avecPrix * 100 / lignes;
    // le seuil fixe, en entiers (pas de flottant sur la frontière : 85 % pile passe, 84,99 % non)
    if (avecPrix * 100 < SEUIL_PCT * lignes) {
        return { passe: false, taux, raison: `${avecPrix} lignes sur ${lignes} portent un prix (${pct(taux)}, < ${SEUIL_PCT} %)` };
    }
    // premier import après le changement : aucun taux du dernier guide -> seul le seuil joue (absent = undefined ou null, rien d'autre)
    if (tauxDernier === undefined || tauxDernier === null) {
        return { passe: true, taux, raison: `${avecPrix} lignes sur ${lignes} portent un prix (${pct(taux)}, ≥ ${SEUIL_PCT} %) ; pas de taux du dernier guide : seul le seuil s'applique` };
    }
    if (typeof tauxDernier !== 'number' || !Number.isFinite(tauxDernier) || tauxDernier < 0 || tauxDernier > 100) {
        return { passe: false, taux, raison: `taux du dernier guide illisible dans la méta (${JSON.stringify(tauxDernier)}) : je ne sais pas si le taux chute — rien n'est importé` };
    }
    if (taux < tauxDernier - CHUTE_MAX_POINTS - 1e-9) {
        return { passe: false, taux, raison: `le taux de lignes avec un prix chute de ${(tauxDernier - taux).toFixed(2).replace('.', ',')} points (${pct(taux)} contre ${pct(tauxDernier)} au dernier guide ; au plus ${CHUTE_MAX_POINTS} points)` };
    }
    return { passe: true, taux, raison: `${avecPrix} lignes sur ${lignes} portent un prix (${pct(taux)}, ≥ ${SEUIL_PCT} % et ≥ ${pct(tauxDernier)} − ${CHUTE_MAX_POINTS} points)` };
}

module.exports = { jugerTauxPrix, porteUnPrix, SEUIL_PCT, CHUTE_MAX_POINTS };
