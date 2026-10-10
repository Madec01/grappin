/**
 * Entrée : un seul geste, maintenir le doigt n'importe où.
 *
 * Un seul pointeur est suivi à la fois. Un deuxième doigt posé pendant que le
 * premier tient est ignoré, et la fin du geste vient du premier doigt
 * seulement : levé, annulé par le système, ou perdu. Chaque gestionnaire reçoit
 * la position du pointeur en pixels CSS, dans le repère de l'élément.
 *
 * Le doigt qui glisse est suivi aussi (`onMove`) : le lanceur se bande en
 * tirant, et la traction se mesure depuis l'appui.
 */

export interface PointerHandlers {
  readonly onPress: (x: number, y: number) => void;
  /** Le pointeur actif a bougé. Jamais appelé sans doigt posé, ni pour un autre pointeur que le premier. */
  readonly onMove: (x: number, y: number) => void;
  readonly onRelease: (x: number, y: number) => void;
}

export function trackPointer(target: HTMLElement, handlers: PointerHandlers): void {
  /** Identifiant du pointeur en cours, ou null si aucun doigt n'est posé. */
  let activeId: number | null = null;

  /** Position de l'événement par rapport au coin haut gauche de l'élément. */
  const local = (event: PointerEvent): { x: number; y: number } => {
    const box = target.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  /** Termine le geste, une seule fois même si plusieurs événements de fin se suivent. */
  const end = (event: PointerEvent): void => {
    if (event.pointerId !== activeId) return;
    activeId = null;
    const { x, y } = local(event);
    handlers.onRelease(x, y);
  };

  target.addEventListener('pointerdown', (event) => {
    if (activeId !== null || event.button !== 0) return;
    event.preventDefault();
    // La capture garantit que le relâchement nous parvient même si le doigt sort de l'élément.
    target.setPointerCapture(event.pointerId);
    activeId = event.pointerId;
    const { x, y } = local(event);
    handlers.onPress(x, y);
  });
  target.addEventListener('pointermove', (event) => {
    if (event.pointerId !== activeId) return;
    const { x, y } = local(event);
    handlers.onMove(x, y);
  });
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
  // Perte du pointeur sans pointerup (changement d'onglet, capture retirée) : on relâche.
  target.addEventListener('lostpointercapture', end);
  // Un appui long ne doit jamais ouvrir le menu contextuel du navigateur.
  target.addEventListener('contextmenu', (event) => event.preventDefault());
}
