/*!
 * shadow-proxy v2.7.4
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
 *   shadowProxy.template.key.$beforeRender = fn    → called before every render
 *   shadowProxy.template.key.$afterRender  = fn    → called after every render
 *   el.addEventListener('before-render', fn) → same via DOM event
 *   el.addEventListener('after-render', fn)  → same via DOM event
 *
 * Watchers:
 *   shadowProxy.on('key.prop', (newVal, oldVal) => {})   → watch any deep path
 *
 * v2.7.4 — structuredClone in _snapshotAncestors (deep watcher oldVal fix)
 *           textarea support in x-model
 *           Renamed global export proxy → shadowProxy (collision-safe)
 * v2.7.1 —  Early template cache in initProxy (x-for with empty arrays)
 *           Centralized error reporting via _reportError + shadowProxy.onError handler
 * v2.3.0 — Granular reactivity (track/trigger)
 * v2.3.1 — Fixes: x-bind granular, _syncModelsForKey, _renderTracked propagation
 * v2.4.0 — Magic vars: $root, $ref, $emit, $this (+parent), $i/$index
 *           Named index alias: "item, k in lista" / "item in lista as k"
 *           Lifecycle hooks: $beforeRender / $afterRender (template + DOM event)
 *           Watchers: shadowProxy.on(path, fn)
 *           Surgical trigger: single-effect updates run synchronously
 */

var shadowProxy = (function () {

    'use strict';

    const _store = {};
    const _proxies = {};

    // Symbol privado ao módulo — substitui a string '__isProxy' (spoofável)
    const _PROXY_SYM = Symbol('shadowProxy');

    // ─── Shadow State Store ─────────────────────────────────────────────────
    // Substitui o padrão antigo de props soltas no elemento (`el.__shadowX`)
    // por um registro dinâmico via WeakMap, chaveado por elemento DOM.
    //
    // Motivo: props soltas no mesmo namespace (`__shadowEffect`) colidiam
    // quando duas diretivas diferentes precisavam de estado próprio no
    // mesmo nó (ex: x-for + x-model no mesmo <select> — ver CHANGELOG 2.7.5).
    // Com o state store, cada diretiva usa sua própria key sem risco de
    // sobrescrever a de outra, e o WeakMap libera o estado sozinho via GC
    // quando o elemento sai do DOM e não sobra outra referência.

    const _shadowState = new WeakMap();

    function _sGet(el, key) {
        return _shadowState.get(el)?.[key];
    }

    function _sSet(el, key, value) {
        if (!_shadowState.has(el)) _shadowState.set(el, {});
        _shadowState.get(el)[key] = value;
        return value;
    }

    function _sHas(el, key) {
        return !!_shadowState.get(el) && key in _shadowState.get(el);
    }

    function _sDelete(el, key) {
        const bucket = _shadowState.get(el);
        if (bucket) delete bucket[key];
    }

    function _sClear(el) {
        _shadowState.delete(el);
    }

    // Debug helper — WeakMap não aparece ao inspecionar o elemento no devtools.
    function _sDebug(el) {
        return Object.assign({}, _shadowState.get(el));
    }

    // ─── Error reporting ──────────────────────────────────────────────────────
    // Centraliza todos os erros da lib. Use _reportError() em vez de console.*
    // O dev pode sobrescrever shadowProxy.onError para capturar/rotear os erros.

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
        SECURITY_BLOCKED : 'security-blocked',
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

        if (typeof shadowProxy.onError === 'function') {
            try { shadowProxy.onError(err); } catch (e) { console.error('[shadow-proxy] onError threw:', e); }
        } else {
            console.error('[shadow-proxy] ' + type + ':', message, err);
        }
    }

    // ─── Watchers — shadowProxy.on(path, fn) ───────────────────────────────────────
    // Observa qualquer caminho profundo do store. Dispara com (newVal, oldVal).

    const _watchers = {};   // { 'key.prop.sub': Set<fn> }

    // ─── Model registry ───────────────────────────────────────────────────────
    // Evita querySelectorAll global no _syncModelsForKey.
    // Cadastrado no _initModels, limpo no _destroyKey.
    const _modelRegistry = new Map(); // key → Set<el>

    // ─── Pending binds — retry após store populado ────────────────────────────
    // Elementos com x-on cuja expressão usava prop ainda inexistente no store.
    // Não é falha de segurança — apenas timing: store vazio no momento do bind.
    // Reprocessados a cada _applyTarget do key correspondente.
    const _pendingBinds = new Map(); // key → Set<{ el, scope, key }>

    function _modelRegistryAdd(key, el) {
        if (!_modelRegistry.has(key)) _modelRegistry.set(key, new Set());
        _modelRegistry.get(key).add(el);
    }

    function _modelRegistryRemove(key) {
        _modelRegistry.delete(key);
    }
    // _snapshotAncestors: captura o valor atual de cada ancestro ANTES da mutação.
    // Deve ser chamado no set() do proxy, antes de target[prop] = value.
    // Retorna Map<ancestorPath, oldVal> para uso posterior no _notifyWatchers.
    function _snapshotAncestors(path) {
        const snapshots = new Map();
        if (Object.keys(_watchers).length === 0) return snapshots; // sem watchers registrados, nada a capturar
        let idx = path.lastIndexOf('.');
        while (idx !== -1) {
            const ancestorPath = path.slice(0, idx);
            if (_watchers[ancestorPath] && _watchers[ancestorPath].size) {
                const val = _getDeep(ancestorPath.split('.'));
                let snapshot;
                if (val && typeof val === 'object') {
                    try {
                        snapshot = structuredClone(val);
                    } catch (e) {
                        try {
                            snapshot = Object.assign(Array.isArray(val) ? [] : {}, val);
                        } catch (e2) {
                            snapshot = val;
                        }
                    }
                } else {
                    snapshot = val;
                }
                snapshots.set(ancestorPath, snapshot);
            }
            idx = ancestorPath.lastIndexOf('.');
        }
        return snapshots;
    }

    function _notifyWatchers(path, newVal, oldVal, ancestorSnapshots) {
        if (newVal !== oldVal) {
            const fns = _watchers[path];
            if (fns && fns.size) {
                fns.forEach(fn => { try { fn(newVal, oldVal); } catch (e) { _reportError(ERROR_TYPES.WATCHER_ERROR, 'Watcher threw', { path: path, message: e.message }); } });
            }
        }

        // Borbulha pros caminhos ancestrais com oldVal correto (capturado antes da mutação).
        // IMPORTANTE: objetos são mutados in-place — ancestorNewVal === ancestorOldVal sempre
        // (mesma referência). Por isso disparamos se há snapshot (mudança confirmada) OU
        // se newVal !== oldVal (a mudança folha garante que o ancestro mudou).
        if (newVal === oldVal) return; // sem mudança real, não borbulha

        let idx = path.lastIndexOf('.');
        while (idx !== -1) {
            const ancestorPath = path.slice(0, idx);
            const fns = _watchers[ancestorPath];
            if (fns && fns.size) {
                const ancestorNewVal = _getDeep(ancestorPath.split('.'));
                const ancestorOldVal = ancestorSnapshots && ancestorSnapshots.has(ancestorPath)
                    ? ancestorSnapshots.get(ancestorPath)
                    : ancestorNewVal;
                // Sempre dispara: mudança profunda confirmada (newVal !== oldVal acima)
                fns.forEach(fn => { try { fn(ancestorNewVal, ancestorOldVal); } catch (e) { _reportError(ERROR_TYPES.WATCHER_ERROR, 'Watcher threw', { path: ancestorPath, message: e.message }); } });
            }
            idx = ancestorPath.lastIndexOf('.');
        }
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

        // Sempre agenda via microtask — elimina o caminho síncrono que rodava
        // efeitos de 1 dependência na hora, fora do batch (causava re-render
        // duplicado quando 2+ props do mesmo effect mudavam no mesmo tick)
        effects.forEach(e => e.schedule());
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
    //
    // Proteção contra re-entrância: se um effect muta dados durante o run(),
    // os novos effects são colocados em _pendingEffects e processados na próxima
    // geração (máximo de _FLUSH_MAX_GENERATIONS gerações por tick).
    // Se o limite for atingido, um erro é reportado via _reportError.

    const _FLUSH_MAX_GENERATIONS = 10;

    const _pendingEffects = new Set();
    let _flushQueued = false;
    let _flushDepth = 0;

    function _scheduleFlush() {
        if (_flushQueued) return;
        _flushQueued = true;
        Promise.resolve().then(function () {
            _flushQueued = false;
            _flushDepth = 0;

            while (_pendingEffects.size > 0) {
                if (_flushDepth >= _FLUSH_MAX_GENERATIONS) {
                    _reportError(ERROR_TYPES.RENDER_ERROR,
                        'Loop de reatividade detectado: ' + _FLUSH_MAX_GENERATIONS + ' gerações de effects sem estabilizar. Verifique mutations dentro de renders.',
                        { pendingCount: _pendingEffects.size }
                    );
                    _pendingEffects.clear();
                    break;
                }

                _flushDepth++;
                const batch = [..._pendingEffects];
                _pendingEffects.clear();

                const keysToSync = new Set();
                batch.forEach(e => {
                    e.scheduled = false;
                    e.run();
                    if (e.key) keysToSync.add(e.key);
                });

                keysToSync.forEach(_syncModelsForKey);
            }

            _flushDepth = 0;
        });
    }

    // ─── Batching para _applyTarget (push/splice/substituição de lista) ───────
    // Também usa microtask — consistência no timing entre os dois paths.

    const _pendingKeys = new Set();
    const _pendingKeysNeedRender = new Set(); // subset de _pendingKeys que precisa do cascade completo
    let _applyQueued = false;

    // needsRender=true (default) → cascade completo (push/splice/substituição de lista,
    // 1ª atribuição de key). needsRender=false → só dispara lifecycle/sync, o(s) effect(s)
    // granular(es) já cuidaram do nó certo via _trigger.
    function _scheduleApply(key, needsRender) {
        if (needsRender === undefined) needsRender = true;
        _pendingKeys.add(key);
        if (needsRender) _pendingKeysNeedRender.add(key);
        if (_applyQueued) return;
        _applyQueued = true;
        Promise.resolve().then(function () {
            _applyQueued = false;
            const keys = [..._pendingKeys];
            const needRender = new Set(_pendingKeysNeedRender);
            _pendingKeys.clear();
            _pendingKeysNeedRender.clear();
            keys.forEach(function (k) { _applyTarget(k, needRender.has(k)); });
            keys.forEach(_syncModelsForKey);
        });
    }

    // ─── Segurança — parser AST mínimo ───────────────────────────────────────────
    //
    // Valida expressões x-on sem dependências externas.
    // Suporta: atribuições, chamadas, encadeamento, ++/--, operadores lógicos,
    //          ternário, múltiplas expressões separadas por ; e variáveis mágicas.
    // Bloqueia: constructor, eval, fetch, window, document, __proto__, etc.

    // Identificadores globais sempre permitidos
    const _SAFE_GLOBALS = new Set([
        'true', 'false', 'null', 'undefined', 'event',
        'Math', 'JSON', 'Date', 'Number', 'String', 'Boolean', 'Array', 'Object',
        'parseInt', 'parseFloat', 'isNaN', 'isFinite'
    ]);

    // Identificadores sempre bloqueados independente do scope
    // adiciona bloqueio a métodos de introspecção de protótipo ───
    const _BLOCKED_IDS = new Set([
        'constructor', 'prototype', '__proto__', '__defineGetter__', '__defineSetter__',
        'eval', 'Function', 'fetch', 'XMLHttpRequest', 'WebSocket', 'Worker',
        'window', 'document', 'globalThis', 'global', 'self', 'top', 'parent', 'frames',
        'location', 'history', 'navigator', 'screen', 'alert', 'confirm', 'prompt',
        'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
        'requestAnimationFrame', 'cancelAnimationFrame',
        'import', 'require', 'module', 'exports', 'process', '__dirname', '__filename',
        'Reflect', 'Proxy', 'Symbol', 'WeakMap', 'WeakSet', 'WeakRef',
        'atob', 'btoa', 'open', 'close', 'postMessage',
        // fix: bypass via Object.getPrototypeOf(obj) contornava o blocklist de
        // 'constructor'/'prototype'/'__proto__' pois usava nome de método diferente
        'getPrototypeOf', 'setPrototypeOf', 'getOwnPropertyDescriptor',
        'getOwnPropertyDescriptors', 'defineProperty', 'defineProperties', 'create',
    ]);

    // Tokenizer mínimo
    // Retorna array de tokens: { type, value }
    // Types: 'str', 'num', 'op', 'id', 'punc'
    function _tokenize(expr) {
        const tokens = [];
        let i = 0;
        const len = expr.length;

        while (i < len) {
            // Whitespace
            if (/\s/.test(expr[i])) { i++; continue; }

            // String literal simples ou dupla
            if (expr[i] === '\'' || expr[i] === '"') {
                const q = expr[i++];
                let s = '';
                while (i < len && expr[i] !== q) {
                    if (expr[i] === '\\') { s += expr[i++]; } // escape
                    s += expr[i++];
                }
                if (expr[i] === q) i++;
                tokens.push({ type: 'str', value: s });
                continue;
            }

            // Número
            if (/[0-9]/.test(expr[i]) || (expr[i] === '.' && /[0-9]/.test(expr[i+1]))) {
                let n = '';
                while (i < len && /[0-9.]/.test(expr[i])) n += expr[i++];
                tokens.push({ type: 'num', value: n });
                continue;
            }

            // Identificador ou keyword
            if (/[A-Za-z_$]/.test(expr[i])) {
                let id = '';
                while (i < len && /[A-Za-z0-9_$]/.test(expr[i])) id += expr[i++];
                tokens.push({ type: 'id', value: id });
                continue;
            }

            // Operadores compostos e simples
            const twoChar = expr.slice(i, i + 2);
            if (['++', '--', '+=', '-=', '*=', '/=', '%=',
                 '==', '!=', '<=', '>=', '===', '!==',
                 '&&', '||', '??', '=>'].includes(twoChar)) {
                // verifica 3 chars primeiro
                const threeChar = expr.slice(i, i + 3);
                if (['===', '!=='].includes(threeChar)) {
                    tokens.push({ type: 'op', value: threeChar }); i += 3;
                } else {
                    tokens.push({ type: 'op', value: twoChar }); i += 2;
                }
                continue;
            }

            // Char único permitido
            if ('=+-*/%!<>&|?:.,;()[]{}'.includes(expr[i])) {
                tokens.push({ type: 'punc', value: expr[i++] });
                continue;
            }

            // Qualquer outro char → bloqueia
            return null;
        }

        return tokens;
    }

    // ─── Parser AST + Interpreter ────────────────────────────────────────────
    //
    // Substitui `new Function(...)` como motor de avaliação de expressões.
    // Motivo: o validador por token (_validateTokens, abaixo) só inspeciona
    // tokens do tipo 'id' contra _BLOCKED_IDS — mas acesso via bracket notation
    // com string literal (ex: a['constructor']) gera token 'str', que NUNCA
    // passava pela checagem. Isso permitia escapar do sandbox e chegar em
    // `Function`/`window`/etc mesmo com o blocklist ativo.
    //
    // O interpreter abaixo nunca gera código executável a partir de string —
    // ele anda numa AST e resolve cada acesso a propriedade (dot OU bracket,
    // literal OU dinâmico) contra o MESMO blocklist, em runtime, via
    // _assertSafeProp(). Não importa como o nome da propriedade foi montado
    // (literal, concatenação, variável) — o que importa é o valor final, e
    // esse valor é sempre checado antes do get/set/call acontecer.
    //
    // _validateTokens/_safeExpr (mais abaixo) continuam existindo apenas como
    // heurística para decidir "bind agora" vs "aguardar prop existir no
    // store" em _bindEvents — não são mais a fronteira de segurança real.

    function _assertSafeProp(name) {
        if (_BLOCKED_IDS.has(name)) {
            throw new _SecurityError('Acesso bloqueado: "' + name + '"');
        }
    }

    function _SecurityError(message) {
        this.name = 'SecurityError';
        this.message = message;
    }
    _SecurityError.prototype = Object.create(Error.prototype);

    const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=']);

    function _Parser(tokens) {
        this.tokens = tokens;
        this.pos = 0;
    }
    _Parser.prototype.peek = function (offset) { return this.tokens[this.pos + (offset || 0)]; };
    _Parser.prototype.next = function () { return this.tokens[this.pos++]; };
    _Parser.prototype.atEnd = function () { return this.pos >= this.tokens.length; };
    _Parser.prototype.is = function (type, value) {
        const t = this.peek();
        if (!t || t.type !== type) return false;
        if (value !== undefined && t.value !== value) return false;
        return true;
    };
    _Parser.prototype.isPunc = function (v) { return this.is('punc', v); };
    // operadores de 1 char vêm como 'punc', os de 2+ chars como 'op' —
    // unifica a checagem por VALOR, ignorando o type.
    _Parser.prototype.isAnyOp = function (v) {
        const t = this.peek();
        return !!t && (t.type === 'op' || t.type === 'punc') && t.value === v;
    };
    _Parser.prototype.expectPunc = function (v) {
        if (!this.isPunc(v)) throw new SyntaxError('Esperado "' + v + '"');
        return this.next();
    };
    _Parser.prototype.parseProgram = function () {
        const body = [];
        if (this.atEnd()) return { type: 'Program', body: body };
        body.push(this.parseAssignment());
        while (this.isPunc(';')) {
            this.next();
            if (this.atEnd()) break;
            body.push(this.parseAssignment());
        }
        if (!this.atEnd()) throw new SyntaxError('Token inesperado: ' + JSON.stringify(this.peek()));
        return { type: 'Program', body: body };
    };
    _Parser.prototype._assertLValue = function (node) {
        if (node.type !== 'Identifier' && node.type !== 'MemberExpression') {
            throw new SyntaxError('Alvo de atribuição inválido');
        }
    };
    _Parser.prototype.parseAssignment = function () {
        const left = this.parseConditional();
        const t = this.peek();
        if (t && (t.type === 'op' || t.type === 'punc') && ASSIGN_OPS.has(t.value)) {
            this.next();
            const right = this.parseAssignment();
            this._assertLValue(left);
            return { type: 'AssignmentExpression', operator: t.value, left: left, right: right };
        }
        return left;
    };
    _Parser.prototype.parseConditional = function () {
        const test = this.parseNullish();
        if (this.isPunc('?')) {
            this.next();
            const consequent = this.parseAssignment();
            this.expectPunc(':');
            const alternate = this.parseAssignment();
            return { type: 'ConditionalExpression', test: test, consequent: consequent, alternate: alternate };
        }
        return test;
    };
    _Parser.prototype.parseNullish = function () { return this._parseLogical('??', this.parseOr.bind(this)); };
    _Parser.prototype.parseOr = function () { return this._parseLogical('||', this.parseAnd.bind(this)); };
    _Parser.prototype.parseAnd = function () { return this._parseLogical('&&', this.parseEquality.bind(this)); };
    _Parser.prototype._parseLogical = function (op, nextFn) {
        let left = nextFn();
        while (this.isAnyOp(op)) {
            this.next();
            const right = nextFn();
            left = { type: 'LogicalExpression', operator: op, left: left, right: right };
        }
        return left;
    };
    _Parser.prototype.parseEquality = function () { return this._parseBinaryLevel(['==', '!=', '===', '!=='], this.parseRelational.bind(this)); };
    _Parser.prototype.parseRelational = function () { return this._parseBinaryLevel(['<', '>', '<=', '>='], this.parseAdditive.bind(this)); };
    _Parser.prototype.parseAdditive = function () { return this._parseBinaryLevel(['+', '-'], this.parseMultiplicative.bind(this)); };
    _Parser.prototype.parseMultiplicative = function () { return this._parseBinaryLevel(['*', '/', '%'], this.parseUnary.bind(this)); };
    _Parser.prototype._parseBinaryLevel = function (ops, nextFn) {
        let left = nextFn();
        for (;;) {
            const t = this.peek();
            if (!t || (t.type !== 'op' && t.type !== 'punc') || ops.indexOf(t.value) === -1) break;
            this.next();
            const right = nextFn();
            left = { type: 'BinaryExpression', operator: t.value, left: left, right: right };
        }
        return left;
    };
    _Parser.prototype.parseUnary = function () {
        const t = this.peek();
        if (t && (t.type === 'punc' || t.type === 'op') && ['!', '-', '+'].indexOf(t.value) !== -1) {
            this.next();
            return { type: 'UnaryExpression', operator: t.value, argument: this.parseUnary() };
        }
        if (t && t.type === 'op' && (t.value === '++' || t.value === '--')) {
            this.next();
            const argument = this.parseUnary();
            this._assertLValue(argument);
            return { type: 'UpdateExpression', operator: t.value, argument: argument, prefix: true };
        }
        return this.parseUpdatePostfix();
    };
    _Parser.prototype.parseUpdatePostfix = function () {
        let node = this.parseCallMember();
        const t = this.peek();
        if (t && t.type === 'op' && (t.value === '++' || t.value === '--')) {
            this.next();
            this._assertLValue(node);
            node = { type: 'UpdateExpression', operator: t.value, argument: node, prefix: false };
        }
        return node;
    };
    _Parser.prototype.parseCallMember = function () {
        let node = this.parsePrimary();
        for (;;) {
            if (this.isPunc('.')) {
                this.next();
                const prop = this.next();
                if (!prop || prop.type !== 'id') throw new SyntaxError('Esperado identificador após "."');
                node = { type: 'MemberExpression', object: node, property: { type: 'Identifier', name: prop.value }, computed: false };
            } else if (this.isPunc('[')) {
                this.next();
                const property = this.parseAssignment();
                this.expectPunc(']');
                node = { type: 'MemberExpression', object: node, property: property, computed: true };
            } else if (this.isPunc('(')) {
                this.next();
                const args = [];
                if (!this.isPunc(')')) {
                    args.push(this.parseAssignment());
                    while (this.isPunc(',')) { this.next(); args.push(this.parseAssignment()); }
                }
                this.expectPunc(')');
                node = { type: 'CallExpression', callee: node, arguments: args };
            } else break;
        }
        return node;
    };
    _Parser.prototype.parsePrimary = function () {
        const t = this.peek();
        if (!t) throw new SyntaxError('Fim inesperado da expressão');
        if (t.type === 'num') { this.next(); return { type: 'Literal', value: parseFloat(t.value) }; }
        if (t.type === 'str') { this.next(); return { type: 'Literal', value: t.value }; }
        if (t.type === 'id') {
            this.next();
            if (t.value === 'true') return { type: 'Literal', value: true };
            if (t.value === 'false') return { type: 'Literal', value: false };
            if (t.value === 'null') return { type: 'Literal', value: null };
            if (t.value === 'undefined') return { type: 'Literal', value: undefined };
            return { type: 'Identifier', name: t.value };
        }
        if (this.isPunc('(')) {
            this.next();
            const expr = this.parseAssignment();
            this.expectPunc(')');
            return expr;
        }
        if (this.isPunc('[')) {
            this.next();
            const elements = [];
            if (!this.isPunc(']')) {
                elements.push(this.parseAssignment());
                while (this.isPunc(',')) { this.next(); elements.push(this.parseAssignment()); }
            }
            this.expectPunc(']');
            return { type: 'ArrayExpression', elements: elements };
        }
        if (this.isPunc('{')) {
            this.next();
            const properties = [];
            if (!this.isPunc('}')) {
                for (;;) {
                    const keyTok = this.next();
                    if (!keyTok || (keyTok.type !== 'id' && keyTok.type !== 'str')) throw new SyntaxError('Chave de objeto inválida');
                    this.expectPunc(':');
                    const value = this.parseAssignment();
                    properties.push({ key: String(keyTok.value), value: value });
                    if (this.isPunc(',')) { this.next(); continue; }
                    break;
                }
            }
            this.expectPunc('}');
            return { type: 'ObjectExpression', properties: properties };
        }
        throw new SyntaxError('Token inesperado: ' + JSON.stringify(t));
    };

    function _parseAST(expr) {
        const tokens = _tokenize(expr);
        if (!tokens) throw new SyntaxError('Falha na tokenização');
        return new _Parser(tokens).parseProgram();
    }

    // Cache de AST — chaveado só pelo texto da expressão (a AST não depende
    // do shape do scope, diferente do `new Function` antigo que precisava
    // recompilar por combinação de chaves). LRU simples com teto fixo.
    const _AST_CACHE_MAX = 500;
    const _astCache = new Map();
    function _getAST(expr) {
        let ast = _astCache.get(expr);
        if (ast) { _astCache.delete(expr); _astCache.set(expr, ast); return ast; } // marca como recém-usado
        ast = _parseAST(expr);
        if (_astCache.size >= _AST_CACHE_MAX) _astCache.delete(_astCache.keys().next().value);
        _astCache.set(expr, ast);
        return ast;
    }

    const _INTERP_SAFE_GLOBALS = {
        Math: Math, JSON: JSON, Date: Date, Number: Number, String: String,
        Boolean: Boolean, Array: Array, Object: Object,
        parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN, isFinite: isFinite,
    };

    function _Interpreter(scope) { this.scope = scope; }
    _Interpreter.prototype.run = function (ast) {
        let result;
        for (let i = 0; i < ast.body.length; i++) result = this.evalNode(ast.body[i]);
        return result;
    };
    _Interpreter.prototype.evalNode = function (node) {
        switch (node.type) {
            case 'Literal': return node.value;
            case 'Identifier': {
                if (node.name === 'undefined') return undefined;
                if (Object.prototype.hasOwnProperty.call(_INTERP_SAFE_GLOBALS, node.name)) return _INTERP_SAFE_GLOBALS[node.name];
                if (!(node.name in this.scope)) throw new ReferenceError('"' + node.name + '" não existe no scope');
                return this.scope[node.name];
            }
            case 'ArrayExpression':
                return node.elements.map(function (el) { return this.evalNode(el); }, this);
            case 'ObjectExpression': {
                const obj = {};
                for (let i = 0; i < node.properties.length; i++) {
                    const p = node.properties[i];
                    _assertSafeProp(p.key);
                    obj[p.key] = this.evalNode(p.value);
                }
                return obj;
            }
            case 'MemberExpression': {
                const r = this._resolveMember(node);
                return r.obj == null ? undefined : r.obj[r.key];
            }
            case 'CallExpression': {
                if (node.callee.type === 'MemberExpression') {
                    const r = this._resolveMember(node.callee);
                    if (r.obj == null) throw new TypeError('Chamando método em null/undefined');
                    const fn = r.obj[r.key];
                    if (typeof fn !== 'function') throw new TypeError('"' + r.key + '" não é função');
                    const args = node.arguments.map(function (a) { return this.evalNode(a); }, this);
                    return fn.apply(r.obj, args);
                }
                if (node.callee.type === 'Identifier') {
                    const fn = this.evalNode(node.callee);
                    if (typeof fn !== 'function') throw new TypeError('"' + node.callee.name + '" não é função');
                    const args = node.arguments.map(function (a) { return this.evalNode(a); }, this);
                    return fn.apply(null, args);
                }
                throw new _SecurityError('Chamada não suportada');
            }
            case 'UnaryExpression': {
                const v = this.evalNode(node.argument);
                if (node.operator === '!') return !v;
                if (node.operator === '-') return -v;
                if (node.operator === '+') return +v;
                break;
            }
            case 'UpdateExpression': {
                const lv = this._resolveLValue(node.argument);
                const old = lv.isIdentifier ? this.scope[lv.key] : lv.obj[lv.key];
                const nextVal = node.operator === '++' ? old + 1 : old - 1;
                if (lv.isIdentifier) this.scope[lv.key] = nextVal; else lv.obj[lv.key] = nextVal;
                return node.prefix ? nextVal : old;
            }
            case 'BinaryExpression': {
                const l = this.evalNode(node.left), r = this.evalNode(node.right);
                switch (node.operator) {
                    case '+': return l + r;
                    case '-': return l - r;
                    case '*': return l * r;
                    case '/': return l / r;
                    case '%': return l % r;
                    case '==': return l == r;
                    case '!=': return l != r;
                    case '===': return l === r;
                    case '!==': return l !== r;
                    case '<': return l < r;
                    case '>': return l > r;
                    case '<=': return l <= r;
                    case '>=': return l >= r;
                }
                break;
            }
            case 'LogicalExpression': {
                const l = this.evalNode(node.left);
                if (node.operator === '&&') return l ? this.evalNode(node.right) : l;
                if (node.operator === '||') return l ? l : this.evalNode(node.right);
                if (node.operator === '??') return l != null ? l : this.evalNode(node.right);
                break;
            }
            case 'ConditionalExpression':
                return this.evalNode(node.test) ? this.evalNode(node.consequent) : this.evalNode(node.alternate);
            case 'AssignmentExpression': {
                const lv = this._resolveLValue(node.left);
                let value = this.evalNode(node.right);
                if (node.operator !== '=') {
                    const current = lv.isIdentifier ? this.scope[lv.key] : lv.obj[lv.key];
                    switch (node.operator) {
                        case '+=': value = current + value; break;
                        case '-=': value = current - value; break;
                        case '*=': value = current * value; break;
                        case '/=': value = current / value; break;
                        case '%=': value = current % value; break;
                    }
                }
                if (lv.isIdentifier) this.scope[lv.key] = value; else lv.obj[lv.key] = value;
                return value;
            }
            default:
                throw new _SecurityError('Nó não suportado: ' + node.type);
        }
    };
    // Resolve um MemberExpression validando CADA propriedade no caminho —
    // dot ou bracket, literal ou dinâmica. É aqui que o bypass de bracket
    // notation com string (ex: a['constructor']) finalmente é barrado,
    // porque o valor de `key` já foi computado — não importa como.
    _Interpreter.prototype._resolveMember = function (node) {
        const obj = this.evalNode(node.object);
        const key = node.computed ? this.evalNode(node.property) : node.property.name;
        _assertSafeProp(String(key));
        return { obj: obj, key: key };
    };
    _Interpreter.prototype._resolveLValue = function (node) {
        if (node.type === 'Identifier') {
            _assertSafeProp(node.name);
            return { key: node.name, isIdentifier: true };
        }
        const r = this._resolveMember(node);
        return { obj: r.obj, key: r.key, isIdentifier: false };
    };

    // Valida lista de tokens contra o scope
    // Regra: todo 'id' que não vem após '.' e não é global/scope é bloqueado.
    // Qualquer id em _BLOCKED_IDS é sempre bloqueado.
    // '=>' (arrow fn) nunca é permitido.
    function _validateTokens(tokens, scopeKeys) {
        if (!tokens) return false; // tokenização falhou

        let braceDepth = 0; // profundidade de { } — pra distinguir chave de objeto de variável

        for (let i = 0; i < tokens.length; i++) {
            const tok = tokens[i];

            if (tok.type === 'punc' && tok.value === '{') { braceDepth++; continue; }
            if (tok.type === 'punc' && tok.value === '}') { braceDepth = Math.max(0, braceDepth - 1); continue; }

            // Arrow function nunca permitida
            if (tok.type === 'op' && tok.value === '=>') return false;

            if (tok.type !== 'id') continue;

            // Sempre bloqueado
            if (_BLOCKED_IDS.has(tok.value)) return false;

            // Vem após '.' → é propriedade, não variável livre
            const prev = tokens[i - 1];
            if (prev && prev.type === 'punc' && prev.value === '.') continue;

            // Chave de objeto literal (ex: { val: 42 }) → não é leitura de variável
            const next = tokens[i + 1];
            if (braceDepth > 0 && next && next.type === 'punc' && next.value === ':') continue;

            // Alvo de atribuição simples (ex: "out = ...") → cria prop nova no
            // store, não precisa existir previamente no scope. Só vale pra
            // identificador "solto" (não member expression tipo "a.b = x",
            // que já cai no "prev is '.'" acima só pra 'b'; 'a' aqui precisaria
            // existir de qualquer forma pois é leitura implícita do objeto).
            if (next && next.type === 'punc' && next.value === '=') continue;

            // Global seguro
            if (_SAFE_GLOBALS.has(tok.value)) continue;

            // No scope
            if (scopeKeys.has(tok.value)) continue;

            // Desconhecido → bloqueia
            return false;
        }

        return true;
    }

    function _safeExpr(expr, scope) {
        const trimmed = expr.trim();
        if (!trimmed) return false;

        const scopeKeys = scope ? new Set(Object.keys(scope)) : new Set();
        const tokens = _tokenize(trimmed);
        return _validateTokens(tokens, scopeKeys);
    }

    // _isBlockedExpr: verifica apenas _BLOCKED_IDS, sem exigir que o scope
    // contenha todas as props. Usado para distinguir "prop ainda não existe"
    // de "expressão genuinamente perigosa" no retry de _pendingBinds.
    function _isBlockedExpr(expr) {
        const tokens = _tokenize(expr.trim());
        if (!tokens) return true;
        return tokens.some(function (tok, i) {
            if (tok.type === 'op' && tok.value === '=>') return true;
            if (tok.type !== 'id') return false;
            const prev = tokens[i - 1];
            if (prev && prev.type === 'punc' && prev.value === '.') return false;
            return _BLOCKED_IDS.has(tok.value);
        });
    }

    // _evalExpr: avalia expressão reativa via parser+interpreter (sem eval/
    // new Function). O AST vem do cache global (_getAST); o scope passado
    // aqui é só o objeto de leitura — nenhuma escrita "vaza" pra fora dele.
    function _evalExpr(expr, scope, componentKey) {
        try {
            const ast = _getAST(expr);
            return new _Interpreter(scope).run(ast);
        } catch (e) {
            const type = (e instanceof _SecurityError) ? ERROR_TYPES.SECURITY_BLOCKED : ERROR_TYPES.X_BIND_EVAL;
            _reportError(type, 'Falha ao avaliar expressão', {
                expr: expr,
                message: e.message,
                component: componentKey,
            });
            return undefined;
        }
    }

    // AST cache é global por texto de expressão (não por componente), então
    // não há nada pra purgar por key no destroy — mantido como no-op pra não
    // quebrar a chamada existente em _destroyKey.
    function _purgeExprCache(key) { /* no-op — ver comentário acima */ }

    function _interpolate(str, scope, componentKey) {
        return str.replace(/\{([^}]+)\}/g, (_, expr) => {
            const val = _evalExpr(expr.trim(), scope, componentKey);
            return val != null ? val : '';
        });
    }

    function _isTruthy(expr, scope, componentKey) {
        return !!_evalExpr(expr, scope, componentKey);
    }

    // ─── x-model ──────────────────────────────────────────────────────────────

    function _parsePath(path) {
        const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
        return { key: parts[0], parts };
    }

    // _setDeep — remove fallback que escrevia direto em _store sem passar pelo proxy ───
    function _setDeep(parts, value) {
        // Garante que o proxy do key existe antes de navegar — mesma lógica
        // usada no `get` trap de initProxy(). Elimina o fallback antigo que
        // gravava direto em _store e pulava o set trap (sem _trigger/watchers).
        if (!_proxies[parts[0]]) {
            if (!_store[parts[0]]) _store[parts[0]] = {};
            _proxies[parts[0]] = _makeProxy(_store[parts[0]], parts[0]);
        }

        let obj = _proxies[parts[0]];
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
        // x-model é relativo ao container (ex: "form.nome", sem prefixo do key).
        // Todo o resto da lib (effects, _setDeep, _syncModelsForKey, _getDeep)
        // espera parts[0] === key (path absoluto a partir de _store). Prefixa
        // aqui, uma única vez, pra manter esse contrato em todos os callers.
        // Se o path já vier absoluto (parts[0] === key), não duplica.
        const fullParts = parts[0] === key ? parts : [key].concat(parts);
        return {
            key,
            parts: fullParts
        };
    }

    function _syncModelsForKey(key) {
        const els = _modelRegistry.get(key);
        if (!els || !els.size) return;
        els.forEach(function (el) {
            // Remove do registry se o elemento saiu do DOM
            if (!el.isConnected) { els.delete(el); return; }
            const { parts } = _resolveModel(el);
            const val = _getDeep(parts);
            if (el.type === 'checkbox') {
                el.checked = !!val;
            } else if (el.type === 'radio') {
                el.checked = (el.value === String(val));
            } else if (el.tagName === 'TEXTAREA') {
                const str = val == null ? '' : String(val);
                if (el.value !== str) el.value = str;
            } else {
                const str = val == null ? '' : String(val);
                if (el.value !== str) el.value = str;
            }
        });
    }

    function _initModels(root) {
        var _root = (root && root.nodeType === Node.ELEMENT_NODE) ? root : document;
        _root.querySelectorAll('[x-model]').forEach(function (el) {
            if (_sGet(el, 'model')) return;
            _sSet(el, 'model', true);

            const {
                key,
                parts
            } = _resolveModel(el);

            if (!_store[parts[0]]) _store[parts[0]] = {};
            if (!_proxies[parts[0]]) _proxies[parts[0]] = _makeProxy(_store[parts[0]], parts[0]);

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
                } else if (el.tagName === 'TEXTAREA') {
                    const str = v == null ? '' : String(v);
                    if (el.value !== str) el.value = str;
                } else {
                    const str = v == null ? '' : String(v);
                    if (el.value !== str) el.value = str;
                }
            });
            effect.key = key;
            _sSet(el, 'modelEffect', effect);
            effect.run();

            _modelRegistryAdd(key, el);

            function _onInput() {
                const v = el.type === 'checkbox' ? el.checked : el.value;
                _setDeep(parts, v);
            }

            _sSet(el, 'modelHandler', _onInput);
            el.addEventListener('input', _onInput);
            el.addEventListener('change', _onInput);
        });
    }
    // ─── x-model dentro de x-for ────────────────────────────────────────────
    // _resolveModel/_initModels resolvem x-model a partir do key do container
    // [x-data], não do alias do loop (ex: "item.valor"). Por isso x-model
    // dentro de x-for precisa de um bind próprio, direto no proxy do item
    // (scope[alias]), que já é reativo e propaga pro array real.
    function _bindModelsInLoop(root, scope, rootKey) {
        if (!root || root.nodeType !== Node.ELEMENT_NODE) return;
        const els = root.hasAttribute('x-model')
            ? [root, ...root.querySelectorAll('[x-model]')]
            : Array.from(root.querySelectorAll('[x-model]'));

        els.forEach(function (el) {
            const modelAttr = el.getAttribute('x-model');
            const { parts } = _parsePath(modelAttr);
            const aliasVal = scope[parts[0]];

            // Não é um alias de loop (proxy de item) → deixa pro _initModels padrão
            if (!aliasVal || typeof aliasVal !== 'object' || !aliasVal[_PROXY_SYM]) return;

            const subParts = parts.slice(1);
            if (!subParts.length) return;

            if (_sGet(el, 'loopModel')) {
                // Reuso do nó: pode ser um item diferente agora — atualiza a
                // referência do proxy e força re-sync do valor exibido.
                _sSet(el, 'loopAlias', aliasVal);
                const existingEffect = _sGet(el, 'loopModelEffect');
                if (existingEffect) existingEffect.run();
                return;
            }
            _sSet(el, 'loopModel', true);
            _sSet(el, 'loopAlias', aliasVal);

            function _getVal() {
                let obj = _sGet(el, 'loopAlias');
                for (let i = 0; i < subParts.length - 1; i++) {
                    if (obj == null) return undefined;
                    obj = obj[subParts[i]];
                }
                return obj == null ? undefined : obj[subParts[subParts.length - 1]];
            }
            function _setVal(v) {
                let obj = _sGet(el, 'loopAlias');
                for (let i = 0; i < subParts.length - 1; i++) {
                    if (obj == null) return;
                    obj = obj[subParts[i]];
                }
                if (obj != null) obj[subParts[subParts.length - 1]] = v;
            }

            const effect = _createEffect(function () {
                const v = _getVal();
                if (el.type === 'checkbox') {
                    el.checked = !!v;
                } else if (el.type === 'radio') {
                    el.checked = (el.value === String(v));
                } else if (el.tagName === 'TEXTAREA') {
                    const str = v == null ? '' : String(v);
                    if (el.value !== str) el.value = str;
                } else {
                    const str = v == null ? '' : String(v);
                    if (el.value !== str) el.value = str;
                }
            });
            effect.key = rootKey;
            // Nota: usa uma key própria ('loopModelEffect'), separada do effect
            // de render do nó ('effect') — a mesma classe de colisão corrigida
            // no _initModels (CHANGELOG 2.7.5) também existia aqui, já que
            // x-model dentro de um item que também carrega x-for/x-if no
            // mesmo elemento sobrescrevia o effect de render.
            _sSet(el, 'loopModelEffect', effect);
            effect.run();

            function _onInput() {
                const v = el.type === 'checkbox' ? el.checked : el.value;
                _setVal(v);
            }
            _sSet(el, 'loopModelHandler', _onInput);
            el.addEventListener('input', _onInput);
            el.addEventListener('change', _onInput);
        });
    }

    // ─── x-on ─────────────────────────────────────────────────────────────────

    // _isInsideXFor: retorna true se o elemento está dentro de um x-for,
    // excluindo o próprio root. Elementos dentro de x-for são bindados
    // pelo _renderFor com o scope correto do loop — não devem ser rebindados aqui.
    function _isInsideXFor(el, root) {
        let ancestor = el.parentElement;
        while (ancestor && ancestor !== root) {
            if (ancestor.hasAttribute('x-for')) return true;
            ancestor = ancestor.parentElement;
        }
        return false;
    }

    function _bindEvents(root, scope, key) {
        const els = root.nodeType === Node.ELEMENT_NODE
            ? [root, ...root.querySelectorAll('*')]
            : [];

        els.forEach(function (el) {
            if (!el.attributes) return;
            // Elementos dentro de x-for já foram bindados pelo _renderFor
            if (el !== root && _isInsideXFor(el, root)) return;
            for (let attr of el.attributes) {
                if (!attr.name.startsWith('x-on:')) continue;
                const event = attr.name.slice(5);
                const expr = attr.value;
                const sKey = 'on_' + event;

                // Já bindado com sucesso — não rebinda
                if (_sGet(el, sKey)) continue;

                // Monta scope de validação enriquecido com chaves do store vivo
                // para que propriedades ainda não existentes no snapshot sejam aceitas
                const liveData = key ? (_store[key] || {}) : {};
                const validationScope = Object.assign({}, liveData, scope);

                if (!_safeExpr(expr, validationScope)) {
                    if (_isBlockedExpr(expr)) {
                        // Bloqueio definitivo — contém identificador proibido
                        _reportError(ERROR_TYPES.X_ON_UNSAFE, 'Expressão bloqueada por segurança no x-on', {
                            expr    : expr,
                            element : _elementId(el),
                            attr    : attr.name,
                        });
                    } else if (key) {
                        // Prop ainda não existe no store — agenda retry
                        if (!_pendingBinds.has(key)) _pendingBinds.set(key, new Set());
                        _pendingBinds.get(key).add({ el, scope, key });
                    }
                    continue;
                }

                const handler = function (e) {
                    try {
                        // Monta $s: objeto com getters/setters que delegam ao proxy vivo.
                        // O interpreter resolve Identifier/MemberExpression contra $s
                        // via get/set nativo do JS — os defineProperty abaixo roteiam
                        // automaticamente pros setters reativos, sem reescrever a expressão.
                        const liveProxy = key ? (_proxies[key] || {}) : {};
                        const $s = Object.create(null);

                        // Props do scope de loop/contexto
                        Object.keys(scope).forEach(function (k) {
                            const v = scope[k];
                            if (v && typeof v === 'object' && v[_PROXY_SYM]) {
                                Object.defineProperty($s, k, {
                                    configurable: true, enumerable: true,
                                    get() { return v; },
                                    set(val) { /* items de loop: mutação direta via proxy */ v[k] = val; }
                                });
                            } else {
                                Object.defineProperty($s, k, {
                                    configurable: true, enumerable: true,
                                    get() { return liveProxy[k] !== undefined ? liveProxy[k] : v; },
                                    set(val) { if (k in liveProxy) liveProxy[k] = val; }
                                });
                            }
                        });

                        // Props do proxy vivo — cobertas no momento do clique (dinâmico)
                        Object.keys(liveProxy).forEach(function (k) {
                            if (k in $s) return;
                            Object.defineProperty($s, k, {
                                configurable: true, enumerable: true,
                                get() { return liveProxy[k]; },
                                set(val) { liveProxy[k] = val; }
                            });
                        });

                        // Identificadores que são alvo de atribuição NOVA (ex: "out = ...")
                        // e ainda não existem em liveProxy nem no scope. Sem isso, o
                        // interpreter não os enxerga como propriedade de $s (Identifier
                        // teria que existir em `scope`) e a atribuição falha em vez de
                        // criar a prop no store.
                        const exprTokens = _tokenize(expr);
                        if (exprTokens) {
                            exprTokens.forEach(function (tok, i) {
                                if (tok.type !== 'id' || tok.value in $s) return;
                                const prevTok = exprTokens[i - 1];
                                if (prevTok && prevTok.type === 'punc' && prevTok.value === '.') return;
                                const nextTok = exprTokens[i + 1];
                                if (!(nextTok && nextTok.type === 'punc' && nextTok.value === '=')) return;
                                const propName = tok.value;
                                Object.defineProperty($s, propName, {
                                    configurable: true, enumerable: true,
                                    get() { return liveProxy[propName]; },
                                    set(val) { liveProxy[propName] = val; }
                                });
                            });
                        }

                        // 'event' não é global fixo — é o Event do próprio disparo.
                        // Injeta como prop comum do $s (interpreter resolve como
                        // Identifier normal, sem precisar de tratamento especial).
                        if (!('event' in $s)) $s.event = e;

                        const ast = _getAST(expr);
                        new _Interpreter($s).run(ast);
                    } catch (err) {
                        const type = (err instanceof _SecurityError) ? ERROR_TYPES.SECURITY_BLOCKED : ERROR_TYPES.X_ON_UNSAFE;
                        _reportError(type, 'Erro ao executar x-on', {
                            expr    : expr,
                            element : _elementId(el),
                            message : err.message,
                        });
                    }
                };
                _sSet(el, sKey, handler);
                el.addEventListener(event, handler);
            }
        });
    }

    // ─── Render com tracking ──────────────────────────────────────────────────
    //
    // _renderTracked: cria ou reutiliza um Effect para o nó.
    // Cada nó com diretiva reativa (x-bind, x-if, x-for) tem seu próprio Effect.
    // Updates pontuais chegam direto ao Effect do nó — sem percorrer a lista.

    function _renderTracked(node, scope, key) {
        const existing = _sGet(node, 'effect');
        if (existing) {
            existing.scope = scope;
            if (key) existing.key = key;
            existing.run();
            return;
        }

        const effect = _createEffect(function () {
            _renderNodeRaw(node, effect.scope);
        });
        effect.scope = scope;
        effect.key = key || null;
        _sSet(node, 'effect', effect);
        effect.run();
    }

    // _renderNodeRaw: executa o render dentro do Effect ativo.
    function _renderNodeRaw(node, scope, componentKey) {
        if (node.nodeType === Node.TEXT_NODE) return;

        // Herda componentKey do effect do próprio nó, se disponível
        const _nodeEffect = _sGet(node, 'effect');
        const ck = componentKey || (_nodeEffect && _nodeEffect.key) || null;

        const xFor = node.getAttribute && node.getAttribute('x-for');
        const xIf = node.getAttribute && node.getAttribute('x-if');
        const xBind = node.getAttribute && node.getAttribute('x-bind');

        if (xIf != null) {
            const show = _isTruthy(xIf, scope, ck);
            node.style.display = show ? '' : 'none';
            if (!show) return;
        }

        if (xBind != null) {
            if (xBind.includes('{')) {
                node.textContent = _interpolate(xBind, scope, ck);
            } else {
                const val = _evalExpr(xBind, scope, ck);
                node.textContent = val != null ? val : '';
            }
        }

        if (node.attributes) {
            const _SKIP_ATTRS = /^(x-bind|x-if|x-for|x-model|x-on:|x-ref|x-key)/;
            let attrTpl = _sGet(node, 'attrTpl');
            if (!attrTpl) attrTpl = _sSet(node, 'attrTpl', {});
            for (let i = 0; i < node.attributes.length; i++) {
                const attr = node.attributes[i];
                if (_SKIP_ATTRS.test(attr.name)) continue;

                // Guarda o template ORIGINAL na primeira vez que o atributo é visto —
                // sem isso, setAttribute() abaixo sobrescreve "{expr}" pelo valor já
                // interpolado, e a próxima render não encontra mais o '{' pra reinterpolar.
                if (!(attr.name in attrTpl)) {
                    if (!attr.value.includes('{')) continue;
                    attrTpl[attr.name] = attr.value;
                }

                node.setAttribute(attr.name, _interpolate(attrTpl[attr.name], scope, ck));
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
                // Sobe na árvore para encontrar o rootKey mais próximo
                let rootKey = ck;
                if (!rootKey) {
                    let ancestor = node;
                    while (ancestor) {
                        const ancestorEffect = _sGet(ancestor, 'effect');
                        if (ancestorEffect && ancestorEffect.key) {
                            rootKey = ancestorEffect.key;
                            break;
                        }
                        ancestor = ancestor.parentElement;
                    }
                }
                _renderTracked(child, scope, rootKey);
            } else {
                _renderNodeRaw(child, scope, ck);
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
                path    : _sGet(node, 'effect')?.key || 'unknown',
            });
            return;
        }

        const list = _evalExpr(listExp, parentScope);
        const xKeyExpr = node.getAttribute('x-key') || null;
        const template = _sGet(node, 'template');
        const templateHasModel = !!template && template.indexOf('x-model') !== -1;

        const parentEffect = _sGet(node, 'effect');
        const rootKey = parentEffect ? parentEffect.key : null;

        const rootEl = rootKey
            ? document.querySelector('[x-data="' + CSS.escape(rootKey) + '"]')
            : null;

        if (!Array.isArray(list) || list.length === 0) {
            (_sGet(node, 'groups') || []).forEach(function (g) {
                g.nodes.forEach(function (el) {
                    const elEffect = _sGet(el, 'effect');
                    if (elEffect) elEffect.cleanup();
                });
            });
            node.innerHTML = '';
            _sSet(node, 'keys', []);
            _sSet(node, 'groups', []);
            return;
        }

        const existingByKey = {};
        const prevGroups = _sGet(node, 'groups') || [];
        const currentKeys = prevGroups.map(function (g) { return g.key; });

        prevGroups.forEach(function (g) {
            existingByKey[g.key] = g.nodes;
        });

        const newKeys = [];
        const newNodes = [];
        const newScopes = [];
        const newThis = [];
        const newNodeGroups = [];

        list.forEach(function (item, index) {
            const rawItem = (item && item[_PROXY_SYM]) ? item : _makeProxy(
                (item && item.__raw) ? item.__raw : item,
                rootKey || ''
            );
            const itemWithIndex = new Proxy(rawItem, {
                get(target, prop, receiver) {
                    if (prop === '$i' || prop === '$index') return index;
                    return Reflect.get(target, prop, receiver);
                }
            });

            const parentThis = parentScope.$this || null;
            const itemThis = {
                index: index,
                dom: null,
                data: item,
                parent: parentThis
            };

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
                const groupNodes = existingByKey[key];
                groupNodes.forEach(function (existingEl) {
                    [existingEl, ...existingEl.querySelectorAll('*')].forEach(el => {
                        if (!el.attributes) return;
                        for (let attr of el.attributes) {
                            if (!attr.name.startsWith('x-on:')) continue;
                            const event = attr.name.slice(5);
                            const sKey = 'on_' + event;
                            const handler = _sGet(el, sKey);
                            if (handler) {
                                el.removeEventListener(event, handler);
                                _sDelete(el, sKey);
                            }
                        }
                    });
                    _renderTracked(existingEl, scope, rootKey);
                });
                newNodes.push(...groupNodes);
                newNodeGroups.push(groupNodes);
            } else {
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
                    newNodeGroups.push([children[0]]);
                } else {
                    children.forEach(c => _renderTracked(c, scope, rootKey));
                    newNodes.push(...children);
                    newNodeGroups.push(children);
                }
            }
        });

        // ── Remove obsoletos ──────────────────────────────────────────────────
        const newKeySet = new Set(newKeys);
        currentKeys.forEach(function (key) {
            if (!newKeySet.has(key) && existingByKey[key]) {
                existingByKey[key].forEach(function (el) {
                    const elEffect = _sGet(el, 'effect');
                    if (elEffect) elEffect.cleanup();
                    el.remove();
                });
            }
        });

        // ── Remove filhos extras não rastreados ───────────────────────────────
        const newNodeSet = new Set(newNodes);
        Array.from(node.children).forEach(function (child) {
            if (!newNodeSet.has(child)) child.remove();
        });

        // ── Insere/reordena via DocumentFragment — único reflow para novos e reordenados ──
        const needsReorder = newNodes.some(function (el, i) {
            return node.children[i] !== el;
        });

        if (needsReorder) {
            const frag = document.createDocumentFragment();
            newNodes.forEach(function (el) { frag.appendChild(el); });
            node.appendChild(frag);
        }

        _sSet(node, 'keys', newKeys);
        _sSet(node, 'groups', newKeys.map(function (key, i) {
            return { key: key, nodes: newNodeGroups[i] };
        }));

        // ── Preenche $this.dom e bind eventos ─────────────────────────────────
        const $ref = {};
        if (rootEl) {
            rootEl.querySelectorAll('[x-ref]').forEach(function (refEl) {
                $ref[refEl.getAttribute('x-ref')] = refEl;
            });
        }

        newNodeGroups.forEach(function (nodes, i) {
            if (!newThis[i]) return;
            newThis[i].dom = nodes[0] || null;

            const $emit = function (name, detail) {
                if (!rootEl) return;
                rootEl.dispatchEvent(new CustomEvent(name, {
                    bubbles: true,
                    detail: detail || {}
                }));
            };

            const enrichedScope = Object.assign({}, newScopes[i], {
                $root: rootEl,
                $ref: $ref,
                $emit: $emit
            });

            nodes.forEach(function (el) {
                if (el && el.nodeType === Node.ELEMENT_NODE) {
                    _bindEvents(el, enrichedScope, rootKey);
                    if (templateHasModel) _bindModelsInLoop(el, enrichedScope, rootKey);
                }
            });
        });
    }

    // ─── Template cache ───────────────────────────────────────────────────────

    function _cacheTemplates(root) {
        root.querySelectorAll('[x-for]').forEach(function (el) {
            if (!_sGet(el, 'template')) _sSet(el, 'template', el.innerHTML);
        });
    }

    // ─── Apply ────────────────────────────────────────────────────────────────

    function _applyTarget(key, doRender) {
        if (doRender === undefined) doRender = true;
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

            // ✅ nunca escreve na proxy reativa. Object.create(baseScope) mantém baseScope
            // na prototype chain — assim scope.nome cai no get trap do Proxy de verdade e
            // RASTREIA a dependência (_track). Só não dá pra usar Object.assign(scope,{...})
            // pra adicionar $root/$ref/etc: como scope não tem essas props OWN, o [[Set]]
            // padrão do JS delega pro [[Set]] do prototype — e como o prototype é um Proxy,
            // isso disparava o SET TRAP DO STORE a cada render (escrevendo $root/$ref/$emit
            // dentro do próprio hero.*), causando _scheduleApply -> render -> set -> loop
            // infinito. Object.defineProperty cria a prop OWN direto, sem consultar/disparar
            // o prototype — sem esse problema.
            const scope = Object.create(baseScope);
            Object.defineProperties(scope, {
                $root:  { value: target, writable: true, enumerable: true, configurable: true },
                $ref:   { value: $ref, writable: true, enumerable: true, configurable: true },
                $emit:  { value: $emit, writable: true, enumerable: true, configurable: true },
                $i:     { value: undefined, writable: true, enumerable: true, configurable: true },
                $index: { value: undefined, writable: true, enumerable: true, configurable: true },
                $this:  { value: null, writable: true, enumerable: true, configurable: true }
            });

            // Cascade completo (_renderNodeRaw a partir da raiz) só quando NINGUÉM
            // tratou a mutação granularmente (_trigger não achou effect). Update pontual
            // já foi resolvido pelo effect do próprio nó — evita retocar a árvore inteira.
            if (doRender) {
                _renderTracked(target, scope, key);
            }

            // removeu o _bindEvents daqui

            Promise.resolve().then(function () {
                // ✅ FIX: binda x-on apenas em elementos fora do x-for
                _bindEvents(target, scope, key);

                // Retry de binds pendentes — após o bind normal, store já populado
                if (_pendingBinds.has(key)) {
                    const pending = _pendingBinds.get(key);
                    _pendingBinds.delete(key);
                    pending.forEach(function (p) {
                        _bindEvents(p.el, p.scope, p.key);
                    });
                }

                if (typeof data.$afterRender === 'function') {
                    try { data.$afterRender(target); } catch (e) { _reportError(ERROR_TYPES.LIFECYCLE, '$afterRender threw', { message: e.message, component: key }); }
                }
                target.dispatchEvent(new CustomEvent('after-render', { bubbles: false }));
            });
        });

        _syncModelsForKey(key);
    }

    // ─── Proxy factory ────────────────────────────────────────────────────────

    // _nestedProxyCache: WeakMap<rawObj, Map<cacheKey, proxy>>
    // cacheKey = key + '\0' + path — garante que o mesmo raw object usado em
    // componentes ou caminhos diferentes recebe proxies independentes,
    // com setters que disparam o key/path correto.
    const _nestedProxyCache = new WeakMap();

    function _getNestedProxy(raw, key, path) {
        let byPath = _nestedProxyCache.get(raw);
        if (!byPath) { byPath = new Map(); _nestedProxyCache.set(raw, byPath); }
        const cacheKey = key + '\u0000' + path;
        if (byPath.has(cacheKey)) return byPath.get(cacheKey);
        const nested = _makeProxy(raw, key, path);
        byPath.set(cacheKey, nested);
        return nested;
    }

    function _makeProxy(data, key, _path) {
        const basePath = _path || key;
        return new Proxy(data, {
            get(target, prop, receiver) {
                if (prop === _PROXY_SYM) return true;
                if (prop === '__raw') return target;

                if (typeof prop === 'string' && prop !== '__nid') {
                    _track(target, prop);
                }

                const val = Reflect.get(target, prop, receiver);
                if (val !== null && typeof val === 'object' && !val[_PROXY_SYM]) {
                    return _getNestedProxy(val, key, basePath + '.' + prop);
                }
                return val;
            },

            set(target, prop, value) {
                const oldVal = target[prop];
                if (oldVal === value) return true;

                if (prop === '__nid') { target[prop] = value; return true; }

                // Captura snapshots ancestrais ANTES da mutação
                const ancestorSnapshots = _snapshotAncestors(basePath + '.' + prop);

                target[prop] = value;

                _notifyWatchers(basePath + '.' + prop, value, oldVal, ancestorSnapshots);

                // Se já existe effect granular tracking esse (target, prop), o _trigger
                // já agenda exatamente o nó certo — não precisa do _applyTarget completo.
                // _scheduleApply só entra como fallback quando ninguém tracka essa prop
                // ainda (ex: novo índice de array via push, prop nova sem effect prévio).
                const handled = _trigger(target, prop);
                _scheduleApply(key, !handled);

                return true;
            },

            deleteProperty(target, prop) {
                const oldVal = target[prop];
                delete target[prop];
                _notifyWatchers(basePath + '.' + prop, undefined, oldVal);
                const handled = _trigger(target, prop);
                _scheduleApply(key, !handled);
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
                const key = 'on_' + event;
                const handler = _sGet(node, key);
                if (handler) {
                    node.removeEventListener(event, handler);
                    _sDelete(node, key);
                }
            }
        }

        // Cleanup effect granular
        const nodeEffect = _sGet(node, 'effect');
        if (nodeEffect) {
            nodeEffect.cleanup();
            _sDelete(node, 'effect');
        }

        // Remove x-model listeners (input/change)
        if (_sGet(node, 'model')) {
            const modelHandler = _sGet(node, 'modelHandler');
            if (modelHandler) {
                node.removeEventListener('input', modelHandler);
                node.removeEventListener('change', modelHandler);
                _sDelete(node, 'modelHandler');
            }
            const modelEffect = _sGet(node, 'modelEffect');
            if (modelEffect) {
                modelEffect.cleanup();
                _sDelete(node, 'modelEffect');
            }
            _sDelete(node, 'model');
        }

        // Remove x-model listeners de dentro de x-for
        if (_sGet(node, 'loopModel')) {
            const loopModelHandler = _sGet(node, 'loopModelHandler');
            if (loopModelHandler) {
                node.removeEventListener('input', loopModelHandler);
                node.removeEventListener('change', loopModelHandler);
                _sDelete(node, 'loopModelHandler');
            }
            const loopModelEffect = _sGet(node, 'loopModelEffect');
            if (loopModelEffect) {
                loopModelEffect.cleanup();
                _sDelete(node, 'loopModelEffect');
            }
            _sDelete(node, 'loopModel');
            _sDelete(node, 'loopAlias');
        }

        // Recursivo nos filhos
        Array.from(node.children).forEach(_destroyNode);
    }

    function _destroyKey(key) {
        // Cancela renders pendentes do key antes de qualquer coisa
        _pendingKeys.delete(key);

        const targets = document.querySelectorAll(
            '[proxy-target="' + CSS.escape(key) + '"], [x-data="' + CSS.escape(key) + '"]'
        );

        targets.forEach(function (target) {
            const data = _store[key] || {};

            // ── $beforeDestroy ────────────────────────────────────────────────
            if (typeof data.$beforeDestroy === 'function') {
                try {
                    data.$beforeDestroy(target);
                } catch (e) {
                    _reportError(ERROR_TYPES.LIFECYCLE, '$beforeDestroy threw', {
                        message: e.message,
                        component: key
                    });
                }
            }
            target.dispatchEvent(new CustomEvent('before-destroy', {
                bubbles: false
            }));

            // ── Destroy recursivo nos filhos ──────────────────────────────────
            Array.from(target.children).forEach(_destroyNode);

            // ── Limpa o próprio target ────────────────────────────────────────
            const targetEffect = _sGet(target, 'effect');
            if (targetEffect) {
                targetEffect.cleanup();
                _sDelete(target, 'effect');
            }
            _sDelete(target, 'keys');

            // ── $afterDestroy ─────────────────────────────────────────────────
            if (typeof data.$afterDestroy === 'function') {
                try {
                    data.$afterDestroy(target);
                } catch (e) {
                    _reportError(ERROR_TYPES.LIFECYCLE, '$afterDestroy threw', {
                        message: e.message,
                        component: key
                    });
                }
            }
            target.dispatchEvent(new CustomEvent('after-destroy', {
                bubbles: false
            }));
        });

        // Limpa store e proxy do key (isso já basta — o getter de shadowProxy.template
        // recria vazio se alguém acessar depois, não precisa de limpeza extra aqui)
        delete _store[key];
        delete _proxies[key];

        // Remove watchers cujo path começa com esse key
        Object.keys(_watchers).forEach(function (path) {
            if (path === key || path.startsWith(key + '.')) {
                delete _watchers[path];
            }
        });

        // Limpa model registry do key
        _modelRegistryRemove(key);

        // Limpa pending binds do key
        _pendingBinds.delete(key);

        // Limpa cache de expressões compiladas do key
        _purgeExprCache(key);
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    /**
     * @namespace proxy
     * @description
     * shadow-proxy — Reactive DOM binding via Recursive Proxy.
     *
     * Uso básico:
     * ```html
     * <div x-data="meuComponente">
     *   <span x-bind="titulo"></span>
     * </div>
     * <script>
     *   shadowProxy.initProxy();
     *   shadowProxy.template.meuComponente.titulo = 'Olá!';
     * </script>
     * ```
     */
    return {

        /** @type {string} Nome da biblioteca. */
        name: 'shadow-proxy',

        /** @type {string} Versão semântica atual. */
        version: '2.7.4',

        /**
         * Proxy raiz que expõe os stores de cada componente.
         *
         * Acesse via `shadowProxy.template.<key>` para ler ou escrever props reativas.
         * Cada acesso retorna um Proxy reativo — atribuições disparam re-render.
         *
         * Atalho de destruição disponível por componente:
         * ```js
         * shadowProxy.template.meuComponente.destroy();
         * ```
         *
         * @type {Object.<string, Object>}
         *
         * @example
         * shadowProxy.template.lista.itens = [{ nome: 'A' }, { nome: 'B' }];
         * shadowProxy.template.form.titulo = 'Novo título';
         */
        template: {},

        /**
         * Handler global de erros da biblioteca.
         *
         * Se definido, substitui o `console.error` padrão.
         * Recebe um objeto com os campos abaixo — campos extras variam por tipo.
         *
         * @type {((err: {
         *   type      : 'x-for-syntax'|'x-on-unsafe'|'x-bind-eval'|'x-if-eval'|
         *               'render-error'|'model-path'|'watcher-error'|'lifecycle-error'|
         *               'proxy-target'|'security-blocked',
         *   message   : string,
         *   timestamp : number,
         *   expr?     : string,
         *   element?  : string,
         *   attr?     : string,
         *   path?     : string,
         *   component?: string,
         * }) => void) | null}
         *
         * @example
         * shadowProxy.onError = function (err) {
         *   console.warn('[meu-app]', err.type, err.message, err);
         * };
         */
        onError: null,

        /**
         * Observa mudanças em qualquer caminho profundo do store.
         *
         * O callback é chamado com `(newVal, oldVal)` sempre que o valor
         * do caminho — ou qualquer prop descendente — for alterado.
         * Mudanças em props filhas borbulham até o caminho observado.
         *
         * @param  {string}   path  Caminho com notação de ponto: `'key.prop.sub'`.
         * @param  {(newVal: *, oldVal: *) => void} fn  Callback chamado na mudança.
         * @returns {() => void} Função de unsubscribe — chame para parar de observar.
         *
         * @example
         * const unsub = shadowProxy.on('carrinho.itens', (novo, antigo) => {
         *   console.log('itens mudaram', novo);
         * });
         *
         * // Para de observar:
         * unsub();
         */
        on: function (path, fn) {
            return _registerWatcher(path, fn);
        },

        /**
         * Registra listeners de `x-on:*` em elementos dentro de `root`.
         *
         * Chamado automaticamente pelo ciclo de render — use manualmente apenas
         * ao injetar HTML dinamicamente fora do fluxo normal do proxy.
         *
         * Expressões são validadas pelo sandbox antes do bind.
         * Expressões com props ainda inexistentes no store são agendadas para
         * retry automático no próximo render do componente.
         *
         * @param {Element} root   Elemento raiz a partir do qual os `x-on:*` são buscados.
         * @param {Object}  scope  Escopo de variáveis disponíveis nas expressões.
         * @param {string}  [key]  Chave do componente (`x-data` / `proxy-target`).
         * @returns {void}
         *
         * @example
         * // Uso manual após injeção de HTML dinâmico:
         * const container = document.querySelector('[x-data="feed"]');
         * shadowProxy.bindEvents(container, shadowProxy.template.feed, 'feed');
         */
        bindEvents: _bindEvents,

        /**
         * Inicializa o two-way binding para todos os elementos `x-model` no documento.
         *
         * Deve ser chamado uma vez após `initProxy()`, ou novamente após injetar
         * novos elementos `x-model` no DOM (ex: troca de página via fetch).
         *
         * Suporta `<input type="text">`, `<input type="checkbox">`,
         * `<input type="radio">` e `<select>`.
         *
         * @returns {void}
         *
         * @example
         * shadowProxy.initProxy();
         * shadowProxy.initModels();
         */
        initModels: _initModels,

        /**
         * Destrói um componente ou todos os componentes registrados.
         *
         * Remove listeners de eventos, efeitos reativos, watchers, model registry
         * e limpa o store interno do(s) componente(s).
         *
         * Dispara os lifecycle hooks `$beforeDestroy` / `$afterDestroy` e os
         * eventos DOM `before-destroy` / `after-destroy` no elemento alvo.
         *
         * @param {string} [key] Chave do componente a destruir.
         *                       Se omitida, destrói **todos** os componentes.
         * @returns {void}
         *
         * @example
         * // Destrói apenas um componente:
         * shadowProxy.destroy('meuComponente');
         *
         * // Ou via atalho no próprio template:
         * shadowProxy.template.meuComponente.destroy();
         *
         * // Destrói tudo (ex: troca de página):
         * shadowProxy.destroy();
         */
        destroy: function (key) {
            if (key) {
                _destroyKey(key);
            } else {
                Object.keys(_store).forEach(_destroyKey);
            }
        },

        /**
         * Inicializa o sistema reativo.
         *
         * Deve ser chamado uma vez após o DOM estar pronto.
         * Varre todos os elementos `[proxy-target]` e `[x-data]`, cacheia
         * os templates de `x-for` e configura o Proxy raiz em `shadowProxy.template`.
         *
         * Pode ser chamado novamente após `destroy()` para reinicializar
         * componentes (ex: navegação via fetch sem reload de página).
         *
         * @returns {void}
         *
         * @example
         * document.addEventListener('DOMContentLoaded', function () {
         *   shadowProxy.initProxy();
         *   shadowProxy.initModels();
         *
         *   shadowProxy.template.app.titulo   = 'Olá mundo';
         *   shadowProxy.template.app.lista    = [{ nome: 'Item 1' }];
         * });
         */
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

            // Auto-inicializa x-model — _initModels já faz querySelectorAll('[x-model]')
            // e sai cedo se não encontrar nada, então é seguro chamar sempre.
            _initModels();
        }
    };

})();