'use strict';
// SECONDE-LECTURE (§72 du testeur) — le module PUR : la décision, le déclenchement, le fournisseur d'essais (modèle FACTICE : aucun appel payant, aucun réseau, aucune base).
// Les trois leçons du §72 sont chacune tenue par un cas :
//   1. le jumeau visé est celui que la première lecture n'écarte que par le CODE ou le NUMÉRO (un voisin déjà écarté par la langue ne déclenche rien) ;
//   2. la carte imprime parfois un autre code que Cardmarket : le code lu CONFIRME, il ne RETIRE que si un AUTRE candidat porte ce code ;
//   3. elle ne se confirme JAMAIS elle-même : aucun champ absent de la première lecture n'est comblé ni confirmé.
const H = require('./_harnais');
const S = require('../identifier/seconde-lecture');

const L = (idProduct, code, numero, langue = null) => ({ idProduct, set: { code }, numero, langue });
const P = L(1, 'PRE', '162'), J = L(2, 'PAR', '251');

(async () => {
    // ── 1. le DÉCLENCHEMENT : seulement quand la seconde lecture peut changer la décision
    const decl = (p, js, premiere) => S.besoin({ p, jumeaux: js, premiere }).declencher;
    H.v('1a. un jumeau écarté par le code ET le numéro, première lecture avec les deux : déclenche', decl(P, [J], { setCode: 'PRE', numero: '162' }), true);
    H.v('1b. un jumeau écarté par le seul numéro (même code) : déclenche', decl(P, [L(2, 'PRE', '251')], { setCode: 'PRE', numero: '162' }), true);
    H.v('1c. un jumeau écarté par le seul code (même numéro) : déclenche', decl(P, [L(2, 'PAR', '162')], { setCode: 'PRE', numero: '162' }), true);
    H.v('1d. LEÇON 1 : un jumeau déjà écarté par la LANGUE (la ligne porte une autre langue que la première lecture) ne déclenche rien', decl(P, [L(2, 'PAR', '251', 'JP')], { setCode: 'PRE', numero: '162', langue: 'FR' }), false);
    H.v('1e. un jumeau de même langue : déclenche toujours', decl(P, [L(2, 'PAR', '251', 'FR')], { setCode: 'PRE', numero: '162', langue: 'FR' }), true);
    H.v('1f. un jumeau que ni le code ni le numéro ne séparent (champs identiques ou inconnus) : ne déclenche pas (rien à lire qui le sépare)', [decl(P, [L(2, 'PRE', '162')], { setCode: 'PRE', numero: '162' }), decl(P, [L(2, null, null)], { setCode: 'PRE', numero: '162' })], [false, false]);
    H.v('1g. un jumeau séparable et un autre qui ne l\'est pas : ne déclenche pas (la seconde lecture ne pourrait pas les séparer tous)', decl(P, [J, L(3, 'PRE', '162')], { setCode: 'PRE', numero: '162' }), false);
    H.v('1h. LEÇON 3 : la première lecture n\'a lu NI code NI numéro : rien à confirmer, ne déclenche pas', decl(P, [J], { setCode: null, numero: null }), false);
    H.v('1i. aucun jumeau, ou plus de deux : ne déclenche pas', [decl(P, [], { setCode: 'PRE', numero: '162' }), decl(P, [J, L(3, 'X', '1'), L(4, 'Y', '2')], { setCode: 'PRE', numero: '162' })], [false, false]);

    // ── 2. la DÉCISION
    const dec = (premiere, seconde, js = [J], p = P) => S.decider({ p, jumeaux: js, premiere, seconde });
    const lu = { setCode: 'PRE', numero: '162' };
    H.v('2a. la seconde lecture confirme le code ET le numéro du produit lu : CONFIRME', dec(lu, { setCode: 'PRE', numero: '162' }).confirme, true);
    H.v('2b. elle confirme le seul numéro (le code est illisible) : le numéro sépare le jumeau, CONFIRME', dec(lu, { setCode: null, numero: '162' }).confirme, true);
    H.v('2c. elle confirme le seul code (le numéro est illisible) : le code sépare le jumeau, CONFIRME', dec(lu, { setCode: 'PRE', numero: null }).confirme, true);
    H.v('2d. elle ne lit rien (deux essais en désaccord, tout null) : ne confirme pas', dec(lu, { setCode: null, numero: null }).confirme, false);
    H.v('2e. elle lit le numéro du JUMEAU : ne confirme pas', dec(lu, { setCode: 'PAR', numero: '251' }).confirme, false);
    H.v('2f. elle contredit le numéro du produit (un autre numéro, que personne ne porte) : ne confirme pas', dec(lu, { setCode: 'PRE', numero: '999' }).confirme, false);
    H.v('2g. elle confirme un champ qui ne SÉPARE PAS le jumeau (le code, identique chez les deux) alors que le numéro est illisible : ne confirme pas', dec(lu, { setCode: 'PRE', numero: null }, [L(2, 'PRE', '251')]).confirme, false);
    H.v('2h. elle confirme le code mais lit le numéro du jumeau : ne confirme pas (le numéro contredit)', dec(lu, { setCode: 'PRE', numero: '251' }, [L(2, 'PRE', '251')]).confirme, false);
    // LEÇON 3 : elle ne comble rien et ne confirme que les champs que la première a LUS
    H.v('3a. LEÇON 3 : la première lecture n\'a PAS lu le numéro ; la seconde le lit « 162 » (celui du produit) : le numéro ne confirme rien ; seul le code (lu des deux fois) confirme', dec({ setCode: 'PRE', numero: null }, { setCode: 'PRE', numero: '162' }).confirme, true);
    H.v('3b. LEÇON 3 : la première n\'a lu NI code NI numéro : la seconde ne peut rien confirmer, même en lisant tout juste', dec({ setCode: null, numero: null }, { setCode: 'PRE', numero: '162' }).confirme, false);
    H.v('3c. LEÇON 3 : la première n\'a lu que le numéro, la seconde ne lit que le code du produit : rien de commun à confirmer', dec({ setCode: null, numero: '162' }, { setCode: 'PRE', numero: null }).confirme, false);
    // LEÇON 2 : un code imprimé ≠ code Cardmarket ne retire pas ; il confirme ou se tait
    const P2 = L(1, 'SI', '100'); // Start Deck : Cardmarket « SI », la carte imprime « SD »... le jumeau a un autre numéro
    H.v('4a. LEÇON 2 : le code imprimé (« PROMO ») n\'est pas celui de Cardmarket (« SM-P ») : il ne retire pas ; le numéro confirme', dec({ setCode: 'PROMO', numero: '100' }, { setCode: 'PROMO', numero: '100' }, [L(2, 'SM12', '200')], L(1, 'SM-P', '100')).confirme, true);
    H.v('4b. LEÇON 2 : même cas, le numéro est illisible : le code lu ne confirme PAS un code qu\'il ne retrouve pas (« PROMO » ≠ « SM-P ») et ne sépare rien : ne confirme pas', dec({ setCode: 'PROMO', numero: null }, { setCode: 'PROMO', numero: null }, [L(2, 'SM12', '200')], L(1, 'SM-P', '100')).confirme, false);
    H.v('4c. LEÇON 2 : un code lu qui diffère de celui du produit mais que PERSONNE d\'autre ne porte ne retire pas — le numéro confirme', dec({ setCode: 'SD', numero: '100' }, { setCode: 'SD', numero: '100' }, [L(2, 'SM12', '200')], P2).confirme, true);
    H.v('4d. LEÇON 2 : le code lu diffère de celui du produit ET un AUTRE candidat (le jumeau) le porte : la carte désigne le jumeau, ne confirme pas', dec({ setCode: 'PAR', numero: '162' }, { setCode: 'PAR', numero: '162' }, [L(2, 'PAR', '162')]).confirme, false);
    H.v('4e. la convention du « x » (code Cardmarket « xASC » pour la carte « ASC ») est un code concordant', dec({ setCode: 'ASC', numero: null }, { setCode: 'ASC', numero: null }, [L(2, 'PAR', '1')], L(1, 'xASC', '5')).confirme, true);
    H.v('2i. deux jumeaux, un seul séparable : ne confirme pas (TOUS les jumeaux doivent être séparés)', dec(lu, { setCode: 'PRE', numero: '162' }, [J, L(3, 'PRE', '162')]).confirme, false);
    H.v('2j. LEÇON 1 : un jumeau déjà séparé par la langue n\'a pas à être séparé par la lecture ; l\'autre l\'est : confirme', dec({ ...lu, langue: 'FR' }, { setCode: 'PRE', numero: '162' }, [J, L(3, 'PRE', '162', 'JP')]).confirme, true);
    // ── TOUR 1 (I-1) : une confirmation exige l'accord des DEUX lectures — la première ne contredit pas P, et la seconde lit ce que la première a lu
    H.v('8a. I-1 : la première lecture EST le jumeau (PAR/251), la seconde lit P (PRE/162) : les deux lectures se contredisent, ne confirme PAS', dec({ setCode: 'PAR', numero: '251' }, { setCode: 'PRE', numero: '162' }).confirme, false);
    H.v('8b. I-1 : la première n\'a lu que le code du jumeau (PAR), la seconde lit P : ne confirme pas', dec({ setCode: 'PAR', numero: null }, { setCode: 'PRE', numero: '162' }).confirme, false);
    H.v('8c. I-1 : la première n\'a lu que le numéro du jumeau (251), la seconde lit P : ne confirme pas', dec({ setCode: null, numero: '251' }, { setCode: 'PRE', numero: '162' }).confirme, false);
    H.v('8d. le désaccord est nommé : raison « conflit de lecture »', /conflit de lecture/.test(dec({ setCode: 'PAR', numero: '251' }, { setCode: 'PRE', numero: '162' }).raison), true);
    H.v('8e. champ par champ : le numéro est le même des deux fois (162) mais les lectures se contredisent sur le code (PAR puis PRE) : ne confirme pas', dec({ setCode: 'PAR', numero: '162' }, { setCode: 'PRE', numero: '162' }).confirme, false);
    H.v('8f. champ par champ : le code est le même des deux fois (PRE) mais les lectures se contredisent sur le numéro (251 puis 162) : ne confirme pas', dec({ setCode: 'PRE', numero: '251' }, { setCode: 'PRE', numero: '162' }, [L(2, 'PRE', '251')]).confirme, false);
    H.v('8g. un accord des deux lectures sur un champ qui ne SÉPARE pas le jumeau (le code, identique chez les deux) ne suffit pas', dec({ setCode: 'PRE', numero: '162' }, { setCode: 'PRE', numero: null }, [L(2, 'PRE', '251')]).confirme, false);
    H.v('8h. les deux lectures disent la même chose et séparent le jumeau : confirme (le cas nominal reste ouvert)', dec({ setCode: 'PRE', numero: '162' }, { setCode: 'PRE', numero: '162' }).confirme, true);
    H.v('8i. la première lecture contredit P sur le numéro (999) et la seconde la suit : ne confirme pas', dec({ setCode: 'PRE', numero: '999' }, { setCode: 'PRE', numero: '999' }).confirme, false);
    H.v('8k. la première lecture contredit P sur le numéro (999) que la seconde ne relit pas ; le code (PRE) confirmerait seul : ne confirme pas (la première ne doit contredire P sur AUCUN champ lu)', dec({ setCode: 'PRE', numero: '999' }, { setCode: 'PRE', numero: null }).confirme, false);
    H.v('8l. les deux lectures ne disent pas la même chose sur le numéro (« 162A » puis « 162 ») sans que la première contredise P : ne confirme pas (accord exact exigé)', dec({ setCode: 'PRE', numero: '162A' }, { setCode: 'PRE', numero: '162' }).confirme, false);
    // la décision rend toujours une raison, jamais une exception
    H.v('5a. entrée vide ou absente : ne confirme pas, ne lève pas', [S.decider({}).confirme, S.decider().confirme, S.decider({ p: P, jumeaux: [J] }).confirme], [false, false, false]);
    H.v('5b. une raison est toujours donnée', typeof dec(lu, { setCode: null, numero: null }).raison, 'string');

    // ── 6. le FOURNISSEUR d'essais : un champ n'est retenu que si DEUX essais le lisent à l'identique
    const lecteurDe = reponses => { const appels = []; const f = async bande => { appels.push(bande); const r = reponses[appels.length - 1]; if (r instanceof Error) throw r; return r; }; f.appels = appels; return f; };
    const IMG = Buffer.from('octets-factices');
    const recadrer = async () => ['b1', 'b2', 'b3'];
    const fournir = (reponses, o = {}) => { const lecteur = lecteurDe(reponses); return { lecteur, F: S.creerFournisseur({ recadrer, lecteur, ...o }) }; };
    {
        const { lecteur, F } = fournir([{ setCode: 'PRE', number: '162' }, { setCode: 'PRE', number: '162' }]);
        const c = { appels: 0 }; const r = await F({ image: IMG, corps: {}, compteur: c });
        H.v('6a. deux essais d\'accord : lu, et le troisième n\'est PAS demandé (2 appels, pas 3)', [r.setCode, r.numero, lecteur.appels.length, c.appels], ['PRE', '162', 2, 2]);
    }
    {
        const { lecteur, F } = fournir([{ setCode: 'PRE', number: '162' }, { setCode: 'PAR', number: '162' }, { setCode: 'PRE', number: '162' }]);
        const c = { appels: 0 }; const r = await F({ image: IMG, corps: {}, compteur: c });
        H.v('6b. désaccord sur le code : un troisième essai, le code retenu est celui que DEUX essais lisent', [r.setCode, r.numero, lecteur.appels.length, c.appels], ['PRE', '162', 3, 3]);
    }
    {
        const { F } = fournir([{ setCode: 'PRE', number: '162' }, { setCode: 'PAR', number: '251' }, { setCode: 'XYZ', number: '7' }]);
        const r = await F({ image: IMG, corps: {}, compteur: { appels: 0 } });
        H.v('6c. trois essais, trois lectures différentes : rien n\'est retenu (null, null) — un champ deviné serait une lecture de plus qui peut mentir', [r.setCode, r.numero], [null, null]);
    }
    {
        const { lecteur, F } = fournir([{ setCode: 'PRE', number: '162' }, { setCode: 'PAR', number: '162' }, { setCode: 'PRE', number: '162' }], { maxEssais: 2 });
        const r = await F({ image: IMG, corps: {}, compteur: { appels: 0 } });
        H.v('6d. maxEssais = 2 : jamais un troisième appel ; le désaccord laisse le code illisible', [lecteur.appels.length, r.setCode, r.numero], [2, null, '162']);
    }
    H.v('6e. maxEssais borné : 7, 0, -1, « x », 2.5 retombent sur le défaut 3 ; 2 et 3 sont gardés', [7, 0, -1, 'x', 2.5, 2, 3, undefined].map(S.bornerEssais), [3, 3, 3, 3, 3, 2, 3, 3]);
    {
        const { lecteur, F } = fournir([{ setCode: 'PRE', number: '162' }], { recadrer: async () => [] });
        const c = { appels: 0 }; const r = await F({ image: IMG, corps: {}, compteur: c });
        H.v('6f. aucune bande à lire (pas de géométrie) : aucun appel, aucun champ, la raison le dit', [lecteur.appels.length, c.appels, r.setCode, r.numero, typeof r.raison], [0, 0, null, null, 'string']);
    }
    {
        const { F } = fournir([new Error('panne OpenRouter')]);
        const c = { appels: 0 }; let levee = null, r = null;
        try { r = await F({ image: IMG, corps: {}, compteur: c }); } catch (e) { levee = e; }
        H.v('6g. le modèle tombe : le fournisseur NE LÈVE PAS, rend echec: true, l\'appel tenté est COMPTÉ (1)', [levee, r && r.echec, c.appels], [null, true, 1]);
    }
    // TOUR 1 (I-2) : sans octets d'image, aucune seconde lecture, aucun appel, le recadreur n'est même pas consulté
    for (const [nom, image] of [['absente', undefined], ['une URL (texte)', 'https://images1.vinted.net/x.jpg'], ['un Buffer vide', Buffer.alloc(0)], ['null', null]]) {
        let recadrages = 0;
        const lecteur = lecteurDe([{ setCode: 'PRE', number: '162' }]);
        const F = S.creerFournisseur({ recadrer: async () => { recadrages++; return ['b1', 'b2']; }, lecteur });
        const c = { appels: 0 }; const r = await F({ image, corps: {}, compteur: c });
        H.v(`6j. image ${nom} : sansImage, aucun appel (${lecteur.appels.length}), aucun recadrage, rien de lu`, [r.sansImage, r.echec, lecteur.appels.length, c.appels, recadrages, r.setCode, r.numero], [true, false, 0, 0, 0, null, null]);
    }
    {
        const recus = []; const ctl = new AbortController();
        const F = S.creerFournisseur({ recadrer: async a => { recus.push(a); return ['b1', 'b2']; }, lecteur: lecteurDe([{ setCode: 'PRE', number: '162' }, { setCode: 'PRE', number: '162' }]) });
        await F({ image: IMG, corps: { x: 1 }, compteur: { appels: 0 }, signal: ctl.signal, photos: ['https://images1.vinted.net/x.jpg'] });
        H.v('6m. le recadreur reçoit les OCTETS (image), le corps et le signal — jamais une URL de photo, même si l\'appelant en glisse une', [recus[0].image === IMG, recus[0].signal === ctl.signal, 'photos' in recus[0], recus[0].corps], [true, true, false, { x: 1 }]);
    }
    // TOUR 1 (coût exact) : un signal d'abandon — après lui, AUCUN appel de plus ne part, et le lecteur reçoit le signal
    {
        const ctl = new AbortController(); const vus = [];
        const lecteur = async (bande, o) => { vus.push(o && o.signal); ctl.abort(); return { setCode: 'PRE', number: '162' }; };     // le délai tombe pendant le premier appel
        const F = S.creerFournisseur({ recadrer, lecteur });
        const c = { appels: 0 }; const r = await F({ image: IMG, corps: {}, compteur: c, signal: ctl.signal });
        H.v('6k. le signal tombe pendant le 1er appel : le 2e ne part PAS, un seul appel compté, échec « interrompue », le lecteur a reçu le signal', [vus.length, vus[0] === ctl.signal, c.appels, r.echec, /INTERROMPUE/.test(r.raison)], [1, true, 1, true, true]);
        const ctl2 = new AbortController(); ctl2.abort();
        const l2 = lecteurDe([{ setCode: 'PRE', number: '162' }]); const c2 = { appels: 0 };
        const r2 = await S.creerFournisseur({ recadrer, lecteur: l2 })({ image: IMG, corps: {}, compteur: c2, signal: ctl2.signal });
        H.v('6l. signal déjà tombé : aucun appel du tout (0 appel, 0 compté)', [l2.appels.length, c2.appels, r2.echec], [0, 0, true]);
    }
    {
        const { F } = fournir([{ setCode: 'PRE', number: ' 162 ' }, { setCode: ' pre', number: '162' }]);
        const r = await F({ image: IMG, corps: {}, compteur: { appels: 0 } });
        H.v('6h. espaces et casse normalisés avant l\'accord (« pre » = « PRE »)', [r.setCode, r.numero], ['PRE', '162']);
    }
    {
        const { F } = fournir([{ setCode: 'null', number: 'NULL' }, { setCode: ' Null ', number: 'null' }, { setCode: null, number: null }]);
        const r = await F({ image: IMG, corps: {}, compteur: { appels: 0 } });
        H.v('6i. « null » écrit en toutes lettres ou null : jamais retenu comme un code', [r.setCode, r.numero], [null, null]);
    }

    // ── 7. les compteurs (le coût, pour la re-mesure) et le garde-fou « jamais deux fois pour le même scan »
    S.reinitialiser();
    H.v('7a. compteurs à zéro au départ', S.compteurs(), { declenchees: 0, confirmees: 0, nonConfirmees: 0, echecs: 0, appels: 0, dejaTentees: 0, nonFaisables: 0 });
    H.v('7b. un scan n\'est tenté qu\'UNE fois : le premier passage est libre, le second refusé', [S.premiereFois('scan-1'), S.premiereFois('scan-1'), S.premiereFois('scan-2')], [true, false, true]);
    H.v('7c. le refus du second passage est COMPTÉ (dejaTentees)', S.compteurs().dejaTentees, 1);
    H.v('7d. un scanId absent ou non texte : refusé (on ne tente jamais sans pouvoir se souvenir)', [S.premiereFois(null), S.premiereFois(undefined), S.premiereFois(42)], [false, false, false]);

    H.bilan();
})().catch(e => { console.error(e); process.exitCode = 1; });
