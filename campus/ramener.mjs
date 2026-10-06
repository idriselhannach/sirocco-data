/**
 * Ramener une salle dans son batiment.
 *
 * Les salles viennent des plans d'etage, cales sur la maquette a quelques
 * metres pres. C'est assez pour une aile large, pas pour une aile etroite
 * qui borde une cour : releve le 5 octobre 2026, D224 et D226 tombaient
 * dans le patio de l'aile D, E20 et E127 trois metres hors de l'aile E —
 * et leurs punaises se plantaient dans la cour ou dans l'herbe.
 *
 * Une salle hors de tout batiment de l'ecole, mais a moins de `MAX_M`
 * d'un mur, est donc posee juste derriere ce mur, a `INTERIEUR_M` dedans.
 * Plus loin, on la laisse : c'est un lieu dehors, ou une erreur a voir.
 */

/** Jusqu'ou l'on va chercher le mur le plus proche, en metres. */
const MAX_M = 15;
/** A quelle distance derriere le mur on pose la salle. */
const INTERIEUR_M = 1.5;

/** Le point est-il dans l'anneau ? (lancer de rayon) */
export function dedans([x, y], anneau) {
  let dans = false;
  for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
    const [xi, yi] = anneau[i];
    const [xj, yj] = anneau[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dans = !dans;
  }
  return dans;
}

/** Dans le batiment : dans son contour, et hors de ses cours. */
export function dansLeBatiment(p, batiment) {
  return dedans(p, batiment.c) && !(batiment.t ?? []).some((cour) => dedans(p, cour));
}

/**
 * La salle, ramenee dans le batiment de l'ecole le plus proche si elle
 * en est sortie de peu. Rend `null` si elle y est deja, ou trop loin.
 */
export function ramener(p, batiments) {
  const ecole = batiments.filter((b) => b.campus);
  if (ecole.some((b) => dansLeBatiment(p, b))) return null;
  let meilleur = null;
  for (const batiment of ecole) {
    for (const anneau of [batiment.c, ...(batiment.t ?? [])]) {
      for (let i = 0; i < anneau.length; i++) {
        const [x1, y1] = anneau[i];
        const [x2, y2] = anneau[(i + 1) % anneau.length];
        const dx = x2 - x1;
        const dy = y2 - y1;
        const long = Math.hypot(dx, dy);
        if (!long) continue;
        const t = Math.max(0, Math.min(1, ((p[0] - x1) * dx + (p[1] - y1) * dy) / long ** 2));
        const q = [x1 + t * dx, y1 + t * dy];
        const distance = Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (distance > MAX_M || (meilleur && distance >= meilleur.distance)) continue;
        /* De quel cote du mur est l'interieur : on essaie les deux. */
        for (const sens of [1, -1]) {
          const r = [q[0] + (sens * -dy * INTERIEUR_M) / long, q[1] + (sens * dx * INTERIEUR_M) / long];
          if (dansLeBatiment(r, batiment)) {
            meilleur = { distance, p: r.map((v) => Math.round(v * 10) / 10) };
            break;
          }
        }
      }
    }
  }
  return meilleur;
}

/**
 * Ce qui est dehors par son nom : une cour, un parvis. Une salle est
 * toujours dedans, mais un « Patio » est justement la cour d'un batiment
 * — le rentrer dans les murs le mettrait au mauvais endroit.
 */
const DEHORS = /^(patio|parvis|terrasse|jardin|cour)\b/i;

/** Chaque lieu ramene s'il le faut ; rend aussi la liste de ceux qui ont bouge. */
export function ramenerLesLieux(lieux, batiments) {
  const bouges = [];
  const ramenes = lieux.map((lieu) => {
    if (DEHORS.test(lieu.nom)) return lieu;
    const deplace = ramener(lieu.p, batiments);
    if (!deplace) return lieu;
    bouges.push({ nom: lieu.nom, de: lieu.p, vers: deplace.p, metres: deplace.distance });
    return { ...lieu, p: deplace.p };
  });
  return { ramenes, bouges };
}
