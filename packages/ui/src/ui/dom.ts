/**
 * A tiny element builder.
 *
 * Views build their DOM once and then update it in place, so this only has
 * to make construction readable — there is no diffing, no virtual DOM, and
 * nothing to learn beyond `h(tag, props, ...children)`.
 */

export type Child = Node | string | false | null | undefined;

export interface Props {
  readonly class?: string;
  readonly text?: string;
  readonly title?: string;
  readonly type?: string;
  readonly attrs?: Readonly<Record<string, string>>;
  readonly style?: Readonly<Record<string, string>>;
  readonly on?: { readonly [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void };
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class !== undefined) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.title !== undefined) node.title = props.title;
  if (props.type !== undefined) node.setAttribute("type", props.type);
  for (const [key, value] of Object.entries(props.attrs ?? {})) node.setAttribute(key, value);
  for (const [key, value] of Object.entries(props.style ?? {})) node.style.setProperty(key, value);
  for (const [event, handler] of Object.entries(props.on ?? {})) {
    node.addEventListener(event, handler as EventListener);
  }
  for (const child of children) {
    if (child === false || child === null || child === undefined) continue;
    node.append(child);
  }
  return node;
}

/** Sets text only when it changed, so updates do not churn the DOM. */
export function setText(node: Node, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function toggleClass(node: Element, name: string, on: boolean): void {
  if (node.classList.contains(name) !== on) node.classList.toggle(name, on);
}

/** Enables or disables a control, with the reason as its tooltip when disabled. */
export function setEnabled(node: HTMLButtonElement | HTMLInputElement | HTMLSelectElement, enabled: boolean, reason?: string, title?: string): void {
  if (node.disabled === enabled) node.disabled = !enabled;
  const tip = enabled ? (title ?? "") : (reason ?? title ?? "");
  if (node.title !== tip) node.title = tip;
}

/** A number input's value, or the fallback when it is empty or not a number. */
export function readNumber(input: HTMLInputElement, fallback: number): number {
  const value = Number.parseFloat(input.value);
  return Number.isFinite(value) ? value : fallback;
}

export function clear(node: Element): void {
  while (node.firstChild) node.firstChild.remove();
}
