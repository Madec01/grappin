/**
 * Entrée : un seul geste, maintenir le doigt n'importe où.
 *
 * Un seul pointeur est suivi à la fois. Un deuxième doigt posé pendant que le
 * premier tient est ignoré, et la fin du geste vient du premier doigt
 * seulement : levé, annulé par le système, ou perdu.
 */

export interface PointerHandlers {
  readonly onPress: () => void;
  readonly onRelease: () => void;
}

export function trackPointer(target: HTMLElement, handlers: PointerHandlers): void {
  /** Identifiant du pointeur en cours, ou null si aucun doigt n'est posé. */
  let activeId: number | null = null;

  /** Termine le geste, une seule fois même si plusieurs événements de fin se suivent. */
  const end = (id: number): void => {
    if (id !== activeId) return;
    activeId = null;
    handlers.onRelease();
  };

  target.addEventListener('pointerdown', (event) => {
    if (activeId !== null || event.button !== 0) return;
    event.preventDefault();
    // La capture garantit que le relâchement nous parvient même si le doigt sort de l'élément.
    target.setPointerCapture(event.pointerId);
    activeId = event.pointerId;
    handlers.onPress();
  });
  target.addEventListener('pointerup', (event) => end(event.pointerId));
  target.addEventListener('pointercancel', (event) => end(event.pointerId));
  // Perte du pointeur sans pointerup (changement d'onglet, capture retirée) : on relâche.
  target.addEventListener('lostpointercapture', (event) => end(event.pointerId));
  // Un appui long ne doit jamais ouvrir le menu contextuel du navigateur.
  target.addEventListener('contextmenu', (event) => event.preventDefault());
}
