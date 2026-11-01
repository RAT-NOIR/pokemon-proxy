'use strict';
// GALERIE — la garde de la BASE DÉDIÉE. Une garde qui n'a jamais dit NON n'a pas été vérifiée : elle est jouée sur des environnements FABRIQUÉS (jamais process.env), puis sur des COPIES MUTÉES du module.
// Aucune connexion réelle : `ouvrir` reçoit une fausse fabrique de connexion.
const { ENV_VALIDE, charger, H } = require('./_aide-galerie');
const G = require('../galerie/grappe');
const { lireGalerie } = require('../galerie/config');

const avec = (changements) => { const e = { ...ENV_VALIDE, ...changements }; for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k]; return e; };
const verdict = (g, env) => { const j = g.jugerGrappe(env); return j.ok ? 'OUI' : 'NON'; };

// ═══ 1. le cas légitime dit OUI ═══
H.v('1. la grappe dédiée déclarée, ni production ni cartes ni essai : OUI', verdict(G, ENV_VALIDE), 'OUI');
H.v('   sans nom de base dans l\'adresse, ou avec le nom exact rm_galerie_essai : OUI', [verdict(G, avec({ MONGO_URI_GALERIE: 'mongodb+srv://u:p@cluster0.dedie11.mongodb.net/rm_galerie_essai?retryWrites=true' })), verdict(G, avec({ MONGO_URI_GALERIE: 'mongodb+srv://u:p@cluster0.dedie11.mongodb.net' }))], ['OUI', 'OUI']);
H.v('   la déclaration V2_GALERIE_GRAPPE est facultative (absente : OUI, la garde porte sur les grappes connues)', verdict(G, avec({ V2_GALERIE_GRAPPE: undefined })), 'OUI');
H.v('   la raison d\'un OUI est nulle et l\'adresse jugée est rendue (pour l\'ouverture seule)', [G.jugerGrappe(ENV_VALIDE).grappe, G.jugerGrappe(ENV_VALIDE).raison], ['dedie11.mongodb.net', undefined]);

// ═══ 2. elle dit NON, cas par cas ═══
const NON = [
    ['variable absente', avec({ MONGO_URI_GALERIE: undefined })],
    ['variable vide', avec({ MONGO_URI_GALERIE: '   ' })],
    ['adresse illisible (pas une adresse mongodb)', avec({ MONGO_URI_GALERIE: 'https://exemple.test/' })],
    ['même grappe que MONGODB_URI (production), même nom de base rm_galerie_essai', avec({ MONGO_URI_GALERIE: 'mongodb+srv://u:p@cluster0.prodxx.mongodb.net/rm_galerie_essai', V2_GALERIE_GRAPPE: 'prodxx.mongodb.net' })],
    ['même grappe que MONGODB_URI sous un AUTRE nom d\'hôte de nœud (shard)', avec({ MONGO_URI_GALERIE: 'mongodb://u:p@cluster0-shard-00-00.prodxx.mongodb.net:27017,cluster0-shard-00-01.prodxx.mongodb.net:27017/', V2_GALERIE_GRAPPE: 'prodxx.mongodb.net' })],
    ['même grappe que MONGODB_CARTES_URI', avec({ MONGO_URI_GALERIE: 'mongodb+srv://u:p@cluster0.cartes1.mongodb.net/', V2_GALERIE_GRAPPE: 'cartes1.mongodb.net' })],
    ['même grappe que MONGODB_ESSAI_URI (rm_essai)', avec({ MONGO_URI_GALERIE: 'mongodb+srv://u:p@cluster0.essai11.mongodb.net/rm_galerie_essai', V2_GALERIE_GRAPPE: 'essai11.mongodb.net' })],
    ['même grappe que MONGODB_TEST_URI', avec({ MONGODB_TEST_URI: 'mongodb+srv://u:p@cluster0.tests11.mongodb.net/', MONGO_URI_GALERIE: 'mongodb+srv://u:p@cluster0.tests11.mongodb.net/', V2_GALERIE_GRAPPE: 'tests11.mongodb.net' })],
    ['même grappe qu\'une variable de LECTURE (MONGODB_LECTURE_URI)', avec({ MONGODB_LECTURE_URI: 'mongodb+srv://r:p@cluster0.dedie11.mongodb.net/' })],
    ['même grappe qu\'une variable MONGODB_* que la garde ne connaissait pas (MONGODB_AUTRE_URI)', avec({ MONGODB_AUTRE_URI: 'mongodb+srv://u:p@cluster0.dedie11.mongodb.net/' })],
    ['la même grappe que la production sous un autre nom de base (test)', avec({ MONGO_URI_GALERIE: 'mongodb+srv://u:p@cluster0.prodxx.mongodb.net/test', V2_GALERIE_GRAPPE: 'prodxx.mongodb.net' })],
    ['la grappe dédiée, mais le nom de base de l\'adresse est « test »', avec({ MONGO_URI_GALERIE: 'mongodb+srv://u:p@cluster0.dedie11.mongodb.net/test' })],
    ['la grappe dédiée, mais le nom de base est rm_essai', avec({ MONGO_URI_GALERIE: 'mongodb+srv://u:p@cluster0.dedie11.mongodb.net/rm_essai' })],
    ['la grappe dédiée, mais un nom de base encodé qui se lit « test »', avec({ MONGO_URI_GALERIE: 'mongodb+srv://u:p@cluster0.dedie11.mongodb.net/%74est' })],
    ['grappe déclarée différente de celle de l\'adresse', avec({ V2_GALERIE_GRAPPE: 'autre22.mongodb.net' })],
    ['plusieurs grappes dans l\'adresse', avec({ MONGO_URI_GALERIE: 'mongodb://u:p@a.dedie11.mongodb.net:27017,b.autre22.mongodb.net:27017/' })],
    ['production illisible : on ne peut pas comparer, donc on ne peut pas autoriser', avec({ MONGODB_URI: undefined })],
    ['production présente mais illisible', avec({ MONGODB_URI: 'pas-une-adresse' })],
    ['une variable de grappe connue illisible (MONGODB_CARTES_URI)', avec({ MONGODB_CARTES_URI: 'mongodb://' })]
];
for (const [nom, env] of NON) { const j = G.jugerGrappe(env); H.v(`2. NON — ${nom}`, [j.ok, typeof j.raison === 'string' && j.raison.length > 10], [false, true]); }
H.vrai('   aucune raison n\'imprime une valeur de variable (ni mot de passe ni adresse)', NON.every(([, env]) => { const r = G.jugerGrappe(env).raison || ''; return !/\bu:p\b|mongodb\+srv:\/\/|mongodb:\/\//.test(r); }));
H.v('   dénominateur : ' + NON.length + ' cas qui disent NON', NON.filter(([, env]) => G.jugerGrappe(env).ok).length, 0);

// ═══ 3. la garde de la configuration (cfg.galerie) ═══
H.v('3. V2_GALERIE absent ou ≠ 1 : éteint, ne lève pas', ['', '0', 'true', 'oui', undefined].map(v => { const c = lireGalerie(avec({ V2_GALERIE: v })); return [c.actif, c.pret]; }), Array(5).fill([false, false]));
H.v('   V2_GALERIE=1 avec tout en ordre : actif et prêt', (({ actif, pret, raison }) => [actif, pret, raison])(lireGalerie(ENV_VALIDE)), [true, true, null]);
H.v('   V2_GALERIE=1 et la garde dit NON : actif mais PAS prêt (les routes ne se montent pas), avec sa raison', (c => [c.actif, c.pret, typeof c.raison])(lireGalerie(avec({ MONGO_URI_GALERIE: undefined }))), [true, false, 'string']);
H.v('   V2_GALERIE=1 et le bucket R2 est celui d\'une autre variable : pas prêt', (c => [c.actif, c.pret])(lireGalerie(avec({ V2_GALERIE_R2_BUCKET: 'rat-market-images' }))), [true, false]);
H.v('   une borne illisible rend le lot pas prêt (jamais une valeur par défaut silencieuse)', (c => [c.pret, /V2_JAIME_MAX/.test(c.raison)])(lireGalerie(avec({ V2_JAIME_MAX: 'beaucoup' }))), [false, true]);
H.v('   les bornes par défaut du brief : 8 Mio, 24 Mpx, 30 arts, 5 000 j\'aime, 20 classeurs, 10 signalements par IP et par heure', (c => [c.bornes.octetsMax, c.bornes.pixelsMax, c.bornes.illustrationsMax, c.limites.jaimeMax, c.limites.classeursMax, c.limites.signalementsIpHeure])(lireGalerie(ENV_VALIDE)), [8388608, 24000000, 30, 5000, 20, 10]);
H.vrai('   la configuration ne porte ni adresse ni secret', !/mongodb|secret-essai|u:p/i.test(JSON.stringify(lireGalerie(ENV_VALIDE))));

// ═══ 4. l'OUVERTURE contrôle APRÈS connexion : le nom de base ET la grappe ═══
(async () => {
    const fausse = (dbNom, host) => async () => ({ db: { databaseName: dbNom }, host, close: async () => { fausse.fermees++; } });
    fausse.fermees = 0;
    const essai = async (creer, env = ENV_VALIDE) => { try { const r = await G.ouvrir({ env, creer }); return r.db.databaseName; } catch (e) { return `refus: ${e.message.slice(0, 40)}`; } };
    H.v('4. connexion sur la bonne base et la grappe déclarée : ouverte', await essai(fausse('rm_galerie_essai', 'cluster0-shard-00-00.dedie11.mongodb.net:27017')), 'rm_galerie_essai');
    H.vrai('   connexion qui tombe sur une AUTRE base du même nom de grappe : refusée et fermée', /^refus/.test(await essai(fausse('test', 'cluster0-shard-00-00.dedie11.mongodb.net:27017'))) && fausse.fermees === 1);
    H.vrai('   connexion qui tombe sur une AUTRE grappe (la bonne base mais l\'hôte de la production) : refusée', /^refus/.test(await essai(fausse('rm_galerie_essai', 'cluster0-shard-00-00.prodxx.mongodb.net:27017'))));
    H.vrai('   connexion dont l\'hôte est illisible : refusée (doute = refus)', /^refus/.test(await essai(fausse('rm_galerie_essai', undefined))));
    H.vrai('   l\'ouverture ne tente RIEN quand la garde dit NON (la fabrique n\'est pas appelée)', await (async () => { let appelee = false; const r = await essai(async () => { appelee = true; return {}; }, avec({ MONGO_URI_GALERIE: 'mongodb+srv://u:p@cluster0.prodxx.mongodb.net/', V2_GALERIE_GRAPPE: 'prodxx.mongodb.net' })); return /^refus/.test(r) && !appelee; })());
    H.v('   la fabrique reçoit le nom de base FIXE', await (async () => { let recu; await G.ouvrir({ env: ENV_VALIDE, creer: async (u, o) => { recu = o.dbName; return { db: { databaseName: 'rm_galerie_essai' }, host: 'cluster0-shard-00-00.dedie11.mongodb.net:27017', close: async () => { } }; } }); return recu; })(), 'rm_galerie_essai');

    // ═══ 5. MUTATIONS : retirer le fragment de la garde, la même scène doit DONNER OUI là où le code réel donne NON ═══
    const mutants = [
        ['le contrôle des grappes connues est retiré', [['if (h.some(x => cleDeGrappe(x) === cles[0])) return refus(', 'if (false) return refus(']], avec({ MONGO_URI_GALERIE: 'mongodb+srv://u:p@cluster0.prodxx.mongodb.net/rm_galerie_essai', V2_GALERIE_GRAPPE: 'prodxx.mongodb.net' })],
        ['la grappe déclarée n\'est plus comparée', [['if (declaree && declaree !== cles[0]) return refus(', 'if (false) return refus(']], avec({ V2_GALERIE_GRAPPE: 'autre22.mongodb.net' })],
        ['le nom de base de l\'adresse n\'est plus contrôlé', [["if (base !== '' && base !== BASE_GALERIE) return refus(", 'if (false) return refus(']], avec({ MONGO_URI_GALERIE: 'mongodb+srv://u:p@cluster0.dedie11.mongodb.net/test' })],
        ['la production illisible n\'arrête plus', [['if (!prod.length) return refus(', 'if (false) return refus(']], avec({ MONGODB_URI: undefined })],
        ['la comparaison se fait sur l\'hôte entier au lieu de la grappe (un nœud différent de la même grappe passe)', [['cleDeGrappe(x) === cles[0]', 'x === hotes[0]']], avec({ MONGO_URI_GALERIE: 'mongodb://u:p@cluster0-shard-00-00.prodxx.mongodb.net:27017/', V2_GALERIE_GRAPPE: 'prodxx.mongodb.net' })]
    ];
    for (const [nom, rempl, env] of mutants) {
        const reel = G.jugerGrappe(env).ok, mute = charger('grappe.js', rempl).jugerGrappe(env).ok;
        H.v(`5. MUTANT « ${nom} » : le réel dit NON, la copie mutée dit OUI (la garde mord)`, [reel, mute], [false, true]);
    }
    // l'ouverture : sans le contrôle APRÈS connexion, une connexion sur la mauvaise grappe passerait
    {
        const mut = charger('grappe.js', [['if (!hoteReel.length || hoteReel.some(h => cleDeGrappe(h) !== j.grappe))', 'if (false)']]);
        const reel = await essai(fausse('rm_galerie_essai', 'cluster0-shard-00-00.prodxx.mongodb.net:27017'));
        let mute; try { mute = (await mut.ouvrir({ env: ENV_VALIDE, creer: fausse('rm_galerie_essai', 'cluster0-shard-00-00.prodxx.mongodb.net:27017') })).db.databaseName; } catch (e) { mute = 'refus'; }
        H.v('   MUTANT « le contrôle de la grappe après connexion est retiré » : le réel refuse, le mutant ouvre', [/^refus/.test(reel), mute], [true, 'rm_galerie_essai']);
    }
    H.bilan();
})();
