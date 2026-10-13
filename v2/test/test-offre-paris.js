'use strict';
// OFFRE-QUOTA — le JOUR CIVIL DE PARIS et la prochaine remise à zéro. Banc PUR (aucune base) : le jour est calculé par Intl (Europe/Paris), jamais par un décalage fixe,
// donc il tient aux deux changements d'heure (journée de 23 h en mars, de 25 h en octobre).
const H = require('./_harnais'); const Of = require('../argent/offre');
const z = s => new Date(s);
(async () => {
    // jour de Paris : avant / après minuit, été (UTC+2) et hiver (UTC+1)
    H.v('été : 23:59:59 Paris (21:59:59Z) = 13 octobre', Of.jourDeParis(z('2026-10-13T21:59:59Z')), '2026-10-13');
    H.v('été : 00:00:00 Paris (22:00:00Z) = 14 octobre', Of.jourDeParis(z('2026-10-13T22:00:00Z')), '2026-10-14');
    H.v('hiver : 23:59:59 Paris (22:59:59Z) = 13 janvier', Of.jourDeParis(z('2026-01-13T22:59:59Z')), '2026-01-13');
    H.v('hiver : 00:00:00 Paris (23:00:00Z) = 14 janvier', Of.jourDeParis(z('2026-01-13T23:00:00Z')), '2026-01-14');
    // le jour UTC n'est PAS le jour de Paris : 22:30Z en été est déjà le lendemain à Paris
    H.v('été 22:30Z : le jour de Paris a déjà changé (le jour UTC non)', [Of.jourDeParis(z('2026-07-01T22:30:00Z')), z('2026-07-01T22:30:00Z').toISOString().slice(0, 10)], ['2026-07-02', '2026-07-01']);
    // journée de 23 h : dimanche 29 mars 2026 (02:00 -> 03:00). Elle commence le 28 à 23:00Z (UTC+1) et finit le 29 à 22:00Z (UTC+2).
    H.v('29 mars (23 h) : début 28T23:00Z', [Of.jourDeParis(z('2026-03-28T22:59:59Z')), Of.jourDeParis(z('2026-03-28T23:00:00Z'))], ['2026-03-28', '2026-03-29']);
    H.v('29 mars (23 h) : fin 29T21:59:59Z / 29T22:00:00Z', [Of.jourDeParis(z('2026-03-29T21:59:59Z')), Of.jourDeParis(z('2026-03-29T22:00:00Z'))], ['2026-03-29', '2026-03-30']);
    // journée de 25 h : dimanche 25 octobre 2026 (03:00 -> 02:00). Elle commence le 24 à 22:00Z (UTC+2) et finit le 25 à 23:00Z (UTC+1).
    H.v('25 octobre (25 h) : début 24T21:59:59Z / 24T22:00:00Z', [Of.jourDeParis(z('2026-10-24T21:59:59Z')), Of.jourDeParis(z('2026-10-24T22:00:00Z'))], ['2026-10-24', '2026-10-25']);
    H.v('25 octobre (25 h) : 22:00Z et 22:59:59Z sont ENCORE le 25 (un décalage fixe +2 l\'aurait fini à 22:00Z)', [Of.jourDeParis(z('2026-10-25T22:00:00Z')), Of.jourDeParis(z('2026-10-25T22:59:59Z'))], ['2026-10-25', '2026-10-25']);
    H.v('25 octobre (25 h) : fin 25T23:00:00Z', Of.jourDeParis(z('2026-10-25T23:00:00Z')), '2026-10-26');
    // la remise à zéro : le prochain minuit de Paris, AVEC son décalage
    const rz = s => Of.prochainMinuitParis(z(s));
    H.v('remise à zéro, été', rz('2026-10-13T10:00:00Z').iso, '2026-10-14T00:00:00+02:00');
    H.v('remise à zéro, hiver', rz('2026-01-13T10:00:00Z').iso, '2026-01-14T00:00:00+01:00');
    H.v('remise à zéro la veille du passage à l\'heure d\'été (journée de 23 h)', rz('2026-03-28T10:00:00Z').iso, '2026-03-29T00:00:00+01:00');
    H.v('   le jour même : minuit suivant à +02:00', rz('2026-03-29T10:00:00Z').iso, '2026-03-30T00:00:00+02:00');
    H.v('remise à zéro la veille du passage à l\'heure d\'hiver (journée de 25 h)', rz('2026-10-24T10:00:00Z').iso, '2026-10-25T00:00:00+02:00');
    H.v('   le jour même : minuit suivant à +01:00', rz('2026-10-25T10:00:00Z').iso, '2026-10-26T00:00:00+01:00');
    H.v('l\'instant de la remise à zéro est exact (ISO avec fuseau == instant)', [rz('2026-10-13T10:00:00Z').instant.toISOString(), Date.parse(rz('2026-10-13T10:00:00Z').iso) === rz('2026-10-13T10:00:00Z').instant.getTime()], ['2026-10-13T22:00:00.000Z', true]);
    H.v('   idem le jour de 25 h et le jour de 23 h', [Date.parse(rz('2026-10-25T10:00:00Z').iso) === rz('2026-10-25T10:00:00Z').instant.getTime(), rz('2026-10-25T10:00:00Z').instant.toISOString(), rz('2026-03-29T10:00:00Z').instant.toISOString()],
        [true, '2026-10-25T23:00:00.000Z', '2026-03-29T22:00:00.000Z']);
    // strictement APRÈS : pile à minuit, la remise à zéro est celle du lendemain
    H.v('pile à minuit de Paris : la remise à zéro est celle du jour d\'après', rz('2026-10-13T22:00:00Z').iso, '2026-10-15T00:00:00+02:00');
    // 366 jours consécutifs : chaque instant de remise à zéro est un minuit de Paris (jour de Paris du dernier instant avant = veille, du premier instant = lendemain)
    let faux = 0, n = 0;
    for (let t = Date.UTC(2026, 0, 1, 12); t < Date.UTC(2027, 0, 1, 12); t += 86400e3) {
        const r = Of.prochainMinuitParis(new Date(t)); n++;
        const avant = Of.jourDeParis(new Date(r.instant.getTime() - 1000)), apres = Of.jourDeParis(r.instant);
        if (!(avant < apres) || Date.parse(r.iso) !== r.instant.getTime()) faux++;
    }
    H.v(`une année entière (${n} jours) : chaque remise à zéro sépare deux jours de Paris et son ISO est exact`, faux, 0);
    // dates invalides : on lève, on n'invente rien
    let leve = 0; for (const x of [null, undefined, 'x', new Date('x')]) { try { Of.jourDeParis(x); } catch (_) { leve++; } }
    H.v('date invalide : lève (4 cas)', leve, 4);
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
