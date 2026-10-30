/* Export Excel (.xlsx) via SheetJS — « Export par patient » (NOM-PRÉNOM abrégés, RPSS, Mémo, Commentaire)
   ou « Export par anonyme » (P1, P2…). */
(function () {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');
  const date = (ts) => { const d = new Date(ts); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
  const heure = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const minutes = (ms) => Math.round(ms / 6000) / 10;
  const arrondi = (x) => (x == null ? '' : Math.round(x * 10) / 10);
  // Colonne « Patient » de l'export par patient : 3 premières lettres du NOM - 3 premières lettres du PRÉNOM (au plus)
  const trois = (s) => String(s || '').toUpperCase().replace(/[^A-ZÀ-ÖØ-Ý]/g, '').slice(0, 3);
  const nomCourt = (d) => [trois(d.nom3), trois(d.prenom2)].filter(Boolean).join('-');

  function exporterExcel({ debut, fin, anonyme, libelle }) {
    const S = window.Store;
    const st = window.Stats.calculer({ debut, fin });
    const dansPeriode = (ts) => ts >= debut && ts < fin;

    // Pseudonymes stables P1, P2… pour l'export anonymisé
    const pseudos = new Map();
    const patient = (d) => {
      if (!anonyme) return nomCourt(d);
      const k = d.rpss || S.codePatient(d) || d.id;
      if (!pseudos.has(k)) pseudos.set(k, `P${pseudos.size + 1}`);
      return pseudos.get(k);
    };
    const identite = (d) => (anonyme ? { Patient: patient(d) } : { RPSS: d.rpss, Patient: patient(d) });
    // Mémo et Commentaire, propres à chaque intervention (textes libres, pouvant contenir des informations
    // identifiantes) : retirés de l'export anonymisé ; pour un dossier, ceux de ses interventions mis bout à bout
    const joindre = (segs, c) => segs.map((s) => s[c]).filter(Boolean).join(' / ');
    const notes = (segs) => (anonyme ? {} : { 'Mémo': joindre(segs, 'memo'), Commentaire: joindre(segs, 'commentaire') });

    const sollicitations = st.sollicitations.map(({ d, s, typeJour, tranche }) => ({
      Date: date(s.debut), Heure: heure(s.debut), 'Jour d\'astreinte': typeJour, Tranche: tranche,
      Semaine: Rules.cleSemaine(s.debut), 'Médecin': s.medecin,
      'Établissement': d.etab, Antenne: d.antenne, ...identite(d), ...notes([s]),
      'Durée de l\'appel (min)': minutes(S.dureeSegment(s)),
    }));

    const dossiers = [];
    const segments = [];
    S.dossiersActifs().forEach((d) => {
      const segs = d.segments.filter((s) => dansPeriode(s.debut)).sort((a, b) => a.debut - b.debut);
      if (!segs.length) return;
      const ref = `D${dossiers.length + 1}`;
      dossiers.push({
        'Réf.': ref, Semaine: Rules.cleSemaine(segs[0].debut), 'Début': `${date(segs[0].debut)} ${heure(segs[0].debut)}`,
        'Établissement': d.etab, Antenne: d.antenne, ...identite(d), ...notes(segs),
        'Appels reçus': segs.filter((s) => s.type === 'Appel reçu').length, 'Nb de temps': segs.length,
        'Durée totale (min)': minutes(segs.reduce((t, s) => t + S.dureeSegment(s), 0)),
        'Médecin(s)': [...new Set(segs.map((s) => s.medecin).filter(Boolean))].join(', '),
      });
      segs.forEach((s) => segments.push({
        'Réf. dossier': ref, Type: s.type, Date: date(s.debut), 'Début': heure(s.debut),
        Fin: s.fin == null ? 'en cours' : heure(s.fin), 'Durée (min)': minutes(S.dureeSegment(s)),
        'Médecin': s.medecin, Note: s.note, Antenne: d.antenne, Patient: patient(d), ...notes([s]),
      }));
    });

    const effectifs = [];
    Object.entries(S.state.semaines).sort().forEach(([cle, sem]) => {
      const b = Rules.bornesSemaine(cle);
      if (b.debut >= fin || b.fin <= debut) return;
      Object.entries(sem.effectifs).forEach(([k, n]) => {
        const [etab, antenne] = k.split('|');
        effectifs.push({ Semaine: cle, 'Établissement': etab, Antenne: antenne, 'Patients présents': n, 'Note de couverture': sem.note });
      });
    });

    const ligneStat = (c, niveau) => ({
      Niveau: niveau, 'Établissement': c.etab || c.nom, Antenne: c.etab ? c.nom : '',
      Sollicitations: c.sollic, Dossiers: c.dossiers, Patients: c.nbPatients, 'Temps (min)': minutes(c.temps),
      'Patients présents (Σ semaines)': c.effectif, 'Sollic. pour 10 patients': arrondi(c.ratio),
      Jour: c.Jour, Nuit: c.Nuit, Semaine: c.Semaine, Samedi: c.Samedi, Dimanche: c.Dimanche, 'Férié': c['Férié'],
    });
    const statsLignes = [...st.etabs.map((c) => ligneStat(c, 'Établissement')),
      ...st.antennes.map((c) => ligneStat(c, 'Antenne')), ligneStat(st.total, 'Total')];

    const jours = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
    const horaires = st.heatmap.map((ligne, i) => {
      const o = { Jour: jours[i] };
      ligne.forEach((n, h) => { o[`${pad(h)}h`] = n; });
      return o;
    });

    // Plages continues déclarées : temps non couvert par une intervention = travail transversal
    const interventions = S.dossiersActifs().flatMap((d) => d.segments.map((s) => [s.debut, s.fin == null ? Date.now() : s.fin]));
    const transversal = (S.state.plages || []).filter((p) => p.fin > debut && p.debut < fin).sort((a, b) => a.debut - b.debut)
      .map((p) => {
        const t = Rules.tempsPlages(interventions, [[p.debut, p.fin]], p.debut, p.fin);
        return {
          'Début': `${date(p.debut)} ${heure(p.debut)}`, Fin: `${date(p.fin)} ${heure(p.fin)}`,
          'Durée de la plage (min)': minutes(p.fin - p.debut), 'Plages W continu (min)': minutes(t.transversal),
        };
      });

    const wb = XLSX.utils.book_new();
    const ajouter = (nom, lignes) => {
      const ws = XLSX.utils.json_to_sheet(lignes.length ? lignes : [{ Information: 'Aucune donnée sur la période' }]);
      const entetes = Object.keys(lignes[0] || { Information: '' });
      ws['!cols'] = entetes.map((h) => ({ wch: Math.min(40, Math.max(h.length + 2, 10)) }));
      XLSX.utils.book_append_sheet(wb, ws, nom);
    };
    ajouter('Sollicitations', sollicitations);
    ajouter('Dossiers', dossiers);
    ajouter('Temps détaillés', segments);
    ajouter('Effectifs', effectifs);
    ajouter('Stats établissements', statsLignes);
    ajouter('Horaires', horaires);
    ajouter('Plages W continu', transversal);

    const nomFichier = `astreinte_${libelle}_${anonyme ? 'anonyme' : 'patient'}.xlsx`;
    XLSX.writeFile(wb, nomFichier);
    return nomFichier;
  }

  window.Export = { exporterExcel };
})();
