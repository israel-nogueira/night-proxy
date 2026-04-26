







<p align="center">
    <img src="https://raw.githubusercontent.com/israel-nogueira/night-proxy/master/assets/img/avatar.png" width="650"/>
</p>

<p align="center">
    <img src="https://img.shields.io/badge/version-2.5.0-7c3aed?style=flat-square" />
    <img src="https://img.shields.io/badge/zero%20dependencies-✓-22c55e?style=flat-square" />
    <img src="https://img.shields.io/badge/no%20build%20tools-✓-06b6d4?style=flat-square" />
    <img src="https://img.shields.io/badge/license-MIT-f59e0b?style=flat-square" />
</p>


# Feito para quem constrói, não para quem quer aprender um framework.

Sua página PHP/HTML está pronta! E agora você precisa que **uma lista atualize sozinha**, que **um contador mude em tempo real**.<br>
Ou que **um formulário reaja ao que o usuário digita** _(tudo isso sem recarregar a página)_.

Não temos nada contra os grandes frameworks, eles existem por boas razões, resolvem problemas reais e sustentam aplicações enormes. Mas existe um espaço enorme entre "página HTML com PHP" e "SPA completa com React".


## É exatamente esse espaço que o night-proxy.js ocupa.

A ideia é simples: um arquivo, uma tag script, e sua página passa a ser reativa. Sem npm. Sem build. Sem opinião sobre a sua stack. 

Você escreve os atributos no HTML, popula os dados via JavaScript, e o DOM se atualiza sozinho de forma granular, eficiente, sem re-renders desnecessários com uma única linha:

```html
<script src="./assets/js/night-proxy.js"></script>
```

Ou via CDN:
```html
<script src="https://cdn.jsdelivr.net/gh/israel-nogueira/night-proxy@no-reflow/assets/js/night-proxy.js"></script>
```


Sem npm. Sem build. Sem configuração. Você escreve HTML normal, adiciona alguns atributos, e a página começa a reagir sozinha às mudanças de dados. Funciona em qualquer projeto, PHP, HTML puro, WordPress, Laravel, o que for.

---
> ✅ Se você já sabe fazer uma página em HTML, você já sabe usar night-proxy.js.
---

## Para quem quer saber como funciona de verdade

night-proxy.js implementa **reatividade declarativa baseada em Proxy Recursivo** com dependency tracking granular, sem virtual DOM, sem dirty checking, sem re-renders desnecessários.

### 🔥 O que isso significa na prática

A maioria das soluções "leves" de reatividade usa uma de duas abordagens ruins: re-renderiza o componente inteiro a cada mudança, ou percorre o DOM em busca de diferenças (dirty checking). Ambas escalam mal.

night-proxy.js faz diferente. Durante o render de cada nó, qualquer leitura de propriedade registra automaticamente uma dependência via `WeakMap`. Quando um valor muda, **apenas os nós que dependem daquela propriedade específica são atualizados!** cirurgicamente, sem tocar no resto.

### 🛡️ Garantias de performance

- **1 dependente** → update síncrono imediato, sem microtask, sem overhead de scheduler
- **N dependentes** → batching via `Promise.resolve()`, agrupa mudanças simultâneas em um único ciclo
- **Mudanças estruturais** (push/splice/substituição de lista) → re-render do `x-for` via microtask

Em testes com 5.000 itens renderizados, um update pontual (`lista[2500].nome = 'x'`) executa em menos de 1 frame (< 16ms), porque toca **exatamente 1 nó**, independente do tamanho da lista.

### ⚙️ Diferenciais técnicos

- **Proxy Recursivo**, qualquer nível de aninhamento é rastreado automaticamente, sem necessidade de declarar observers manualmente
- **Effects com auto-cleanup**, cada nó reativo tem seu próprio Effect que se desregistra e re-registra nas dependências a cada run, evitando memory leaks e renders obsoletos
- **Lifecycle completo**, `$beforeRender`, `$afterRender`, `$beforeDestroy`, `$afterDestroy` com suporte a eventos DOM nativos (`before-render`, `after-destroy`...)
- **Destroy real**, limpa effects, event listeners, watchers e store em cascata; essencial para SPAs que trocam conteúdo via fetch
- **44 testes automatizados**, cobrindo reatividade, granularidade, stress (500 / 1k / 5k itens) e ciclo de vida completo, todos passando

### 🤓 Para quem é indicado

Projetos que precisam de reatividade pontual sem o custo de adotar um framework completo.<br>
Aplicações PHP, páginas com conteúdo dinâmico via fetch, dashboards simples, formulários reativos <br>
e qualquer cenário onde **React ou Vue seria complexidade desnecessária**.

**Um arquivo. Sem dependências. Sem opinião sobre sua stack.**

---

## 🛠️ Instalação

Um único arquivo. Inclua no `<head>`:

```html
<script src="./assets/js/night-proxy.js"></script>
```

Nenhuma dependência externa necessária.

---

## Conceito básico

Você define um container reativo no HTML com `x-data` e inicializa o proxy.  
Qualquer alteração em `proxy.template` atualiza o DOM automaticamente.

```html
<div x-data="produto">
    <h1 x-bind="nome"></h1>
    <p x-bind="Preço: R$ {preco}"></p>
</div>

<script>
    proxy.initProxy();
    proxy.template.produto.nome  = "Coxinha Supreme";
    proxy.template.produto.preco = 9.90;
</script>
```

---

## Diretivas

### `x-data="chave"`

Define o container reativo. As expressões internas não precisam de prefixo.

```html
<div x-data="produto">
    <h1 x-bind="nome"></h1>
</div>
```

```javascript
proxy.initProxy();
proxy.template.produto.nome = "Coxinha Supreme";
```

---

### `x-bind="expr"`

Renderiza um valor reativo como texto. Suporta expressão direta ou interpolação com `{}`.

```html
<div x-data="produto">
    <h1 x-bind="nome"></h1>
    <p x-bind="Preço: R$ {preco}, Qtd: {qty}"></p>
</div>

<script>
    proxy.initProxy();
    proxy.template.produto.nome  = "Coxinha Supreme";
    proxy.template.produto.preco = 9.90;
    proxy.template.produto.qty   = 3;

    // Qualquer alteração posterior atualiza o DOM automaticamente
    proxy.template.produto.nome = "Novo nome";
</script>
```

---

### `x-if="expr"`

Oculta o elemento via `display: none` quando a expressão for falsa. O elemento permanece no DOM.

```html
<p x-if="ativo">Produto disponível</p>
<p x-if="!ativo">Fora de estoque</p>
```

```javascript
proxy.initProxy();
proxy.template.produto.ativo = true;

// Alternar visibilidade reativamente
proxy.template.produto.ativo = false;
```

---

### `x-for="alias in lista"`

Loop reativo e aninhável. Suporta duas sintaxes para declarar o índice com nome:

```html
<!-- sem índice nomeado, usa $i / $index como fallback -->
<div x-for="item in itens">

<!-- índice nomeado, sintaxe com vírgula -->
<div x-for="item, k in itens">

<!-- índice nomeado, sintaxe com as (estilo SQL) -->
<div x-for="item in itens as k">
```

Exemplo com aninhamento e índices nomeados:

```html
<div x-data="pedido">
    <div x-for="item, k in itens">
        <strong x-bind="{item.nome}"></strong>
        <span x-bind="Item {k}"></span>

        <div x-for="sub, b in item.subitens">
            <span x-bind="{sub.label}"></span>
            <small x-bind="Item {k} › Sub {b}"></small>
        </div>
    </div>
</div>
```

```javascript
proxy.initProxy();
proxy.template.pedido.itens = [
    {
        nome: "Salgados",
        subitens: [{ label: "Coxinha" }, { label: "Pastel" }]
    },
    {
        nome: "Bebidas",
        subitens: [{ label: "Suco" }, { label: "Água" }]
    }
];

// Adicionar item, re-render automático do x-for
proxy.template.pedido.itens.push({ nome: "Doces", subitens: [] });

// Update cirúrgico, toca só o nó do item[0], não re-renderiza a lista
proxy.template.pedido.itens[0].nome = "Salgadinhos";
```

---

### `x-key="expr"`

Chave única para otimização do `x-for`. O proxy reutiliza nós DOM existentes ao reordenar ou atualizar a lista. Sem `x-key`, um id interno é gerado automaticamente.

```html
<div x-for="item in lista" x-key="item.id">
    <span x-bind="{item.nome}"></span>
</div>
```

```javascript
proxy.initProxy();
proxy.template.catalogo.lista = [
    { id: 1, nome: "Item A" },
    { id: 2, nome: "Item B" },
    { id: 3, nome: "Item C" },
];

// Com x-key, ao reordenar a lista o proxy reutiliza os nós DOM existentes
// em vez de recriar tudo, mais eficiente e preserva estado de inputs internos
proxy.template.catalogo.lista = [
    { id: 3, nome: "Item C" },
    { id: 1, nome: "Item A" },
    { id: 2, nome: "Item B" },
];
```

---

### `x-model="caminho"`

Two-way binding com inputs. Suporta `text`, `checkbox`, `radio`, `select` e caminhos profundos.

```html
<input type="text"     x-model="produto.nome">
<input type="checkbox" x-model="produto.ativo">
<input type="radio"    x-model="produto.cor" value="azul"> Azul
<input type="radio"    x-model="produto.cor" value="verde"> Verde
<select x-model="produto.categoria">
    <option value="a">Categoria A</option>
    <option value="b">Categoria B</option>
</select>

<!-- Caminho profundo -->
<input type="text" x-model="produto.lista[1].titulo">
```

```javascript
proxy.initProxy();

// Valor inicial, já aparece nos inputs
proxy.template.produto.nome      = "Coxinha";
proxy.template.produto.ativo     = true;
proxy.template.produto.cor       = "azul";
proxy.template.produto.categoria = "a";

// Alterar via JS também atualiza os inputs (two-way)
proxy.template.produto.cor = "verde";

// Alterar via input também atualiza o proxy (two-way)
//, o usuário digita no campo e proxy.template.produto.nome é atualizado automaticamente
```

---

### `x-on:evento="expr"`

Event listener declarativo com acesso ao escopo do loop e às magic variables.

```html
<div x-data="lista">
    <div x-for="item, k in itens">
        <span x-bind="{item.nome}"></span>
        <button x-on:click="remover(k)">✕</button>
        <button x-on:click="$emit('selecionou', { index: k })">Selecionar</button>
        <button x-on:click="console.log(event.target)">Log</button>
    </div>
</div>
```

```javascript
proxy.initProxy();

proxy.template.lista.itens = [
    { nome: "Item A" },
    { nome: "Item B" },
];

// Função registrada no escopo, disponível no x-on sem depender de globais
proxy.template.lista.remover = function(idx) {
    proxy.template.lista.itens.splice(idx, 1);
};

// Ouvindo o evento emitido pelo $emit dentro do template
document.querySelector('[x-data="lista"]').addEventListener('selecionou', e => {
    console.log('índice selecionado:', e.detail.index);
});
```

---

### `x-ref="nome"`

Registra uma referência ao elemento, acessível via `$ref.nome` em qualquer `x-on` do mesmo componente.

```html
<div x-data="busca">
    <input x-ref="campo" type="text">
    <button x-on:click="console.log($ref.campo.value)">Buscar</button>
</div>
```

```javascript
proxy.initProxy();

// $ref é resolvido dentro do x-on, não precisa de querySelector manual
// O acesso ao DOM fica encapsulado no próprio componente
```

---

## Magic Variables

Disponíveis dentro de qualquer expressão `x-on`.

### `$root`
Elemento DOM do container `x-data`. Útil para manipulação direta ou para saber em qual componente o evento ocorreu.

```html
<button x-on:click="$root.classList.toggle('ativo')">Toggle classe</button>
```

```javascript
proxy.initProxy();

// $root é o próprio elemento [x-data="..."]
// Equivale a document.querySelector('[x-data="meu-componente"]')
// mas sem precisar de querySelector, já está no escopo do x-on
```

---

### `$ref`
Acessa elementos marcados com `x-ref` dentro do mesmo componente.

```html
<input x-ref="campo" type="text">
<button x-on:click="console.log($ref.campo.value)">Buscar</button>
```

---

### `$emit`
Dispara um `CustomEvent` no `$root`. Ideal para comunicar ações do template para o JS externo.

```html
<!-- dentro do template, ação intencional -->
<button x-on:click="$emit('item-selecionado', { id: item.id })">Selecionar</button>
```

```javascript
// fora, no JS, quem quiser ouvir
document.querySelector('[x-data="lista"]').addEventListener('item-selecionado', e => {
    console.log(e.detail.id);
});
```

---

### `$i` / `$index`
Índice do item atual no loop. Disponíveis quando nenhum alias de índice foi declarado. Quando um alias é declarado (`item, k in lista`), use o alias, `$i` e `$index` ficam como fallback.

```html
<!-- sem alias, usa $i / $index -->
<div x-for="item in itens">
    <span x-bind="Item {$index}: {item.nome}"></span>
    <button x-on:click="remover($i)">✕</button>
</div>
```

```javascript
proxy.initProxy();

proxy.template.lista.itens = [
    { nome: "Item A" },
    { nome: "Item B" },
];

proxy.template.lista.remover = function(idx) {
    proxy.template.lista.itens.splice(idx, 1);
};
```

---

### `$this`
Objeto rico com informações do item atual no loop.

| Propriedade | Descrição |
|---|---|
| `$this.index` | Índice do item no loop |
| `$this.dom` | Elemento DOM do item |
| `$this.data` | Objeto de dados do item |
| `$this.parent` | `$this` do loop pai (encadeável) |

```html
<div x-for="item, k in itens">
    <div x-for="sub, b in item.subitens">
        <button x-on:click="console.log($this.index, $this.parent.index)">
            Log índices
        </button>
    </div>
</div>
```

Em loops profundamente aninhados, `$this.parent` é especialmente útil via JS:

```javascript
document.querySelector('[x-data="lista"]').addEventListener('meu-evento', e => {
    const ctx = e.target.__nightThis;
    console.log(ctx.index, ctx.parent.index, ctx.parent.parent.index);
});
```

---

### `event`
Evento DOM nativo, sempre disponível em `x-on`.

```html
<button x-on:click="console.log(event.target)">Log</button>
```

---

## Lifecycle Hooks

Executam antes e depois de cada ciclo de render do componente. Disponíveis via `proxy.template` ou `addEventListener` no container, ambas as formas funcionam simultaneamente e disparam em todo update, incluindo o render inicial.

```javascript
// via proxy.template
proxy.template.produto.$beforeRender = function(el) {
    console.log('vai renderizar', el);
};

proxy.template.produto.$afterRender = function(el) {
    console.log('renderizou', el);
};
```

```javascript
// via addEventListener
const el = document.querySelector('[x-data="produto"]');

el.addEventListener('before-render', () => console.log('antes'));
el.addEventListener('after-render',  () => console.log('depois'));
```

---

---

## Destroy

Limpa completamente um componente antes de recarregar via fetch ou ao desmontar a página. O destroy remove todos os effects reativos, event listeners declarados com `x-on`, watchers registrados e a entrada no store interno.

### Destruir um componente específico

```javascript
// via método direto
proxy.destroy('produto');

// via shortcut no template
proxy.template.produto.destroy();
```

### Destruir tudo

```javascript
proxy.destroy();
```

### Hooks de destroy

Executam antes e depois do destroy. Disponíveis via `proxy.template` ou `addEventListener`, ambas as formas funcionam simultaneamente.

```javascript
// via proxy.template
proxy.template.produto.$beforeDestroy = function(el) {
    console.log('vai destruir', el);
};

proxy.template.produto.$afterDestroy = function(el) {
    console.log('destruído', el);
};
```

```javascript
// via addEventListener
const el = document.querySelector('[x-data="produto"]');

el.addEventListener('before-destroy', () => console.log('antes do destroy'));
el.addEventListener('after-destroy',  () => console.log('depois do destroy'));
```

### Padrão com fetch

O destroy é o ponto de entrada natural antes de qualquer recarga de conteúdo dinâmico:

```javascript
async function carregarProduto(id) {
    // 1. Mata o componente atual
    proxy.destroy('produto');

    // 2. Busca novo conteúdo
    const res  = await fetch(`/produto/${id}`);
    const html = await res.text();

    // 3. Injeta o HTML
    document.querySelector('#container').innerHTML = html;

    // 4. Reinicializa
    proxy.initProxy();
    proxy.template.produto.nome = "Novo produto";
}
```

## Watchers

Observa qualquer caminho do store e executa um callback quando o valor muda. Retorna uma função de cancelamento.

```javascript
const unsubscribe = proxy.on('produto.preco', (novoValor, valorAnterior) => {
    console.log(`preço: ${valorAnterior} → ${novoValor}`);
});

// Cancelar
unsubscribe();
```

Funciona com caminhos profundos:

```javascript
proxy.on('pedido.itens.0.nome', (novo, velho) => {
    console.log('nome do primeiro item mudou');
});
```

---

## Inicialização

```javascript
proxy.initProxy();
```

Chame após o DOM estar pronto. Em seguida, popule os dados via `proxy.template`:

```javascript
proxy.initProxy();

proxy.template.produto.nome  = "Coxinha Supreme";
proxy.template.produto.ativo = true;
proxy.template.produto.preco = 9.90;
proxy.template.produto.lista = [
    { titulo: "Com catupiry", subitens: [{ label: "P" }, { label: "G" }] },
    { titulo: "Com bacon",    subitens: [{ label: "Único" }] },
];
```

---

## Atualizações reativas

```javascript
// Valor simples, síncrono, atualiza o DOM na hora
proxy.template.produto.nome = "Novo nome";

// Item específico da lista, cirúrgico, toca só o nó do item
proxy.template.produto.lista[0].titulo = "Titulo atualizado";

// Substituir lista inteira
proxy.template.produto.lista = [{ titulo: "Item novo", subitens: [] }];

// Adicionar item
proxy.template.produto.lista.push({ titulo: "Mais um", subitens: [] });

// Remover item
proxy.template.produto.lista.splice(2, 1);
```

---

## Funções no escopo

Registre funções diretamente no `proxy.template` para usá-las nos eventos sem depender de globais.

```html
<div x-data="lista">
    <div x-for="item, k in itens">
        <span x-bind="{item.nome}"></span>
        <button x-on:click="remover(k)">✕</button>
    </div>
</div>

<script>
    proxy.initProxy();

    proxy.template.lista.itens = [
        { nome: "Item A" },
        { nome: "Item B" },
    ];

    proxy.template.lista.remover = function(idx) {
        proxy.template.lista.itens.splice(idx, 1);
    };
</>
```

---

## Exemplo completo

```html
<input type="text"     x-model="pedido.cliente" placeholder="Nome do cliente">
<input type="checkbox" x-model="pedido.confirmado"> Confirmado

<div x-data="pedido">
    <h2 x-bind="cliente"></h2>
    <p x-if="confirmado">✅ Pedido confirmado</p>

    <div x-for="item, k in itens">
        <strong x-bind="{item.nome}"></strong>
        <span x-bind="Qtd: {item.qty}"></span>
        <button x-on:click="remover(k)">✕</button>
        <button x-on:click="$emit('selecionou', { index: k, nome: item.nome })">Selecionar</button>
    </div>
</div>

<script>
    proxy.initProxy();

    proxy.template.pedido.cliente    = "João Silva";
    proxy.template.pedido.confirmado = true;
    proxy.template.pedido.itens      = [
        { nome: "Coxinha",  qty: 3 },
        { nome: "Pastel",   qty: 2 },
        { nome: "Salgado",  qty: 5 },
    ];

    proxy.template.pedido.remover = function(idx) {
        proxy.template.pedido.itens.splice(idx, 1);
    };

    proxy.template.pedido.$afterRender = function() {
        console.log('pedido renderizado');
    };

    document.querySelector('[x-data="pedido"]').addEventListener('selecionou', e => {
        console.log('selecionado:', e.detail.nome);
    });

    proxy.on('pedido.cliente', (novo, velho) => {
        console.log(`cliente: ${velho} → ${novo}`);
    });
</script>
```

---

## Referência rápida

### Diretivas

| Diretiva | Descrição |
|---|---|
| `x-data="chave"` | Container reativo, escopo sem prefixo |
| `x-bind="expr"` | Renderiza valor ou interpolação `{var}` como texto |
| `x-if="expr"` | Condicional, oculta via `display: none` |
| `x-for="alias in lista"` | Loop reativo (aninhável) |
| `x-for="alias, k in lista"` | Loop com índice nomeado |
| `x-for="alias in lista as k"` | Loop com índice nomeado (sintaxe alternativa) |
| `x-key="expr"` | Chave única para reuso de nós no `x-for` |
| `x-model="caminho"` | Two-way binding com inputs |
| `x-on:evento="expr"` | Event listener com escopo do loop |
| `x-ref="nome"` | Referência ao elemento via `$ref.nome` |

### Magic Variables (em `x-on`)

| Variable | Descrição |
|---|---|
| `$root` | Elemento DOM do container `x-data` |
| `$ref.nome` | Elemento marcado com `x-ref="nome"` |
| `$emit(nome, detalhe)` | Dispara `CustomEvent` no `$root` |
| `$i` / `$index` | Índice do item (fallback sem alias declarado) |
| `$this.index` | Índice do item atual |
| `$this.dom` | Elemento DOM do item atual |
| `$this.data` | Objeto de dados do item atual |
| `$this.parent` | `$this` do loop pai (encadeável) |
| `event` | Evento DOM nativo |

### API JavaScript

| Método | Descrição |
|---|---|
| `proxy.initProxy()` | Inicializa o proxy |
| `proxy.destroy('key')` | Destrói um componente específico |
| `proxy.destroy()` | Destrói todos os componentes |
| `proxy.template.key.destroy()` | Shortcut para destruir um componente |
| `proxy.on(path, fn)` | Observa um caminho, retorna `unsubscribe()` |
| `proxy.template.key.$beforeRender = fn` | Hook antes do render |
| `proxy.template.key.$afterRender = fn` | Hook após o render |
| `proxy.template.key.$beforeDestroy = fn` | Hook antes do destroy |
| `proxy.template.key.$afterDestroy = fn` | Hook após o destroy |

---

## Como funciona internamente

O proxy usa **dependency tracking** granular: durante o render de cada nó, qualquer leitura de propriedade registra uma dependência. Quando um valor muda:

- **1 dependente** → render síncrono imediato, sem microtask
- **Múltiplos dependentes** → batching via microtask (`Promise.resolve`)
- **Mudanças estruturais** (push/splice/substituição de lista) → re-render do `x-for` via microtask

Isso garante que `lista[250].nome = 'x'` toque **apenas o nó do item 250**, independente do tamanho da lista.