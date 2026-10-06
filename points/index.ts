import { getDatabase } from 'firebase-admin/database';
import { onValueCreated } from 'firebase-functions/v2/database';
import { logger } from 'firebase-functions';
import { PLAFONDS } from './bareme.js';
import { ouvrirFenetre } from './copresence.js';
import { attribuer, comptePourLaSemaine } from './moteur.js';

/**
 * Les declencheurs du moteur de points.
 *
 * Chacun part d'un fait que le membre ne peut pas fabriquer seul. Le plus
 * important est la presence : elle n'est ecrite que par l'organisateur,
 * scan du billet ou case cochee. **On ne declenche jamais sur
 * l'inscription a un evenement** — s'inscrire ne coute rien et ne prouve
 * rien.
 *
 * Le meme declencheur porte quatre attributions, parce qu'un check-in dit
 * quatre choses a la fois : quelqu'un est venu, il a croise ceux qui
 * etaient deja la, l'organisateur a peut-etre reuni assez de monde, et il
 * a peut-etre accueilli un nouveau.
 */

function db() {
  return getDatabase();
}

interface IndexEvenement {
  serverId?: string;
  organizerId?: string;
}

/** Une sortie spontanee vaut la moitie d'un evenement prepare. */
async function estSpontane(spot: string, eventId: string): Promise<boolean> {
  return Boolean((await db().ref(`events/${spot}/${eventId}/spontane`).get()).val());
}

/** Qui est deja passe a cet evenement, l'arrivant excepte. */
async function dejaPresents(eventId: string, sauf: string): Promise<string[]> {
  const marques = ((await db().ref(`eventAttendance/${eventId}`).get()).val() as Record<
    string,
    unknown
  > | null) ?? {};
  return Object.keys(marques).filter((uid) => uid !== sauf);
}

/** Une paire, rangee toujours dans le meme ordre : la cle est la meme des deux cotes. */
function paire(a: string, b: string): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

/**
 * Ce qu'une presence constatee declenche.
 *
 * Sorti du declencheur pour pouvoir etre appele tel quel par les tests
 * d'emulateur : c'est ici que vivent l'idempotence, les plafonds et
 * l'appariement, donc c'est ici qu'un bug se cacherait.
 */
export async function traiterPresence(eventId: string, uid: string): Promise<void> {
  const index = ((await db().ref(`eventIndex/${eventId}`).get()).val() as IndexEvenement | null) ?? {};
    const spot = index.serverId;
    const organisateur = index.organizerId;
    if (!spot) return;

    /*
      En ligne, on ne s'est pas vu : ni points, ni rencontre, ni fenetre
      pour s'ecrire. La presence cochee reste sur la feuille de
      l'organisateur ; elle ne paie rien. Sans cette garde, quelques amis
      se cocheraient en visio et gagneraient des rencontres qui n'ont pas
      eu lieu.
    */
    if ((await db().ref(`events/${spot}/${eventId}/enLigne`).get()).val() === true) return;

    /* 1. Venir. Une seule fois par evenement — la cle le garantit. */
    await attribuer({
      uid,
      spot,
      motif: 'presence',
      cle: `presence_${eventId}`,
      ref: eventId,
      compteur: 'venus',
    });

    /*
      La nature de la sortie, comptee a part.

      « Touche-a-tout » veut quatre categories differentes, « Foot entre
      Francais » trois sorties sportives : ni l'un ni l'autre ne se lit
      dans le compteur des presences, qui ne sait pas de quoi elles
      etaient faites. Un compteur par categorie suffit, et il ne coute
      qu'une ligne a l'arrivee.
    */
    const categorie = (await db()
      .ref(`events/${spot}/${eventId}/category`)
      .get()).val() as string | null;
    if (categorie) {
      await db()
        .ref(`stats/${uid}/${spot}/parCategorie/${categorie}`)
        .transaction((actuel: number | null) => (actuel ?? 0) + 1);
    }

    const presents = await dejaPresents(eventId, uid);

    /*
      2. Les rencontres.

      On n'apparie l'arrivant qu'avec ceux qui sont deja la : le prochain
      a pointer s'appariera avec lui. Une soiree ne compte donc jamais
      deux fois la meme paire, meme si les gens arrivent en ordre
      disperse.

      Une meme paire ne recompte pas avant trente jours : deux amis qui
      sortent chaque semaine se rencontrent une fois, pas cinquante.
    */
    const maintenant = Date.now();
    let comptees = 0;
    for (const autre of presents) {
      if (comptees >= PLAFONDS.rencontresParEvenement) break;

      const chemin = `rencontres/${spot}/${uid}/${autre}`;
      const connue = ((await db().ref(chemin).get()).val() as
        | { premiereFois?: number; nombre?: number; dernierEvent?: string }
        | null) ?? null;

      const recente = connue?.premiereFois
        ? maintenant - connue.premiereFois < PLAFONDS.memePaireMs
        : false;

      /*
        L'index se tient des deux cotes : chacun lit ses rencontres chez
        lui. Il ne se touche qu'une fois par paire et par evenement — les
        deux presents passent ici, chacun a son pointage, et un
        declencheur rejoue passerait une troisieme fois. Sans cette
        garde, `nombre` comptait deux rencontres la ou il n'y en avait
        qu'une : les points etaient justes, le compteur mentait.
      */
      if (connue?.dernierEvent !== eventId) {
        const ligne = {
          premiereFois: connue?.premiereFois ?? maintenant,
          dernierEvent: eventId,
          nombre: (connue?.nombre ?? 0) + 1,
        };
        await db()
          .ref()
          .update({
            [`rencontres/${spot}/${uid}/${autre}`]: ligne,
            [`rencontres/${spot}/${autre}/${uid}`]: ligne,
          });
      }

      /*
        Sept jours pour s'ecrire librement, meme sans etre amis. La
        fenetre s'ouvre a chaque co-presence, y compris pour une paire
        deja rencontree — c'est la derniere soiree partagee qui compte,
        pas la premiere.
      */
      await ouvrirFenetre(uid, autre);

      if (recente) continue;

      // La cle porte la paire, pas l'evenement : c'est la rencontre qu'on
      // compte, et elle n'a lieu qu'une fois par periode.
      const cle = `rencontre_${paire(uid, autre)}_${Math.floor(maintenant / PLAFONDS.memePaireMs)}`;
      const donne = await attribuer({
        uid, spot, motif: 'rencontre', cle, ref: eventId, compteur: 'rencontres',
      });
      await attribuer({
        uid: autre, spot, motif: 'rencontre', cle, ref: eventId, compteur: 'rencontres',
      });
      if (donne > 0) comptees += 1;
    }

    if (!organisateur || organisateur === uid) return;

    /*
      3. Accueillir un nouveau. Le compte revient a l'organisateur : c'est
      lui qui a ouvert la porte.
    */
    const inscritLe = ((await db().ref(`users/${uid}/createdAt`).get()).val() as number | null) ?? 0;
    if (inscritLe && maintenant - inscritLe < PLAFONDS.nouveauMs) {
      const deja = await comptePourLaSemaine(spot, organisateur, `accueil_${eventId}_`);
      if (deja < PLAFONDS.accueilsParEvenement) {
        await attribuer({
          uid: organisateur,
          spot,
          motif: 'accueil',
          cle: `accueil_${eventId}_${uid}`,
          ref: eventId,
          compteur: 'nouveauxAccueillis',
        });
      }
    }

    /*
      4. Organiser un evenement qui a **eu lieu**.

      Trois presents dont deux autres que l'organisateur : en dessous, ce
      n'est pas une sortie, c'est un rendez-vous. La condition se reteste a
      chaque pointage, et la cle fait que le point ne tombe qu'une fois.
    */
    const tous = await dejaPresents(eventId, '');
    const autresQueLui = tous.filter((membre) => membre !== organisateur);
    if (tous.length >= PLAFONDS.presentsPourOrganiser && autresQueLui.length >= 2) {
      const cetteSemaine = await comptePourLaSemaine(spot, organisateur, 'organisation_');
      if (cetteSemaine < PLAFONDS.organisationsParSemaine) {
        await attribuer({
          uid: organisateur,
          spot,
          motif: 'organisation',
          cle: `organisation_${eventId}`,
          ref: eventId,
          compteur: 'organises',
          // Le geste est plus leger, la recompense aussi.
          ...((await estSpontane(spot, eventId)) ? { montant: 50 } : {}),
        });
      } else {
        logger.info('organisation au plafond hebdomadaire', { organisateur, spot });
      }
  }
}

export const pointsSurPresence = onValueCreated(
  { ref: '/eventAttendance/{eventId}/{uid}', region: 'europe-west1' },
  (evenement) => traiterPresence(evenement.params.eventId, evenement.params.uid),
);

/** Ce qu'un post publie rapporte. Meme raison d'etre a part. */
export async function traiterPost(spot: string, postId: string, auteur: string): Promise<void> {
  if (!auteur) return;

    // Trois posts comptes par semaine : au-dela, publier reste libre, mais
    // ne rapporte plus. On veut des sorties, pas du volume.
    if ((await comptePourLaSemaine(spot, auteur, 'post_')) >= PLAFONDS.postsParSemaine) return;

  await attribuer({
    uid: auteur, spot, motif: 'post', cle: `post_${postId}`, ref: postId, compteur: 'postes',
  });
}

export const pointsSurPost = onValueCreated(
  { ref: '/posts/{spot}/{postId}', region: 'europe-west1' },
  (evenement) =>
    traiterPost(
      evenement.params.spot,
      evenement.params.postId,
      (evenement.data.val() as { authorId?: string } | null)?.authorId ?? '',
    ),
);

/** Ce qu'un commentaire rapporte. */
export async function traiterCommentaire(
  postId: string,
  commentId: string,
  auteur: string,
): Promise<void> {
  if (!auteur) return;

    const spot = ((await db().ref(`postIndex/${postId}/serverId`).get()).val() as string | null) ?? null;
    if (!spot) return;

    if ((await comptePourLaSemaine(spot, auteur, 'commentaire_')) >= PLAFONDS.commentairesParSemaine) {
      return;
    }

  await attribuer({
    uid: auteur, spot, motif: 'commentaire', cle: `commentaire_${commentId}`, ref: postId,
  });
}

export const pointsSurCommentaire = onValueCreated(
  { ref: '/comments/{postId}/{commentId}', region: 'europe-west1' },
  (evenement) =>
    traiterCommentaire(
      evenement.params.postId,
      evenement.params.commentId,
      (evenement.data.val() as { authorId?: string } | null)?.authorId ?? '',
    ),
);
