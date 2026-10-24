'use strict';
// ETAT-TITRE — le module v2/identifier/etat-photos.js, SANS réseau ni base : la lecture de la réponse du modèle, l'appel (corps, images, signal), les pannes qui rendent un état nul sans lever, la fusion dans la lecture.
// Le banc par les vraies routes (test-etat-titre.js) prouve le comportement de bout en bout ; celui-ci fixe les cas limites de la pièce.
const H = require('./_harnais');
const E = require('../identifier/etat-photos');
const muet = { error: () => { } };
const rep = contenu => ({ data: { choices: [{ message: { content: contenu } }] } });

(async () => {
    // ── la lecture de la réponse : jamais une valeur inventée
    H.v('1. une réponse propre', E.analyserReponse('{"etatEstime":"EX","etatConfiance":"haute","defautsVus":["blanchiment bord gauche"]}'), { etatEstime: 'EX', etatSecond: null, etatSecondRefuse: false, etatConfiance: 'haute', defautsVus: ['blanchiment bord gauche'] });
    H.v('1. des clôtures markdown et des majuscules/minuscules inversées sont lues', E.analyserReponse('```json\n{"etatEstime":"gd","etatConfiance":"MOYENNE","defautsVus":[]}\n```'), { etatEstime: 'GD', etatSecond: null, etatSecondRefuse: false, etatConfiance: 'moyenne', defautsVus: [] });
    H.v('1. un état hors barème (« Mint », « MT » est au barème) et une confiance hors énumération deviennent null, champ par champ', E.analyserReponse('{"etatEstime":"Mint","etatConfiance":"certaine","defautsVus":[]}'), { etatEstime: null, etatSecond: null, etatSecondRefuse: false, etatConfiance: null, defautsVus: [] });
    H.v('1. « MT » est un état du barème', E.analyserReponse('{"etatEstime":"MT","etatConfiance":"haute","defautsVus":[]}').etatEstime, 'MT');
    H.v('1. des défauts qui ne sont pas une liste de chaînes : null (jamais [] qui dirait « aucun défaut vu »)', E.analyserReponse('{"etatEstime":"NM","etatConfiance":"haute","defautsVus":"rien"}').defautsVus, null);
    H.v('1. les défauts sont bornés (10 défauts, 200 caractères) et vidés des chaînes vides', E.analyserReponse(JSON.stringify({ etatEstime: 'NM', etatConfiance: 'haute', defautsVus: [...Array(15).fill('x'.repeat(300)), '  ', 4] })).defautsVus.map(x => x.length), Array(10).fill(200));
    for (const [nom, x] of [['pas du JSON', 'bonjour'], ['un tableau', '[1]'], ['null', 'null'], ['pas une chaîne', undefined], ['un nombre', 5]]) H.v(`1. ${nom} : null`, E.analyserReponse(x), null);

    // ── LE SECOND ÉTAT (règle de l'éditeur, tour 2) : l'erreur ne va JAMAIS vers « moins abîmé que la réalité »
    {
        const lire = (e, s) => E.analyserReponse(JSON.stringify({ etatEstime: e, ...(s === undefined ? {} : { etatSecond: s }), etatConfiance: 'haute', defautsVus: [] }));
        H.v('8. hésitation : un second état de la liste est lu', [lire('NM', 'LP').etatSecond, lire('NM', 'LP').etatSecondRefuse], ['LP', false]);
        H.v('8. absence d\'hésitation : champ absent, null, « null », vide → aucun second état, rien de refusé', ['x', null, 'null', '', 'aucun'].slice(1).map(s => { const r = lire('NM', s); return [r.etatSecond, r.etatSecondRefuse]; }).concat([[lire('NM').etatSecond, lire('NM').etatSecondRefuse]]), [[null, false], [null, false], [null, false], [null, false], [null, false]]);
        H.v('8. second état HORS LISTE (« MINT », « Poor », 7, « EX+ ») : REFUSÉ (null, signalé), jamais retenu', ['MINT', 'Poor', 'EX+', 'LP/PL'].map(s => { const r = lire('NM', s); return [r.etatSecond, r.etatSecondRefuse]; }), Array(4).fill([null, true]));
        H.v('8. un second état qui n\'est pas une chaîne (nombre, tableau, objet) : ignoré, sans second état', [7, ['LP'], { a: 1 }].map(s => lire('NM', s).etatSecond), [null, null, null]);
        H.v('8. un second égal au premier n\'est pas une hésitation', [lire('NM', 'nm').etatSecond, lire('NM', 'nm').etatSecondRefuse], [null, false]);
        // retenirEtat : le PLUS ABÎMÉ des deux, jamais un état meilleur
        H.v('8. retenirEtat : hésitation NM/LP → LP ; EX/GD → GD ; GD/EX → GD (l\'ordre dit-il quel est le premier : peu importe)', [E.retenirEtat('NM', 'LP'), E.retenirEtat('EX', 'GD'), E.retenirEtat('GD', 'EX')], ['LP', 'GD', 'GD']);
        H.v('8. retenirEtat : sans second état → l\'état unique ; second hors liste ou null → l\'état unique', [E.retenirEtat('EX', null), E.retenirEtat('EX', undefined), E.retenirEtat('EX', 'MINT'), E.retenirEtat('EX', '')], ['EX', 'EX', 'EX', 'EX']);
        H.v('8. retenirEtat : un second MEILLEUR (NM, MT) ne relève jamais l\'état', [E.retenirEtat('EX', 'NM'), E.retenirEtat('GD', 'MT')], ['EX', 'GD']);
        H.v('8. retenirEtat : sans état valide → null, le second n\'est jamais retenu seul', [E.retenirEtat(null, 'LP'), E.retenirEtat('Mint', 'LP'), E.retenirEtat('', 'PL')], [null, null, null]);
        H.v('8. retenirEtat sur tout le barème : le résultat n\'est jamais plus beau que l\'état d\'origine', ['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'].every(e => ['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO', 'x', null].every(s => ['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'].indexOf(E.retenirEtat(e, s)) >= ['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'].indexOf(e))), true);
        H.vrai('8. la consigne propose le champ facultatif etatSecond, fermé (même liste), « seulement si tu hésites VRAIMENT entre deux états voisins »', /"etatSecond": "NM\/EX\/GD\/LP\/PL\/PO, ou null"/.test(E.PROMPT_ETAT) && /etatSecond : null dans la grande majorité des cas\. Ne le renseigne que si tu hésites VRAIMENT entre deux états voisins/.test(E.PROMPT_ETAT));
        const l = { name: 'X', etatEstime: 'NM' };
        E.fusionner(l, { etatEstime: 'EX', etatSecond: 'GD', etatSecondRefuse: false, etatConfiance: 'haute', defautsVus: [], ms: 1, cause: null });
        H.v('8. fusionner pose le second état (information) ; un état en panne le remet à null', [l.etatSecond, E.fusionner({ etatEstime: 'NM' }, { ...nulSeconds(), ms: 1, cause: 'panne' }).etatSecond], ['GD', null]);
        function nulSeconds() { return { etatEstime: null, etatSecond: null, etatSecondRefuse: false, etatConfiance: null, defautsVus: null }; }
    }

    // ── la consigne : ni titre, ni vendeur
    H.vrai('2. la consigne ne contient aucune variable d\'annonce (pas de ${…} non résolu, pas de « (non fourni) »)', !/\$\{|non fourni/.test(E.PROMPT_ETAT));
    H.vrai('2. la consigne demande le JSON de l\'état et rien d\'autre (trois clés)', /"etatEstime"/.test(E.PROMPT_ETAT) && /"etatConfiance"/.test(E.PROMPT_ETAT) && /"defautsVus"/.test(E.PROMPT_ETAT) && !/"name"|"number"|"setCode"/.test(E.PROMPT_ETAT));

    // ── l'appel : le corps, les images, le signal
    {
        let vu = null;
        const r = await E.estimerEtat({ images: ['https://a/1.webp', '', null, 'data:image/jpeg;base64,eHk='], modele: 'm/x', journal: muet, appeler: async (corps, config) => { vu = { corps, config }; return rep('{"etatEstime":"LP","etatConfiance":"moyenne","defautsVus":["coin corné"]}'); } });
        H.v('3. l\'état rendu, la cause nulle, une durée', [r.etatEstime, r.etatConfiance, r.defautsVus, r.cause, Number.isFinite(r.ms)], ['LP', 'moyenne', ['coin corné'], null, true]);
        H.v('3. le corps : le modèle donné, température 0, UN message dont le texte est la consigne d\'état seule', [vu.corps.model, vu.corps.temperature, vu.corps.messages.length, vu.corps.messages[0].content[0]], ['m/x', 0, 1, { type: 'text', text: E.PROMPT_ETAT }]);
        H.v('3. les images vides sont écartées, les autres passées telles quelles, dans l\'ordre (URL et `data:`)', vu.corps.messages[0].content.slice(1).map(p => p.image_url.url), ['https://a/1.webp', 'data:image/jpeg;base64,eHk=']);
        H.v('3. sans signal d\'arrêt, la configuration passée au client ne porte pas de signal', 'signal' in vu.config, false);
        const ctl = new AbortController(); let cfg = null;
        await E.estimerEtat({ images: ['u'], modele: 'm', signal: ctl.signal, journal: muet, appeler: async (c, config) => { cfg = config; return rep('{}'); } });
        H.vrai('3. le signal d\'arrêt du scan est transmis au client', cfg && cfg.signal === ctl.signal);
    }

    // ── les pannes rendent un état nul avec leur cause, sans jamais lever
    const nul = { etatEstime: null, etatConfiance: null, defautsVus: null };
    const cas = [
        ['aucune image', { images: [], appeler: async () => rep('{}') }, 'sans-image'],
        ['images absentes', { images: undefined, appeler: async () => rep('{}') }, 'sans-image'],
        ['client absent', { images: ['u'], appeler: undefined }, 'sans-image'],
        ['panne du fournisseur (ECONNRESET)', { images: ['u'], appeler: async () => { throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }); } }, 'panne'],
        ['HTTP 500', { images: ['u'], appeler: async () => { throw Object.assign(new Error('x'), { response: { status: 500, data: { secret: 'ne-pas-journaliser' } } }); } }, 'panne'],
        ['plafond de dépense du modèle', { images: ['u'], appeler: async () => { throw Object.assign(new Error('dépense'), { code: 'DEPENSE_MODELE_PLAFOND' }); } }, 'depense'],
        ['arrêt du scan (AbortError)', { images: ['u'], appeler: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); } }, 'arret'],
        ['arrêt du scan (axios : ERR_CANCELED)', { images: ['u'], appeler: async () => { throw Object.assign(new Error('x'), { code: 'ERR_CANCELED' }); } }, 'arret'],
        ['réponse illisible', { images: ['u'], appeler: async () => rep('pas du json') }, 'illisible'],
        ['réponse sans choix', { images: ['u'], appeler: async () => ({ data: {} }) }, 'illisible'],
        ['réponse vide (undefined)', { images: ['u'], appeler: async () => undefined }, 'illisible'],
    ];
    for (const [nom, o, cause] of cas) {
        let lever = null, r = null;
        const traces = [];
        try { r = await E.estimerEtat({ modele: 'm', journal: { error: t => traces.push(t) }, ...o }); } catch (e) { lever = e; }
        H.v(`4. ${nom} : ne lève pas, état nul, cause « ${cause} »`, lever ? 'LEVE ' + lever.message : [r.etatEstime, r.etatConfiance, r.defautsVus, r.cause], [null, null, null, cause]);
        H.vrai(`4. ${nom} : la trace ne porte jamais le corps de la réponse du fournisseur`, traces.every(t => !/ne-pas-journaliser/.test(t)));
    }
    {
        const ctl = new AbortController(); ctl.abort();
        const r = await E.estimerEtat({ images: ['u'], modele: 'm', signal: ctl.signal, journal: muet, appeler: async () => { throw new Error('autre'); } });
        H.v('4. signal déjà avorté + erreur quelconque : cause « arret »', r.cause, 'arret');
    }

    // ── la fusion : l'état des photos REMPLACE celui de la lecture, qui est gardé comme information
    {
        const lecture = { name: 'Tropius', number: '001', etatEstime: 'NM', etatConfiance: 'haute', defautsVus: ['neuf'] };
        E.fusionner(lecture, { etatEstime: 'GD', etatConfiance: 'moyenne', defautsVus: ['rayure'], ms: 812, cause: null });
        H.v('5. l\'état, la confiance et les défauts sont ceux de l\'appel séparé', [lecture.etatEstime, lecture.etatConfiance, lecture.defautsVus], ['GD', 'moyenne', ['rayure']]);
        H.v('5. l\'état de la lecture est gardé comme information, la durée posée, le nom et le numéro intacts', [lecture.etatIdentification, lecture.msEtat, lecture.etatCause, lecture.name, lecture.number], [{ etatEstime: 'NM', etatConfiance: 'haute' }, 812, null, 'Tropius', '001']);
        const l2 = { name: 'X', etatEstime: 'NM', etatConfiance: 'haute', defautsVus: [] };
        E.fusionner(l2, { ...nul, ms: 5, cause: 'panne' });
        H.v('5. un appel d\'état en PANNE ne laisse JAMAIS l\'état de la lecture : nul, avec sa cause', [l2.etatEstime, l2.etatConfiance, l2.defautsVus, l2.etatCause, l2.etatIdentification], [null, null, null, 'panne', { etatEstime: 'NM', etatConfiance: 'haute' }]);
        const l3 = { name: 'Y' };
        E.fusionner(l3, { etatEstime: 'EX', etatConfiance: 'haute', defautsVus: [], ms: 1, cause: null });
        H.v('5. une lecture sans état ne laisse pas d\'« information » inventée', l3.etatIdentification, null);
    }

    // ── C3 : le délai propre de l'attente de l'état, sur une HORLOGE FACTICE (aucun vrai temps ne passe)
    {
        const horloge = () => { let t = 0, n = 0; const taches = new Map(); return {
            programmer: (fn, ms) => { const id = ++n; taches.set(id, { fn, a: t + ms }); return id; },
            annuler: id => { taches.delete(id); },
            avancer: ms => { t += ms; for (const [id, x] of [...taches]) if (x.a <= t) { taches.delete(id); x.fn(); } },
            enAttente: () => taches.size }; };
        const attente = (promesse, h) => { let fini = null; const p = E.attendre(promesse, { programmer: h.programmer, annuler: h.annuler }).then(r => { fini = r; return r; }); return { p, fini: () => fini }; };
        const rendre = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };      // laisse passer les micro-tâches

        // 1. l'état rendu à temps (à +500 ms) : il est servi, le minuteur est annulé
        {
            const h = horloge(); let resoudre; const etat = new Promise(r => { resoudre = r; });
            const a = attente(etat, h);
            h.avancer(500); await rendre(); H.v('7. à temps : l\'attente n\'est pas finie tant que l\'état n\'a pas répondu', a.fini(), null);
            resoudre({ etatEstime: 'EX', etatConfiance: 'moyenne', defautsVus: [], ms: 500, cause: null });
            const r = await a.p;
            H.v('7. à temps : l\'état rendu est servi, sans cause ; le minuteur est annulé (aucun reste)', [r.etatEstime, r.etatConfiance, r.cause, h.enAttente()], ['EX', 'moyenne', null, 0]);
        }
        // 2. l'état en retard : l'identification (déjà rendue) sort à +2 000 ms, l'état est nul de cause « delai » ; l'appel n'est ni repris ni annulé (il peut finir plus tard sans rien changer)
        {
            const h = horloge(); let resoudre; const etat = new Promise(r => { resoudre = r; });
            const a = attente(etat, h);
            h.avancer(1999); await rendre(); H.v('7. en retard : à +1 999 ms l\'attente dure encore', a.fini(), null);
            h.avancer(1); const r = await a.p;
            H.v('7. en retard : à +2 000 ms l\'attente sort, état nul, cause « delai »', [r.etatEstime, r.etatConfiance, r.defautsVus, r.cause, r.ms], [null, null, null, 'delai', 2000]);
            const lecture = { name: 'Tropius', number: '001', etatEstime: 'NM', etatConfiance: 'haute', defautsVus: ['neuf'] };
            E.fusionner(lecture, r);
            H.v('7. en retard : l\'état de la lecture n\'est JAMAIS repris ; nom et numéro intacts ; cause gardée', [lecture.etatEstime, lecture.etatConfiance, lecture.name, lecture.number, lecture.etatCause], [null, null, 'Tropius', '001', 'delai']);
            resoudre({ etatEstime: 'EX', etatConfiance: 'haute', defautsVus: [], ms: 9000, cause: null });
            await rendre(); H.v('7. en retard : l\'état arrivé après coup ne change pas ce qui a été rendu', [lecture.etatEstime, lecture.etatConfiance], [null, null]);
        }
        // 3. l'état en erreur : l'appel d'état ne rejette jamais (état nul de sa cause), l'attente le rend tout de suite, l'identification est intacte
        {
            const h = horloge();
            const etat = E.estimerEtat({ images: ['u'], modele: 'm', journal: muet, appeler: async () => { throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }); } });
            const a = attente(etat, h); const r = await a.p;
            H.v('7. en erreur : l\'attente rend sans attendre (aucun temps écoulé), état nul de cause « panne », minuteur annulé', [r.etatEstime, r.cause, h.enAttente()], [null, 'panne', 0]);
            const lecture = { name: 'Tropius', number: '001', etatEstime: 'NM', etatConfiance: 'haute' };
            E.fusionner(lecture, r);
            H.v('7. en erreur : l\'identification est inchangée (nom, numéro)', [lecture.name, lecture.number, lecture.etatEstime], ['Tropius', '001', null]);
        }
        H.v('7. le délai est de 2 000 ms', E.DELAI_ETAT_MS, 2000);
    }

    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
