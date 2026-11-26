/**
 * Press-and-drag that keeps working in After Effects on macOS.
 *
 * The usual browser recipe — `setPointerCapture` on the pressed element and
 * moves heard on that element — depends on pointer capture, which After
 * Effects' panel engine on macOS doesn't reliably honour: the drag stops the
 * moment the pointer slips off a small target such as a curve handle. Here the
 * moves and the release are heard on the whole window, so a drag carries on
 * wherever the pointer goes, with or without capture. Capture is still asked
 * for, where it works, and mouse events stand in for pointer events from an
 * engine that doesn't send them during a press.
 */

export type DragPoint = Pick<MouseEvent, "clientX" | "clientY">;

/** A pointerdown and the mousedown that follows it within this long are one press. */
const SAME_PRESS_MS = 600;

/**
 * Follows a drag from the press `start` on `element` until the button is
 * released, the drag is cancelled or the panel loses focus. Moves may arrive
 * twice (as pointer and as mouse events); `onMove` only gets positions, so a
 * repeat changes nothing. Returns a function that ends the drag early.
 */
export function followDrag(start: PointerEvent | MouseEvent, element: Element, onMove: (point: DragPoint) => void, onEnd?: () => void): () => void {
  let done = false;
  const move = (event: PointerEvent | MouseEvent): void => {
    if (!done) onMove(event);
  };
  const finish = (): void => {
    if (done) return;
    done = true;
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("mousemove", move, true);
    window.removeEventListener("pointerup", finish, true);
    window.removeEventListener("mouseup", finish, true);
    window.removeEventListener("pointercancel", finish, true);
    window.removeEventListener("blur", finish);
    if ("pointerId" in start) {
      try {
        if (element.hasPointerCapture(start.pointerId)) element.releasePointerCapture(start.pointerId);
      } catch {
        // Capture was never granted; there is nothing to release.
      }
    }
    onEnd?.();
  };
  window.addEventListener("pointermove", move, true);
  window.addEventListener("mousemove", move, true);
  window.addEventListener("pointerup", finish, true);
  window.addEventListener("mouseup", finish, true);
  window.addEventListener("pointercancel", finish, true);
  window.addEventListener("blur", finish);
  if ("pointerId" in start) {
    try {
      element.setPointerCapture(start.pointerId);
    } catch {
      // Refused (as on macOS panels at times): the window listeners carry the drag.
    }
  }
  return finish;
}

/**
 * Calls `onPress` for a left-button press on `element`, from its pointerdown,
 * or from its mousedown when no pointerdown came first.
 */
export function onPress(element: Element, onPress: (event: PointerEvent | MouseEvent) => void): void {
  let pointerAt = -Infinity;
  element.addEventListener("pointerdown", (event) => {
    const e = event as PointerEvent;
    if (e.button !== 0) return;
    pointerAt = performance.now();
    onPress(e);
  });
  element.addEventListener("mousedown", (event) => {
    const e = event as MouseEvent;
    if (e.button !== 0 || performance.now() - pointerAt < SAME_PRESS_MS) return;
    onPress(e);
  });
}
