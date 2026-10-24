'use strict';
// ETAT-TITRE — le module v2/identifier/etat-photos.js, SANS réseau ni base : la lecture de la réponse du modèle, l'appel (corps, images, signal), les pannes qui rendent un état nul sans lever, la fusion dans la lecture.
// Le banc par les vraies routes (test-etat-titre.js) prouve le comportement de bout en bout ; celui-ci fixe les cas limites de la pièce.
const H = require('./_harnais');
const E = require('../identifier/etat-photos');
const muet = { error: () => { } };
const rep = contenu => ({ data: { choices: [{ message: { content: contenu } }] } });

(async () => {
    // ── la lecture de la réponse : jamais une valeur inventée
    H.v('1. une réponse propre', E.analyserReponse('{"etatEstime":"EX","etatConfiance":"haute","defautsVus":["blanchiment bord gauche"]}'), { etatEstime: 'EX', etatConfiance: 'haute', defautsVus: ['blanchiment bord gauche'] });
    H.v('1. des clôtures markdown et des majuscules/minuscules inversées sont lues', E.analyserReponse('```json\n{"etatEstime":"gd","etatConfiance":"MOYENNE","defautsVus":[]}\n```'), { etatEstime: 'GD', etatConfiance: 'moyenne', defautsVus: [] });
    H.v('1. un état hors barème (« Mint », « MT » est au barème) et une confiance hors énumération deviennent null, champ par champ', E.analyserReponse('{"etatEstime":"Mint","etatConfiance":"certaine","defautsVus":[]}'), { etatEstime: null, etatConfiance: null, defautsVus: [] });
    H.v('1. « MT » est un état du barème', E.analyserReponse('{"etatEstime":"MT","etatConfiance":"haute","defautsVus":[]}').etatEstime, 'MT');
    H.v('1. des défauts qui ne sont pas une liste de chaînes : null (jamais [] qui dirait « aucun défaut vu »)', E.analyserReponse('{"etatEstime":"NM","etatConfiance":"haute","defautsVus":"rien"}').defautsVus, null);
    H.v('1. les défauts sont bornés (10 défauts, 200 caractères) et vidés des chaînes vides', E.analyserReponse(JSON.stringify({ etatEstime: 'NM', etatConfiance: 'haute', defautsVus: [...Array(15).fill('x'.repeat(300)), '  ', 4] })).defautsVus.map(x => x.length), Array(10).fill(200));
    for (const [nom, x] of [['pas du JSON', 'bonjour'], ['un tableau', '[1]'], ['null', 'null'], ['pas une chaîne', undefined], ['un nombre', 5]]) H.v(`1. ${nom} : null`, E.analyserReponse(x), null);

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

    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
