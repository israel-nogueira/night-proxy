/*!
 * night-proxy.js v2.2.0
 * Reactive DOM binding via Recursive Proxy
 * https://github.com/israel-nogueira/night-proxy
 *
 * Directives:
 *   x-target="key"                          → component root
 *   x-for="item in lista"                   → reactive loop (nestable)
 *   x-bind="item.titulo"                    → reactive text / interpolation with {var}
 *   x-text="item.titulo"                    → reactive text content
 *   x-if="item.ativo"                       → removes/restores element from DOM
 *   x-show="item.ativo"                     → toggles visibility (display)
 *   x-on:event="expr"                       → event listener with loop scope
 *   x-model="key.prop"                      → two-way binding
 *   x-ref="nome"                            → register element reference
 *   $i                                      → loop index (item.$i)
 *
 * Magic properties (available in x-on expressions):
 *   $root            → root x-target element
 *   $ref.nome        → element with x-ref="nome"
 *   $event           → native DOM event
 *   $emit(name)      → dispatch CustomEvent on $root
 *   $afterRender(fn) → run fn after next render cycle
 *   $observe(path, fn) → watch a property path for changes
 */

var proxy = (function () {

    'use strict';

    const _store = {};
    const _proxies = {};
    const _targetTemplates = {};
    const _observers = {};

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function _interpolate(str, scope) {
        return str.replace(/\{([^}]+)\}/g, (_, expr) => {
            const val = _evalExpr(expr.trim(), scope);
            return val != null ? val : '';
        });
    }

    function _evalExpr(expr, scope) {
        try {
            const keys = Object.keys(scope);
            const values = Object.values(scope);
            return new Function(...keys, `return (${expr})`).call(null, ...values);
        } catch (e) {
            return undefined;
        }
    }

    function _isTruthy(expr, scope) {
        return !!_evalExpr(expr, scope);
    }

    function _parsePath(path) {
        const normalized = path.replace(/\[(\d+)\]/g, '.$1');
        const parts = normalized.split('.');
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
        for (let i = 0; i < parts.length; i++) {
            if (obj == null) return undefined;
            obj = obj[parts[i]];
        }
        return obj;
    }

    // ─── DOM diff (sem dependência externa) ───────────────────────────────────

    function _patch(from, to) {
        // patch attributes
        const toAttrs = Array.from(to.attributes || []);
        const fromAttrs = Array.from(from.attributes || []);

        toAttrs.forEach(function (attr) {
            if (from.getAttribute(attr.name) !== attr.value) {
                from.setAttribute(attr.name, attr.value);
            }
        });
        fromAttrs.forEach(function (attr) {
            if (!to.hasAttribute(attr.name)) {
                from.removeAttribute(attr.name);
            }
        });

        // patch style if set directly
        if (to.style && to.style.cssText !== from.style.cssText) {
            from.style.cssText = to.style.cssText;
        }

        // patch textContent for leaf nodes (no children)
        if (to.children.length === 0 && from.children.length === 0) {
            if (from.textContent !== to.textContent) {
                from.textContent = to.textContent;
            }
            return;
        }

        // patch children
        const fromChildren = Array.from(from.childNodes);
        const toChildren = Array.from(to.childNodes);

        // remove extra nodes
        for (let i = fromChildren.length - 1; i >= toChildren.length; i--) {
            from.removeChild(fromChildren[i]);
        }

        toChildren.forEach(function (toChild, i) {
            const fromChild = from.childNodes[i];

            if (!fromChild) {
                // usa o nó diretamente para preservar listeners
                from.appendChild(toChild);
                return;
            }

            // different node type or tag → replace
            // mas nunca substituir nós que contêm x-on (perdem listeners)
            if (fromChild.nodeType !== toChild.nodeType ||
                fromChild.nodeName !== toChild.nodeName) {
                const hasXOn = fromChild.querySelector && fromChild.querySelector('[x-on\:click],[x-on\:input],[x-on\:change]');
                if (hasXOn) {
                    _patch(fromChild, toChild);
                } else {
                    from.replaceChild(toChild, fromChild);
                }
                return;
            }

            // text node
            if (toChild.nodeType === Node.TEXT_NODE) {
                if (fromChild.textContent !== toChild.textContent) {
                    fromChild.textContent = toChild.textContent;
                }
                return;
            }

            // preserve focused element
            if (fromChild === document.activeElement) return;

            // nós gerados por x-for: substituir direto para preservar listeners
            if (toChild.__nightForNode) {
                from.replaceChild(toChild, fromChild);
                return;
            }

            // recurse
            _patch(fromChild, toChild);
        });
    }

    // ─── $ref helper ──────────────────────────────────────────────────────────

    function _buildRefProxy(root) {
        return new Proxy({}, {
            get(_, name) {
                return root.querySelector('[x-ref="' + name + '"]') || undefined;
            }
        });
    }

    // ─── Magic scope ──────────────────────────────────────────────────────────

    function _buildMagics(key, rootEl) {
        return {
            $root: rootEl,
            $ref: _buildRefProxy(rootEl),
            $emit: function (name, detail) {
                rootEl.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: detail || {} }));
            },
            $afterRender: function (fn) {
                Promise.resolve().then(fn);
            },
            $observe: function (path, fn) {
                const fullPath = key + '.' + path;
                if (!_observers[fullPath]) _observers[fullPath] = [];
                _observers[fullPath].push(fn);
            }
        };
    }

    // ─── Models ───────────────────────────────────────────────────────────────

    function _syncModelsForKey(key) {
        document.querySelectorAll('[x-model]').forEach(function (el) {
            const { key: elKey, parts } = _parsePath(el.getAttribute('x-model'));
            if (elKey !== key) return;
            const val = _getDeep(parts);
            if (el.type === 'checkbox') {
                el.checked = !!val;
            } else if (el.type === 'radio') {
                el.checked = (el.value === val);
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

            if (el.type === 'checkbox') {
                el.checked = !!val;
            } else if (el.type === 'radio') {
                el.checked = (el.value === val);
            } else {
                el.value = val == null ? '' : val;
            }

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

    // ─── DOM renderer ─────────────────────────────────────────────────────────

    function _renderNode(node, scope) {
        if (node.nodeType === Node.TEXT_NODE) return;

        const xFor = node.getAttribute && node.getAttribute('x-for');
        const xIf = node.getAttribute && node.getAttribute('x-if');
        const xShow = node.getAttribute && node.getAttribute('x-show');
        const xBind = node.getAttribute && node.getAttribute('x-bind');
        const xText = node.getAttribute && node.getAttribute('x-text');

        // x-if
        if (xIf !== null && xIf !== undefined) {
            const show = _isTruthy(xIf, scope);
            node.style.display = show ? '' : 'none';
            if (!show) return;
        }

        // x-show
        if (xShow !== null && xShow !== undefined) {
            node.style.display = _isTruthy(xShow, scope) ? '' : 'none';
        }

        // x-text
        if (xText !== null && xText !== undefined) {
            const val = _evalExpr(xText, scope);
            node.textContent = val != null ? val : '';
        }

        // x-bind
        if (xBind !== null && xBind !== undefined) {
            if (xBind.includes('{')) {
                node.textContent = _interpolate(xBind, scope);
            } else {
                const val = _evalExpr(xBind, scope);
                node.textContent = val != null ? val : '';
            }
        }

        // x-on:*
        if (node.attributes) {
            for (let attr of node.attributes) {
                if (attr.name.startsWith('x-on:')) {
                    const event = attr.name.slice(5);
                    const expr = attr.value;
                    if (!node.__nightListeners) node.__nightListeners = {};
                    if (!node.__nightListeners[event]) {
                        node.__nightListeners[event] = true;
                        node.addEventListener(event, function (e) {
                            const s = Object.assign({}, node.__nightScope || scope, { $event: e });
                            try {
                                const keys = Object.keys(s);
                                const values = Object.values(s);
                                new Function(...keys, expr).call(null, ...values);
                            } catch (err) {
                                console.error('[night-proxy] x-on error:', err);
                            }
                        });
                    }
                    node.__nightScope = scope;
                }
            }
        }

        // x-for
        if (xFor !== null && xFor !== undefined) {
            _renderFor(node, scope, xFor);
            return;
        }

        for (let child of node.children) {
            _renderNode(child, scope);
        }
    }

    function _renderFor(node, parentScope, expr) {
        const match = expr.match(/^\s*(\w+)\s+in\s+(.+)\s*$/);
        if (!match) {
            console.error('[night-proxy] x-for syntax error:', expr);
            return;
        }

        const alias = match[1];
        const listExp = match[2].trim();
        const list = _evalExpr(listExp, parentScope);

        if (!Array.isArray(list)) return;

        const template = node.__nightTemplate || '';
        node.innerHTML = '';

        // parser do template para restaurar __nightTemplate nos x-for internos
        const tplParser = document.createElement('div');
        tplParser.innerHTML = template;

        list.forEach(function (item, index) {
            const itemWithIndex = Object.assign({}, item, { $i: index });
            const scope = Object.assign({}, parentScope, { [alias]: itemWithIndex });
            const wrapper = document.createElement('div');
            wrapper.innerHTML = template;

            // restaurar __nightTemplate nos x-for filhos a partir do template limpo
            wrapper.querySelectorAll('[x-for]').forEach(function (el) {
                const expr = el.getAttribute('x-for');
                const tplEl = tplParser.querySelector('[x-for="' + expr + '"]');
                if (tplEl) el.__nightTemplate = tplEl.innerHTML;
            });

            const children = Array.from(wrapper.children);
            for (let child of children) {
                _renderNode(child, scope);
                child.__nightForNode = true;
                node.appendChild(child);
            }
        });
    }

    // ─── Apply target ─────────────────────────────────────────────────────────

    function _applyTarget(key) {
        const targets = document.querySelectorAll('[x-target="' + key + '"], [x-data="' + key + '"]');
        if (!targets.length) {
            console.warn('[night-proxy] No x-target/x-data found for "' + key + '"');
            return;
        }

        const data = _store[key];
        const cleanHTML = _targetTemplates[key];

        targets.forEach(function (target) {
            const isXData = target.hasAttribute('x-data');
            const magics = _buildMagics(key, target);
            const virtual = document.createElement(target.tagName);

            Array.from(target.attributes).forEach(function (attr) {
                virtual.setAttribute(attr.name, attr.value);
            });
            virtual.innerHTML = cleanHTML;

            // restaurar __nightTemplate nos x-for do virtual a partir do cleanHTML
            const tplContainer = document.createElement('div');
            tplContainer.innerHTML = cleanHTML;
            virtual.querySelectorAll('[x-for]').forEach(function (el) {
                const tplEl = tplContainer.querySelector('[x-for="' + el.getAttribute('x-for') + '"]');
                if (tplEl) el.__nightTemplate = tplEl.innerHTML;
            });

            // extrair funções do store para o scope
            const fns = {};
            Object.keys(data).forEach(function (k) {
                if (typeof data[k] === 'function') fns[k] = data[k];
            });

            // x-data: scope direto sem prefixo
            // x-target: scope com prefixo { key: data }
            const scope = isXData
                ? Object.assign({}, data, fns, magics)
                : Object.assign({ [key]: data }, fns, magics);

            _renderNode(virtual, scope);
            _patch(target, virtual);
        });

        _syncModelsForKey(key);
    }

    // ─── Proxy factory ────────────────────────────────────────────────────────

    function _makeProxy(data, key, path) {
        return new Proxy(data, {
            get(target, prop, receiver) {
                if (prop === '__isProxy') return true;
                if (prop === '__raw') return target;

                const val = Reflect.get(target, prop, receiver);

                if (val !== null && typeof val === 'object' && !val.__isProxy) {
                    return _makeProxy(val, key, path ? path + '.' + prop : prop);
                }

                return val;
            },
            set(target, prop, value) {
                const old = target[prop];
                if (old === value) return true;
                target[prop] = value;

                // funções não trigam re-render
                if (typeof value === 'function') return true;

                const fullPath = path ? path + '.' + prop : String(prop);
                const obsKey = key + '.' + fullPath;
                if (_observers[obsKey]) {
                    _observers[obsKey].forEach(fn => fn(value, old));
                }

                _applyTarget(key);
                _syncModelsForKey(key);
                return true;
            },
            deleteProperty(target, prop) {
                delete target[prop];
                _applyTarget(key);
                return true;
            }
        });
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    return {

        name: 'night-proxy.js',
        version: '2.2.0',
        template: {},

        initProxy: function () {
            const self = this;

            document.querySelectorAll('[x-target], [x-data]').forEach(function (el) {
                const key = el.getAttribute('x-target') || el.getAttribute('x-data');
                if (!_store[key]) _store[key] = {};
                _targetTemplates[key] = el.innerHTML;
            });

            self.template = new Proxy(_store, {
                get(target, key) {
                    if (!target[key]) target[key] = {};
                    if (!_proxies[key]) {
                        _proxies[key] = _makeProxy(target[key], key, '');
                    }
                    return _proxies[key];
                },
                set(target, key, value) {
                    target[key] = value;
                    _proxies[key] = _makeProxy(target[key], key, '');
                    _applyTarget(key);
                    _syncModelsForKey(key);
                    return true;
                }
            });

            _initModels();
        }
    };

})();