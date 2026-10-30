/* Export / import de toutes les données en CSV (séparateur « ; », UTF-8, lisible par Excel).
   Une ligne par temps (segment) avec son Mémo et son Commentaire, les informations du dossier étant répétées ;
   une ligne « Plage » par plage continue déclarée (travail transversal) ; plus une ligne par effectif
   et par note de semaine. Le même fichier se relit à l'import, y compris après passage dans Excel.
   Utilisable dans le navigateur et dans Node (tests). */
(function (global) {
  'use strict';

  // Motifs, Texte, Propositions, Hors astreinte et Pertinence ne font plus partie de l'application (v1.29.0) :
  // un ancien fichier qui les contient se relit toujours, ces colonnes étant ignorées
  const COLONNES = ['Ligne', 'Dossier', 'Créé le', 'Modifié le', 'Clos', 'HAD', 'Antenne', 'RPSS', 'Nom', 'Prénom', 'Mémo', 'Commentaire',
    'Temps', 'Type', 'Début', 'Fin', 'Médecin', 'Note', 'Semaine', 'Effectif', 'Note semaine'];

  const pad = (n) => String(n).padStart(2, '0');
  const dateTexte = (ts) => {
    if (ts == null || ts === '') return '';
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  // Identifiant stable pour une ligne ajoutée à la main (sans n° de dossier) : réimporter le même fichier
  // ne crée pas de doublon (empreinte FNV-1a du nom, du prénom et de l'heure de début)
  const empreinte = (texte) => {
    let h = 0x811c9dc5;
    for (const c of texte) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
    return `csv${h.toString(36)}`;
  };

  /* ---------- Export ---------- */
  const champ = (v) => {
    const s = v == null ? '' : String(v);
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  function exporter(etat) {
    const lignes = [];
    const ligne = (o) => lignes.push(COLONNES.map((c) => champ(o[c])).join(';'));
    (etat.dossiers || []).filter((d) => !d.supprime && d.segments && d.segments.length).forEach((d) => {
      [...d.segments].sort((a, b) => a.debut - b.debut).forEach((s) => ligne({
        Ligne: 'Temps', Dossier: d.id, 'Créé le': dateTexte(d.creeLe), 'Modifié le': dateTexte(d.majLe),
        Clos: d.clos ? 'oui' : 'non', HAD: d.etab, Antenne: d.antenne, RPSS: d.rpss, Nom: d.nom3, 'Prénom': d.prenom2, 'Mémo': s.memo, Commentaire: s.commentaire,
        Temps: s.id, Type: s.type, 'Début': dateTexte(s.debut), Fin: dateTexte(s.fin),
        'Médecin': s.medecin, Note: s.note,
      }));
    });
    (etat.plages || []).slice().sort((a, b) => a.debut - b.debut).forEach((p) => ligne({
      Ligne: 'Plage', Temps: p.id, 'Modifié le': dateTexte(p.majLe), 'Début': dateTexte(p.debut), Fin: dateTexte(p.fin),
    }));
    Object.entries(etat.semaines || {}).sort(([a], [b]) => a.localeCompare(b)).forEach(([cle, sem]) => {
      Object.entries(sem.effectifs || {}).forEach(([k, n]) => {
        const [had, ...antenne] = k.split('|');
        ligne({ Ligne: 'Effectif', Semaine: cle, 'Modifié le': dateTexte(sem.majLe), HAD: had, Antenne: antenne.join('|'), Effectif: n });
      });
      if (sem.note) ligne({ Ligne: 'Semaine', Semaine: cle, 'Modifié le': dateTexte(sem.majLe), 'Note semaine': sem.note });
    });
    return `﻿${COLONNES.join(';')}\r\n${lignes.join('\r\n')}\r\n`;
  }

  /* ---------- Import ---------- */
  // Découpe un CSV (guillemets, retours à la ligne dans une case) avec le séparateur donné
  function decouper(texte, sep) {
    const lignes = [];
    let ligne = [], val = '', guill = false;
    for (let i = 0; i < texte.length; i++) {
      const c = texte[i];
      if (guill) {
        if (c === '"' && texte[i + 1] === '"') { val += '"'; i++; }
        else if (c === '"') guill = false;
        else val += c;
      } else if (c === '"') guill = true;
      else if (c === sep) { ligne.push(val); val = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && texte[i + 1] === '\n') i++;
        ligne.push(val); lignes.push(ligne); ligne = []; val = '';
      } else val += c;
    }
    if (val !== '' || ligne.length) { ligne.push(val); lignes.push(ligne); }
    return lignes.filter((l) => l.some((x) => x.trim() !== ''));
  }

  const cleColonne = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

  // « 2026-10-27 21:10:00 » (export) ou « 27/10/2026 21:10 » (après enregistrement par Excel)
  function lireDate(s) {
    const t = String(s || '').trim();
    let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) return new Date(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
    m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) {
      const an = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      return new Date(an, m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
    }
    return null;
  }
  const oui = (s) => /^(oui|vrai|true|1|x)$/i.test(String(s || '').trim());

  // Renvoie { dossiers, semaines, plages, nbTemps, ignorees } ; lève une erreur si le fichier n'est pas reconnu
  function lire(texte) {
    texte = String(texte).replace(/^﻿/, '');
    const entete = texte.split(/\r?\n/, 1)[0];
    const sep = [';', '\t', ','].sort((a, b) => entete.split(b).length - entete.split(a).length)[0];
    const lignes = decouper(texte, sep);
    if (lignes.length < 1) throw new Error('Fichier vide');
    const index = {};
    lignes[0].forEach((nom, i) => { index[cleColonne(nom)] = i; });
    if (index.debut == null && index.semaine == null) throw new Error('Colonnes « Début » ou « Semaine » introuvables');
    const v = (l, nom) => { const i = index[cleColonne(nom)]; return i == null ? '' : String(l[i] == null ? '' : l[i]).trim(); };

    const dossiers = new Map();
    const semaines = {};
    const semaine = (cle) => semaines[cle] || (semaines[cle] = { effectifs: {}, note: '', majLe: 0 });
    let nbTemps = 0;
    const ignorees = [];
    const plages = [];

    lignes.slice(1).forEach((l, i) => {
      const n = i + 2;   // numéro de ligne dans le fichier (pour le message d'erreur)
      const type = cleColonne(v(l, 'Ligne') || 'Temps');
      const modif = lireDate(v(l, 'Modifié le'));
      if (type === 'effectif') {
        const cle = v(l, 'Semaine'), nb = Number(v(l, 'Effectif').replace(',', '.'));
        if (!cle || !v(l, 'HAD') || Number.isNaN(nb)) { ignorees.push(n); return; }
        const sem = semaine(cle);
        sem.effectifs[`${v(l, 'HAD')}|${v(l, 'Antenne') || v(l, 'HAD')}`] = Math.max(0, Math.round(nb));
        sem.majLe = Math.max(sem.majLe, modif || 0);
        return;
      }
      if (type === 'plage') {
        const debut = lireDate(v(l, 'Début')), fin = lireDate(v(l, 'Fin'));
        if (debut == null || fin == null || fin <= debut) { ignorees.push(n); return; }
        plages.push({ id: v(l, 'Temps') || empreinte(`plage|${debut}|${fin}`), debut, fin, majLe: modif || Date.now() });
        return;
      }
      if (type === 'semaine') {
        if (!v(l, 'Semaine')) { ignorees.push(n); return; }
        const sem = semaine(v(l, 'Semaine'));
        sem.note = v(l, 'Note semaine');
        sem.majLe = Math.max(sem.majLe, modif || 0);
        return;
      }
      const debut = lireDate(v(l, 'Début'));
      if (debut == null) { ignorees.push(n); return; }
      const fin = lireDate(v(l, 'Fin'));
      const id = v(l, 'Dossier') || empreinte(`${v(l, 'Nom').toUpperCase()}|${v(l, 'Prénom').toUpperCase()}|${debut}`);
      let d = dossiers.get(id);
      if (!d) {
        d = {
          id, creeLe: lireDate(v(l, 'Créé le')) || debut, majLe: modif || Date.now(), supprime: false,
          clos: oui(v(l, 'Clos')), etab: v(l, 'HAD'), antenne: v(l, 'Antenne'), rpss: v(l, 'RPSS'),
          nom3: v(l, 'Nom').toUpperCase(), prenom2: v(l, 'Prénom').toUpperCase(), memo: '',
          commentaire: '', segments: [],
        };
        dossiers.set(id, d);
      }
      d.segments.push({
        id: v(l, 'Temps') || empreinte(`${id}|${debut}|${d.segments.length}`), type: v(l, 'Type') || 'Appel reçu', debut,
        fin: fin == null ? null : Math.max(fin, debut), medecin: v(l, 'Médecin'), note: v(l, 'Note'),
        memo: v(l, 'Mémo'), commentaire: v(l, 'Commentaire'),   // propres à chaque intervention (v1.11)
      });
      nbTemps++;
    });
    return { dossiers: [...dossiers.values()], semaines, plages, nbTemps, ignorees };
  }

  const Csv = { exporter, lire, COLONNES };
  if (typeof module !== 'undefined' && module.exports) module.exports = Csv;
  else global.Csv = Csv;
})(typeof window !== 'undefined' ? window : globalThis);
