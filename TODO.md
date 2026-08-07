# TODO — shadow-proxy.js

Lista de pendências levantadas em análise técnica da v2.7.3. Nada aqui é bloqueante — a lib funciona e passa nos 152 testes — mas são pontos a corrigir/endurecer nas próximas versões.

## 🔴 Bugs confirmados

- [ ] **Seletor CSS sem escape em `_applyTarget`** (linha ~1581)
  `querySelectorAll('[proxy-target="' + key + '"]...')` não usa `CSS.escape(key)`, diferente de `_destroyKey` e `_renderFor`. Key com aspas quebra o render (`SyntaxError`).

- [ ] **`_getItemKey` polui o objeto original do usuário** (linha ~1357)
  Escreve `item.__nid` direto no dado raw quando não há `x-key`. Vaza em `JSON.stringify`/`Object.keys` do item.

- [ ] **`structuredClone` incompatível com browser support anunciado** (linha ~135)
  README promete Safari 10+/Chrome 49+, mas `structuredClone` só existe a partir de Safari 15.4/Chrome 98. Fallback (`Object.assign`) é shallow copy → `oldVal` de watcher pode vir corrompido em objeto aninhado, em browser antigo.

## 🟡 Segurança (baixo/médio risco)

- [ ] **Blocklist incompleta**: `getOwnPropertyNames` / `getOwnPropertySymbols` não estão em `_BLOCKED_IDS`, ao contrário de `getPrototypeOf`/`defineProperty`/etc. Permite introspecção de propriedades não previstas.

- [ ] **Sem sanitização de atributos interpolados**: `x-bind` em atributo (ex: `href="{link}"`) vai direto pro `setAttribute` sem checagem de scheme (`javascript:`). `x-bind` em texto é seguro (`textContent`), atributo não.

- [ ] **`x-on` permite criar props novas com qualquer nome**: identificador seguido de `=` não passa pelo `scopeKeys.has()`, só pelo blocklist fixo. Qualquer expressão pode criar prop nova no store do componente.

## 🟠 Arquitetura / performance

- [ ] **Dois pipelines de flush desincronizados**: `_scheduleFlush` (effects granulares) e `_scheduleApply` (`_applyTarget`, full re-render) rodam em microtasks independentes. Prop sem effect tracked cai no fallback de full re-render — contradiz a promessa de "update toca 1 nó só".

- [ ] **Estado 100% singleton em nível de módulo**: `_store`, `_proxies`, `_watchers` etc. são globais únicos do IIFE. Duas instâncias da lib no mesmo doc (ex: bundlers diferentes) colidem em dados, não só em nome.

- [ ] **Cache de template do `x-for` travado no primeiro `innerHTML`**: mudar o HTML interno do elemento após `initProxy()` não invalida o cache — mudanças subsequentes são ignoradas.

## 🟢 Menores (cosmético, sem risco de segurança)

- [ ] **Tokenizer não interpreta sequências de escape em string** (linha ~377): `\n`, `\t` etc. ficam literais (`\` + caractere) em vez de virar o caractere real.

- [ ] **Tokenizer de número aceita múltiplos pontos** (linha ~386): `"1.2.3"` é tokenizado como um único num válido; `parseFloat` trunca silenciosamente pra `1.2` sem erro.

---

*Documento de trabalho — atualizar conforme os itens forem resolvidos.*