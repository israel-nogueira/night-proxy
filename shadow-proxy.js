/*!
 * shadow-proxy v2.7.0
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
 * v2.7.0 — Early template cache in initProxy (x-for with empty arrays)
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

        if (typeof proxy.onError === 'function') {
            try { proxy.onError(err); } catch (e) { console.error('[shadow-proxy] onError threw:', e); }
        } else {
            console.error('[shadow-proxy] ' + type + ':', message, err);
        }
    }

    // ─── Watchers — proxy.on(path, fn) ───────────────────────────────────────
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
        let idx = path.lastIndexOf('.');
        while (idx !== -1) {
            const ancestorPath = path.slice(0, idx);
            if (_watchers[ancestorPath] && _watchers[ancestorPath].size) {
                const val = _getDeep(ancestorPath.split('.'));
                // Cópia rasa para objetos — referência simples seria igual após mutação in-place
                snapshots.set(ancestorPath, (val && typeof val === 'object') ? Object.assign({}, val) : val);
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
        // x-model já vem com o path completo (ex: "t_model.nome"), parts[0] já é o key
        return {
            key,
            parts
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
                } else {
                    const str = v == null ? '' : String(v);
                    if (el.value !== str) el.value = str;
                }
            });
            effect.key = key;
            el.__shadowEffect = effect;
            effect.run();

            _modelRegistryAdd(key, el);

            function _onInput() {
                const v = el.type === 'checkbox' ? el.checked : el.value;
                _setDeep(parts, v);
            }

            el.__shadowModelHandler = _onInput;
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
            if (!aliasVal || typeof aliasVal !== 'object' || !aliasVal.__isProxy) return;

            const subParts = parts.slice(1);
            if (!subParts.length) return;

            if (el.__shadowLoopModel) {
                // Reuso do nó: pode ser um item diferente agora — atualiza a
                // referência do proxy e força re-sync do valor exibido.
                el.__shadowLoopAlias = aliasVal;
                if (el.__shadowEffect) el.__shadowEffect.run();
                return;
            }
            el.__shadowLoopModel = true;
            el.__shadowLoopAlias = aliasVal;

            function _getVal() {
                let obj = el.__shadowLoopAlias;
                for (let i = 0; i < subParts.length - 1; i++) {
                    if (obj == null) return undefined;
                    obj = obj[subParts[i]];
                }
                return obj == null ? undefined : obj[subParts[subParts.length - 1]];
            }
            function _setVal(v) {
                let obj = el.__shadowLoopAlias;
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
                } else {
                    const str = v == null ? '' : String(v);
                    if (el.value !== str) el.value = str;
                }
            });
            effect.key = rootKey;
            el.__shadowEffect = effect;
            effect.run();

            function _onInput() {
                const v = el.type === 'checkbox' ? el.checked : el.value;
                _setVal(v);
            }
            el.__shadowLoopModelHandler = _onInput;
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
                const flag = '__shadow_' + event;

                // Já bindado com sucesso — não rebinda
                if (el[flag]) continue;

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

                el[flag] = function (e) {
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
                            if (v && typeof v === 'object' && v.__isProxy) {
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
    function _renderNodeRaw(node, scope, componentKey) {
        if (node.nodeType === Node.TEXT_NODE) return;

        // Herda componentKey do effect do próprio nó, se disponível
        const ck = componentKey || (node.__shadowEffect && node.__shadowEffect.key) || null;

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
            if (!node.__shadowAttrTpl) node.__shadowAttrTpl = {};
            for (let i = 0; i < node.attributes.length; i++) {
                const attr = node.attributes[i];
                if (_SKIP_ATTRS.test(attr.name)) continue;

                // Guarda o template ORIGINAL na primeira vez que o atributo é visto —
                // sem isso, setAttribute() abaixo sobrescreve "{expr}" pelo valor já
                // interpolado, e a próxima render não encontra mais o '{' pra reinterpolar.
                if (!(attr.name in node.__shadowAttrTpl)) {
                    if (!attr.value.includes('{')) continue;
                    node.__shadowAttrTpl[attr.name] = attr.value;
                }

                node.setAttribute(attr.name, _interpolate(node.__shadowAttrTpl[attr.name], scope, ck));
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
                        if (ancestor.__shadowEffect && ancestor.__shadowEffect.key) {
                            rootKey = ancestor.__shadowEffect.key;
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
        // Evita custo de querySelectorAll por item quando o template não usa x-model
        const templateHasModel = !!template && template.indexOf('x-model') !== -1;

        // Propaga key do effect pai para os filhos
        const parentEffect = node.__shadowEffect;
        const rootKey = parentEffect ? parentEffect.key : null;

        // $root do container
        const rootEl = rootKey
            ? document.querySelector('[x-data="' + rootKey + '"]')
            : null;

        // ── Lista vazia ───────────────────────────────────────────────────────
        if (!Array.isArray(list) || list.length === 0) {
            (node.__shadowGroups || []).forEach(function (g) {
                g.nodes.forEach(function (el) {
                    if (el.__shadowEffect) el.__shadowEffect.cleanup();
                });
            });
            node.innerHTML = '';
            node.__shadowKeys = [];
            node.__shadowGroups = [];
            return;
        }

        // ── Monta mapa key → grupo de nós existente ──────────────────────────
        // Um item pode gerar mais de 1 nó-raiz (template multi-filho). Por isso
        // o reuso é feito por GRUPO (node.__shadowGroups), não por índice flat
        // em node.children — indexar por i quebrava a partir do 2º item quando
        // cada item ocupa mais de 1 posição no DOM.
        const existingByKey = {};
        const prevGroups = node.__shadowGroups || [];
        const currentKeys = prevGroups.map(function (g) { return g.key; });

        prevGroups.forEach(function (g) {
            existingByKey[g.key] = g.nodes;
        });

        const newKeys = [];
        const newNodes = [];
        const newScopes = [];
        const newThis = [];        // $this de cada item
        const newNodeGroups = [];  // nós DOM pertencentes a cada item (1+ por item)

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
                const groupNodes = existingByKey[key];
                groupNodes.forEach(function (existingEl) {
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
                });
                newNodes.push(...groupNodes);
                newNodeGroups.push(groupNodes);
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
                    if (el.__shadowEffect) el.__shadowEffect.cleanup();
                    el.remove();
                });
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
        node.__shadowGroups = newKeys.map(function (key, i) {
            return { key: key, nodes: newNodeGroups[i] };
        });

        // ── Preenche $this.dom e bind eventos ─────────────────────────────────
        // Agrupado por ITEM (newNodeGroups), não por nó — um item pode gerar
        // vários nós raiz (template multi-filho), e todos devem usar o MESMO
        // scope/$this daquele item, não do índice seguinte por acaso.
        //
        // $ref calculado UMA VEZ fora do loop de itens — antes rodava um
        // querySelectorAll('[x-ref]') completo POR ITEM (O(n²) numa lista
        // de N itens, já que x-ref não muda entre itens do mesmo x-for).
        const $ref = {};
        if (rootEl) {
            rootEl.querySelectorAll('[x-ref]').forEach(function (refEl) {
                $ref[refEl.getAttribute('x-ref')] = refEl;
            });
        }

        newNodeGroups.forEach(function (nodes, i) {
            if (!newThis[i]) return;
            newThis[i].dom = nodes[0] || null;

            // $emit — dispara CustomEvent no $root
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

            // ✅ nunca escreve na proxy reativa (Object.assign(baseScope,...) disparava
            // o set trap a cada render por causa de $ref/$emit sempre novos -> loop infinito)
            const scope = Object.assign({}, baseScope, {
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
                if (prop === '__isProxy') return true;
                if (prop === '__raw') return target;

                if (typeof prop === 'string' && prop !== '__nid') {
                    _track(target, prop);
                }

                const val = Reflect.get(target, prop, receiver);
                if (val !== null && typeof val === 'object' && !val.__isProxy) {
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

        // Remove x-model listeners (input/change)
        if (node.__shadowModel) {
            if (node.__shadowModelHandler) {
                node.removeEventListener('input', node.__shadowModelHandler);
                node.removeEventListener('change', node.__shadowModelHandler);
                delete node.__shadowModelHandler;
            }
            delete node.__shadowModel;
        }

        // Remove x-model listeners de dentro de x-for
        if (node.__shadowLoopModel) {
            if (node.__shadowLoopModelHandler) {
                node.removeEventListener('input', node.__shadowLoopModelHandler);
                node.removeEventListener('change', node.__shadowLoopModelHandler);
                delete node.__shadowLoopModelHandler;
            }
            delete node.__shadowLoopModel;
            delete node.__shadowLoopAlias;
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
            if (target.__shadowEffect) {
                target.__shadowEffect.cleanup();
                delete target.__shadowEffect;
            }
            delete target.__shadowKeys;

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

        // Limpa store e proxy do key (isso já basta — o getter de proxy.template
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
     *   proxy.initProxy();
     *   proxy.template.meuComponente.titulo = 'Olá!';
     * </script>
     * ```
     */
    return {

        /** @type {string} Nome da biblioteca. */
        name: 'shadow-proxy',

        /** @type {string} Versão semântica atual. */
        version: '2.7.0',

        /**
         * Proxy raiz que expõe os stores de cada componente.
         *
         * Acesse via `proxy.template.<key>` para ler ou escrever props reativas.
         * Cada acesso retorna um Proxy reativo — atribuições disparam re-render.
         *
         * Atalho de destruição disponível por componente:
         * ```js
         * proxy.template.meuComponente.destroy();
         * ```
         *
         * @type {Object.<string, Object>}
         *
         * @example
         * proxy.template.lista.itens = [{ nome: 'A' }, { nome: 'B' }];
         * proxy.template.form.titulo = 'Novo título';
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
         * proxy.onError = function (err) {
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
         * const unsub = proxy.on('carrinho.itens', (novo, antigo) => {
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
         * proxy.bindEvents(container, proxy.template.feed, 'feed');
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
         * proxy.initProxy();
         * proxy.initModels();
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
         * proxy.destroy('meuComponente');
         *
         * // Ou via atalho no próprio template:
         * proxy.template.meuComponente.destroy();
         *
         * // Destrói tudo (ex: troca de página):
         * proxy.destroy();
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
         * os templates de `x-for` e configura o Proxy raiz em `proxy.template`.
         *
         * Pode ser chamado novamente após `destroy()` para reinicializar
         * componentes (ex: navegação via fetch sem reload de página).
         *
         * @returns {void}
         *
         * @example
         * document.addEventListener('DOMContentLoaded', function () {
         *   proxy.initProxy();
         *   proxy.initModels();
         *
         *   proxy.template.app.titulo   = 'Olá mundo';
         *   proxy.template.app.lista    = [{ nome: 'Item 1' }];
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

        }
    };

})();