<p align="center">
    <img src="https://raw.githubusercontent.com/israel-nogueira/shadow-proxy/refs/heads/no-reflow/assets/img/avatar.png" width="650"/>
</p>

<p align="center">
    <img src="https://img.shields.io/badge/version-2.7.0-7c3aed?style=flat-square" />
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
<script src="https://cdn.jsdelivr.net/gh/israel-nogueira/shadow-proxy@refs/heads/no-reflow/assets/js/shadow-proxy.min.js"></script>
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
    proxy.initProxy();
    proxy.template.produto.nome  = "Coxinha Supreme";
    proxy.template.produto.preco = 9.90;
    proxy.template.produto.ativo = true;
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
    proxy.initProxy();

    // Carrega de uma API — lista começa vazia, sem problema
    fetch('/api/itens')
        .then(r => r.json())
        .then(data => {
            proxy.template.pedido.itens = data; // atualiza sozinho
        });

    proxy.template.pedido.remover = function(idx) {
        proxy.template.pedido.itens.splice(idx, 1); // remove e re-renderiza
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
    proxy.initProxy();
    proxy.initModels();

    proxy.template.produto.nome      = "Coxinha";
    proxy.template.produto.ativo     = true;
    proxy.template.produto.categoria = "a";
</script>
```

O input atualiza o proxy. O proxy atualiza o DOM. Funciona nos dois sentidos, sem código extra.

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
    proxy.initProxy();
    proxy.initModels();

    proxy.template.pedido.cliente    = "João Silva";
    proxy.template.pedido.confirmado = true;
    proxy.template.pedido.carregado  = false;
    proxy.template.pedido.itens      = [];

    fetch('/api/itens-pedido')
        .then(r => r.json())
        .then(data => {
            proxy.template.pedido.itens    = data;
            proxy.template.pedido.carregado = true;
        });

    proxy.template.pedido.remover = function(idx) {
        proxy.template.pedido.itens.splice(idx, 1);
    };
</script>
```

---

## Instalação

**Via CDN — copie e cole, pronto:**
```html
<script src="https://cdn.jsdelivr.net/gh/israel-nogueira/shadow-proxy@refs/heads/no-reflow/assets/js/shadow-proxy.min.js"></script>
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
import { proxy } from 'shadow-proxy.js';
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
proxy.initProxy();          // inicializa — chame após o DOM carregar
proxy.initModels();         // ativa two-way binding nos x-model

proxy.template.key.prop = valor;   // atualiza e re-renderiza sozinho
proxy.template.key.lista.push({}); // push/splice/sort — tudo reativo

proxy.destroy('key');       // limpa um componente (útil com fetch)
proxy.destroy();            // limpa tudo (troca de página em SPA)

proxy.on('key.prop', (novo, velho) => {}); // observa qualquer mudança

proxy.onError = function(err) { console.error(err); }; // captura erros
```

---

## Magic Variables (dentro de `x-on`)

| Variável | O que é |
|---|---|
| `$root` | O elemento `x-data` do componente |
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
proxy.template.produto.$beforeRender = function(el) { /* antes de renderizar */ };
proxy.template.produto.$afterRender  = function(el) { /* após renderizar */ };
proxy.template.produto.$beforeDestroy = function(el) { /* antes de destruir */ };
proxy.template.produto.$afterDestroy  = function(el) { /* após destruir */ };
```

---

## Watchers

```javascript
const unsub = proxy.on('produto.preco', (novo, velho) => {
    console.log(`preço: ${velho} → ${novo}`);
});

unsub(); // para de observar
```

---

## Destroy — para quem usa fetch ou SPA

```javascript
async function carregarProduto(id) {
    proxy.destroy('produto');                         // mata o atual

    const html = await fetch(`/produto/${id}`).then(r => r.text());
    document.querySelector('#container').innerHTML = html;

    proxy.initProxy();                                // reinicializa
    proxy.template.produto.nome = "Novo produto";
}
```

---

## Funções no escopo

```javascript
proxy.template.lista.remover = function(idx) {
    proxy.template.lista.itens.splice(idx, 1);
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

> **v2.7.0** — Motor de avaliação completamente reescrito. Zero `eval` / `new Function`.

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
proxy.template.produto.nome = 'x'
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

## Tipos de erro (`proxy.onError`)

| Tipo | Origem |
|---|---|
| `x-for-syntax` | Sintaxe inválida no `x-for` |
| `x-on-unsafe` | Expressão bloqueada em `x-on` |
| `x-bind-eval` | Falha em `x-bind` |
| `x-if-eval` | Falha em `x-if` |
| `render-error` | Loop de reatividade detectado |
| `model-path` | Caminho inválido em `x-model` |
| `lifecycle-error` | Exceção em hook de lifecycle |
| `watcher-error` | Exceção em `proxy.on()` |
| `proxy-target` | Elemento `[x-data]` não encontrado |
| `security-blocked` | Acesso a propriedade bloqueada em runtime |

---

## Licença

MIT © [Israel Nogueira](https://github.com/israel-nogueira)