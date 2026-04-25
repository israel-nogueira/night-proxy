<p align="center">
    <img src="https://raw.githubusercontent.com/israel-nogueira/night-proxy/master/assets/img/avatar.png" width="650"/>
</p>

# night-proxy.js

Reatividade declarativa no HTML puro — sem frameworks, sem build tools.  
Usa **Proxy Recursivo** para atualizar o DOM de forma eficiente e granular.

---

## Instalação

Um único arquivo. Inclua no `<head>`:

```html
<script src="./assets/js/night-proxy.js"></script>
```

Nenhuma dependência externa necessária.

---

## Conceito básico

Você define um **target** no HTML e inicializa o proxy.  
Qualquer alteração em `proxy.template` atualiza o DOM automaticamente.

```html
<div x-target="meu_bloco">
    <h1 x-bind="meu_bloco.titulo"></h1>
</div>

<script>
    proxy.initProxy();
    proxy.template.meu_bloco.titulo = "Olá, mundo!";
</script>
```

---

## Diretivas

### `x-target="chave"`
Define o container reativo. As expressões internas usam o prefixo da chave.

```html
<div x-target="produto">
    <h1 x-bind="produto.nome"></h1>
</div>
```

---

### `x-data="chave"`
Igual ao `x-target`, mas sem prefixo nas expressões internas. Mais limpo para componentes isolados.

```html
<div x-data="produto">
    <h1 x-bind="nome"></h1>
    <p x-bind="Preço: R$ {preco}"></p>
    <div x-for="item in lista">
        <span x-bind="{item.titulo}"></span>
    </div>
</div>
```

---

### `x-bind="expr"`
Renderiza um valor reativo como texto. Suporta expressão direta ou interpolação com `{}`.

```html
<h1 x-bind="produto.nome"></h1>
<p x-bind="Preço: R$ {produto.preco} — Qtd: {produto.qty}"></p>
```

---

### `x-text="expr"`
Renderiza texto via expressão JavaScript pura — sem interpolação.

```html
<span x-text="produto.ativo ? 'Disponível' : 'Esgotado'"></span>
```

---

### `x-if="expr"`
Oculta o elemento via `display: none` quando a expressão for falsa. O elemento permanece no DOM.

```html
<p x-if="produto.ativo">Produto disponível</p>
<p x-if="!produto.ativo">Fora de estoque</p>
```

---

### `x-show="expr"`
Igual ao `x-if` — alterna a visibilidade sem remover o elemento do DOM.

```html
<div x-show="carregando">Carregando...</div>
```

---

### `x-for="item in lista"`
Loop reativo. Suporta aninhamento e expõe `$i` como índice do item.

```html
<div x-for="item in produto.lista">
    <h4 x-bind="{item.titulo}"></h4>

    <div x-for="sub in item.subitems">
        <p x-bind="{sub.nome}"></p>
        <small x-bind="Item {item.$i} › Sub {sub.$i}"></small>
    </div>
</div>
```

---

### `x-model="caminho"`
Two-way binding com inputs. Suporta text, checkbox, radio, select e caminhos profundos.

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
Event listener declarativo com acesso ao escopo do loop e às magic properties.

```html
<button x-on:click="console.log(item.$i)">Log índice</button>
<button x-on:click="remover(item.$i)">Remover</button>
<button x-on:click="$emit('item-selecionado', { id: item.$i })">Selecionar</button>
```

---

### `x-ref="nome"`
Registra uma referência ao elemento, acessível via `$ref.nome` nos eventos.

```html
<input x-ref="campoBusca" type="text">
<button x-on:click="console.log($ref.campoBusca.value)">Buscar</button>
```

---

## Magic Properties

Disponíveis dentro de qualquer expressão `x-on`.

| Magic | Descrição |
|---|---|
| `$root` | Elemento raiz do componente (`x-target` ou `x-data`) |
| `$ref.nome` | Elemento marcado com `x-ref="nome"` |
| `$event` | Evento DOM nativo |
| `$emit(nome, detalhe)` | Dispara um `CustomEvent` no `$root` |
| `$afterRender(fn)` | Executa `fn` após o próximo ciclo de render |
| `$observe(path, fn)` | Observa uma propriedade e executa `fn` quando ela muda |

```html
<div x-data="painel">
    <input x-ref="campo" type="text">
    <button x-on:click="$emit('busca', { termo: $ref.campo.value })">Buscar</button>
    <button x-on:click="console.log($event.target)">Log evento</button>
</div>

<script>
    proxy.initProxy();
    document.querySelector('[x-data="painel"]').addEventListener('busca', e => {
        console.log(e.detail.termo);
    });
</script>
```

---

## Funções no escopo do componente

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

## Inicialização

```javascript
proxy.initProxy();
```

Chame após o DOM estar pronto. Em seguida, popule os dados:

```javascript
proxy.initProxy();

proxy.template.produto.nome   = "Coxinha Supreme";
proxy.template.produto.ativo  = true;
proxy.template.produto.preco  = 9.90;
proxy.template.produto.lista  = [
    { titulo: "Com catupiry", subitems: [{ nome: "P" }, { nome: "G" }] },
    { titulo: "Com bacon",    subitems: [{ nome: "Único" }] },
];
```

---

## Atualizações reativas

```javascript
// Valor simples
proxy.template.produto.nome = "Novo nome";

// Item de lista
proxy.template.produto.lista[0].titulo = "Titulo atualizado";

// Substituir lista inteira
proxy.template.produto.lista = [{ titulo: "Item novo", subitems: [] }];

// Adicionar item
proxy.template.produto.lista.push({ titulo: "Mais um", subitems: [] });

// Remover item
proxy.template.produto.lista.splice(2, 1);
```

---

## Exemplo completo

```html
<input type="text" x-model="pedido.cliente" placeholder="Nome do cliente">
<input type="checkbox" x-model="pedido.confirmado"> Confirmado

<div x-data="pedido">
    <h2 x-bind="cliente"></h2>
    <p x-if="confirmado">✅ Pedido confirmado</p>
    <p x-text="'Total: ' + itens.length + ' itens'"></p>

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
| `x-target="chave"` | Container reativo com prefixo nas expressões |
| `x-data="chave"` | Container reativo sem prefixo nas expressões |
| `x-bind="expr"` | Renderiza valor ou interpolação `{var}` |
| `x-text="expr"` | Renderiza expressão JS como texto |
| `x-if="expr"` | Condicional — oculta via `display: none` |
| `x-show="expr"` | Igual ao `x-if` |
| `x-for="item in lista"` | Loop reativo (aninhável) |
| `x-model="caminho"` | Two-way binding com inputs |
| `x-on:evento="expr"` | Event listener com escopo do loop |
| `x-ref="nome"` | Referência ao elemento via `$ref.nome` |
| `item.$i` | Índice do item no loop |