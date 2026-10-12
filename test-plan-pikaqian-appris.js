// node test-plan-pikaqian-appris.js — la MESURE passive (plan-pikaqian-appris.js) sur données FABRIQUÉES : un faux `db` en lecture, des fiches écrites par le
// récepteur lui-même (jugerPage + ecrireFiche), la vraie `planifier` du collecteur. Aucune base, aucun réseau.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const R = require('./recepteur-pikaqian');
const PL = require('./plan-pikaqian-appris');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};

const UUID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tuile = (n, code, num, nom) => `<a href="/cards/${UUID(n)}"><img alt="${nom}" src="https://images.pikaqian.com/${code}/${UUID(n)}.webp"/><h2>${nom}</h2><p>${code}<!-- --> · ${num}</p></a>`;
const OFFICIELLE = 'https://cdn.pokemon-tcg.cn/cards/0123456789abcdef0123456789abcdef.png';
const flux = (n, o) => `<script>"{\\"id\\",\\"${UUID(n)}\\",\\"native_image_url\\",\\"https://pokipair.example/x.png\\",\\"we_chat_image_url\\",\\"${o}\\"}"</script>`;
const HTML = `<html><body>${tuile(1, 'cs1bc', '001', 'Pikachu')}${tuile(2, 'cs1bc', '002', 'Raichu')}${tuile(3, 'cs1bc', '003', 'Pichu')}${flux(2, OFFICIELLE)}</body></html>`;
const SLUG = 'Dynamax-Clash-Flame';

// le faux `db` : seulement collection(nom).find(filtre, opts).toArray() — ce que `planifier` du collecteur appelle
function fauxDb({ lignes, cartes, sets = { [SLUG]: { _id: SLUG, tirage: 'zh-hans' } } }) {
    const appels = [];
    return {
        appels,
        collection: nom => ({
            findOne: async filtre => { appels.push({ nom, filtre, op: 'findOne' }); if (nom !== 'sets') throw new Error(`findOne inattendu ${nom}`); return sets[filtre._id] ?? null; },
            countDocuments: async filtre => { appels.push({ nom, filtre, op: 'count' }); return lignes.filter(l => l.slugSet === filtre.slugSet).length; },
            find: filtre => ({
                toArray: async () => {
                    appels.push({ nom, filtre });
                    if (nom === 'cartes_produits') return lignes.filter(l => l.slugSet === filtre.slugSet);
                    if (nom === 'cartes') return cartes.filter(c => filtre._id.$in.includes(c._id));
                    throw new Error(`collection inattendue ${nom}`);
                }
            })
        })
    };
}
const lignes = [
    { slugSet: SLUG, carteId: 'A', idProduct: 1, numeroFiche: '001' },   // Pikachu : tuile 001 « Pikachu » -> APPARIÉ
    { slugSet: SLUG, carteId: 'B', idProduct: 2, numeroFiche: '002' },   // Raichu : APPARIÉ, adresse officielle déclarée
    { slugSet: SLUG, carteId: 'C', idProduct: 3, numeroFiche: '010' },   // numéro absent de la page
    { slugSet: SLUG, carteId: 'D', idProduct: 4, numeroFiche: '003' },   // Mew au n° 003, la tuile dit Pichu : nom différent
    { slugSet: SLUG, carteId: 'E', idProduct: 5, numeroFiche: '005' },   // déjà servie : n'est pas un trou
    { slugSet: SLUG, carteId: 'F', idProduct: 6, numeroFiche: null },    // sans numéro
    { slugSet: 'Autre-Set', carteId: 'Z', idProduct: 9, numeroFiche: '001' }
];
const cartes = [
    { _id: 'A', nomEn: 'Pikachu', images: [] }, { _id: 'B', nomEn: 'Raichu', images: [] }, { _id: 'C', nomEn: 'Zubat', images: [] },
    { _id: 'D', nomEn: 'Mew', images: [] }, { _id: 'E', nomEn: 'Eevee', images: [{ set: SLUG, numero: '005' }] }, { _id: 'F', nomEn: 'Ditto', images: [] }
];

(async () => {
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-pk-'));
    // les fiches sont écrites par le récepteur lui-même : le format lu est celui qu'il écrit
    const aucunAttendu = { attendu: () => null };
    const j = R.jugerPage(JSON.stringify({ url: 'https://pikaqian.com/sets/cs1bc', html: HTML }), aucunAttendu);
    verifier('(préalable) le récepteur accepte la page fabriquée', j.statut, 200);
    const nom1 = R.ecrireFiche(dossier, { ...j.fiche, le: '2026-10-12T10:00:00.000Z' });
    // une version PLUS RÉCENTE de la même page : c'est elle seule que la mesure lit
    R.ecrireFiche(dossier, { ...j.fiche, le: '2026-10-12T11:00:00.000Z' });
    // un fichier abîmé, un code sans ligne de table, un fichier étranger
    fs.writeFileSync(path.join(dossier, 'abime--20261012T120000Z.json'), '{pas du json');
    const sansLigne = R.jugerPage(JSON.stringify({ url: 'https://pikaqian.com/sets/zz-inconnu', html: HTML.replaceAll('cs1bc', 'zz-inconnu') }), aucunAttendu);
    R.ecrireFiche(dossier, sansLigne.fiche);
    fs.writeFileSync(path.join(dossier, 'notes.txt'), 'rien');

    const db = fauxDb({ lignes, cartes });
    const M = await PL.mesurer({ dossier, db, attendu: () => null });
    verifier('dénominateurs : fichiers .json 4, illisibles 1 (abîmé), anciens écartés 1 (la version la plus récente de cs1bc seule est lue)', [M.fichiers, M.illisibles.length, M.anciens], [4, 1, 1]);
    const s = M.sets.find(x => x.code === 'cs1bc');
    verifier('le set : slug de la table de production', s?.slug, SLUG);
    verifier('tuiles 3, au code 3, produits 6, trous 5 (la carte déjà servie n\'en est pas un)', [s.tuiles, s.auCode, s.produits, s.trous], [3, 3, 6, 5]);
    verifier('appariés 2', s.apparies, 2);
    verifier('restes par motif', s.restes, { 'absente-de-la-source': 1, 'nom-different': 1, 'sans-numero': 1 });
    verifier('appariés dont la page déclare l\'adresse officielle : 1 (Raichu) ; adresses officielles dans la page : 1', [s.appariesAvecOfficielle, s.officiellesDeclarees], [1, 1]);
    verifier('les cartes d\'un autre set ne sont pas lues (le filtre est le slug du set)', db.appels.filter(a => a.nom === 'cartes_produits').every(a => a.filtre.slugSet === SLUG), true);
    const inconnu = M.sets.find(x => x.code === 'zz-inconnu');
    verifier('un code sans ligne dans pikaqian-sets.js : nommé, pas mesuré', [inconnu?.slug, inconnu?.motif], [null, 'code sans ligne dans collecte-cartes/pikaqian-sets.js']);
    verifier('totaux : trous 5, appariés 2, avec adresse officielle 1',[M.totaux.trous, M.totaux.apparies, M.totaux.appariesAvecOfficielle], [5, 2, 1]);
    const texte = PL.formater(M);
    verifier('l\'impression porte les dénominateurs (fichiers lus, trous, appariés, restes, officielles)', ['fichier(s)', 'trous', 'apparié(s)', 'absente-de-la-source', 'officielle'].every(w => texte.includes(w)), true);
    verifier('« apparié » ne s\'imprime jamais seul : chaque occurrence est suivie de « téléchargement non décidé »', (texte.match(/apparié\(s\)/gi) || []).length >= 2 && (texte.match(/apparié\(s\)(?!, téléchargement non décidé)/gi) || []).length === 0, true);
    verifier('… ni en majuscules sèches', /APPARIÉS/.test(texte), false);
    verifier('la sortie dit ce qui n\'est pas rejoué : « seuil de taille non jugé : jugé au téléchargement » avec le seuil de la source', /seuil de taille non jugé : jugé au téléchargement \(largeur de l'original ≥ \d+ px\)/.test(texte), true);
    // les gardes du collecteur sont rejouées par SES fonctions : la ligne de table, le tirage du set, les produits joints
    const sansSet = await PL.mesurer({ dossier, db: fauxDb({ lignes, cartes, sets: {} }), attendu: () => null });
    const rs = sansSet.sets.find(x => x.code === 'cs1bc');
    verifier('set absent de la base : REFUSÉ par le collecteur (refuse-set), jamais compté dans les appariés', [rs.refuse?.etat, /absent de la base/.test(rs.refuse?.motif || ''), rs.apparies, sansSet.totaux.apparies, sansSet.totaux.refuses], ['refuse-set', true, undefined, 0, 1]);
    const mauvaisTirage = await PL.mesurer({ dossier, db: fauxDb({ lignes, cartes, sets: { [SLUG]: { _id: SLUG, tirage: 'jp' } } }), attendu: () => null });
    verifier('tirage en base différent de la table : REFUSÉ (refuse-set)', [mauvaisTirage.sets.find(x => x.code === 'cs1bc').refuse?.etat, /tirage jp en base, zh-hans dans la table/.test(mauvaisTirage.sets.find(x => x.code === 'cs1bc').refuse?.motif || '')], ['refuse-set', true]);
    const sansProduit = await PL.mesurer({ dossier, db: fauxDb({ lignes: [], cartes }), attendu: () => null });
    verifier('aucun produit joint : REFUSÉ (refuse-set), pas « 0 trou »', [sansProduit.sets.find(x => x.code === 'cs1bc').refuse?.etat, /aucun produit joint/.test(sansProduit.sets.find(x => x.code === 'cs1bc').refuse?.motif || '')], ['refuse-set', true]);
    verifier('… l\'impression nomme le refus du collecteur', /REFUSÉ PAR LE COLLECTEUR \(refuse-set\)/.test(PL.formater(sansProduit)), true);
    // une page partielle ou incomplète, même arrivée dans le dossier par un autre chemin, ne fait jamais compter de « absente-de-la-source »
    const d4 = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-pk4-'));
    R.ecrireFiche(d4, { ...j.fiche, le: '2026-10-12T13:00:00.000Z', ancres: 40 });
    const M4 = await PL.mesurer({ dossier: d4, db, attendu: () => null });
    verifier('fichier dont les ancres dépassent les tuiles : non mesuré (page partielle)', [M4.sets.length, /page partielle ou forme changée : 40 ancres, 3 tuiles/.test(M4.illisibles[0]?.motif || '')], [0, true]);
    const M5 = await PL.mesurer({ dossier, db });
    verifier('table de production : cs1bc = 315 tuiles relevées, le fichier de 3 tuiles est non mesuré (page incomplète)', [M5.sets.some(x => x.code === 'cs1bc'), M5.illisibles.some(x => /page incomplète : 3 tuiles lues, 315/.test(x.motif))], [false, true]);
    fs.rmSync(d4, { recursive: true, force: true });

    // une fiche dont le verdict ne tient plus à la relecture (tuiles trafiquées) n'est pas mesurée
    const mauvaise = { ...j.fiche, le: '2026-10-12T12:00:00.000Z', code: 'csv10c', url: 'https://pikaqian.com/sets/csv10c' };
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-pk2-'));
    R.ecrireFiche(d2, mauvaise);    // ses tuiles sont au code cs1bc, pas csv10c : la relecture par verdictDePage refuse
    const M2 = await PL.mesurer({ dossier: d2, db, attendu: () => null });
    verifier('fiche dont les tuiles ne sont pas au code du set : ignorée, avec sa raison', [M2.sets.length, M2.illisibles.length, /code/.test(M2.illisibles[0]?.motif || '')], [0, 1, true]);
    // un dossier vide : le dit, ne rend pas un « tout va bien »
    const d3 = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-pk3-'));
    const M3 = await PL.mesurer({ dossier: d3, db, attendu: () => null });
    verifier('dossier sans fichier appris : fichiers 0, et l\'impression le dit', [M3.fichiers, /aucune page apprise/.test(PL.formater(M3))], [0, true]);

    // ── la ligne de commande : argument inconnu = refus avant toute connexion ; variable de lecture absente = refus
    const cli = (args, env = {}) => spawnSync(process.execPath, [path.join(__dirname, 'plan-pikaqian-appris.js'), ...args], { encoding: 'utf8', timeout: 20000, env: { ...process.env, MONGODB_CARTES_LECTURE_URI: '', ...env } });
    const c1 = cli(['--inconnu']);
    verifier('CLI argument inconnu : code 2', c1.status, 2);
    const c2 = cli([`--dossier=${dossier}`]);
    verifier('CLI sans MONGODB_CARTES_LECTURE_URI : refus (code 1), la variable est nommée, aucune connexion', [c2.status, /MONGODB_CARTES_LECTURE_URI/.test(c2.stderr + c2.stdout)], [1, true]);
    verifier('CLI : le module n\'importe aucune URI d\'écriture (le fichier ne cite pas MONGODB_URI ni MONGODB_CARTES_URI)', /MONGODB_(CARTES_)?URI\b/.test(fs.readFileSync(path.join(__dirname, 'plan-pikaqian-appris.js'), 'utf8').replace(/MONGODB_(CARTES_)?LECTURE_URI/g, '')), false);

    for (const d of [dossier, d2, d3]) fs.rmSync(d, { recursive: true, force: true });
    console.log(`\n${ok} réussis, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('❌ banc interrompu :', e); process.exit(1); });
