// node test-preseance-images.js — la PRÉSÉANCE DE RÉSOLUTION (décision 4 du testeur, 2026-10-13) : « les cartes à deux images justes : la plus grande résolution ;
// à égalité, TCGdex ». Pur : modèles en mémoire, aucune base, aucun réseau, rien sur R2. Ce que le banc garde :
//   · la règle (collecte-cartes/preseance-images.js) — le cas réel de Celebrations (pokemontcg.io 700×977 contre TCGdex 600×825), l'égalité,
//     et tout ce qu'elle N'AUTORISE PAS (Bulbapedia, autre langue, langue inconnue, autre set/numéro, basse définition, source non arbitrée) ;
//   · la jointure du WORKER TCGdex (joindreImagesTcgdex, EXÉCUTÉE telle que le worker l'exécute) : celle qui perd n'ajoute pas son entrée, celle qui gagne retire la perdante ;
//   · l'outil de mise en conformité des doublons existants (mettre-en-conformite-preseance.js : plan pur, annonce de la garde, refus si le compte diffère) ;
//   · la garde du commit du worker surveille le module ; les DEUX écritures (worker TCGdex, pokemontcg.io) l'appellent (§21 bis : une règle, un module).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const lire = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const sansCommentaires = t => t.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');

const P = require('./collecte-cartes/preseance-images');
const SLUG = 'Celebrations';
// les deux entrées RÉELLES de Celebrations n° 011 (mesure du 2026-10-13) : pokemontcg.io 700×977, TCGdex 600×825
const ptcgio = (o = {}) => ({ set: SLUG, source: 'pokemontcg.io', numero: '011', cleR2: 'pokemontcg.io/Celebrations/011-263369-en.webp', w: 700, h: 977, langue: 'en', ...o });
const tcgdex = (o = {}) => ({ set: SLUG, source: 'tcgdex', numero: '011', cleR2: 'tcgdex/Celebrations/011-263369.webp', w: 600, h: 825, langue: 'en', ...o });
const bulba = (o = {}) => ({ set: SLUG, source: 'bulbapedia', numero: '011', cleR2: 'bulbapedia/Celebrations/011.webp', w: 600, h: 840, langue: 'en', ...o });
const gagnante = (a, b) => { const r = P.departager(a, b); return r ? r.gagnante.source : null; };

(async () => {
    // ── 1. la règle, pure ─────────────────────────────────────────────────────────────────────────────────────────────
    verifier('le cas RÉEL de Celebrations : 700×977 (pokemontcg.io) bat 600×825 (TCGdex), dans les deux ordres', [gagnante(ptcgio(), tcgdex()), gagnante(tcgdex(), ptcgio())], ['pokemontcg.io', 'pokemontcg.io']);
    verifier('   le motif dit la préséance de résolution et les deux aires', (r => [r.motif.includes('préséance de résolution'), r.perdante.source, r.aireGagnante, r.airePerdante])(P.departager(ptcgio(), tcgdex())), [true, 'tcgdex', 700 * 977, 600 * 825]);
    verifier('à ÉGALITÉ d\'aire : TCGdex, dans les deux ordres', [gagnante(ptcgio({ w: 600, h: 825 }), tcgdex()), gagnante(tcgdex(), ptcgio({ w: 600, h: 825 }))], ['tcgdex', 'tcgdex']);
    verifier('TCGdex plus grand : TCGdex', gagnante(ptcgio({ w: 500, h: 700 }), tcgdex()), 'tcgdex');
    verifier('l\'AIRE (w×h) décide, pas la seule largeur : plus étroit mais plus haut, plus grande aire', gagnante(ptcgio({ w: 600, h: 1000 }), tcgdex({ w: 650, h: 800 })), 'pokemontcg.io');
    verifier('le numéro se compare par la clé de la jointure (« 011 » = « 11 »)', gagnante(ptcgio({ numero: '011' }), tcgdex({ numero: '11' })), 'pokemontcg.io');
    // ce que la règle N'AUTORISE PAS (une garde s'écrit par ce qu'elle autorise)
    verifier('la paire BULBAPEDIA / TCGDEX est INCHANGÉE : aucun verdict (la préséance du §55 reste celle du remplacement, risque de langue)', [P.departager(bulba(), tcgdex()), P.departager(tcgdex(), bulba({ w: 900, h: 1200 }))], [null, null]);
    verifier('Bulbapedia contre pokemontcg.io : aucun verdict non plus', P.departager(bulba(), ptcgio()), null);
    verifier('une source non arbitrée (artofpkm) : aucun verdict', [P.departager(tcgdex(), tcgdex({ source: 'artofpkm' })), P.departager(ptcgio(), ptcgio({ source: 'tpc-asie' }))], [null, null]);
    verifier('deux entrées d\'une MÊME source : aucun verdict', P.departager(tcgdex(), tcgdex({ cleR2: 'autre.webp' })), null);
    verifier('une autre langue : aucun verdict', P.departager(ptcgio({ langue: 'ja' }), tcgdex()), null);
    verifier('une langue INCONNUE (null) ou absente, d\'un côté ou de l\'autre : aucun verdict', [P.departager(ptcgio({ langue: null }), tcgdex()), P.departager(ptcgio(), tcgdex({ langue: undefined })), P.departager(ptcgio({ langue: null }), tcgdex({ langue: null }))], [null, null, null]);
    verifier('un autre set, un autre numéro : aucun verdict', [P.departager(ptcgio({ set: 'Autre' }), tcgdex()), P.departager(ptcgio({ numero: '012' }), tcgdex())], [null, null]);
    verifier('un numéro absent (null) : aucun verdict (il ne désigne pas une impression)', [P.departager(ptcgio({ numero: null }), tcgdex({ numero: null })), P.departager(ptcgio({ numero: undefined }), tcgdex())], [null, null]);
    verifier('une dimension absente ou nulle : aucun verdict (inconnu n\'est pas petit)', [P.departager(ptcgio({ w: undefined }), tcgdex()), P.departager(ptcgio({ h: 0 }), tcgdex())], [null, null]);
    verifier('une entrée de basse définition : aucun verdict (la règle des marques est celle de basse-definition.js)', [P.departager(ptcgio({ basseDefinition: true }), tcgdex()), P.departager(ptcgio(), tcgdex({ basseDefinition: true }))], [null, null]);
    verifier('des entrées absentes ou non objets : aucun verdict, sans exception', [P.departager(null, tcgdex()), P.departager(undefined, undefined), P.departager('x', tcgdex())], [null, null, null]);

    verifier('les noms de source du module sont ceux des collecteurs (ptcgio.js SOURCE, collecteur-images-tcgdex.js SOURCE)', [P.SOURCE_PTCGIO === require('./collecte-cartes/ptcgio').SOURCE, P.SOURCE_TCGDEX === require('./collecteur-images-tcgdex').SOURCE, P.SOURCES_ARBITREES], [true, true, ['tcgdex', 'pokemontcg.io']]);

    // contre(images, candidate) : ce qu'une écriture demande avant d'ajouter son entrée
    const c1 = P.contre([ptcgio()], tcgdex());
    verifier('contre : la candidate TCGdex 600×825 PERD contre l\'entrée pokemontcg.io 700×977 → elle n\'ajoute rien, rien n\'est retiré', [c1.perd, c1.aRetirer.length], [true, 0]);
    const c2 = P.contre([tcgdex()], ptcgio());
    verifier('contre : la candidate pokemontcg.io 700×977 GAGNE contre l\'entrée TCGdex → elle ajoute, l\'entrée TCGdex est à retirer', [c2.perd, c2.aRetirer.map(e => e.source)], [false, ['tcgdex']]);
    const c3 = P.contre([bulba(), ptcgio({ numero: '012' })], tcgdex());
    verifier('contre : ni Bulbapedia ni un autre numéro ne comptent comme conflit → ne perd pas, rien à retirer', [c3.perd, c3.aRetirer.length, c3.conflits.length], [false, 0, 0]);
    verifier('contre : une image seule, ou aucune image → rien', [P.contre([], tcgdex()).perd, P.contre(undefined, tcgdex()).conflits.length, P.contre(null, tcgdex()).aRetirer.length], [false, 0, 0]);
    const c4 = P.contre([tcgdex({ w: 900, h: 1200 }), ptcgio({ w: 400, h: 550 })], tcgdex({ cleR2: 'x.webp' }));
    verifier('contre : une candidate qui perd contre UN conflit perd (prudence), même si elle bat un autre', [P.contre([ptcgio(), ptcgio({ cleR2: 'p2.webp', w: 100, h: 140 })], tcgdex()).perd, c4.perd], [true, false]);

    // doublons existants (outil) : la perdante de chaque (set, numéro)
    const existants = P.perdantesDeLaCarte([ptcgio(), tcgdex(), tcgdex({ numero: '012', cleR2: 't12.webp' }), bulba({ numero: '013' }), tcgdex({ numero: '013', cleR2: 't13.webp' }), ptcgio({ numero: '014', cleR2: 'p14.webp', w: 600, h: 825 }), tcgdex({ numero: '014', cleR2: 't14.webp' })]);
    verifier('perdantesDeLaCarte : 011 → TCGdex perd ; 012 seul → rien ; 013 Bulbapedia+TCGdex → rien (inchangé) ; 014 égalité → pokemontcg.io perd',
        existants.map(x => [x.perdante.cleR2, x.gagnante.cleR2]), [['tcgdex/Celebrations/011-263369.webp', 'pokemontcg.io/Celebrations/011-263369-en.webp'], ['p14.webp', 't14.webp']]);
    verifier('perdantesDeLaCarte : une carte sans doublon, sans images, ou images non tableau → []', [P.perdantesDeLaCarte([ptcgio()]), P.perdantesDeLaCarte([]), P.perdantesDeLaCarte(undefined)], [[], [], []]);

    // ── 2. la jointure du WORKER TCGdex, exécutée telle quelle ───────────────────────────────────────────────────────
    function fausseBase() {
        const cols = { cartes: new Map(), images: new Map() };
        const lire = (o, k) => k.split('.').reduce((x, p) => x?.[p], o);
        const accepte = (d, f) => Object.entries(f || {}).every(([k, v]) => {
            const x = lire(d, k);
            if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
                if ('$in' in v) return Array.isArray(x) ? x.some(y => v.$in.includes(y)) : v.$in.includes(x);
                if ('$exists' in v) return (x !== undefined) === v.$exists;
                return false;
            }
            if (v === null) return x == null;
            return Array.isArray(x) && !Array.isArray(v) ? x.includes(v) : x === v;
        });
        const ecrire = (o, k, v) => { const ps = k.split('.'); let x = o; for (const p of ps.slice(0, -1)) x = x[p] ??= {}; x[ps.at(-1)] = v; };
        const appliquer = (d, u) => {
            for (const [k, v] of Object.entries(u.$set || {})) ecrire(d, k, v);
            for (const [k, v] of Object.entries(u.$pull || {})) d[k] = (d[k] || []).filter(e => !accepte(e, v));
            for (const [k, v] of Object.entries(u.$push || {})) (d[k] ??= []).push(...(v.$each || [v]));
        };
        const tous = (col, f) => [...col.values()].filter(d => accepte(d, f));
        const modele = col => ({
            find: f => ({ lean: async () => structuredClone(tous(col, f)), select() { return this; } }),
            findById: id => ({ select() { return this; }, lean: async () => structuredClone(col.get(id) ?? null) }),
            async updateOne(f, u, o = {}) { let d = tous(col, f)[0]; if (!d) { if (!o.upsert) return { matchedCount: 0, modifiedCount: 0 }; d = { _id: f._id }; col.set(d._id, d); } appliquer(d, u); return { matchedCount: 1, modifiedCount: 1 }; }
        });
        return { cols, M: { Carte: modele(cols.cartes), Image: modele(cols.images) } };
    }
    const { joindreImagesTcgdex } = require('./collecteur-images-tcgdex');
    const LANG = { langue: 'en', preuve: 'banc' };
    const docTcg = (o = {}) => ({ _id: 'tcg:11', source: 'tcgdex', set: SLUG, carteId: 1, numero: '011', cleR2: 'tcgdex/Celebrations/011-263369.webp', sha256: 'h', w: 600, h: 825, fmt: 'webp', wOriginal: 600, urlOriginal: 'u', preuve: 'p', etat: 'ok', langue: 'en', languePreuve: 'banc', ...o });
    const docPtc = (o = {}) => ({ _id: 'ptc:11', source: 'pokemontcg.io', set: SLUG, carteId: 1, numero: '011', cleR2: 'pokemontcg.io/Celebrations/011-263369-en.webp', etat: 'ok', langue: 'en', ...o });
    const semer = (B, entrees, docs) => { B.cols.cartes.set(1, { _id: 1, nomEn: 'Mew', images: structuredClone(entrees) }); for (const d of docs) B.cols.images.set(d._id, structuredClone(d)); };
    const rien = async f => { const l = console.log, w = console.warn; console.log = console.warn = () => { }; try { return await f(); } finally { console.log = l; console.warn = w; } };
    const vue = B => B.cols.cartes.get(1).images.map(e => `${e.source}:${e.numero}`);

    {   // le cas RÉEL : l'entrée pokemontcg.io est là, le worker a téléchargé TCGdex 600×825 (le document est « ok »)
        const B = fausseBase(); semer(B, [ptcgio()], [docPtc(), docTcg()]);
        const r = await rien(() => joindreImagesTcgdex(B.M, SLUG, [docTcg()], { langue: 'en', LANGUE: LANG }));
        verifier('WORKER TCGDEX : 600×825 contre pokemontcg.io 700×977 → TCGdex n\'ajoute PAS son entrée, pokemontcg.io reste', vue(B), ['pokemontcg.io:011']);
        verifier('   le compte remonte (preseancePerdues), le document pokemontcg.io reste « ok »', [r.preseancePerdues, B.cols.images.get('ptc:11').etat], [1, 'ok']);
    }
    {   // le REJEU : l'entrée TCGdex est déjà dans cartes.images (les 5 de Celebrations, posées avant la règle)
        const B = fausseBase(); semer(B, [ptcgio(), tcgdex()], [docPtc(), docTcg()]);
        await rien(() => joindreImagesTcgdex(B.M, SLUG, [docTcg()], { langue: 'en', LANGUE: LANG }));
        verifier('WORKER TCGDEX : rejeu avec l\'entrée TCGdex déjà posée → elle sort (le $pull de ses propres entrées) et ne revient pas', vue(B), ['pokemontcg.io:011']);
    }
    {   // l'égalité : TCGdex
        const B = fausseBase(); semer(B, [ptcgio({ w: 600, h: 825 })], [docPtc(), docTcg()]);
        const r = await rien(() => joindreImagesTcgdex(B.M, SLUG, [docTcg()], { langue: 'en', LANGUE: LANG }));
        verifier('WORKER TCGDEX : à égalité d\'aire, TCGdex GAGNE → il ajoute, l\'entrée pokemontcg.io sort', vue(B), ['tcgdex:011']);
        const d = B.cols.images.get('ptc:11');
        verifier('   le document pokemontcg.io passe « retire » (motif, par quoi), pour que ni rejeu ni recollecte ne le reprenne ; compte remonté', [d.etat, d.retrait?.motif, d.retrait?.etatAvant, d.retrait?.remplacePar, r.preseanceRemplacees], ['retire', 'préséance de résolution', 'ok', { source: 'tcgdex', cleR2: 'tcgdex/Celebrations/011-263369.webp' }, 1]);
    }
    {   // TCGdex plus grand
        const B = fausseBase(); semer(B, [ptcgio({ w: 300, h: 400 })], [docPtc(), docTcg()]);
        await rien(() => joindreImagesTcgdex(B.M, SLUG, [docTcg()], { langue: 'en', LANGUE: LANG }));
        verifier('WORKER TCGDEX : TCGdex plus grand → il ajoute, pokemontcg.io sort', vue(B), ['tcgdex:011']);
    }
    {   // une image seule : inchangée
        const B = fausseBase(); semer(B, [], [docTcg()]);
        const r = await rien(() => joindreImagesTcgdex(B.M, SLUG, [docTcg()], { langue: 'en', LANGUE: LANG }));
        verifier('WORKER TCGDEX : une image seule → posée comme avant, rien de compté', [vue(B), r.preseancePerdues, r.preseanceRemplacees], [['tcgdex:011'], 0, 0]);
    }
    {   // la paire Bulbapedia : INCHANGÉE (le remplacement du §55 retire l'entrée Bulbapedia, comme avant)
        const B = fausseBase(); semer(B, [bulba()], [docTcg()]);
        const r = await rien(() => joindreImagesTcgdex(B.M, SLUG, [docTcg()], { langue: 'en', LANGUE: LANG }));
        verifier('WORKER TCGDEX : la paire Bulbapedia / TCGdex est inchangée (Bulbapedia remplacée, TCGdex posée), la préséance de résolution n\'y touche pas', [vue(B), r.bulbaRetirees, r.preseancePerdues, r.preseanceRemplacees], [['tcgdex:011'], 1, 0, 0]);
    }
    {   // une autre langue (indonésien) : jamais en conflit avec une entrée « en »
        const B = fausseBase(); semer(B, [ptcgio()], [docPtc(), docTcg({ langue: 'id' })]);
        await rien(() => joindreImagesTcgdex(B.M, SLUG, [docTcg({ langue: 'id' })], { langue: 'id', LANGUE: { langue: 'id', preuve: 'banc' } }));
        verifier('WORKER TCGDEX : une unité d\'une autre langue (id) ne perd ni ne gagne contre une entrée « en »', vue(B), ['pokemontcg.io:011', 'tcgdex:011']);
    }
    {   // deux numéros d'une même carte : le conflit est par (set, numéro)
        const B = fausseBase(); semer(B, [ptcgio()], [docPtc(), docTcg({ numero: '012', _id: 'tcg:12', cleR2: 'tcgdex/Celebrations/012-263369.webp' })]);
        await rien(() => joindreImagesTcgdex(B.M, SLUG, [docTcg({ numero: '012', _id: 'tcg:12', cleR2: 'tcgdex/Celebrations/012-263369.webp' })], { langue: 'en', LANGUE: LANG }));
        verifier('WORKER TCGDEX : un autre numéro de la même carte n\'est pas un conflit', vue(B), ['pokemontcg.io:011', 'tcgdex:012']);
    }

    // ── 3. l'outil des doublons existants ────────────────────────────────────────────────────────────────────────────
    const T = require('./mettre-en-conformite-preseance');
    const cartes5 = [[244868, '023'], [263369, '011'], [263368, '005'], [264453, '002'], [264741, '010']].map(([id, n]) => ({
        _id: id, nomEn: `C${id}`, sets: [SLUG],
        images: [ptcgio({ numero: n, cleR2: `pokemontcg.io/Celebrations/${n}-${id}-en.webp`, vignette: { cleR2: `vignettes/p${id}.webp` } }), tcgdex({ numero: n, cleR2: `tcgdex/Celebrations/${n}-${id}.webp`, vignette: { cleR2: `vignettes/t${id}.webp` } })]
    })).concat([{ _id: 1, nomEn: 'Seule', sets: [SLUG], images: [tcgdex({ numero: '001', cleR2: 'tcgdex/Celebrations/001-1.webp' })] }, { _id: 2, nomEn: 'Bulba', sets: [SLUG], images: [bulba({ numero: '003' }), tcgdex({ numero: '003', cleR2: 'tcgdex/Celebrations/003-2.webp' })] }]);
    const plan = T.planifier(cartes5);
    verifier('OUTIL : les 5 de Celebrations sont les 5 perdantes (TCGdex) ; la carte à image seule et la paire Bulbapedia/TCGdex n\'en sont pas', [plan.retraits.length, plan.retraits.every(r => r.perdante.source === 'tcgdex'), plan.retraits.map(r => r.carteId).sort((a, b) => a - b)], [5, true, [244868, 263368, 263369, 264453, 264741]]);
    verifier('OUTIL : les clés R2 à retirer (les mêmes que retirer-visuels.js reçoit par --cles)', plan.cles, plan.retraits.map(r => r.perdante.cleR2));
    verifier('OUTIL : l\'ANNONCE de la garde vient de garde-lot.js (images du set : avant → après) — une baisse annoncée par set', plan.annonce, { 'images set:Celebrations': 5 });
    verifier('OUTIL : l\'annonce est validée par la garde (compteur connu) ET couvre toute la baisse (aucune baisse non autorisée)', [plan.garde.nonAutorisees.length, plan.garde.annoncesNonRealisees.length], [0, 0]);
    verifier('OUTIL : sans l\'annonce, la garde de lot BLOQUERAIT (le témoin que la garde sait dire non)', T.verifierAnnonce(cartes5, plan, {}).nonAutorisees.length > 0, true);
    verifier('OUTIL : --attendu égal au compte → accepté ; différent → refusé et le dit', [T.verifierAttendu(plan, 5).ok, T.verifierAttendu(plan, 4).ok, /5/.test(T.verifierAttendu(plan, 4).raison) && /4/.test(T.verifierAttendu(plan, 4).raison), T.verifierAttendu(plan, undefined).ok], [true, false, true, false]);
    verifier('OUTIL : le motif de retrait est celui de la décision', T.MOTIF, 'préséance de résolution');
    const lancerCli = a => spawnSync(process.execPath, [path.join(__dirname, 'mettre-en-conformite-preseance.js'), ...a], { encoding: 'utf8' });
    verifier('OUTIL : un argument inconnu refuse avant toute connexion (code 2)', lancerCli(['--tout']).status, 2);
    verifier('OUTIL : --ecrire sans --attendu refuse avant toute connexion (code 2)', lancerCli(['--ecrire']).status, 2);

    // ── 4. l'écriture du plan réutilise retirer-visuels.js (une seule implémentation du retrait) ─────────────────────
    const srcOutil = sansCommentaires(lire('mettre-en-conformite-preseance.js'));
    verifier('OUTIL : l\'écriture passe par retirer-visuels.js (--cles, --motif), jamais par une seconde copie du retrait', [/retirer-visuels\.js/.test(srcOutil), /\$pull\s*:/.test(srcOutil), /etat:\s*'retire'/.test(srcOutil)], [true, false, false]);

    // ── 5. les lecteurs de la règle, et la garde du commit du worker ─────────────────────────────────────────────────
    for (const f of ['collecteur-images-tcgdex.js', 'collecteur-images-ptcgio.js']) {
        verifier(`${f} appelle le module (UNE règle, lue par les deux écritures)`, /preseance-images/.test(sansCommentaires(lire(f))) && /\bcontre\(/.test(sansCommentaires(lire(f))), true);
    }
    verifier('aucun lecteur ne recopie la comparaison d\'aires (la règle vit dans le module)', ['collecteur-images-tcgdex.js', 'collecteur-images-ptcgio.js', 'mettre-en-conformite-preseance.js'].map(f => /\.w\s*\*\s*\w+\.h|\bw\s*\*\s*h\b/.test(sansCommentaires(lire(f)))), [false, false, false]);
    const regles = lire('remettre-en-file.js').match(/const REGLES = \[([\s\S]*?)\];/)?.[1] ?? '';
    verifier('REGLES (garde du commit du worker) surveille collecte-cartes/preseance-images.js : le worker TCGdex l\'exécute', regles.includes("'collecte-cartes/preseance-images.js'"), true);

    console.log(`\n${ok} passés, ${ko} en échec (sur ${ok + ko})`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ ERREUR DU BANC', e); process.exit(1); });
