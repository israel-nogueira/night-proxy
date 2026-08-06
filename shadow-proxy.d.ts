/**
 * shadow-proxy — Reactive DOM binding via Recursive Proxy
 * https://github.com/israel-nogueira/shadow-proxy
 */

// ─── Error types ──────────────────────────────────────────────────────────────

export type ShadowProxyErrorType =
  | 'x-for-syntax'
  | 'x-on-unsafe'
  | 'x-bind-eval'
  | 'x-if-eval'
  | 'render-error'
  | 'model-path'
  | 'watcher-error'
  | 'lifecycle-error'
  | 'proxy-target'
  | 'security-blocked';

export interface ShadowProxyError {
  type: ShadowProxyErrorType;
  message: string;
  timestamp: number;
  expr?: string;
  element?: string;
  attr?: string;
  path?: string;
  component?: string;
}

// ─── Component store ──────────────────────────────────────────────────────────

export interface ShadowProxyComponent {
  /** Called before every render of this component. */
  $beforeRender?: (el: Element) => void;
  /** Called after every render of this component. */
  $afterRender?: (el: Element) => void;
  /** Called before this component is destroyed. */
  $beforeDestroy?: (el: Element) => void;
  /** Called after this component is destroyed. */
  $afterDestroy?: (el: Element) => void;
  /** Destroys this component (same as `proxy.destroy(key)`). */
  destroy(): void;
  /** Any reactive data property. */
  [key: string]: any;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface ShadowProxy {
  /** Library name. */
  readonly name: string;

  /** Semantic version. */
  readonly version: string;

  /**
   * Reactive store proxy. Access via `proxy.template.<key>`.
   * Any assignment triggers a re-render of the matching `[x-data]` element.
   *
   * @example
   * proxy.template.app.title = 'Hello';
   * proxy.template.list.items = [{ name: 'A' }, { name: 'B' }];
   */
  template: { [key: string]: ShadowProxyComponent };

  /**
   * Global error handler. If set, replaces the default `console.error`.
   *
   * @example
   * proxy.onError = (err) => {
   *   console.warn('[myapp]', err.type, err.message, err);
   * };
   */
  onError: ((err: ShadowProxyError) => void) | null;

  /**
   * Initializes the reactive system.
   *
   * Must be called once after the DOM is ready. Scans all `[proxy-target]`
   * and `[x-data]` elements, caches `x-for` templates and sets up the
   * root Proxy in `proxy.template`.
   *
   * Can be called again after `destroy()` to reinitialize components
   * (e.g. SPA navigation without page reload).
   *
   * @example
   * document.addEventListener('DOMContentLoaded', () => {
   *   proxy.initProxy();
   *   proxy.initModels();
   *   proxy.template.app.title = 'Hello world';
   * });
   */
  initProxy(): void;

  /**
   * Initializes two-way binding for all `x-model` elements in the document.
   *
   * Should be called once after `initProxy()`, or again after injecting
   * new `x-model` elements into the DOM (e.g. page swap via fetch).
   *
   * Supports `<input type="text">`, `<input type="checkbox">`,
   * `<input type="radio">` and `<select>`.
   *
   * @example
   * proxy.initProxy();
   * proxy.initModels();
   */
  initModels(): void;

  /**
   * Registers `x-on:*` listeners on elements inside `root`.
   *
   * Called automatically by the render cycle — use manually only when
   * injecting HTML dynamically outside the normal proxy flow.
   *
   * @param root  Root element from which `x-on:*` attributes are searched.
   * @param scope Variables available in expressions.
   * @param key   Component key (`x-data` / `proxy-target`).
   *
   * @example
   * const container = document.querySelector('[x-data="feed"]');
   * proxy.bindEvents(container, proxy.template.feed, 'feed');
   */
  bindEvents(root: Element, scope: object, key?: string): void;

  /**
   * Watches any deep path in the store for changes.
   *
   * The callback is called with `(newVal, oldVal)` whenever the value
   * at the path — or any descendant property — changes.
   * Child changes bubble up to the watched path.
   *
   * @param path  Dot-notation path: `'key.prop.sub'`.
   * @param fn    Callback called on change.
   * @returns     Unsubscribe function — call it to stop watching.
   *
   * @example
   * const unsub = proxy.on('cart.items', (next, prev) => {
   *   console.log('items changed', next);
   * });
   *
   * // Stop watching:
   * unsub();
   */
  on(path: string, fn: (newVal: any, oldVal: any) => void): () => void;

  /**
   * Destroys one or all registered components.
   *
   * Removes event listeners, reactive effects, watchers, model registry
   * and clears the internal store of the component(s).
   *
   * Fires `$beforeDestroy` / `$afterDestroy` lifecycle hooks and the
   * DOM events `before-destroy` / `after-destroy` on the target element.
   *
   * @param key Component key to destroy. If omitted, destroys **all** components.
   *
   * @example
   * proxy.destroy('myComponent');
   *
   * // Or via shortcut on the template:
   * proxy.template.myComponent.destroy();
   *
   * // Destroy everything (e.g. page transition):
   * proxy.destroy();
   */
  destroy(key?: string): void;
}

// ─── Global export ────────────────────────────────────────────────────────────

declare const proxy: ShadowProxy;

export { proxy };
export default proxy;

// ─── Augment browser global ───────────────────────────────────────────────────

declare global {
  interface Window {
    proxy: ShadowProxy;
  }
  const proxy: ShadowProxy;
}