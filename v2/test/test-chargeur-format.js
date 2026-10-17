'use strict';
// COTES-VISUELS, tour 1 — le FORMAT du fichier compact (un seul module, deux voies : le calcul dans l'API et le fichier précalculé hors de l'API). Aller-retour exact ; un fichier abîmé,
// tronqué, mal scellé ou MENTEUR (hachage refait sur un contenu incohérent) est REFUSÉ, jamais servi. Pas de base, pas de réseau.
const zlib = require('zlib');
const H = require('./_harnais');
const F = require('../chargeur/format');
const { creerConstructeur } = require('../chargeur/version');

const CM = 'https://www.cardmarket.com/fr/Pokemon/Products/Singles';
const brut = (id, o = {}) => ({ idProduct: id, vignette: { cle: `vignettes/${id}.webp`, w: 200, h: 279 }, grande: { cle: `cartes/${id}.webp`, w: 600, h: 838 }, visuel: 'du-set', mention: null,
    idMetacard: null, numero: null, rarete: null, total: null, variante: null, setNom: null, lien: null, ...o });
function fabriquer(n = 50) {
    const b = creerConstructeur();
    for (let i = n; i >= 1; i--) b.entree(brut(3000 + i, { idMetacard: 800 + (i % 5), numero: String(i), rarete: i % 3 ? 'Rare' : null, total: '102', setNom: i % 2 ? 'Pokémon — Éclat' : 'Base Set', lien: i % 4 ? `${CM}/Base-Set/P${i}` : null,
        visuel: i % 10 === 0 ? 'substitut' : 'du-set', mention: i % 10 === 0 ? 'Visuel d\'un autre tirage' : null }));
    for (let i = 1; i <= 10; i++) b.lien(i % 2 ? 'Set-A' : 'S-P/ID', `${100 + i}|${i % 3 ? String(i).padStart(3, '0') : '-'}`, [3000 + i, 3000 + i + 10]);
    return b.finir(new Date('2026-10-11T10:00:00.000Z'));
}
const refuse = (fn) => { try { fn(); return null; } catch (e) { return e.name === 'FormatInvalide' ? e.motif : `AUTRE:${e.name}`; } };

(async () => {
    const v = fabriquer();
    const brutF = F.serialiser(v, { entree: { sets: 2, cartes: 40, produits: 60, catalogue: 70 } });
    const w = F.deserialiser(brutF);
    H.v('aller-retour : 50 entrées identiques une à une', Array.from({ length: 50 }, (_, k) => JSON.stringify(w.entree(3001 + k)) === JSON.stringify(v.entree(3001 + k))).filter(Boolean).length, 50);
    H.v('   métacartes, fiches de deux sets (clé « - » comprise), comptes, date : identiques', [JSON.stringify([800, 801, 802, 803, 804].map(m => w.produitsDeMetacarte(m))) === JSON.stringify([800, 801, 802, 803, 804].map(m => v.produitsDeMetacarte(m))),
        JSON.stringify(w.fichesDuSet('S-P/ID')) === JSON.stringify(v.fichesDuSet('S-P/ID')), JSON.stringify(w.fichesDuSet('Set-A')) === JSON.stringify(v.fichesDuSet('Set-A')),
        JSON.stringify(w.comptes) === JSON.stringify(v.comptes), w.chargeLe.toISOString()], [true, true, true, true, '2026-10-11T10:00:00.000Z']);
    H.v('   les dénominateurs d\'entrée voyagent dans l\'en-tête', F.lireEntete(brutF).entree, { sets: 2, cartes: 40, produits: 60, catalogue: 70 });
    H.vrai('   la version relue est gelée', Object.isFrozen(w));
    H.vrai('   déterministe : sérialiser deux fois la même version donne les mêmes octets', F.serialiser(v, { entree: { sets: 2, cartes: 40, produits: 60, catalogue: 70 } }).equals(brutF));

    // compression
    const gz = await F.compresser(brutF);
    H.vrai(`compression : ${brutF.length} octets → ${gz.length} (gzip)`, gz.length < brutF.length);
    H.v('   décompresser puis relire : identique', (await F.decompresser(gz)).equals(brutF), true);
    let bombe = null; try { await F.decompresser(zlib.gzipSync(Buffer.alloc(5e6)), { max: 1e6 }); } catch (e) { bombe = e.name; }
    H.v('   une archive qui dépasse la taille permise est refusée (borne de décompression)', bombe, 'FormatInvalide');
    let pasGzip = null; try { await F.decompresser(Buffer.from('pas du gzip')); } catch (e) { pasGzip = e.name; }
    H.v('   un fichier qui n\'est pas du gzip est refusé', pasGzip, 'FormatInvalide');

    // refus : abîmé, tronqué, mal scellé
    const corps = brutF.subarray(0, brutF.length - 32);
    const retouche = (fn) => { const b = Buffer.from(corps); fn(b); return F.sceller(b); };      // contenu modifié PUIS rescellé : seul un contrôle de STRUCTURE peut le refuser
    const S = F.sections(brutF);
    H.vrai('un octet retourné dans le milieu : refusé (hachage)', refuse(() => { const b = Buffer.from(brutF); b[b.length >> 1] ^= 1; F.deserialiser(b); }) !== null);
    H.vrai('   un octet retourné dans le hachage : refusé', refuse(() => { const b = Buffer.from(brutF); b[b.length - 1] ^= 1; F.deserialiser(b); }) !== null);
    for (const n of [0, 3, 8, 100, brutF.length - 33, brutF.length - 1]) H.vrai(`   tronqué à ${n} octets : refusé`, refuse(() => F.deserialiser(brutF.subarray(0, n))) !== null);
    H.vrai('   magie fausse (rescellé) : refusé', refuse(() => F.deserialiser(retouche(b => { b[0] = 0x58; }))) !== null);
    H.vrai('   numéro de format inconnu (en-tête réécrit, rescellé) : refusé', /format/i.test(refuse(() => { const e = F.lireEntete(brutF); e.format = 99; F.deserialiser(F.reecrireEntete(brutF, e)); }) || ''));
    const echange = nomSection => { const s = S.find(x => x.nom === nomSection); return { s, ok: s !== undefined }; };
    const ids = echange('id');
    H.vrai('   identifiants plus triés (deux échangés, RESCELLÉ) : refusé par la structure', refuse(() => F.deserialiser(retouche(b => { const o = ids.s.debut; const a = b.readInt32LE(o), c = b.readInt32LE(o + 4); b.writeInt32LE(c, o); b.writeInt32LE(a, o + 4); }))) !== null);
    const vig = echange('vig');
    H.vrai('   indice de chaîne hors de la réserve (RESCELLÉ) : refusé par la structure', refuse(() => F.deserialiser(retouche(b => { b.writeInt32LE(999999, vig.s.debut); }))) !== null);
    const numF = echange('fiches.num');
    H.vrai('   indice de numéro de fiche hors de la réserve (RESCELLÉ) : refusé par la structure', refuse(() => F.deserialiser(retouche(b => { b.writeInt32LE(999999, numF.s.debut); }))) !== null);
    const fin = echange('fiches.fin');
    H.vrai('   fin de fiche au-delà des produits (RESCELLÉ) : refusé par la structure', refuse(() => F.deserialiser(retouche(b => { b.writeInt32LE(123456789, fin.s.debut); }))) !== null);
    H.vrai('   en-tête qui ment sur la longueur d\'une section : refusé', refuse(() => { const e = F.lireEntete(brutF); e.sections[0].n += 1000; F.deserialiser(F.reecrireEntete(brutF, e)); }) !== null);
    H.vrai('   section manquante dans l\'en-tête : refusé', refuse(() => { const e = F.lireEntete(brutF); e.sections.pop(); F.deserialiser(F.reecrireEntete(brutF, e)); }) !== null);
    H.v('   les refus sont des FormatInvalide nommés (aucune autre erreur ne s\'échappe)', [refuse(() => F.deserialiser(Buffer.alloc(0))), refuse(() => F.deserialiser(null)), refuse(() => F.deserialiser('texte'))].map(x => typeof x === 'string' && !x.startsWith('AUTRE:')), [true, true, true]);
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
