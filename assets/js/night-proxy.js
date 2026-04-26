/*!
 * night-proxy.js v2.3.1
 * Reactive DOM binding via Recursive Proxy
 * https://github.com/israel-nogueira/night-proxy
 *
 * Directives:
 *   x-for="item in lista"                    → reactive loop (nestable)
 *   x-key="item.id"                          → optional unique key for x-for (fallback: auto __nid)
 *   x-bind="item.titulo"                     → reactive text / interpolation with {var}
 *   x-if="item.ativo"                        → reactive conditional
 *   x-on:event="expr"                        → event listener with loop scope
 *   x-model="elemento_01.nome"               → two-way binding (input/checkbox/radio/select)
 *   x-model="elemento_01.lista[1].titulo"    → deep path two-way binding
 *   $i                                       → index via scoped variable (item.$i)
 *
 * v2.3.0 — Granular reactivity (track/trigger):
 *   - Cada nó DOM rastreia exatamente quais propriedades leu durante o render
 *   - Updates cirúrgicos: lista[1].nome = 'x' atualiza APENAS o nó do item[1]
 *   - Nenhum loop sobre a lista inteira para updates pontuais
 *   - Estruturas de lista (push/splice/substituição) ainda fazem re-render completo do x-for
 *   - Batching via requestAnimationFrame mantido para rajadas de updates
 *
 * v2.3.1 — Fixes:
 *   - x-bind fora de x-for agora recebe Effect próprio → reatividade granular em qualquer contexto
 *   - _syncModelsForKey chamado após flush de effects → x-model sempre sincronizado
 *   - _renderNodeRaw propaga _renderTracked em TODOS os filhos com x-bind/x-if/x-for
 */

var proxy = (function () {

    'use strict';

    const _store = {};
    const _proxies = {};

    // ─── Dependency tracking ──────────────────────────────────────────────────
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
            // Update cirúrgico — roda síncrono, sem microtask
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
        let obj = _store;
        for (let i = 0; i < parts.length - 1; i++) {
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

    function _syncModelsForKey(key) {
        document.querySelectorAll('[x-model]').forEach(function (el) {
            const { key: elKey, parts } = _parsePath(el.getAttribute('x-model'));
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
            if (el.__nightModel) return;
            el.__nightModel = true;

            const { key, parts } = _parsePath(el.getAttribute('x-model'));
            const val = _getDeep(parts);

            if (el.type === 'checkbox') el.checked = !!val;
            else if (el.type === 'radio') el.checked = (el.value === String(val));
            else el.value = val == null ? '' : val;

            function _onInput() {
                const v = el.type === 'checkbox' ? el.checked : el.value;
                _setDeep(parts, v);
                _applyTarget(key);
                _syncModelsForKey(key);
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
                const flag = '__night_' + event;

                if (el[flag]) el.removeEventListener(event, el[flag]);

                if (!_safeExpr(expr)) {
                    console.warn('[night-proxy] unsafe x-on blocked:', expr);
                    continue;
                }

                el[flag] = function (e) {
                    try {
                        const keys = Object.keys(scope);
                        const values = Object.values(scope);
                        new Function(...keys, 'event', expr).call(null, ...values, e);
                    } catch (err) {
                        console.error('[night-proxy] x-on error:', err);
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
        if (node.__nightEffect) {
            node.__nightEffect.scope = scope;
            if (key) node.__nightEffect.key = key;
            node.__nightEffect.run();
            return;
        }

        const effect = _createEffect(function () {
            _renderNodeRaw(node, effect.scope);
        });
        effect.scope = scope;
        effect.key = key || null;
        node.__nightEffect = effect;
        effect.run();
    }

    // _renderNodeRaw: executa o render dentro do Effect ativo.
    // Propaga _renderTracked para todos os filhos com diretivas reativas.
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

        if (xFor != null) {
            _renderFor(node, scope, xFor);
            return;
        }

        for (let child of node.children) {
            const hasDirective = child.hasAttribute('x-bind')
                || child.hasAttribute('x-if')
                || child.hasAttribute('x-for');

            if (hasDirective) {
                // Filho com diretiva ganha Effect próprio — rastreamento granular
                const parentEffect = node.__nightEffect;
                const rootKey = parentEffect ? parentEffect.key : null;
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
        const match = expr.match(/^\s*(\w+)\s+in\s+(.+)\s*$/);
        if (!match) {
            console.error('[night-proxy] x-for syntax error:', expr);
            return;
        }

        const alias = match[1];
        const listExp = match[2].trim();
        const list = _evalExpr(listExp, parentScope);
        const xKeyExpr = node.getAttribute('x-key') || null;
        const template = node.__nightTemplate;

        // Propaga key do effect pai para os filhos
        const parentEffect = node.__nightEffect;
        const rootKey = parentEffect ? parentEffect.key : null;

        // ── Lista vazia ───────────────────────────────────────────────────────
        if (!Array.isArray(list) || list.length === 0) {
            while (node.firstChild) node.removeChild(node.firstChild);
            node.__nightKeys = [];
            return;
        }

        // ── Monta mapa key → nó existente ────────────────────────────────────
        const existingByKey = {};
        const currentKeys = node.__nightKeys || [];

        currentKeys.forEach(function (key, i) {
            const el = node.children[i];
            if (el) existingByKey[key] = el;
        });

        const newKeys = [];
        const newNodes = [];
        const newScopes = [];

        list.forEach(function (item, index) {
            // Preserva o proxy do item — não copia props para objeto plain.
            // $i é exposto via wrapper que delega gets ao proxy original.
            const rawItem = (item && item.__isProxy) ? item : _makeProxy(
                (item && item.__raw) ? item.__raw : item,
                rootKey || ''
            );
            const itemWithIndex = new Proxy(rawItem, {
                get(target, prop, receiver) {
                    if (prop === '$i') return index;
                    return Reflect.get(target, prop, receiver);
                }
            });
            const scope = Object.assign({}, parentScope, { [alias]: itemWithIndex });
            const key = _getItemKey(item, xKeyExpr, scope);

            newKeys.push(key);
            newScopes.push(scope);

            if (existingByKey[key]) {
                _renderTracked(existingByKey[key], scope, rootKey);
                newNodes.push(existingByKey[key]);
            } else {
                const wrapper = document.createElement('div');
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
                if (el.__nightEffect) el.__nightEffect.cleanup();
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

        node.__nightKeys = newKeys;

        // ── Bind eventos ──────────────────────────────────────────────────────
        newNodes.forEach(function (el, i) {
            if (el && el.nodeType === Node.ELEMENT_NODE) {
                _bindEvents(el, newScopes[i]);
            }
        });
    }

    // ─── Template cache ───────────────────────────────────────────────────────

    function _cacheTemplates(root) {
        root.querySelectorAll('[x-for]').forEach(function (el) {
            if (!el.__nightTemplate) el.__nightTemplate = el.innerHTML;
        });
    }

    // ─── Apply ────────────────────────────────────────────────────────────────

    function _applyTarget(key) {
        const targets = document.querySelectorAll(
            '[proxy-target="' + key + '"], [x-data="' + key + '"]'
        );
        if (!targets.length) return;

        const data = _store[key];

        targets.forEach(function (target) {
            _cacheTemplates(target);
            const scope = target.hasAttribute('x-data')
                ? Object.assign({}, data)
                : { [key]: data };
            _renderTracked(target, scope, key);
        });

        _syncModelsForKey(key);
    }

    // ─── Proxy factory ────────────────────────────────────────────────────────

    function _makeProxy(data, key) {
        return new Proxy(data, {
            get(target, prop, receiver) {
                if (prop === '__isProxy') return true;
                if (prop === '__raw') return target;

                if (typeof prop === 'string' && prop !== '__nid') {
                    _track(target, prop);
                }

                const val = Reflect.get(target, prop, receiver);
                if (val !== null && typeof val === 'object' && !val.__isProxy) {
                    return _makeProxy(val, key);
                }
                return val;
            },

            set(target, prop, value) {
                if (target[prop] === value) return true;
                target[prop] = value;

                const triggered = _trigger(target, prop);
                if (!triggered) {
                    _scheduleApply(key);
                }

                return true;
            },

            deleteProperty(target, prop) {
                delete target[prop];
                _trigger(target, prop);
                _scheduleApply(key);
                return true;
            }
        });
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    return {

        name: 'night-proxy.js',
        version: '2.3.1',
        template: {},

        initProxy: function () {
            const self = this;

            document.querySelectorAll('[proxy-target], [x-data]').forEach(function (el) {
                const key = el.getAttribute('proxy-target') || el.getAttribute('x-data');
                if (!_store[key]) _store[key] = {};
            });

            self.template = new Proxy(_store, {
                get(target, key) {
                    if (!target[key]) target[key] = {};
                    if (!_proxies[key]) {
                        _proxies[key] = _makeProxy(target[key], key);
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

            _initModels();
        }
    };

})();