<p align="center">
    <img src="https://raw.githubusercontent.com/israel-nogueira/night-proxy/master/assets/img/avatar.png" width="650"/>
</p>

# night-proxy.js

Reatividade declarativa no HTML puro — sem frameworks, sem build tools.  
Usa **Proxy Recursivo** para atualizar o DOM de forma granular e eficiente.

---

## Instalação

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

---

### `x-bind="expr"`

Renderiza um valor reativo como texto. Suporta expressão direta ou interpolação com `{}`.

```html
<h1 x-bind="nome"></h1>
<p x-bind="Preço: R$ {preco} — Qtd: {qty}"></p>
```

---

### `x-if="expr"`

Oculta o elemento via `display: none` quando a expressão for falsa. O elemento permanece no DOM.

```html
<p x-if="ativo">Produto disponível</p>
<p x-if="!ativo">Fora de estoque</p>
```

---

### `x-for="alias in lista"`

Loop reativo. Suporta aninhamento e expõe `$i` como índice do item atual.

```html
<div x-data="pedido">
    <div x-for="item in itens">
        <strong x-bind="{item.nome}"></strong>
        <span x-bind="Item {item.$i}"></span>

        <div x-for="sub in item.subitens">
            <span x-bind="{sub.label}"></span>
        </div>
    </div>
</div>
```

---

### `x-key="expr"`

Chave única para otimização do `x-for`. Quando definida, o proxy reutiliza nós DOM existentes ao reordenar ou atualizar a lista. Sem `x-key`, um id interno (`__nid`) é gerado automaticamente.

```html
<div x-for="item in lista" x-key="item.id">
    <span x-bind="{item.nome}"></span>
</div>
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

---

### `x-on:evento="expr"`

Event listener declarativo com acesso ao escopo do loop. O evento DOM nativo é exposto como `event`.

```html
<div x-data="lista">
    <div x-for="item in itens">
        <span x-bind="{item.nome}"></span>
        <button x-on:click="remover(item.$i)">✕</button>
        <button x-on:click="console.log(event.target)">Log</button>
    </div>
</div>
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
// Valor simples — síncrono, atualiza o DOM na hora
proxy.template.produto.nome = "Novo nome";

// Item específico da lista — cirúrgico, toca só o nó do item
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
    <div x-for="item in itens">
        <span x-bind="{item.nome}"></span>
        <button x-on:click="remover(item.$i)">✕</button>
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
</script>
```

---

## Exemplo completo

```html
<input type="text"     x-model="pedido.cliente" placeholder="Nome do cliente">
<input type="checkbox" x-model="pedido.confirmado"> Confirmado

<div x-data="pedido">
    <h2 x-bind="cliente"></h2>
    <p x-if="confirmado">✅ Pedido confirmado</p>

    <div x-for="item in itens">
        <strong x-bind="{item.nome}"></strong>
        <span x-bind="Qtd: {item.qty}"></span>
        <button x-on:click="remover(item.$i)">✕</button>
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
</script>
```

---

## Referência rápida

| Diretiva | Descrição |
|---|---|
| `x-data="chave"` | Container reativo — escopo sem prefixo nas expressões |
| `x-bind="expr"` | Renderiza valor ou interpolação `{var}` como texto |
| `x-if="expr"` | Condicional — oculta via `display: none` |
| `x-for="alias in lista"` | Loop reativo (aninhável) |
| `x-key="expr"` | Chave única para reuso de nós no `x-for` |
| `x-model="caminho"` | Two-way binding com inputs |
| `x-on:evento="expr"` | Event listener com escopo do loop |
| `item.$i` | Índice do item no loop |
| `event` | Evento DOM nativo (disponível em `x-on`) |

---

## Como funciona internamente

O proxy usa **dependency tracking** granular: durante o render de cada nó, qualquer leitura de propriedade registra uma dependência. Quando um valor muda:

- **1 dependente** → render síncrono imediato, sem microtask
- **Múltiplos dependentes** → batching via microtask (`Promise.resolve`)
- **Mudanças estruturais** (push/splice/substituição de lista) → re-render do `x-for` via microtask

Isso garante que `lista[250].nome = 'x'` toque **apenas o nó do item 250**, independente do tamanho da lista.