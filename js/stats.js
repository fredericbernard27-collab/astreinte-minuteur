/* Calcul des statistiques sur une période [debut, fin[. */
(function () {
  'use strict';

  const NON_RENSEIGNE = 'Non renseigné';
  const TYPES_JOUR = ['Semaine', 'Samedi', 'Dimanche', 'Férié'];

  function compteurVide(nom) {
    return {
      nom, sollic: 0, dossiers: 0, patients: new Set(), temps: 0, effectif: 0,
      Jour: 0, Nuit: 0, Semaine: 0, Samedi: 0, Dimanche: 0, 'Férié': 0,
      // Tableau « Par établissement et antenne » : intervalles de temps des interventions (réunis ensuite, sans doublon)
      intervalles: [],
      npatients: null,
    };
  }

  const longueur = (intervalles) => intervalles.reduce((t, [a, b]) => t + b - a, 0);

  // Temps d'intervalles réparti par type de journée d'astreinte (coupure chaque jour à 9 h 00) : samedi, dimanche ou férié
  function tempsParJour(intervalles) {
    const res = { samedi: 0, dimFerie: 0 };
    intervalles.forEach(([a, b]) => {
      for (let x = a; x < b;) {
        const { jour } = Rules.jourAstreinte(x);
        const y = Math.min(b, new Date(jour.getFullYear(), jour.getMonth(), jour.getDate() + 1, 9).getTime());
        const tj = Rules.typeJour(x);
        if (tj === 'Samedi') res.samedi += y - x;
        else if (tj === 'Dimanche' || tj === 'Férié') res.dimFerie += y - x;
        x = y;
      }
    });
    return res;
  }

  /* Tranches horaires (heures de début et de fin, durée en heures) : le temps y est réparti selon les heures
     réellement passées dans chacune (19 h 50 → 20 h 20 : 10 min en 9h-20h, 20 min en 20h-24h), si bien que la somme
     des trois tranches égale le temps total. */
  const TRANCHES = [['jour', 9, 20], ['soir', 20, 24], ['nuit', 0, 9]];
  function tempsParTranche(intervalles) {
    const res = { jour: 0, soir: 0, nuit: 0 };
    intervalles.forEach(([a, b]) => {
      for (const j = new Date(new Date(a).setHours(0, 0, 0, 0)); j.getTime() < b; j.setDate(j.getDate() + 1)) {
        TRANCHES.forEach(([k, h1, h2]) => {
          const x = Math.max(a, new Date(j.getFullYear(), j.getMonth(), j.getDate(), h1).getTime());
          const y = Math.min(b, new Date(j.getFullYear(), j.getMonth(), j.getDate(), h2).getTime());
          if (y > x) res[k] += y - x;
        });
      }
    });
    return res;
  }
  /* Carte « Horaires d'interventions » : temps des interventions (Appel reçu, Reprise…, sans doublon) par jour de la
     semaine (lundi = 0) et par heure d'horloge, en ms, cumulé sur la période. */
  function tempsParHeure(intervalles) {
    const res = Array.from({ length: 7 }, () => Array(24).fill(0));
    Rules.reunir(intervalles).forEach(([a, b]) => {
      for (let x = a; x < b;) {
        const dt = new Date(x);
        const y = Math.min(b, new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), dt.getHours() + 1).getTime());
        res[(dt.getDay() + 6) % 7][dt.getHours()] += y - x;
        x = y;
      }
    });
    return res;
  }
  const ecart = (a, b) => Object.fromEntries(Object.keys(a).map((k) => [k, a[k] - b[k]]));

  function finaliser(c) {
    c.nbPatients = c.patients.size;
    c.ratio = c.effectif > 0 ? (c.sollic / c.effectif) * 10 : null;
    c.reunis = Rules.reunir(c.intervalles);
    c.tempsInstances = longueur(c.reunis);   // temps des interventions, sans doublon si elles se chevauchent
    c.jours = tempsParJour(c.reunis);
    c.tranches = tempsParTranche(c.reunis);
    return c;
  }

  // cible : '' (tout), 'Etab' ou 'Etab|Antenne' — filtre de la carte de chaleur
  function calculer({ debut, fin, cible = '' }) {
    const S = window.Store;
    const etat = S.state;
    const dansPeriode = (ts) => ts >= debut && ts < fin;
    const parEtab = new Map();
    const parAntenne = new Map();
    const total = compteurVide('Total');
    const heatmap = Array.from({ length: 7 }, () => Array(24).fill(0));
    const intervallesCible = [];   // interventions de la cible de la carte des horaires (temps par heure)
    const medecins = new Map();
    const sollicitations = [];
    let nbDossiers = 0;
    // Dénominations patients : NOM + PREN distincts ; chaque dossier encore sans nom compte pour une (comme le Cumul)
    const dossiersPeriode = [];   // pour compter les patients (Rules.patients) et les dossiers sans antenne
    const maintenant = Date.now();
    let premier = Infinity;   // début de la première intervention de la période (période « Tout »)

    // Effectifs : somme des semaines qui chevauchent la période
    Object.entries(etat.semaines).forEach(([cle, sem]) => {
      const b = Rules.bornesSemaine(cle);
      if (b.debut >= fin || b.fin <= debut) return;
      Object.entries(sem.effectifs || {}).forEach(([k, n]) => {
        const [etab, antenne] = k.split('|');
        n = Number(n) || 0;
        obtenir(parEtab, etab).effectif += n;
        obtenir(parAntenne, k, antenne, etab).effectif += n;
        total.effectif += n;
      });
    });

    function obtenir(map, cle, nom = cle, etab) {
      if (!map.has(cle)) map.set(cle, Object.assign(compteurVide(nom), etab ? { etab } : {}));
      return map.get(cle);
    }

    S.dossiersActifs().forEach((d) => {
      const segs = d.segments.filter((s) => dansPeriode(s.debut));
      if (!segs.length) return;
      nbDossiers++;
      dossiersPeriode.push(d);
      const etab = d.etab || NON_RENSEIGNE;
      const antenne = d.antenne || NON_RENSEIGNE;
      const cleA = `${etab}|${antenne}`;
      const cE = obtenir(parEtab, etab);
      const cA = obtenir(parAntenne, cleA, antenne, etab);
      const cibles = [cE, cA, total];
      const patient = d.rpss || S.codePatient(d) || d.id;
      const temps = segs.reduce((t, s) => t + S.dureeSegment(s), 0);
      const correspondCible = !cible || cible === etab || cible === cleA;

      cibles.forEach((c) => {
        c.dossiers++; c.patients.add(patient); c.temps += temps;
      });

      segs.forEach((s) => {
        // Temps = ce qui est déjà écoulé (comme le Cumul du bandeau)
        premier = Math.min(premier, s.debut);
        const finS = Math.min(s.fin == null ? maintenant : s.fin, maintenant);
        if (finS > s.debut) {
          cibles.forEach((c) => c.intervalles.push([s.debut, finS]));
          if (correspondCible) intervallesCible.push([s.debut, finS]);
        }
        if (s.medecin || s.type === 'Appel reçu') {
          const m = medecins.get(s.medecin || NON_RENSEIGNE) || { sollic: 0, temps: 0 };
          m.temps += S.dureeSegment(s);
          if (s.type === 'Appel reçu') m.sollic++;
          medecins.set(s.medecin || NON_RENSEIGNE, m);
        }
        if (s.type !== 'Appel reçu') return;
        const tj = Rules.typeJour(s.debut);
        const tr = Rules.tranche(s.debut);
        cibles.forEach((c) => { c.sollic++; c[tj]++; c[tr]++; });
        if (correspondCible) {
          const dt = new Date(s.debut);
          heatmap[(dt.getDay() + 6) % 7][dt.getHours()]++;
        }
        sollicitations.push({ ts: s.debut, d, s, typeJour: tj, tranche: tr });
      });
    });

    const etabs = [...parEtab.values()].map(finaliser);
    const antennes = [...parAntenne.values()].map(finaliser);
    // Ordre : référentiel d'abord, puis « Non renseigné »
    const ordre = [];
    etat.config.etablissements.forEach((e) => { ordre.push(e.nom); Rules.antennesDe(e).forEach((a) => ordre.push(`${e.nom}|${a}`)); });
    const rang = (k) => { const i = ordre.indexOf(k); return i < 0 ? 999 : i; };
    etabs.sort((a, b) => rang(a.nom) - rang(b.nom));
    antennes.sort((a, b) => rang(`${a.etab}|${a.nom}`) - rang(`${b.etab}|${b.nom}`));

    finaliser(total);

    /* Npatients : patients présents saisis pour la semaine d'astreinte du 1er jour de la période (J1) ;
       antenne → son effectif, établissement → somme de ses antennes, total → somme de tout. */
    const j1 = debut > 0 ? debut : (premier < Infinity ? premier : maintenant);
    const cleJ1 = Rules.cleSemaine(j1);
    const effJ1 = (etat.semaines[cleJ1] && etat.semaines[cleJ1].effectifs) || {};
    const somme = (filtre) => Object.entries(effJ1).filter(([k]) => filtre(k)).reduce((t, [, n]) => t + (Number(n) || 0), 0);
    const nOuRien = (n) => (n > 0 ? n : null);
    antennes.forEach((a) => { a.npatients = nOuRien(somme((k) => k === `${a.etab}|${a.nom}`)); });
    etabs.forEach((e) => { e.npatients = nOuRien(somme((k) => k.split('|')[0] === e.nom)); });
    total.npatients = nOuRien(somme(() => true));
    // Nombre de jours écoulés de la période (décimal) : du 1er jour jusqu'à maintenant, ou jusqu'à la fin si elle est passée.
    // En heures d'horloge : une semaine qui contient un changement d'heure compte 7 jours, pas 7,04
    const bout = Math.min(maintenant, fin);
    const decalage = (new Date(j1).getTimezoneOffset() - new Date(bout).getTimezoneOffset()) * 60000;
    const nbJours = Math.max(0, (bout - j1 + decalage) / 864e5);
    // Nombre de samedis, et de dimanches ou jours fériés (journées d'astreinte 9 h → 9 h), commencés dans la période :
    // une semaine avec un dimanche et un férié = 2 ; un mois = 4 ou 5 dimanches + les fériés
    const nbJoursType = { samedi: 0, dimFerie: 0 };
    for (let x = j1; x < bout;) {
      const { jour } = Rules.jourAstreinte(x);
      const tj = Rules.typeJour(x);
      if (tj === 'Samedi') nbJoursType.samedi++;
      else if (tj === 'Dimanche' || tj === 'Férié') nbJoursType.dimFerie++;
      x = new Date(jour.getFullYear(), jour.getMonth(), jour.getDate() + 1, 9).getTime();
    }

    /* Travail transversal (plages continues déclarées, dans la période) : temps non couvert par une intervention.
       Temps total = interventions + transversal, sans doublon de mesure. */
    const plages = (etat.plages || []).map((p) => [Math.max(p.debut, debut), Math.min(p.fin, fin)]).filter(([a, b]) => b > a);
    const combine = Rules.reunir([...total.reunis, ...plages]);
    total.tempsTotal = longueur(combine);
    total.joursTotal = tempsParJour(combine);
    total.tranchesTotal = tempsParTranche(combine);
    const transversal = {
      temps: total.tempsTotal - total.tempsInstances,
      jours: ecart(total.joursTotal, total.jours),
      tranches: ecart(total.tranchesTotal, total.tranches),
    };

    sollicitations.sort((a, b) => a.ts - b.ts);

    return {
      TRANCHES, total, nbDossiers, transversal,
      nbDenominations: new Set(Rules.patients(dossiersPeriode, (d) => S.debutDossier(d)).values()).size,
      nbSansAntenne: dossiersPeriode.filter((d) => !d.antenne).length, semaineJ1: cleJ1, nbJours, nbJoursType, etabs, antennes, heatmap,
      tempsHoraires: tempsParHeure(intervallesCible), sollicitations,
      medecins: [...medecins.entries()].map(([nom, v]) => ({ nom, ...v })).sort((a, b) => b.sollic - a.sollic),
      TYPES_JOUR,
    };
  }

  window.Stats = { calculer, NON_RENSEIGNE, TYPES_JOUR };
})();
