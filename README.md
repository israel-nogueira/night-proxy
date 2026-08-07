<p align="center">
    <img src="https://raw.githubusercontent.com/israel-nogueira/shadow-proxy/refs/heads/no-reflow/assets/img/avatar.png" width="650"/>
</p>

<p align="center">
    <img src="https://img.shields.io/badge/version-2.7.2-7c3aed?style=flat-square" />
    <img src="https://img.shields.io/badge/zero%20dependencies-✓-22c55e?style=flat-square" />
    <img src="https://img.shields.io/badge/no%20build%20tools-✓-06b6d4?style=flat-square" />
    <img src="https://img.shields.io/badge/CSP%20safe-✓-22c55e?style=flat-square" />
    <img src="https://img.shields.io/badge/no%20eval-✓-22c55e?style=flat-square" />
    <img src="https://img.shields.io/badge/152%20tests-passing-22c55e?style=flat-square" />
    <img src="https://img.shields.io/badge/license-MIT-f59e0b?style=flat-square" />
</p>

# Feito para quem constrói, não para quem quer aprender um framework.

Sua página PHP/HTML está pronta. E agora você precisa que **uma lista atualize sozinha**, que **um contador mude em tempo real**, ou que **um formulário reaja ao que o usuário digita** — tudo isso sem recarregar a página.

Você não quer aprender React. Não quer configurar webpack. Não quer ler documentação de 300 páginas.

## Você só quer que funcione.

Um arquivo. Uma tag `<script>`. Sua página passa a ser reativa. Sem npm. Sem build. Sem opinião sobre a sua stack.

```html
<script src="https://cdn.jsdelivr.net/gh/israel-nogueira/shadow-proxy@no-reflow/shadow-proxy.min.js"></script>
```

> ✅ Se você já sabe fazer uma página em HTML, você já sabe usar shadow-proxy.js. **15 minutos e você está em produção.**

---

## Como funciona na prática

Você coloca atributos no HTML e popula os dados via JavaScript. O DOM se atualiza sozinho.

```html
<div x-data="produto">
    <h1 x-bind="nome"></h1>
    <p x-bind="Preço: R$ {preco}"></p>
    <p x-if="ativo">Em estoque ✅</p>
    <p x-if="!ativo">Fora de estoque ❌</p>
</div>

<script>
    shadowProxy.initProxy();
    shadowProxy.template.produto.nome  = "Coxinha Supreme";
    shadowProxy.template.produto.preco = 9.90;
    shadowProxy.template.produto.ativo = true;
</script>
```

É isso. Sem componentes. Sem estado gerenciado. Sem lifecycles obrigatórios. Você escreve HTML normal e diz quais partes são reativas.

---

## Listas que se atualizam sozinhas

```html
<div x-data="pedido">
    <div x-for="item in itens">
        <strong x-bind="{item.nome}"></strong>
        <span x-bind="R$ {item.preco}"></span>
        <button x-on:click="remover($i)">✕</button>
    </div>
</div>

<script>
    shadowProxy.initProxy();

    // Carrega de uma API — lista começa vazia, sem problema
    fetch('/api/itens')
        .then(r => r.json())
        .then(data => {
            shadowProxy.template.pedido.itens = data; // atualiza sozinho
        });

    shadowProxy.template.pedido.remover = function(idx) {
        shadowProxy.template.pedido.itens.splice(idx, 1); // remove e re-renderiza
    };
</script>
```

Adicionar item? `lista.push(...)`. Remover? `lista.splice(...)`. Atualizar um item? `lista[2].nome = 'novo'`. **O DOM segue sozinho.**

---

## Formulários com two-way binding

```html
<input type="text"     x-model="produto.nome">
<input type="checkbox" x-model="produto.ativo">
<select x-model="produto.categoria">
    <option value="a">Categoria A</option>
    <option value="b">Categoria B</option>
</select>

<div x-data="produto">
    <h2 x-bind="nome"></h2>
    <p x-if="ativo">Produto ativo</p>
</div>

<script>
    shadowProxy.initProxy();
    shadowProxy.initModels();

    shadowProxy.template.produto.nome      = "Coxinha";
    shadowProxy.template.produto.ativo     = true;
    shadowProxy.template.produto.categoria = "a";
</script>
```

O input atualiza o shadowProxy. O shadowProxy atualiza o DOM. Funciona nos dois sentidos, sem código extra.

---

## Funciona em qualquer projeto

PHP, HTML puro, WordPress, Laravel — **o que você já usa hoje**. Sem mudar nada na sua stack. Sem reescrever o projeto.

```html
<!-- Em qualquer página PHP -->
<script src="./assets/js/shadow-proxy.js"></script>
```

Ou via npm se preferir:
```bash
npm install shadow-proxy
```

---

## Por que não Alpine, Vue ou React?

| | shadow-proxy | Alpine.js | Vue.js | React |
|---|---|---|---|---|
| Tamanho (gzip) | **~8.4KB** | ~13.5KB | ~34KB | ~45KB |
| Curva de aprendizado | **15 min** | 1 hora | 2 dias | 1 semana |
| Build tools necessário | ❌ | ❌ | ❌ | ✅ |
| Funciona em PHP puro | ✅ | ✅ | ⚠️ | ❌ |
| Two-way binding | ✅ | ✅ | ✅ | ❌ |
| CSP `unsafe-eval` | ❌ Não precisa | ✅ Precisa | ✅ Precisa | ✅ Precisa |

### Mas onde o shadow-proxy se encaixa?

**Alpine.js** te dá diretivas simples, mas reavalia expressões de forma grosseira e depende de `eval`-like sob o capô — rápido de aprender, limitado quando o app cresce.

**Vue e Angular** te dão reatividade de verdade, mas cobram o preço: build step, compilador de template, curva de aprendizado de dias, e uma arquitetura de componentes que você não pediu pra sua página PHP.

shadow-proxy fica na **zona cinzenta entre os dois**: sintaxe declarativa tão simples quanto o Alpine, mas com reatividade granular por propriedade (dependency tracking via `WeakMap`, não reavaliação bruta), watchers profundos, lifecycle hooks e um interpreter de expressões próprio — sem exigir `unsafe-eval` no CSP, sem build, sem virar uma "aplicação Vue" disfarçada.

> **Alpine.js syntax, Vue-level reactivity, zero build step.**

ShadowProxy não impõe componentização, roteamento ou ciclo de vida de aplicação. Ele é um **reactive micro-framework**: reatividade séria, pegada de biblioteca.

---

## Exemplo completo — do zero ao reativo

```html
<input type="text" x-model="pedido.cliente" placeholder="Nome do cliente">

<div x-data="pedido">
    <h2 x-bind="cliente"></h2>
    <p x-if="!carregado">Carregando itens...</p>
    <p x-if="confirmado">✅ Pedido confirmado</p>

    <div x-for="item, k in itens" x-key="item.id">
        <strong x-bind="{item.nome}"></strong>
        <span x-bind="Qtd: {item.qty}"></span>
        <button x-on:click="remover(k)">✕</button>
    </div>
</div>

<script>
    shadowProxy.initProxy();
    shadowProxy.initModels();

    shadowProxy.template.pedido.cliente    = "João Silva";
    shadowProxy.template.pedido.confirmado = true;
    shadowProxy.template.pedido.carregado  = false;
    shadowProxy.template.pedido.itens      = [];

    fetch('/api/itens-pedido')
        .then(r => r.json())
        .then(data => {
            shadowProxy.template.pedido.itens    = data;
            shadowProxy.template.pedido.carregado = true;
        });

    shadowProxy.template.pedido.remover = function(idx) {
        shadowProxy.template.pedido.itens.splice(idx, 1);
    };
</script>
```

---

## Instalação

**Via CDN — copie e cole, pronto:**
```html
<script src="https://cdn.jsdelivr.net/gh/israel-nogueira/shadow-proxy@no-reflow/shadow-proxy.min.js"></script>
```

**Via arquivo local:**
```html
<script src="./assets/js/shadow-proxy.js"></script>
```

**Via npm:**
```bash
npm install shadow-proxy
```
```ts
import shadowProxy from 'shadow-proxy.js';
```

---

## Diretivas — o que você pode usar no HTML

| Diretiva | O que faz |
|---|---|
| `x-data="chave"` | Marca o container reativo |
| `x-bind="expr"` | Mostra um valor que atualiza sozinho |
| `x-if="expr"` | Mostra/oculta com base em uma condição |
| `x-for="item in lista"` | Loop que se atualiza quando a lista muda |
| `x-for="item, k in lista"` | Loop com índice |
| `x-key="item.id"` | Otimiza o loop reutilizando nós DOM |
| `x-model="caminho"` | Two-way binding com inputs |
| `x-on:click="expr"` | Event listener declarativo (qualquer evento) |
| `x-ref="nome"` | Referência ao elemento via `$ref.nome` |

---

## API JavaScript

```javascript
shadowProxy.initProxy();          // inicializa — chame após o DOM carregar
shadowProxy.initModels();         // ativa two-way binding nos x-model

shadowProxy.template.key.prop = valor;   // atualiza e re-renderiza sozinho
shadowProxy.template.key.lista.push({}); // push/splice/sort — tudo reativo

shadowProxy.destroy('key');       // limpa um componente (útil com fetch)
shadowProxy.destroy();            // limpa tudo (troca de página em SPA)

shadowProxy.on('key.prop', (novo, velho) => {}); // observa qualquer mudança

shadowProxy.onError = function(err) { console.error(err); }; // captura erros
```

---

## Magic Variables (dentro de `x-on`)

| Variável | O que é |
|---|---|
| `$root` | O elemento `x-data` do componente |
| `$this.data` | Objeto de dados do item atual |
| `$ref.nome` | Elemento marcado com `x-ref` |
| `$emit('evento', dados)` | Dispara um CustomEvent no `$root` |
| `$i` / `$index` | Índice do item no loop |
| `$this.index` | Índice do item atual |
| `$this.dom` | Elemento DOM do item atual |
| `$this.parent` | `$this` do loop pai |
| `event` | Evento DOM nativo |

---

## Lifecycle Hooks

```javascript
shadowProxy.template.produto.$beforeRender = function(el) { /* antes de renderizar */ };
shadowProxy.template.produto.$afterRender  = function(el) { /* após renderizar */ };
shadowProxy.template.produto.$beforeDestroy = function(el) { /* antes de destruir */ };
shadowProxy.template.produto.$afterDestroy  = function(el) { /* após destruir */ };
```

---

## Watchers

```javascript
const unsub = shadowProxy.on('produto.preco', (novo, velho) => {
    console.log(`preço: ${velho} → ${novo}`);
});

unsub(); // para de observar
```

---

## Destroy — objeto limpo, sem vazamentos

```javascript

    // PÁGINA A — detalhe de PRODUTO
    shadowProxy.template.detalhe.nome    = "Coxinha";
    shadowProxy.template.detalhe.ativo   = true;
    shadowProxy.template.detalhe.remover = function() { apagarProduto(id); };

    // usuário navega (fetch troca o #app inteiro)
    shadowProxy.destroy('detalhe');   // ← aqui: zera _store['detalhe'] antes da página B usar a key

    // PÁGINA B — detalhe de USUÁRIO (mesma key "detalhe")
    document.querySelector('#app').innerHTML = htmlPaginaB;
    shadowProxy.initProxy();
    shadowProxy.template.detalhe.nome = "João Silva";
    // agora "ativo" e "remover" não existem mais — objeto limpo, sem vazamento

```
---

## Para quem usa fetch ou SPA

```javascript

     //carrega todos os produtos de uma lista
    const dataAll = await fetch(`/api/products/all`).then(r => r.json());
    shadowProxy.template.products = dataAll;


    async function atualizarProduto(id) {
        // criamos o listner
        shadowProxy.on(`products.${id}.preco`, (novo, velho) => {
            console.log(`preço mudou: ${velho} → ${novo}`);
        });

        // importamos os dados do produto
        const dataProd = await fetch(`/api/produto/${id}`).then(r => r.json());
        shadowProxy.template.products[id] = dataProd;
    }
    atualizarProduto(34); // 1º watcher em products.34.preco
    atualizarProduto(34); // usuário reabre o mesmo produto → 2º watcher empilhado no MESMO path

```

---

## Funções no escopo

```javascript
shadowProxy.template.lista.remover = function(idx) {
    shadowProxy.template.lista.itens.splice(idx, 1);
};
```

```html
<button x-on:click="remover(k)">✕</button>
```

---

## Browser support

Chrome 49+, Firefox 44+, Safari 10+, Opera 36+. Sem polyfills. Sem transpilação.

---

## 🛡️ Segurança — CSP-safe, zero eval

> **v2.7.2** — Motor de avaliação completamente reescrito. Zero `eval` / `new Function`.

A maioria das libs reativas avalia expressões com `eval()` ou `new Function()` — o que exige `unsafe-eval` no CSP e abre brechas de segurança.

shadow-proxy usa um **parser AST + interpreter próprio**. Toda expressão passa por tokenização, parsing e interpretação — sem executar código arbitrário.

Bloqueado por design: `constructor`, `prototype`, `__proto__`, `eval`, `Function`, `fetch`, `window`, `document`, `setTimeout`, `setInterval`, `import`, `require` e muitos outros — independente de como o nome chegue ao interpreter (string literal, concatenação, variável, `String.fromCharCode`...).

Compatível com CSP estrito:
```http
Content-Security-Policy: script-src 'self' 'nonce-...'
```

---

## ⚡ Performance — números reais, DOM real, Chromium

| Operação | Tempo |
|---|---|
| Render inicial — 500 itens | < 300ms |
| Render inicial — 1.000 itens | < 500ms |
| Render inicial — 5.000 itens | < 1.500ms |
| Update em 1 item (lista de 5.000) | < 16ms |
| Limpar lista de 5.000 itens | < 500ms |
| 3 listas × 200 itens simultâneos | < 300ms |

Update pontual toca **exatamente 1 nó DOM**, independente do tamanho da lista.

---

## 🧪 152 testes, todos passando

Reatividade, segurança, edge cases, race conditions, memory leaks — rodando em Chromium real via Playwright, sem mocks de DOM.

```
📊 RESULTADO: 152/152 passaram | 0 falharam
```

---

## Como funciona internamente

shadow-proxy usa **reatividade declarativa baseada em Proxy Recursivo** com dependency tracking granular por nó via `WeakMap`. Quando um valor muda, apenas os nós que dependem daquela propriedade são atualizados — sem virtual DOM, sem dirty checking, sem re-renders desnecessários.

Múltiplas mudanças no mesmo tick são agrupadas em um único render via microtask (`Promise.resolve()`).

### Pipeline de segurança

```
Expressão string
      ↓
  Tokenizer    → bloqueia chars inválidos
      ↓
  Parser AST   → bloqueia arrow fn, import, construções proibidas
      ↓
  Interpreter  → valida cada acesso a propriedade em runtime
      ↓
  Resultado
```

Cache LRU de 500 entradas garante que expressões repetidas não são re-parseadas.

### Pipeline de reatividade

```
shadowProxy.template.produto.nome = 'x'
      ↓
  set trap       → detecta mudança
      ↓
  _trigger       → agenda effects dependentes via microtask
      ↓
  _scheduleFlush → batching: agrupa todos os effects do tick
      ↓
  effect.run()   → atualiza só os nós afetados
```

---

## Tipos de erro (`shadowProxy.onError`)

| Tipo | Origem |
|---|---|
| `x-for-syntax` | Sintaxe inválida no `x-for` |
| `x-on-unsafe` | Expressão bloqueada em `x-on` |
| `x-bind-eval` | Falha em `x-bind` |
| `x-if-eval` | Falha em `x-if` |
| `render-error` | Loop de reatividade detectado |
| `model-path` | Caminho inválido em `x-model` |
| `lifecycle-error` | Exceção em hook de lifecycle |
| `watcher-error` | Exceção em `shadowProxy.on()` |
| `proxy-target` | Elemento `[x-data]` não encontrado |
| `security-blocked` | Acesso a propriedade bloqueada em runtime |

---

## Licença

MIT © [Israel Nogueira](https://github.com/israel-nogueira)