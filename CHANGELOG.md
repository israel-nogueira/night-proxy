# Changelog

All notable changes to shadow-proxy are documented here.

---

## [2.7.5] - Correção de path relativo em x-model

### 🐛 Corrigido
- **`x-model` com path relativo (padrão documentado) nunca funcionava.** `_resolveModel()` resolvia corretamente o `key` do componente via `closest('[x-data],[proxy-target]')`, mas devolvia `parts` cru, direto do atributo `x-model` (ex: `x-model="form.nome"` → `parts = ['form', 'nome']`), sem prefixar o `key`.
  - Todo o resto da lib (`_initModels`, `_onInput`/`_setDeep`, `_syncModelsForKey`, `_getDeep`) assume `parts[0] === key` — é assim que ela navega a partir de `_store`.
  - Resultado: com `parts[0] = 'form'`, a lib procurava um componente chamado `form` no `_store` raiz (que não existe) em vez de `_store.detalhesFranquia.form`. O `el.value` nunca era populado no load, e digitar no input não escrevia em lugar nenhum — o `x-bind` correspondente nunca reagia.
  - Fix: `_resolveModel()` agora devolve `parts` com o `key` prefixado (`[key, ...parts]`) quando o path é relativo. Se o path já vier absoluto (`parts[0] === key`, uso legado), não duplica.

### 📝 Notas
- **Sem breaking changes.** Módulos que já usavam path absoluto (`x-model="meuModulo.form.nome"`) continuam funcionando igual.
- Módulos que seguiam a documentação (`x-model="form.nome"`, path relativo) e pareciam "sem reatividade" ou com inputs sempre vazios devem funcionar corretamente após essa atualização, sem precisar mudar nada no `.tpl.html`.

---

## [2.7.4] - Auto-init de x-model

### ✨ Adicionado
- **`initProxy()` agora chama `initModels()` automaticamente** ao final da inicialização.
  - Antes era preciso chamar os dois manualmente:
    ```js
    shadowProxy.initProxy();
    shadowProxy.initModels(); // obrigatório se usasse x-model
    ```
  - Agora basta:
    ```js
    shadowProxy.initProxy();
    ```
  - Seguro por padrão: `_initModels` faz `querySelectorAll('[x-model]')` e simplesmente não executa nada se não encontrar elementos — custo zero em projetos sem `x-model`.

### 📝 Notas
- **Sem breaking changes.** Quem já chamava `initModels()` manualmente pode continuar chamando — a função é idempotente (`el.__shadowModel` evita rebind duplicado).
- Chamadas manuais de `initModels()` continuam necessárias apenas para reinicializar `x-model` após injetar novo HTML dinâmico no DOM (ex: fetch de nova página).

---

## [2.7.3] - Correção de loop infinito + apply granular

### 🐛 Corrigido
- **Loop infinito de reatividade em `_applyTarget`**: o scope era montado com `Object.assign(baseScope, {$root, $ref, $emit, ...})`, e como `baseScope` podia ser o proxy reativo (`_proxies[key]`), o `Object.assign` dependia do `[[Set]]` que caía no *set trap* do Proxy — cada render escrevia `$root`/`$ref`/`$emit` dentro do próprio `store`, disparando `_scheduleApply` de novo → render de novo → loop infinito.
  - Fix: `scope` agora é criado via `Object.create(baseScope)` (mantém o proxy na prototype chain, preservando o tracking de dependências) + `Object.defineProperties` para `$root/$ref/$emit/$i/$index/$this` como props **own**, sem tocar no `[[Set]]` do prototype.

### ⚡ Melhorado
- **`_scheduleApply(key, needsRender)`**: novo segundo parâmetro distingue "precisa de cascade completo (`_renderTracked` a partir da raiz)" de "só precisa rodar lifecycle hooks + sync de models".
  - `_pendingKeysNeedRender` (novo Set) rastreia quais keys pendentes realmente precisam do cascade.
- **`_applyTarget(key, doRender)`**: novo parâmetro `doRender` (default `true`). Quando `false`, pula `_renderTracked` — usado quando um effect granular já tratou a mutação específica (via `_trigger`), evitando re-render da árvore inteira.
- **`set`/`deleteProperty` do proxy**: agora capturam o retorno de `_trigger(target, prop)` em `handled` e chamam `_scheduleApply(key, !handled)`:
  - Antes: se `_trigger` retornava `true`, `_scheduleApply` **não era chamado** (lifecycle hooks e sync de models ficavam sem rodar quando havia effect granular).
  - Agora: `_scheduleApply` é sempre chamado, mas com `needsRender=false` quando já houve tratamento granular — lifecycle/sync continuam rodando, só o cascade completo é evitado.

### 📝 Notas
- Recomenda-se atualizar de 2.7.2 → 2.7.3 caso use `x-data` combinado com `x-ref`, `x-on`, `$this` ou lifecycle hooks (`$beforeRender`/`$afterRender`), onde o bug do loop infinito era mais provável de aparecer.

---

## [2.7.2] — 2024

### 🔒 Security — Breaking-adjacent

**Replaced `new Function` / `eval` with a custom AST parser + interpreter.**

The previous sandbox relied on a token-level blocklist (`_validateTokens`) that could be bypassed via bracket notation with string literals — e.g. `a['constructor']` tokenizes as `'str'`, which the old check never inspected.

The new engine (`_parseAST` / `_Interpreter`) walks an AST and validates **every property access** — dot or bracket, literal or dynamic — against `_assertSafeProp()` **at runtime**, after the key value has been fully resolved. The attack surface covered:

- `a['constructor']` → blocked
- `a['con' + 'structor']` → blocked
- `a[varContainingDangerousName]` → blocked
- Arrow functions (`=>`) → blocked at parse time
- `Object.getPrototypeOf(obj)` and other prototype-introspection methods (`setPrototypeOf`, `getOwnPropertyDescriptor(s)`, `defineProperty(ies)`, `create`) → blocked. These reach the same prototype chain as `constructor`/`__proto__` but under a different property name, so they weren't covered by the original blocklist.

Zero `new Function` / `eval` calls remain in the codebase. The library now works under strict CSP (`script-src` without `unsafe-eval`).

**Error messages from expression failures now come from the custom parser** — syntax error wording may differ from previous versions.

New error type added: `security-blocked` (fired when the interpreter blocks a dangerous property access at runtime).

### ✨ Features

- **Early template cache** (`_cacheTemplates` now called in `initProxy`) — `x-for` with empty arrays no longer loses the template on first render.
- **Centralized error reporting** — all internal errors go through `_reportError`. Set `proxy.onError` to capture them globally.

### 🐛 Fixes

- `with($s)` removed — expressions are now evaluated by the interpreter directly against the scope object.
- Duplicate re-render when 2+ props of the same effect changed in the same tick — fixed by always scheduling effects via microtask (no more synchronous single-effect shortcut).
- **`_setDeep` fallback bypassed reactivity.** When `_proxies[key]` didn't exist yet (e.g. an orphan `x-model` element writing after its component's `destroy()`), the old fallback wrote straight into `_store`, skipping the proxy `set` trap entirely — no `_trigger`, no watcher notification. Fixed by always ensuring the proxy exists before writing, same lazy-create logic used by the `template` getter.

### 🧪 Tests

- **154 tests** (was 152) — added coverage for the `Object.getPrototypeOf` bypass attempt in the security sandbox, and for the orphan `x-model` write-after-destroy now going through the reactive proxy.

---

## [2.5.x] — previous

See inline comments in `shadow-proxy` header for prior change history.