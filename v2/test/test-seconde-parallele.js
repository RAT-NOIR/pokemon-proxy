'use strict';
// LOT TEMPS-CHAINE-2 — la seconde lecture, les DEUX premiers essais en parallèle (V2_TC_SECONDE_PARALLELE, éteint par défaut).
// La propriété qui compte : DÉCIDER EXACTEMENT comme la version séquentielle, sur TOUTES les combinaisons d'issues des trois essais (modèle FACTICE : aucun appel payant, aucun réseau, aucune base).
//   · éteint : séquentiel (le 2e appel ne part qu'après la fin du 1er) ;
//   · allumé : les deux premiers partent ensemble ; le 3e SEULEMENT si les deux sont lus et en désaccord ; jamais plus de 3 appels ;
//   · seule différence de coût, nommée : le 1er essai TOMBE (erreur) alors que le 2e est déjà parti -> 2 appels comptés au lieu de 1, même issue (échec).
const H = require('./_harnais');
const S = require('../identifier/seconde-lecture');
const TC = require('../identifier/temps-chaine');
const { v, vrai } = H;

const IMG = Buffer.from('octets-factices');
const ISSUES = { X: { setCode: 'PRE', number: '162' }, Y: { setCode: 'PAR', number: '162' }, Z: { setCode: 'PRE', number: '251' }, I: { illisible: true }, N: null, E: 'ERREUR' };
const noms = Object.keys(ISSUES);
const recadrerN = n => async () => ['b1', 'b2', 'b3'].slice(0, n);
// un lecteur qui répond selon la BANDE (pas selon l'ordre d'arrivée) : même réponse quel que soit l'ordonnancement ; il note le pic de concurrence et les bandes appelées
function lecteurDe(code, { delai = 0, aborter = null, delaiBande = null } = {}) {
    const etat = { appels: [], enCours: 0, pic: 0 };
    const f = async (bande, o) => {
        etat.appels.push(bande); etat.enCours++; etat.pic = Math.max(etat.pic, etat.enCours);
        const d = delaiBande ? (delaiBande[bande] || 0) : delai;
        if (d) await new Promise(r => setTimeout(r, d));
        if (aborter && aborter.bande === bande) aborter.ctl.abort();
        etat.enCours--;
        const r = ISSUES[code[Number(bande.slice(1)) - 1]];
        if (r === 'ERREUR') throw new Error('panne OpenRouter');
        return r;
    };
    f.etat = etat; return f;
}
const lancer = async (code, { parallele, n = 3, max, signal, delai, aborter, delaiBande } = {}) => {
    const lecteur = lecteurDe(code, { delai, aborter, delaiBande }), c = { appels: 0 };
    const F = S.creerFournisseur({ recadrer: recadrerN(n), lecteur, maxEssais: max, parallele });
    const r = await F({ image: IMG, corps: {}, compteur: c, signal });
    return { r, c: c.appels, bandes: lecteur.etat.appels, pic: lecteur.etat.pic };
};

(async () => {
    console.log('=== 1. le drapeau : seul « 1 » allume (écrit par ce qu\'il AUTORISE) ===');
    v('absent -> éteint', TC.reglages({}).secondeParallele, false);
    v('"1" allume', TC.reglages({ V2_TC_SECONDE_PARALLELE: '1' }).secondeParallele, true);
    v('"true", "oui", "0", " 1", "" n\'allument pas', ['true', 'oui', '0', ' 1', ''].map(x => TC.reglages({ V2_TC_SECONDE_PARALLELE: x }).secondeParallele), [false, false, false, false, false]);
    v('le réglage de l\'image prioritaire est intact', TC.reglages({ V2_TC_IMAGE_PRIORITAIRE: '1' }).imagePrioritaireSansCalcul, true);

    console.log('=== 2. éteint (défaut) : séquentiel, jamais deux appels à la fois ===');
    {
        const a = await lancer('XXX', { delai: 15 });
        v('défaut : pic de concurrence 1, 2 appels, accord', [a.pic, a.c, a.r.setCode, a.r.numero], [1, 2, 'PRE', '162']);
        const b = await lancer('XXX', { delai: 15, parallele: false });
        v('parallele:false explicite : pic 1', b.pic, 1);
        process.env.V2_TC_SECONDE_PARALLELE = '1';
        const e = await lancer('XXX', { delai: 15 });
        delete process.env.V2_TC_SECONDE_PARALLELE;
        v('le drapeau d\'environnement allume quand l\'option est absente : pic 2', e.pic, 2);
        for (const val of ['true', 'oui', '0', ' 1', '']) {
            process.env.V2_TC_SECONDE_PARALLELE = val;
            const g = await lancer('XXX', { delai: 15 });
            delete process.env.V2_TC_SECONDE_PARALLELE;
            v(`environnement « ${val} » : n'allume pas le chemin (pic 1)`, g.pic, 1);
        }
        const f = await lancer('XXX', { delai: 15, parallele: false });
        v('l\'option explicite prime sur l\'environnement (éteint si parallele:false)', f.pic, 1);
    }

    console.log('=== 3. allumé : les deux premiers partent ENSEMBLE, le 3e après ===');
    {
        const a = await lancer('XXX', { parallele: true, delai: 15 });
        v('deux d\'accord : pic 2, 2 appels (pas de 3e), bandes b1 b2', [a.pic, a.c, a.bandes.sort()], [2, 2, ['b1', 'b2']]);
        const b = await lancer('XYX', { parallele: true, delai: 15 });
        v('désaccord : 3 appels, le 3e seul après les deux (pic 2)', [b.pic, b.c, b.bandes.length, b.r.setCode], [2, 3, 3, 'PRE']);
        const t0 = Date.now(); await lancer('XYX', { parallele: true, delai: 60 }); const dPar = Date.now() - t0;
        const t1 = Date.now(); await lancer('XYX', { parallele: false, delai: 60 }); const dSeq = Date.now() - t1;
        vrai(`durée : parallèle (${dPar} ms) nettement sous séquentiel (${dSeq} ms)`, dPar < dSeq - 40);
    }

    console.log('=== 4. EXHAUSTIF : toutes les combinaisons d\'issues des 3 essais x bandes (1 à 3) x maxEssais (2, 3) ===');
    let combos = 0, memeDecision = 0, memeAppelsHorsErreur1 = 0, horsErreur1 = 0, plusDe3 = 0, troisiemeIndu = 0, surcoutAutorise = 0, surcoutIndu = 0;
    const diffs = [];
    for (const a of noms) for (const b of noms) for (const c3 of noms) for (const n of [1, 2, 3]) for (const max of [2, 3]) {
        const code = a + b + c3;
        const s = await lancer(code, { parallele: false, n, max }), p = await lancer(code, { parallele: true, n, max });
        combos++;
        const cle = x => JSON.stringify({ s: x.r.setCode, n: x.r.numero, t: x.r.total, e: x.r.echec, ra: x.r.raison });
        // décision : les champs retenus, l'échec et la raison — identiques
        const eg = cle(s) === cle(p) && (s.r.echec ? true : JSON.stringify(s.r.essais) === JSON.stringify(p.r.essais));
        if (eg) memeDecision++; else diffs.push([code, n, max, cle(s), cle(p)]);
        if (p.c > 3) plusDe3++;
        if (p.bandes.includes('b3') !== s.bandes.includes('b3')) troisiemeIndu++;     // le 3e part dans les mêmes cas, ni plus ni moins
        // ET la règle absolue, écrite à part (pas copiée du code) : le 3e part ssi 3 bandes, plafond 3, les deux premiers LUS (ni erreur) et en désaccord sur le code ou le numéro
        const lu = k => (ISSUES[k] === 'ERREUR' ? undefined : ISSUES[k] && !ISSUES[k].illisible ? ISSUES[k] : { setCode: null, number: null });
        const [la, lb] = [lu(a), lu(b)];
        const du = n > 2 && max >= 3 && la && lb && !(la.setCode === lb.setCode && la.number === lb.number);
        if (p.bandes.includes('b3') !== Boolean(du) || s.bandes.includes('b3') !== Boolean(du)) troisiemeIndu++;
        const erreur1 = n > 1 && a === 'E';
        if (!erreur1) { horsErreur1++; if (s.c === p.c && JSON.stringify(s.bandes) === JSON.stringify(p.bandes.slice().sort())) memeAppelsHorsErreur1++; }
        else if (p.c === s.c + 1 && p.c === 2) surcoutAutorise++; else surcoutIndu++;
    }
    v(`${combos} combinaisons : décision identique (champs retenus, échec, raison, essais)`, [memeDecision, diffs.slice(0, 3)], [combos, []]);
    v('hors « 1er essai en erreur » : EXACTEMENT les mêmes appels (nombre et bandes)', memeAppelsHorsErreur1, horsErreur1);
    v('jamais plus de 3 appels, jamais un 3e appel qui n\'est pas dû', [plusDe3, troisiemeIndu], [0, 0]);
    v('1er essai en erreur (2 bandes ou plus) : +1 appel exactement (2 au lieu de 1), jamais plus', [surcoutIndu > 0, surcoutAutorise > 0], [false, true]);

    console.log('=== 5. signal d\'abandon : même issue que le séquentiel ===');
    {
        // le signal tombe pendant le 1er appel : séquentiel -> le 2e ne part pas, échec « interrompue » ; parallèle -> le 2e est déjà parti (compté), MÊME échec
        for (const par of [false, true]) {
            const ctl = new AbortController();
            const r = await lancer('XXX', { parallele: par, signal: ctl.signal, aborter: { ctl, bande: 'b1' } });
            v(`signal tombé pendant le 1er appel (parallele=${par}) : échec « interrompue », aucun champ`, [r.r.echec, /INTERROMPUE/.test(r.r.raison), r.r.setCode, r.r.numero], [true, true, null, null]);
            vrai(`   appels bornés (${par ? '<= 2' : '1'}) : ${r.c}`, par ? r.c <= 2 : r.c === 1);
        }
        // le 1er essai est LENT, le 2e finit avant lui et le signal tombe pendant le 1er : le séquentiel n'aurait pas appelé le 2e -> échec « interrompue » aussi en parallèle (pas de résultat tiré d'un 2e appel que le séquentiel n'aurait pas fait)
        for (const par of [false, true]) {
            const ctl = new AbortController();
            const r = await lancer('XXX', { parallele: par, signal: ctl.signal, aborter: { ctl, bande: 'b1' }, delaiBande: { b1: 30, b2: 0 } });
            v(`signal tombé à la FIN d'un 1er essai lent (parallele=${par}) : échec « interrompue », aucun champ`, [r.r.echec, /INTERROMPUE/.test(r.r.raison), r.r.setCode, r.r.numero], [true, true, null, null]);
        }
        for (const par of [false, true]) {
            const ctl = new AbortController(); ctl.abort();
            const r = await lancer('XXX', { parallele: par, signal: ctl.signal });
            v(`signal déjà tombé (parallele=${par}) : 0 appel, échec`, [r.c, r.bandes.length, r.r.echec], [0, 0, true]);
        }
        // le signal tombe pendant le 2e appel seulement : séquentiel et parallèle gardent le résultat s'ils sont d'accord (pas de 3e demandé) ; désaccord -> 3e refusé (INTERROMPUE)
        for (const code of ['XXX', 'XYX']) {
            const sortie = [];
            for (const par of [false, true]) {
                const ctl = new AbortController();
                const r = await lancer(code, { parallele: par, signal: ctl.signal, aborter: { ctl, bande: 'b2' }, delai: 10 });
                sortie.push(JSON.stringify([r.r.echec, r.r.setCode, r.r.numero, /INTERROMPUE/.test(r.r.raison || '')]));
            }
            v(`signal tombé pendant le 2e appel, essais ${code} : même résultat séquentiel / parallèle`, sortie[0], sortie[1]);
        }
    }

    console.log('=== 6. le compteur de l\'appelant et les cas sans lecture ===');
    {
        const sans = await lancer('XXX', { parallele: true, n: 0 });
        v('aucune bande : 0 appel, aucune erreur', [sans.c, sans.r.echec, sans.r.setCode], [0, false, null]);
        let recadrages = 0;
        const F = S.creerFournisseur({ recadrer: async () => { recadrages++; return ['b1', 'b2']; }, lecteur: lecteurDe('XXX'), parallele: true });
        const r = await F({ image: 'https://x/y.jpg', corps: {}, compteur: { appels: 0 } });
        v('sans octets (URL) : sansImage, aucun appel, aucun recadrage', [r.sansImage, recadrages], [true, 0]);
        const seul = await lancer('XXX', { parallele: true, n: 1 });
        v('une seule bande : un seul appel', [seul.c, seul.bandes], [1, ['b1']]);
    }

    H.bilan();
})().catch(e => { console.error(e); process.exitCode = 1; });
