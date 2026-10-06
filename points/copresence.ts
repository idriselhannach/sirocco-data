import { getDatabase } from 'firebase-admin/database';
import { onValueCreated } from 'firebase-functions/v2/database';
import { logger } from 'firebase-functions';

/**
 * La fenetre qui suit une rencontre.
 *
 * On vient de se voir en vrai : on ne devrait pas avoir a envoyer une
 * demande d'ami et attendre pour dire « c'etait sympa, on remet ca ? ».
 * Pendant sept jours, deux personnes qui ont ete presentes au meme
 * evenement s'ecrivent librement, sans etre amies et sans la limite d'un
 * seul message. Passe ce delai, retour au regime normal — sauf si l'un
 * des deux a repondu, auquel cas la conversation est ouverte comme
 * n'importe quelle demande acceptee.
 *
 * Ce delai est la fenetre ou une rencontre devient une relation ou
 * retombe.
 *
 * **La fenetre vit dans une branche que nul client n'ecrit.** Posee sur
 * la conversation, elle aurait ete forgeable : la regle laisse chacun
 * ecrire dans les conversations dont il est membre, et une regle enfant
 * ne peut pas retirer un droit accorde au parent. C'est le meme piege que
 * la suspension et que les points.
 */

/** Sept jours : ni le temps d'oublier, ni celui de s'installer. */
export const FENETRE_MS = 7 * 24 * 60 * 60 * 1000;

function db() {
  return getDatabase();
}

/** La cle d'une paire, dans l'ordre ou `directConversations` la range. */
function paire(a: string, b: string): string {
  return [a, b].sort().join('_');
}

/**
 * Ouvre la fenetre pour une paire, si leur tete-a-tete existe deja.
 *
 * S'il n'existe pas encore, il n'y a rien a marquer : le premier message
 * passe de toute facon — la regle en autorise un — et c'est sa creation
 * qui posera la fenetre, par le declencheur ci-dessous.
 */
export async function ouvrirFenetre(a: string, b: string): Promise<void> {
  const conversationId = (await db().ref(`directConversations/${paire(a, b)}`).get()).val() as
    | string
    | null;
  if (!conversationId) return;

  await db().ref(`coPresence/${conversationId}`).set(Date.now() + FENETRE_MS);
  logger.info('fenetre de co-presence ouverte', { conversationId });
}

/**
 * Un tete-a-tete qui nait entre deux personnes qui viennent de se voir.
 *
 * Le cas de celui qui ecrit le premier apres la soiree : la conversation
 * n'existait pas quand ils se sont rencontres, donc rien n'avait pu etre
 * marque. On rattrape a la creation.
 */
export const fenetreSurNouvelleConversation = onValueCreated(
  { ref: '/conversations/{conversationId}', region: 'europe-west1' },
  async (evenement) => {
    const conversation = evenement.data.val() as {
      type?: string;
      serverId?: string;
      members?: Record<string, unknown>;
    } | null;
    if (conversation?.type !== 'direct' || !conversation.serverId) return;

    const membres = Object.keys(conversation.members ?? {});
    if (membres.length !== 2) return;

    const [a, b] = membres;
    const rencontre = (
      await db().ref(`rencontres/${conversation.serverId}/${a}/${b}`).get()
    ).val() as { dernierEvent?: string; premiereFois?: number } | null;
    if (!rencontre?.dernierEvent) return;

    /*
      On se fie a la derniere rencontre connue. La date exacte du dernier
      evenement partage n'est pas retenue dans l'index — `premiereFois`
      l'est — donc on ouvre la fenetre a partir de maintenant : la
      conversation vient de naitre, la rencontre est forcement recente ou
      la personne n'aurait pas ecrit.
    */
    await db()
      .ref(`coPresence/${evenement.params.conversationId}`)
      .set(Date.now() + FENETRE_MS);
    logger.info('fenetre posee a la creation', { conversationId: evenement.params.conversationId });
  },
);
