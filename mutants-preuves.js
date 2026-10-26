// Mutants du fournisseur « prv » : chaque mutant retire UNE garde ; le banc concerné doit ÉCHOUER. Un mutant qui survit = une garde que rien ne garde.
//   node mutants-preuves.js                       (sortie : tués / survivants)
//   node mutants-preuves.js --groupe=preuves      (ne rejoue que les modules dont le nom contient le fragment)
// Le module est réécrit SUR PLACE, le temps d'un essai, puis RESTAURÉ (try/finally, et un contrôle final de l'identité du texte) : ne pas le lancer pendant qu'un autre processus lit ces fichiers.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const BANC = ['test-preuves.js'];
const GROUPES = [
    { module: 'collecte-cartes/preuves.js', bancs: BANC, mutants: [
        ['édition locale élargie à un autre idExpansion', "Object.freeze({ 2361: 'fr', 3354: 'fr' })", "Object.freeze({ 2361: 'fr', 3354: 'fr', 9999: 'fr' })"],
        ['idExpansion lu comme texte (« 2361 » = fr)', "if (Number.isInteger(idExpansion) && Object.hasOwn(", "if (Object.hasOwn("],
        ['source par unité retirée du descripteur', "nomsInterdits: NOMS_INTERDITS, parUnite: true });", "nomsInterdits: NOMS_INTERDITS, parUnite: false });"],
        ['validation d\'un autre que le coordinateur', "if (v.par !== 'coordinateur')", "if (false)"],
        ['validation à un autre sha256 acceptée', "if (v.sha256 !== e.sha256) {", "if (false) {"],
        ['entrée sans validation acceptée', "if (!vs) { refus.push({ idProduct: id, motif: 'sans-validation' }); continue; }", "if (!vs) { appariees.push({ entree: e, validation: null }); continue; }"],
        ['validation d\'une autre règle acceptée', "if (v.regle !== e.regle) {", "if (false) {"],
        ['validation fantôme acceptée sans trace', "if (!parId.has(id)) refus.push(", "if (false) refus.push("],
        ['doublon de manifeste accepté', "if (Number.isInteger(id) && parId.get(id).length > 1) {", "if (false) {"],
        ['validations contradictoires acceptées', "if (new Set(vs.map(v => `${v.sha256}|${v.regle}`)).size > 1) {", "if (false) {"],
        ['entrée mal formée acceptée', "if (forme) { refus.push(", "if (false) { refus.push("],
        ['preuve-lue : langue non comparée', "else if (lu.langue !== langueProduit) motifs.push('langue-differente');", ""],
        ['preuve-lue : langue du tirage inconnue acceptée', "if (langueProduit == null) motifs.push('langue-du-tirage-inconnue');", "if (false) motifs.push('langue-du-tirage-inconnue');"],
        ['preuve-lue : numéro lu non comparé', "else if (J.cleNumero(n) !== J.cleNumero(np)) motifs.push('numero-different');", ""],
        ['preuve-lue : total non exigé', "if (n === '' || t === '') motifs.push('numero-ou-total-absent');", "if (n === '') motifs.push('numero-ou-total-absent');"],
        ['preuve-lue : tampon non comparé', "if (norm(lu.tampon) !== norm(produit?.tamponnee)) motifs.push('tampon-different');", ""],
        ['preuve-lue : contradictions ignorées', "if (!Array.isArray(entree.contradictions) || entree.contradictions.length > 0) motifs.push('contradictions');", ""],
        ['preuve-lue : marques non exigées', "if (!marques) motifs.push('marques-vides');", ""],
        ['preuve-lue : produit sans numéro, attendu non nul accepté', "motifs.push('numero-attendu-non-null');", "void 0;"],
        ['deux-sources : même hôte accepté', "if (norm(s.hote) === norm(entree.hote)) return non('meme-hote');", ""],
        ['deux-sources : même site accepté', "if (racineDe(s.hote) === racineDe(entree.hote)) return non('meme-site');", ""],
        ['deux-sources : même sha256 accepté', "if (s.sha256 === entree.sha256) return non('meme-sha256');", ""],
        ['deux-sources : mêmes octets acceptés', "if (octets.a.equals(octets.b)) return non('memes-octets');", ""],
        ['deux-sources : contradictions ignorées', "if (!Array.isArray(entree.contradictions) || entree.contradictions.length > 0) return non('contradictions');", ""],
        ['deux-sources : la règle d\'image ignorée', "if (r?.decision !== 'ecrire') return non(r?.motif ?? r?.decision ?? 'indecidable');", ""],
        ['deux-sources : la lecture de la seconde ignorée', "tirageDeLecture(s.lu)", "tirageDeLecture(entree.lu)"],
        ['deux-sources : tampon du produit non transmis', "tampon: produit?.tamponnee ?? null },", "tampon: null },"],
        ['deux-sources : seconde absente acceptée', "if (!objet(s)) return non('seconde-absente');", ""],
        ['cache : sha256 du manifeste non comparé', "if (s !== entree.sha256) return non(", "if (false) return non("],
        ['cache : fiche du cache non comparée (cache altéré)', "if (c.meta?.sha256 && c.meta.sha256 !== s) return non(", "if (false) return non("],
        ['cache : fichier cité non relu', "if (sha256De(f) !== entree.sha256) return non('fichier-different'", "if (false) return non('fichier-different'"],
        ['cache : image trop petite acceptée', "if (l.statut === 'trop-petit') return non('trop-petit'", "if (false) return non('trop-petit'"],
        ['cache : forme inattendue acceptée', "if (j.statut === 'forme-inattendue') return non(", "if (false) return non("],
        ['unités : fiche inconnue acceptée', "if (!Array.isArray(tous) || !tous.length) {", "if (false) {"],
        ['unités : plus de deux produits sur la fiche acceptés', "if (tous.length !== 2) {", "if (false) {"],
        ['unités : produit de la fiche sans entrée validée accepté', "if (!tous.every(id => ids.includes(id))) {", "if (false) {"],
        ['unités : sha256 différents dans une paire acceptés', "if (new Set(membres.map(m => m.entree.sha256)).size > 1) {", "if (false) {"],
        ['unités : variante non nommée acceptée', "if (paires.some(x => !x)) {", "if (false) {"],
        ['unités : paire qui ne désigne pas les produits de la fiche acceptée', "if (tous.length !== 2 || !tous.includes(normale) || !tous.includes(holo)) return null;", "if (tous.length !== 2) return null;"],
        ['unités : paire normale = holo acceptée', "Number.isInteger(holo) || normale === holo) return null;", "Number.isInteger(holo)) return null;"],
        ['unités : source de la paire non nommée acceptée', "if (!objet(v) || !texte(v.source) || !objet(v.paire)) return null;", "if (!objet(v) || !objet(v.paire)) return null;"],
        ['unités : deux entrées qui disent deux paires acceptées', "if (new Set(paires.map(x => `${x.normale}|${x.holo}`)).size > 1) {", "if (false) {"],
        ['tour 1 : texte libre de l\'agent écrit (lu non énuméré)', "lu = luEnumere(e.lu), marques", "lu = e.lu, marques"],
        ['tour 1 : produit sans numéro, nom non comparé', "if (!memeNomQueLeProduit(lu.nom, produit?.nomEn)) motifs.push('nom-different');", ""],
        ['tour 1 : nom comparé = toujours vrai', "return J.clesNom(lu).some(k => cles.has(k));", "return true;"],
        ['tour 1 : marque qui nomme une source acceptée', "else if (lu.marques.some(nommeUneSource)) motifs.push('marque-nomme-une-source');", ""],
        ['tour 1 : seconde lecture non exigée', "if (!objet(s.lu)) return non('seconde-sans-lecture');", "if (!objet(s.lu)) s.lu = entree.lu;"],
        ['tour 1 : seconde lecture non jugée', "if (!l2.ok) return non(", "if (false) return non("],
        ['tour 1 : écart de famille non dit', "ecartDeFamille: obj.famille !== nom,", "ecartDeFamille: false,"],
        ['unités : langue ou tampon différents dans une paire acceptés', "if (new Set(membres.map(m => `${m.langue}|${norm(m.produit.tamponnee)}`)).size > 1) {", "if (false) {"],
        ['unités : marquage holo / non holo oublié', "partage = { partageeHoloNonHolo: true, produitsPartages: [...ids], paire: paires[0] };", "partage = null;"],
        ['trous : doublon accepté', "if (vus.has(t.idProduct)) throw", "if (false) throw"],
        ['trous : date non exigée', "if (!le) throw new Error(`trou ${t.idProduct} : date valide exigée`);", ""],
        ['trous : produit qui reçoit un visuel gardé', "(recus.has(t.idProduct) ? ecartes.push(", "(false ? ecartes.push("]
    ] },
    { module: 'collecte-cartes/recolte-commun.js', bancs: BANC, mutants: [
        ['source par unité : la langue de la source au lieu de celle de l\'unité', "if (!parUnite) return LANGUE; if (typeof l", "if (true) return LANGUE; if (typeof l"],
        ['source par unité : tirage attendu ignoré', "(set.tirage ?? set.region) !== p.u.tirageAttendu);", "false);"],
        ['source par unité : champs de preuve de l\'entrée oubliés', "{ ...champsDe(SRC, u, 'champsEntree'), set:", "{ set:"],
        ['source par unité : champs de preuve du document oubliés', "{ ...champsDe(SRC, u, 'champsDocument'), _id:", "{ _id:"],
        ['source par unité : preuve de langue de la source', "languePreuve: languePreuveDe(SRC, u), ...(tampon", "languePreuve: SRC.LANGUE_PREUVE, ...(tampon"],
        ['source par unité : clé de la décision sans la langue', "const cle = SRC.cleR2(u.slugSet, u.numero, u.carteId, langueDe(SRC, u));", "const cle = SRC.cleR2(u.slugSet, u.numero, u.carteId);"],
        ['source par unité : tampon de l\'unité ignoré', "const tamponDe = (SRC, u) => (SRC.parUnite ? (u.tampon || undefined) : SRC.tampon(u.slugSet));", "const tamponDe = (SRC, u) => SRC.tampon(u.slugSet);"]
    ] },
    { module: 'collecte-cartes/comblement.js', bancs: BANC, mutants: [
        ['motif variantes-indiscernables retiré', ", 'absente-chez-la-source', 'variantes-indiscernables']);", ", 'absente-chez-la-source']);"]
    ] },
    { module: 'collecte-cartes/seuils-images.js', bancs: BANC, mutants: [
        ['prv sans plancher de 200 px', "Object.freeze(['pokemon.com', 'ctr', 'prv'])", "Object.freeze(['pokemon.com', 'ctr'])"]
    ] },
    { module: 'collecte-cartes/langue-visuel.js', bancs: BANC, mutants: [
        ['règle de langue prv retirée (un rejeu effacerait la langue)', "if (im.source === 'prv') return [", "if (false) return ["]
    ] },
    { module: 'retirer-visuels-recolte.js', bancs: BANC, mutants: [
        ['prv absent du retrait', "prv: () => require('./collecte-cartes/preuves').SRC });", "});"],
        ['prv refusé en argument du retrait', "(ppr|tcs|scx|pmk|prv)$/];", "(ppr|tcs|scx|pmk)$/];"]
    ] },
    { module: 'collecteur-images-preuves.js', bancs: BANC, mutants: [
        ['écriture hors lot-additif.js', "if (['--ecrire', '--trous'].includes(mode)) require('./collecte-cartes/images-empruntees').garderSousLot(", "if (false) require('./collecte-cartes/images-empruntees').garderSousLot("],
        ['plan périmé accepté', "if (perime) throw new Error(", "if (false) throw new Error("],
        ['--ecrire sans --attendu', "if (['--ecrire', '--trous'].includes(mode) && !a('attendu'))", "if (false)"],
        ['--trous sans --attendu (écriture sans compte)', "if (Number(attendu) !== reel) {", "if (false) {"],
        ['argument inconnu accepté', "if (inconnus.length) return", "if (false) return"],
        ['mode multiple accepté', "if (modes.length !== 1) return", "if (false) return"],
        ['--attendu hors écriture accepté', "if (a('attendu') && !['--ecrire', '--trous'].includes(mode))", "if (false)"],
        ['tour 1 : écart de famille ni dit ni compté', "if (manifeste.ecartDeFamille) avertissements.push(", "if (false) avertissements.push("],
        ['tirage du set non comparé à l\'état', "if ((set.tirage ?? set.region) !== E.langue) {", "if (false) {"],
        ['produit joint à plusieurs fiches accepté', "if (new Set(ls.map(cleLigne)).size > 1) {", "if (false) {"],
        ['cache non relu', "if (!c1.ok) {", "if (false) {"],
        ['seconde image du cache non relue', "if (!c2.ok) {", "if (false) {"],
        ['règle non appliquée', "if (!ev.ok) {", "if (false) {"],
        ['produit absent de l\'état accepté', "if (!E) {", "if (false) {"],
        ['trous écrits pour un produit qui reçoit un visuel', "const recus = new Set((plan.unites ?? []).flatMap(u => u.produits ?? []));", "const recus = new Set();"],
        ['plan sans empreintes accepté', "if (!emp || typeof emp !== 'object' || !Object.keys(emp).length) return", "if (false) return"]
    ] }
];
let tues = 0, total = 0;
const survivants = [];
const filtres = process.argv.slice(2).filter(a => a.startsWith('--groupe=')).map(a => a.slice(9));
for (const G of GROUPES) {
    if (filtres.length && !filtres.some(f => G.module.includes(f))) continue;
    const fichier = path.join(__dirname, G.module);
    const original = fs.readFileSync(fichier, 'utf8');
    try {
        for (const [nom, de, vers] of G.mutants) {
            total++;
            if (!original.includes(de)) { console.log(`❌ motif introuvable pour « ${nom} » (${G.module})`); process.exitCode = 2; continue; }
            fs.writeFileSync(fichier, original.replace(de, vers));
            let tue = false;
            for (const banc of G.bancs) {
                const r = spawnSync(process.execPath, [banc], { cwd: __dirname, encoding: 'utf8', timeout: 240000, env: { ...process.env, ARRETS_HOTES_DOSSIER: path.join(require('os').tmpdir(), 'arrets-mutants-prv') } });
                if (r.status !== 0) { tue = true; break; }
            }
            if (tue) tues++; else survivants.push(`${G.module} : ${nom}`);
        }
    } finally { fs.writeFileSync(fichier, original); }
    if (fs.readFileSync(fichier, 'utf8') !== original) { console.error(`🔴 ${G.module} n'est PAS restauré`); process.exitCode = 3; }
}
console.log(`mutants : ${tues} tués sur ${total}${survivants.length ? ` · SURVIVANTS :\n   ${survivants.join('\n   ')}` : ''}`);
if (survivants.length && !process.exitCode) process.exitCode = 1;
