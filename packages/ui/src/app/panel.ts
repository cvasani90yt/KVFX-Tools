import type { Session, SessionState } from "./session.js";

/**
 * What every view can reach: the session, and the shell's shared overlays.
 */

export interface ConfirmOptions {
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
  /** Styles the confirm button as destructive. */
  readonly danger?: boolean;
}

export interface Panel {
  readonly session: Session;
  confirm(options: ConfirmOptions): Promise<boolean>;
  openPalette(): void;
  openSettings(): void;
}

export interface Availability {
  readonly ids: ReadonlySet<string>;
  readonly reasons: ReadonlyMap<string, string>;
}

export interface View {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly root: HTMLElement;
  /** Called on every state change while mounted; must be cheap and in place. */
  update(state: SessionState, availability: Availability): void;
  /** Called when the tab becomes visible. */
  shown?(): void;
}
