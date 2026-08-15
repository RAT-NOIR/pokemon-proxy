// ============================================================================
// ⚠️⚠️ DISCIPLINE DES OUTILS DE MESURE — LIRE AVANT D'AJOUTER UNE LIGNE
// ============================================================================
// Septième principe : un instrument qui se trompe coûte plus cher qu'un bug, il envoie
// corriger là où il n'y a rien. Trois règles, toutes tirées d'erreurs commises cette
// semaine dans CE dépôt :
//   1. NE RECONSTRUIS JAMAIS UNE CLÉ (mesure-route-langue.js fabriquait des identifiants
//      de carte qui n'ont jamais existé, et concluait faux).
//   2. NE LIS PAS UN CHAMP HORS DU MOMENT OÙ IL EST REMPLI. `setTcgdex` vient de
//      `lienGagnant`, calculé APRÈS les sorties de refus : le compter sur une ligne
//      d'échec mesure « la ligne a-t-elle abouti », pas « TCGdex a-t-il répondu ».
//   3. UN COMPTEUR QUI SORT 100 % / 0 % EST SUSPECT AVANT D'ÊTRE INTÉRESSANT.
// LECTURE SEULE : aucune écriture.
//
// ============================================================================
// CE QUE CET OUTIL MESURE : les refus sont-ils du RÉSEAU ou de la COUVERTURE ?
// ============================================================================
// L'ENJEU, POSÉ AVANT LA MESURE. Le repli par NOM SEUL (étape 3) ne vaut que pour les
// ABSENCES RÉELLES. S'il s'avère que les refus arrivent groupés en rafales de quelques
// secondes, c'est le réseau qui parle, et le repli sauvera beaucoup moins qu'espéré —
// pire, appliqué sans l'étape 1 il replierait SUR DES PANNES, échangeant un refus honnête
// contre une identification hasardeuse. Mauvais sens de l'échange.
//
// LA SIGNATURE QU'ON CHERCHE : un incident réseau frappe des scans CONSÉCUTIFS et
// rapprochés ; un trou de couverture frappe une carte, n'importe quand, et se répète
// sur la MÊME carte à des jours d'écart.
//
// USAGE : node mesure-panne-ou-absence.js --base=<nom>
require('dotenv').config();
const BASE = process.argv.find(a => a.startsWith('--base='))?.split('=')[1];
if (!BASE) { console.error('❌ --base=<nom> obligatoire.'); process.exit(1); }
const mongoose = require('mongoose');
const { numeroEstUnDexId } = require('./pokedex');

const pc = (n, d) => d ? `${(100 * n / d).toFixed(1)} %` : '—';
const hhmm = d => String(d?.toISOString?.() ?? d).slice(0, 19).replace('T', ' ');

(async () => {
    const c = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: BASE }).asPromise();
    const toutes = await c.collection('journal_scans')
        .find({ route: 'identifier' }).sort({ le: 1 }).toArray();
    console.log(`base : ${BASE}   ·   lignes /api/identifier : ${toutes.length}\n`);

    // Écart au scan PRÉCÉDENT, quel que soit son résultat. C'est lui qui dit si un refus
    // est isolé ou pris dans une rafale.
    for (let i = 0; i < toutes.length; i++) {
        toutes[i].ecartAvant = i === 0 ? null : Math.round((toutes[i].le - toutes[i - 1].le) / 1000);
    }

    // ⚠️ LE REFUS SE RECONNAÎT À `motifEchec`, JAMAIS À `resultat !== 'succes'`.
    // Première version de cet outil : `resultat !== 'succes'` rendait 80 refus sur 162.
    // 49 d'entre eux étaient des lignes ANCIENNES, écrites avant que `resultat` existe :
    // le champ est ABSENT, donc `!== 'succes'` est vrai, et l'outil les comptait comme
    // des échecs. C'est le PREMIER PRINCIPE pris en flagrant délit dans l'instrument
    // lui-même — « je ne sais pas » traité comme « je sais que non ».
    // `motifEchec` n'a jamais été facultatif sur un refus : il est le seul discriminant sûr.
    const refus = toutes.filter(l => l.motifEchec != null);
    const sansResultat = toutes.filter(l => l.resultat == null).length;
    console.log(`⚠️ lignes sans champ \`resultat\` (antérieures à son ajout) : ${sansResultat}` +
        ` — comptées ici d'après \`motifEchec\`, pas d'après \`resultat\`.\n`);
    console.log('═'.repeat(78));
    console.log(`LES REFUS PAR MOTIF — ${refus.length} sur ${toutes.length} (${pc(refus.length, toutes.length)})`);
    console.log('═'.repeat(78));
    const parMotif = new Map();
    for (const l of refus) parMotif.set(l.motifEchec ?? '—', [...(parMotif.get(l.motifEchec ?? '—') || []), l]);
    for (const [m, lot] of [...parMotif].sort((a, b) => b[1].length - a[1].length)) {
        console.log(`   ${String(m).padEnd(26)} ${String(lot.length).padStart(3)}`);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 1. carte-introuvable : combien, et groupés ou isolés ?
    // ─────────────────────────────────────────────────────────────────────
    console.log('\n' + '═'.repeat(78));
    console.log('carte-introuvable — LA CLASSE OÙ TCGdex A RENDU null');
    console.log('═'.repeat(78));
    const ci = refus.filter(l => l.motifEchec === 'carte-introuvable');
    console.log(`   occurrences : ${ci.length}`);
    for (const l of ci) {
        console.log(`      ${hhmm(l.le)}  "${l.nom}" n°${l.numero ?? '—'} lg=${l.langue ?? '—'}` +
            `  nomBrut=${l.nomBrut ?? '—'}  écart au scan précédent : ${l.ecartAvant ?? '—'} s`);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2. LA RAFALE : les refus arrivent-ils en grappes ?
    // ─────────────────────────────────────────────────────────────────────
    // Un refus dont le VOISIN IMMÉDIAT (avant ou après, < 60 s) est aussi un refus est
    // dit « en rafale ». Ce n'est pas une preuve de panne — deux mauvaises cartes
    // scannées de suite le sont aussi — mais l'absence de rafale, elle, EXCLUT la panne.
    console.log('\n' + '═'.repeat(78));
    console.log('LES REFUS ARRIVENT-ILS EN RAFALE ? (voisin immédiat à moins de 60 s)');
    console.log('═'.repeat(78));
    let enRafale = 0, isoles = 0;
    for (let i = 0; i < toutes.length; i++) {
        if (toutes[i].motifEchec == null) continue;
        const av = i > 0 ? toutes[i - 1] : null;
        const ap = i < toutes.length - 1 ? toutes[i + 1] : null;
        const colle = (v, ecart) => v && v.motifEchec != null && ecart != null && ecart <= 60;
        const grappe = colle(av, toutes[i].ecartAvant) || colle(ap, ap?.ecartAvant);
        if (grappe) enRafale++; else isoles++;
    }
    console.log(`   refus EN RAFALE : ${enRafale}  (${pc(enRafale, refus.length)})`);
    console.log(`   refus ISOLÉS    : ${isoles}  (${pc(isoles, refus.length)})`);
    console.log('   ⚠️ une rafale n\'est pas une preuve de panne : scanner cinq mauvaises cartes');
    console.log('      de suite en produit une aussi. C\'est l\'ABSENCE de rafale qui exclut la panne.');

    // ─────────────────────────────────────────────────────────────────────
    // 3. CE QUE LE REPLI PAR NOM SEUL SAUVERAIT VRAIMENT
    // ─────────────────────────────────────────────────────────────────────
    // Le repli de l'étape 3 s'applique EXACTEMENT là où identifierEnLocal refuse de
    // tourner : numéro neutralisé par la règle Pokédex, et aucun chemin restant.
    console.log('\n' + '═'.repeat(78));
    console.log('LA POPULATION DU REPLI PAR NOM SEUL');
    console.log('═'.repeat(78));
    const dex = l => numeroEstUnDexId({ nom: l.nom, numero: l.numero, total: l.total, langue: l.langue }).estDex;
    const cible = refus.filter(l => dex(l) && l.motifEchec === 'carte-introuvable');
    const dexRefus = refus.filter(dex);
    console.log(`   refus avec règle Pokédex déclenchée : ${dexRefus.length}`);
    const pm = new Map();
    for (const l of dexRefus) pm.set(l.motifEchec ?? '—', (pm.get(l.motifEchec ?? '—') || 0) + 1);
    for (const [m, n] of [...pm].sort((a, b) => b[1] - a[1])) console.log(`      ${String(m).padEnd(26)} ${n}`);
    console.log(`\n   -> population du repli (règle déclenchée ET carte-introuvable) : ${cible.length}`);
    for (const l of cible) console.log(`      ${hhmm(l.le)}  "${l.nom}"  écart au précédent : ${l.ecartAvant ?? '—'} s`);

    // ─────────────────────────────────────────────────────────────────────
    // 4. LA MÊME CARTE A-T-ELLE ÉCHOUÉ DEUX FOIS, À DES JOURS D'ÉCART ?
    // ─────────────────────────────────────────────────────────────────────
    // C'est LE discriminant. Un trou de couverture est REPRODUCTIBLE ; une panne ne l'est
    // pas. Si aucune carte refusée n'a jamais été refusée deux fois à distance, aucune
    // absence réelle n'est démontrée par ce journal.
    console.log('\n' + '═'.repeat(78));
    console.log('REPRODUCTIBILITÉ — la même carte a-t-elle échoué à des jours d\'écart ?');
    console.log('═'.repeat(78));
    const parCarte = new Map();
    for (const l of refus) {
        const k = `${String(l.nom || '?').toLowerCase()}|${l.numero ?? '?'}|${l.langue ?? '?'}`;
        parCarte.set(k, [...(parCarte.get(k) || []), l]);
    }
    let repetees = 0;
    for (const [k, lot] of parCarte) {
        if (lot.length < 2) continue;
        const jours = (lot[lot.length - 1].le - lot[0].le) / 86400000;
        if (jours < 0.02) continue;   // moins de ~30 min : même session, pas une répétition
        repetees++;
        console.log(`   « ${k} » refusée ${lot.length} fois sur ${jours.toFixed(1)} jour(s) : ` +
            `${lot.map(x => x.motifEchec ?? '—').join(', ')}`);
    }
    if (!repetees) console.log('   AUCUNE : aucune carte refusée n\'a été refusée à nouveau à distance.');

    // ─────────────────────────────────────────────────────────────────────
    // 5. LA MUTETÉ ABSORBÉE EN SILENCE
    // ─────────────────────────────────────────────────────────────────────
    // Une panne TCGdex ne produit pas QUE des refus : quand le catalogue local ou le
    // chemin setcode+numéro rattrape, elle sort en SUCCÈS dégradé (identifieeEnLocal).
    // Si ces lignes-là arrivent aussi en rafale, la panne est plus large que les refus.
    console.log('\n' + '═'.repeat(78));
    console.log('MUTETÉ ABSORBÉE EN SILENCE — identifieeEnLocal sur les SUCCÈS');
    console.log('═'.repeat(78));
    const succes = toutes.filter(l => l.motifEchec == null);
    const locales = succes.filter(l => l.identifieeEnLocal === true);
    console.log(`   succès : ${succes.length}   ·   dont identifiés SANS TCGdex : ${locales.length}  (${pc(locales.length, succes.length)})`);
    const parJour = new Map();
    for (const l of locales) {
        const j = hhmm(l.le).slice(0, 10);
        parJour.set(j, (parJour.get(j) || 0) + 1);
    }
    console.log('   répartition par jour (une panne se concentre, un trou de couverture s\'étale) :');
    for (const [j, n] of [...parJour].sort()) console.log(`      ${j} : ${'█'.repeat(Math.min(n, 40))} ${n}`);

    await c.close();
})().catch(e => { console.error(e.stack); process.exit(1); });
