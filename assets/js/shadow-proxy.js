/*!
 * shadow-proxy.js v2.6.0
 * Reactive DOM binding via Recursive Proxy
 * https://github.com/israel-nogueira/shadow-proxy
 *
 * Directives:
 *   x-for="item in lista"                    → reactive loop (nestable)
 *   x-for="item, k in lista"                 → loop with named index alias
 *   x-for="item in lista as k"               → alternative syntax for named index
 *   x-key="item.id"                          → optional unique key for x-for (fallback: auto __nid)
 *   x-bind="item.titulo"                     → reactive text / interpolation with {var}
 *   x-if="item.ativo"                        → reactive conditional
 *   x-on:event="expr"                        → event listener with loop scope
 *   x-model="elemento_01.nome"               → two-way binding (input/checkbox/radio/select)
 *   x-model="elemento_01.lista[1].titulo"    → deep path two-way binding
 *   x-ref="nome"                             → element reference via $ref.nome
 *
 * Magic variables (available in x-on expressions):
 *   $root                  → root DOM element of the x-data container
 *   $ref.nome              → element marked with x-ref="nome"
 *   $emit(name, detail)    → dispatch CustomEvent on $root
 *   $i / $index            → current loop index (fallback when no alias declared)
 *   $this.index            → current item index
 *   $this.dom              → current item DOM element
 *   $this.data             → current item data object
 *   $this.parent           → $this of parent loop (chainable)
 *
 * Lifecycle hooks (per component key):
 *   proxy.template.key.$beforeRender = fn    → called before every render
 *   proxy.template.key.$afterRender  = fn    → called after every render
 *   el.addEventListener('before-render', fn) → same via DOM event
 *   el.addEventListener('after-render', fn)  → same via DOM event
 *
 * Watchers:
 *   proxy.on('key.prop', (newVal, oldVal) => {})   → watch any deep path
 *
 * v2.6.0 — Early template cache in initProxy (x-for with empty arrays)
 *           Centralized error reporting via _reportError + proxy.onError handler
 * v2.3.0 — Granular reactivity (track/trigger)
 * v2.3.1 — Fixes: x-bind granular, _syncModelsForKey, _renderTracked propagation
 * v2.4.0 — Magic vars: $root, $ref, $emit, $this (+parent), $i/$index
 *           Named index alias: "item, k in lista" / "item in lista as k"
 *           Lifecycle hooks: $beforeRender / $afterRender (template + DOM event)
 *           Watchers: proxy.on(path, fn)
 *           Surgical trigger: single-effect updates run synchronously
 */

var proxy = (function () {

    'use strict';

    const _store = {};
    const _proxies = {};

    // ─── Error reporting ──────────────────────────────────────────────────────
    // Centraliza todos os erros da lib. Use _reportError() em vez de console.*
    // O dev pode sobrescrever proxy.onError para capturar/rotear os erros.

    const ERROR_TYPES = {
        X_FOR_SYNTAX  : 'x-for-syntax',
        X_ON_UNSAFE   : 'x-on-unsafe',
        X_BIND_EVAL   : 'x-bind-eval',
        X_IF_EVAL     : 'x-if-eval',
        RENDER_ERROR  : 'render-error',
        MODEL_PATH    : 'model-path',
        WATCHER_ERROR : 'watcher-error',
        LIFECYCLE     : 'lifecycle-error',
        PROXY_TARGET  : 'proxy-target',
    };

    function _elementId(el) {
        if (!el || !el.tagName) return 'unknown';
        return el.tagName + (el.id ? '#' + el.id : '') + (el.className ? '.' + String(el.className).trim().split(/\s+/).join('.') : '');
    }

    function _reportError(type, message, ctx) {
        const err = Object.assign({
            type      : type,
            message   : message,
            timestamp : Date.now(),
        }, ctx || {});

        if (typeof proxy.onError === 'function') {
            try { proxy.onError(err); } catch (e) { console.error('[shadow-proxy] onError threw:', e); }
        } else {
            console.error('[shadow-proxy] ' + type + ':', message, err);
        }
    }

    // ─── Watchers — proxy.on(path, fn) ───────────────────────────────────────
    // Observa qualquer caminho profundo do store. Dispara com (newVal, oldVal).

    const _watchers = {};   // { 'key.prop.sub': Set<fn> }

    function _notifyWatchers(path, newVal, oldVal) {
        if (newVal === oldVal) return;
        const fns = _watchers[path];
        if (!fns || !fns.size) return;
        fns.forEach(fn => { try { fn(newVal, oldVal); } catch (e) { _reportError(ERROR_TYPES.WATCHER_ERROR, 'Watcher threw', { path: path, message: e.message }); } });
    }

    function _registerWatcher(path, fn) {
        if (!_watchers[path]) _watchers[path] = new Set();
        _watchers[path].add(fn);
        return function () { _watchers[path].delete(fn); };  // retorna unsubscribe
    }


    //
    // _deps: WeakMap<rawObject, Map<prop, Set<Effect>>>
    //
    // Durante o render de um nó, _activeEffect aponta para o Effect daquele nó.
    // Qualquer get() de proxy registra a dependência automaticamente.
    // Quando a prop muda, trigger() agenda só os Effects dependentes.

    const _deps = new WeakMap();
    let _activeEffect = null;

    function _track(rawObj, prop) {
        if (!_activeEffect) return;
        if (!_deps.has(rawObj)) _deps.set(rawObj, new Map());
        const propMap = _deps.get(rawObj);
        if (!propMap.has(prop)) propMap.set(prop, new Set());
        const effects = propMap.get(prop);
        if (!effects.has(_activeEffect)) {
            effects.add(_activeEffect);
            _activeEffect.deps.add(effects);
        }
    }

    function _trigger(rawObj, prop) {
        if (!_deps.has(rawObj)) return false;
        const propMap = _deps.get(rawObj);
        if (!propMap.has(prop)) return false;
        const effects = propMap.get(prop);
        if (!effects.size) return false;

        const list = [...effects];
        if (list.length === 1) {
            const e = list[0];
            e.scheduled = false;
            e.run();
            if (e.key) _syncModelsForKey(e.key);
        } else {
            list.forEach(e => e.schedule());
        }
        return true;
    }


    // ─── Effect ───────────────────────────────────────────────────────────────

    function _createEffect(fn) {
        const effect = {
            fn,
            deps: new Set(),
            scheduled: false,
            key: null,    // root key para _syncModelsForKey após flush

            cleanup() {
                effect.deps.forEach(depSet => depSet.delete(effect));
                effect.deps.clear();
            },

            run() {
                effect.cleanup();
                const prev = _activeEffect;
                _activeEffect = effect;
                try { fn(); } finally { _activeEffect = prev; }
            },

            schedule() {
                if (effect.scheduled) return;
                effect.scheduled = true;
                _pendingEffects.add(effect);
                _scheduleFlush();
            }
        };
        return effect;
    }

    // ─── Flush de effects (microtask) ────────────────────────────────────────
    // Usa Promise.resolve() — dispara antes do próximo frame e antes de qualquer
    // setTimeout, garantindo reatividade quasi-síncrona sem bloquear a thread.

    const _pendingEffects = new Set();
    let _flushQueued = false;

    function _scheduleFlush() {
        if (_flushQueued) return;
        _flushQueued = true;
        Promise.resolve().then(function () {
            _flushQueued = false;
            const batch = [..._pendingEffects];
            _pendingEffects.clear();

            const keysToSync = new Set();

            batch.forEach(e => {
                e.scheduled = false;
                e.run();
                if (e.key) keysToSync.add(e.key);
            });

            keysToSync.forEach(_syncModelsForKey);
        });
    }

    // ─── Batching para _applyTarget (push/splice/substituição de lista) ───────
    // Também usa microtask — consistência no timing entre os dois paths.

    const _pendingKeys = new Set();
    let _applyQueued = false;

    function _scheduleApply(key) {
        _pendingKeys.add(key);
        if (_applyQueued) return;
        _applyQueued = true;
        Promise.resolve().then(function () {
            _applyQueued = false;
            const keys = [..._pendingKeys];
            _pendingKeys.clear();
            keys.forEach(_applyTarget);
            keys.forEach(_syncModelsForKey);
        });
    }

    // ─── Segurança ────────────────────────────────────────────────────────────

    const _SAFE_EXPR = /^[a-zA-Z0-9_$.\[\]!<>=&|?:()\s,'"+-]*$/;
    function _safeExpr(expr) {
        return _SAFE_EXPR.test(expr.trim());
    }

    function _evalExpr(expr, scope) {
        if (!_safeExpr(expr)) return undefined;
        try {
            const keys = Object.keys(scope);
            const values = Object.values(scope);
            return new Function(...keys, `return (${expr})`).call(null, ...values);
        } catch (e) {
            _reportError(ERROR_TYPES.X_BIND_EVAL, 'Falha ao avaliar expressão', {
                expr    : expr,
                message : e.message,
            });
            return undefined;
        }
    }

    function _interpolate(str, scope) {
        return str.replace(/\{([^}]+)\}/g, (_, expr) => {
            const val = _evalExpr(expr.trim(), scope);
            return val != null ? val : '';
        });
    }

    function _isTruthy(expr, scope) {
        return !!_evalExpr(expr, scope);
    }

    // ─── x-model ──────────────────────────────────────────────────────────────

    function _parsePath(path) {
        const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
        return { key: parts[0], parts };
    }

    function _setDeep(parts, value) {
        // Navega pelo PROXY para disparar o setter reativo
        let obj = _proxies[parts[0]];
        if (!obj) {
            // fallback proxy-target
            obj = _store;
            for (let i = 0; i < parts.length - 1; i++) {
                obj = obj[parts[i]];
                if (obj == null) return;
            }
            obj[parts[parts.length - 1]] = value;
            return;
        }
        for (let i = 1; i < parts.length - 1; i++) {
            obj = obj[parts[i]];
            if (obj == null) return;
        }
        obj[parts[parts.length - 1]] = value;
    }

    function _getDeep(parts) {
        let obj = _store;
        for (const k of parts) {
            if (obj == null) return undefined;
            obj = obj[k];
        }
        return obj;
    }


    function _resolveModel(el) {
        const modelAttr = el.getAttribute('x-model');
        const {
            parts
        } = _parsePath(modelAttr);
        const container = el.closest('[x-data],[proxy-target]');
        if (!container) return {
            key: parts[0],
            parts
        };
        const key = container.getAttribute('x-data') || container.getAttribute('proxy-target');
        const isXData = container.hasAttribute('x-data');
        // com x-data o store fica em _store[key], então prefixa
        const fullParts = isXData ? [key, ...parts] : parts;
        return {
            key,
            parts: fullParts
        };
    }

    function _syncModelsForKey(key) {
        document.querySelectorAll('[x-model]').forEach(function (el) {
            const {
                key: elKey,
                parts
            } = _resolveModel(el);
            if (elKey !== key) return;
            const val = _getDeep(parts);
            if (el.type === 'checkbox') {
                el.checked = !!val;
            } else if (el.type === 'radio') {
                el.checked = (el.value === String(val));
            } else {
                const str = val == null ? '' : String(val);
                if (el.value !== str) el.value = str;
            }
        });
    }

    function _initModels() {
        document.querySelectorAll('[x-model]').forEach(function (el) {
            if (el.__shadowModel) return;
            el.__shadowModel = true;

            const {
                key,
                parts
            } = _resolveModel(el);

            const effect = _createEffect(function () {
                let obj = _proxies[parts[0]];
                for (let i = 1; i < parts.length - 1; i++) {
                    if (obj == null) return;
                    obj = obj[parts[i]];
                }
                const v = obj == null ? undefined : obj[parts[parts.length - 1]];

                if (el.type === 'checkbox') {
                    el.checked = !!v;
                } else if (el.type === 'radio') {
                    el.checked = (el.value === String(v));
                } else {
                    const str = v == null ? '' : String(v);
                    if (el.value !== str) el.value = str;
                }
            });
            effect.key = key;
            el.__shadowEffect = effect;
            effect.run();

            function _onInput() {
                const v = el.type === 'checkbox' ? el.checked : el.value;
                _setDeep(parts, v);
            }

            el.addEventListener('input', _onInput);
            el.addEventListener('change', _onInput);
        });
    }

    // ─── x-on ─────────────────────────────────────────────────────────────────

    function _bindEvents(root, scope) {
        const els = root.nodeType === Node.ELEMENT_NODE
            ? [root, ...root.querySelectorAll('*')]
            : [];

        els.forEach(function (el) {
            if (!el.attributes) return;
            for (let attr of el.attributes) {
                if (!attr.name.startsWith('x-on:')) continue;
                const event = attr.name.slice(5);
                const expr = attr.value;
                const flag = '__shadow_' + event;

                // if (el[flag]) el.removeEventListener(event, el[flag]);
                if (el[flag]) continue;

                if (!_safeExpr(expr)) {
                    _reportError(ERROR_TYPES.X_ON_UNSAFE, 'Expressão bloqueada por segurança no x-on', {
                        expr    : expr,
                        element : _elementId(el),
                        attr    : attr.name,
                    });
                    continue;
                }

                el[flag] = function (e) {
                    try {
                        const keys = Object.keys(scope);
                        const values = Object.values(scope);
                        new Function(...keys, 'event', expr).call(null, ...values, e);
                    } catch (err) {
                        console.error('[shadow-proxy] x-on error:', err);
                    }
                };
                el.addEventListener(event, el[flag]);
            }
        });
    }

    // ─── Render com tracking ──────────────────────────────────────────────────
    //
    // _renderTracked: cria ou reutiliza um Effect para o nó.
    // Cada nó com diretiva reativa (x-bind, x-if, x-for) tem seu próprio Effect.
    // Updates pontuais chegam direto ao Effect do nó — sem percorrer a lista.

    function _renderTracked(node, scope, key) {
        if (node.__shadowEffect) {
            node.__shadowEffect.scope = scope;
            if (key) node.__shadowEffect.key = key;
            node.__shadowEffect.run();
            return;
        }

        const effect = _createEffect(function () {
            _renderNodeRaw(node, effect.scope);
        });
        effect.scope = scope;
        effect.key = key || null;
        node.__shadowEffect = effect;
        effect.run();
    }

    // _renderNodeRaw: executa o render dentro do Effect ativo.
    function _renderNodeRaw(node, scope) {
        if (node.nodeType === Node.TEXT_NODE) return;

        const xFor = node.getAttribute && node.getAttribute('x-for');
        const xIf = node.getAttribute && node.getAttribute('x-if');
        const xBind = node.getAttribute && node.getAttribute('x-bind');

        if (xIf != null) {
            const show = _isTruthy(xIf, scope);
            node.style.display = show ? '' : 'none';
            if (!show) return;
        }

        if (xBind != null) {
            if (xBind.includes('{')) {
                node.textContent = _interpolate(xBind, scope);
            } else {
                const val = _evalExpr(xBind, scope);
                node.textContent = val != null ? val : '';
            }
        }

        if (node.attributes) {
            const _SKIP_ATTRS = /^(x-bind|x-if|x-for|x-model|x-on:|x-ref|x-key)/;
            for (let i = 0; i < node.attributes.length; i++) {
                const attr = node.attributes[i];
                if (_SKIP_ATTRS.test(attr.name)) continue;
                if (!attr.value.includes('{')) continue;
                node.setAttribute(attr.name, _interpolate(attr.value, scope));
            }
        }

        if (xFor != null) {
            _renderFor(node, scope, xFor);
            return;
        }

        for (let child of node.children) {
            const hasDirective = child.hasAttribute('x-bind') ||
                child.hasAttribute('x-if') ||
                child.hasAttribute('x-for');

            if (hasDirective) {
                // ✅ Sobe na árvore para encontrar o rootKey mais próximo
                let rootKey = null;
                let ancestor = node;
                while (ancestor) {
                    if (ancestor.__shadowEffect && ancestor.__shadowEffect.key) {
                        rootKey = ancestor.__shadowEffect.key;
                        break;
                    }
                    ancestor = ancestor.parentElement;
                }
                _renderTracked(child, scope, rootKey);
            } else {
                _renderNodeRaw(child, scope);
            }
        }
    }

    // ─── x-key / __nid ────────────────────────────────────────────────────────

    let _nidCounter = 0;

    function _getItemKey(item, xKeyExpr, scope) {
        if (xKeyExpr) {
            const val = _evalExpr(xKeyExpr, scope);
            if (val != null) return String(val);
        }
        if (!item.__nid) item.__nid = 'nid_' + (++_nidCounter);
        return item.__nid;
    }

    // ─── x-for ────────────────────────────────────────────────────────────────

    function _renderFor(node, parentScope, expr) {
        // Suporta:
        //   "item in lista"
        //   "item, k in lista"
        //   "item in lista as k"
        let alias, indexAlias, listExp;

        const matchAs = expr.match(/^\s*(\w+)\s+in\s+(.+?)\s+as\s+(\w+)\s*$/);
        const matchComma = expr.match(/^\s*(\w+)\s*,\s*(\w+)\s+in\s+(.+)\s*$/);
        const matchPlain = expr.match(/^\s*(\w+)\s+in\s+(.+)\s*$/);

        if (matchAs) {
            alias = matchAs[1]; listExp = matchAs[2].trim(); indexAlias = matchAs[3];
        } else if (matchComma) {
            alias = matchComma[1]; indexAlias = matchComma[2]; listExp = matchComma[3].trim();
        } else if (matchPlain) {
            alias = matchPlain[1]; listExp = matchPlain[2].trim(); indexAlias = null;
        } else {
            _reportError(ERROR_TYPES.X_FOR_SYNTAX, 'Expressão inválida no x-for', {
                expr    : expr,
                element : _elementId(node),
                path    : node.__shadowEffect?.key || 'unknown',
            });
            return;
        }

        const list = _evalExpr(listExp, parentScope);
        const xKeyExpr = node.getAttribute('x-key') || null;
        const template = node.__shadowTemplate;

        // Propaga key do effect pai para os filhos
        const parentEffect = node.__shadowEffect;
        const rootKey = parentEffect ? parentEffect.key : null;

        // $root do container
        const rootEl = rootKey
            ? document.querySelector('[x-data="' + rootKey + '"]')
            : null;

        // ── Lista vazia ───────────────────────────────────────────────────────
        if (!Array.isArray(list) || list.length === 0) {
            while (node.firstChild) node.removeChild(node.firstChild);
            node.__shadowKeys = [];
            return;
        }

        // ── Monta mapa key → nó existente ────────────────────────────────────
        const existingByKey = {};
        const currentKeys = node.__shadowKeys || [];

        currentKeys.forEach(function (key, i) {
            const el = node.children[i];
            if (el) existingByKey[key] = el;
        });

        const newKeys = [];
        const newNodes = [];
        const newScopes = [];
        const newThis = [];   // $this de cada item

        list.forEach(function (item, index) {
            // Preserva o proxy do item
            const rawItem = (item && item.__isProxy) ? item : _makeProxy(
                (item && item.__raw) ? item.__raw : item,
                rootKey || ''
            );
            const itemWithIndex = new Proxy(rawItem, {
                get(target, prop, receiver) {
                    if (prop === '$i' || prop === '$index') return index;
                    return Reflect.get(target, prop, receiver);
                }
            });

            // $this do item — dom será preenchido após criação do nó
            const parentThis = parentScope.$this || null;
            const itemThis = {
                index: index,
                dom: null,   // preenchido abaixo
                data: item,
                parent: parentThis
            };

            // Monta scope com alias, indexAlias, $i, $index, $this
            const scope = Object.assign({}, parentScope, {
                [alias]: itemWithIndex,
                $i: index,
                $index: index,
                $this: itemThis
            });
            if (indexAlias) scope[indexAlias] = index;

            const key = _getItemKey(item, xKeyExpr, scope);
            newKeys.push(key);
            newScopes.push(scope);
            newThis.push(itemThis);

            if (existingByKey[key]) {
                const existingEl = existingByKey[key];
                // ✅ Limpa TODOS os flags x-on para forçar rebind com scope atualizado
                [existingEl, ...existingEl.querySelectorAll('*')].forEach(el => {
                    if (!el.attributes) return;
                    for (let attr of el.attributes) {
                        if (!attr.name.startsWith('x-on:')) continue;
                        const flag = '__shadow_' + attr.name.slice(5);
                        if (el[flag]) {
                            el.removeEventListener(attr.name.slice(5), el[flag]);
                            delete el[flag];
                        }
                    }
                });
                _renderTracked(existingEl, scope, rootKey);
                newNodes.push(existingEl);
            } 
            else 
            {
                const _WRAPPER_MAP = {
                    SELECT  : 'select',
                    TBODY   : 'tbody',
                    THEAD   : 'thead',
                    TFOOT   : 'tfoot',
                    TR      : 'tr',
                    UL      : 'ul',
                    OL      : 'ol',
                    DL      : 'dl',
                };
                const wrapper = document.createElement(_WRAPPER_MAP[node.tagName] || 'div');
                wrapper.innerHTML = template;
                _cacheTemplates(wrapper);
                const children = Array.from(wrapper.children);

                if (children.length === 1) {
                    _renderTracked(children[0], scope, rootKey);
                    newNodes.push(children[0]);
                } else {
                    children.forEach(c => _renderTracked(c, scope, rootKey));
                    newNodes.push(...children);
                }
            }
        });

        // ── Remove obsoletos ──────────────────────────────────────────────────
        const newKeySet = new Set(newKeys);
        currentKeys.forEach(function (key) {
            if (!newKeySet.has(key) && existingByKey[key]) {
                const el = existingByKey[key];
                if (el.__shadowEffect) el.__shadowEffect.cleanup();
                el.remove();
            }
        });

        // ── Remove filhos extras não rastreados ───────────────────────────────
        const newNodeSet = new Set(newNodes);
        Array.from(node.children).forEach(function (child) {
            if (!newNodeSet.has(child)) child.remove();
        });

        // ── Reordena no DOM ───────────────────────────────────────────────────
        newNodes.forEach(function (el, i) {
            const current = node.children[i];
            if (current !== el) node.insertBefore(el, current || null);
        });

        node.__shadowKeys = newKeys;

        // ── Preenche $this.dom e bind eventos ─────────────────────────────────
        newNodes.forEach(function (el, i) {
            if (el && el.nodeType === Node.ELEMENT_NODE) {
                newThis[i].dom = el;

                // $ref — elementos marcados com x-ref dentro do x-data
                const $ref = {};
                if (rootEl) {
                    rootEl.querySelectorAll('[x-ref]').forEach(function (refEl) {
                        $ref[refEl.getAttribute('x-ref')] = refEl;
                    });
                }

                // $emit — dispara CustomEvent no $root
                const $emit = function (name, detail) {
                    if (!rootEl) return;
                    rootEl.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: detail || {} }));
                };

                const enrichedScope = Object.assign({}, newScopes[i], {
                    $root: rootEl,
                    $ref: $ref,
                    $emit: $emit
                });

                _bindEvents(el, enrichedScope);
            }
        });
    }

    // ─── Template cache ───────────────────────────────────────────────────────

    function _cacheTemplates(root) {
        root.querySelectorAll('[x-for]').forEach(function (el) {
            if (!el.__shadowTemplate) el.__shadowTemplate = el.innerHTML;
        });
    }

    // ─── Apply ────────────────────────────────────────────────────────────────

    function _applyTarget(key) {
        const targets = document.querySelectorAll(
            '[proxy-target="' + key + '"], [x-data="' + key + '"]'
        );

        if (!targets.length) return;

        const data = _store[key];
        if (!data) return;

        targets.forEach(function (target) {
            if (typeof data.$beforeRender === 'function') {
                try { data.$beforeRender(target); } catch (e) { _reportError(ERROR_TYPES.LIFECYCLE, '$beforeRender threw', { message: e.message, component: key }); }
            }
            target.dispatchEvent(new CustomEvent('before-render', { bubbles: false }));

            _cacheTemplates(target);

            const $ref = {};
            target.querySelectorAll('[x-ref]').forEach(function (el) {
                $ref[el.getAttribute('x-ref')] = el;
            });
            const $emit = function (name, detail) {
                target.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: detail || {} }));
            };

        const baseScope = target.hasAttribute('x-data')
            ? (_proxies[key] || data)   // ✅ usa o proxy para rastrear dependências
            : { [key]: data };

            const scope = Object.assign(baseScope, {
                $root: target,
                $ref: $ref,
                $emit: $emit,
                $i: undefined,
                $index: undefined,
                $this: null
            });

            _renderTracked(target, scope, key);

            // removeu o _bindEvents daqui

            Promise.resolve().then(function () {
                // ✅ FIX: binda x-on apenas em elementos fora do x-for
                _bindEvents(target, scope);

                if (typeof data.$afterRender === 'function') {
                    try { data.$afterRender(target); } catch (e) { _reportError(ERROR_TYPES.LIFECYCLE, '$afterRender threw', { message: e.message, component: key }); }
                }
                target.dispatchEvent(new CustomEvent('after-render', { bubbles: false }));
            });
        });

        _syncModelsForKey(key);
    }

    // ─── Proxy factory ────────────────────────────────────────────────────────

    function _makeProxy(data, key, _path) {
        const basePath = _path || key;
        return new Proxy(data, {
            get(target, prop, receiver) {
                if (prop === '__isProxy') return true;
                if (prop === '__raw') return target;

                if (typeof prop === 'string' && prop !== '__nid') {
                    _track(target, prop);
                }

                const val = Reflect.get(target, prop, receiver);
                if (val !== null && typeof val === 'object' && !val.__isProxy) {
                    return _makeProxy(val, key, basePath + '.' + prop);
                }
                return val;
            },

            set(target, prop, value) {
                const oldVal = target[prop];
                if (oldVal === value) return true;
                target[prop] = value;

                _notifyWatchers(basePath + '.' + prop, value, oldVal);

                const triggered = _trigger(target, prop);
                if (!triggered) {
                    _scheduleApply(key);
                }

                return true;
            },

            deleteProperty(target, prop) {
                const oldVal = target[prop];
                delete target[prop];
                _notifyWatchers(basePath + '.' + prop, undefined, oldVal);
                _trigger(target, prop);
                _scheduleApply(key);
                return true;
            }
        });
    }

    // ─── Destroy helpers ──────────────────────────────────────────────────────

    function _destroyNode(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return;

        // Remove x-on listeners
        if (node.attributes) {
            for (let attr of node.attributes) {
                if (!attr.name.startsWith('x-on:')) continue;
                const event = attr.name.slice(5);
                const flag = '__shadow_' + event;
                if (node[flag]) {
                    node.removeEventListener(event, node[flag]);
                    delete node[flag];
                }
            }
        }

        // Cleanup effect granular
        if (node.__shadowEffect) {
            node.__shadowEffect.cleanup();
            delete node.__shadowEffect;
        }

        // Remove x-model listeners (marca interna __shadowModel)
        if (node.__shadowModel) {
            delete node.__shadowModel;
        }

        // Recursivo nos filhos
        Array.from(node.children).forEach(_destroyNode);
    }

    function _destroyKey(key) {
        // Cancela renders pendentes do key antes de qualquer coisa
        _pendingKeys.delete(key);

        const targets = document.querySelectorAll(
            '[proxy-target="' + key + '"], [x-data="' + key + '"]'
        );

        targets.forEach(function (target) {
            const data = _store[key] || {};

            // ── $beforeDestroy ────────────────────────────────────────────────
            if (typeof data.$beforeDestroy === 'function') {
                try { data.$beforeDestroy(target); } catch (e) { _reportError(ERROR_TYPES.LIFECYCLE, '$beforeDestroy threw', { message: e.message, component: key }); }
            }
            target.dispatchEvent(new CustomEvent('before-destroy', { bubbles: false }));

            // ── Destroy recursivo nos filhos ──────────────────────────────────
            Array.from(target.children).forEach(_destroyNode);

            // ── Limpa o próprio target ────────────────────────────────────────
            if (target.__shadowEffect) {
                target.__shadowEffect.cleanup();
                delete target.__shadowEffect;
            }
            delete target.__shadowKeys;

            // ── $afterDestroy ─────────────────────────────────────────────────
            if (typeof data.$afterDestroy === 'function') {
                try { data.$afterDestroy(target); } catch (e) { _reportError(ERROR_TYPES.LIFECYCLE, '$afterDestroy threw', { message: e.message, component: key }); }
            }
            target.dispatchEvent(new CustomEvent('after-destroy', { bubbles: false }));
        });

        // Limpa store, proxy e watchers do key
        delete _store[key];
        delete _proxies[key];

        // Remove watchers cujo path começa com esse key
        Object.keys(_watchers).forEach(function (path) {
            if (path === key || path.startsWith(key + '.')) {
                delete _watchers[path];
            }
        });

        // Remove entrada no template público
        if (proxy.template && proxy.template[key]) {
            delete proxy.template.__raw__[key]; // segurança; o Proxy recria se precisar
        }
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    return {

        name: 'shadow-proxy.js',
        version: '2.6.0',
        template: {},

        // proxy.onError = fn({ type, message, timestamp, ...ctx })
        // Se não definido, usa console.error por padrão.
        onError: null,

        // proxy.on('key.prop', (newVal, oldVal) => {})
        // Retorna função de unsubscribe
        on: function (path, fn) {
            return _registerWatcher(path, fn);
        },

        bindEvents: _bindEvents,
        initModels: _initModels,
        destroy: function (key) {
            if (key) {
                _destroyKey(key);
            } else {
                Object.keys(_store).forEach(_destroyKey);
            }
        },

        initProxy: function () {
            const self = this;

            document.querySelectorAll('[proxy-target], [x-data]').forEach(function (el) {
                const key = el.getAttribute('proxy-target') || el.getAttribute('x-data');
                if (!_store[key]) _store[key] = {};
                _cacheTemplates(el); // cacheia x-for templates antes de qualquer render (fix: arrays vazios)
            });

            self.template = new Proxy(_store, {
                get(target, key) {
                    if (key === '__raw__') return target;
                    if (!target[key]) target[key] = {};
                    // Recria proxy se o raw mudou (ex: após destroy)
                    if (!_proxies[key] || _proxies[key].__raw !== target[key]) {
                        _proxies[key] = _makeProxy(target[key], key);
                    }
                    // Injeta .destroy() diretamente no raw do key
                    const raw = target[key];
                    if (raw && !raw.__destroyBound) {
                        Object.defineProperty(raw, 'destroy', {
                            configurable: true,
                            enumerable: false,
                            value: function () { _destroyKey(key); }
                        });
                        raw.__destroyBound = true;
                    }
                    return _proxies[key];
                },
                set(target, key, value) {
                    target[key] = value;
                    _proxies[key] = _makeProxy(target[key], key);
                    _scheduleApply(key);
                    return true;
                }
            });

        }
    };

})();