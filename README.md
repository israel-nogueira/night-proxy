<p align="center">
    <img src="https://raw.githubusercontent.com/israel-nogueira/night-proxy/master/assets/img/avatar.png" width="650"/>
</p>

# night-proxy.js

Reatividade declarativa no HTML puro — sem frameworks, sem build tools.  
Usa **Proxy Recursivo** + **morphdom** para atualizar o DOM de forma eficiente e granular.

---

## Instalação

Um único arquivo. Inclua no `<head>`:

```html
<script src="./assets/js/night-proxy.js"></script>
```

> O morphdom já está embutido no arquivo. Nenhuma dependência externa necessária.

---

## Conceito básico

Você define um **target** no HTML — o bloco reativo — e inicializa o proxy.  
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
Define o container reativo. Tudo dentro dele é monitorado pelo proxy.

```html
<div x-target="produto">
    ...
</div>
```

---

### `x-bind="expr"`
Renderiza um valor reativo como texto. Suporta expressão direta ou interpolação com `{}`.

```html
<!-- Valor direto -->
<h1 x-bind="produto.nome"></h1>

<!-- Interpolação -->
<p x-bind="Preço: R$ {produto.preco}"></p>
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

### `x-if="expr"`
Exibe ou oculta o elemento conforme a expressão. O elemento permanece no DOM (`display: none`).

```html
<p x-if="produto.ativo">Produto disponível</p>
<p x-if="!produto.ativo">Fora de estoque</p>
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
<input type="text" x-model="produto.lista[0].subitems[2].nome">
```

---

### `x-on:evento="expr"`
Event listener declarativo com acesso ao escopo do loop.

```html
<button x-on:click="console.log(item.$i)">Log índice</button>
<button x-on:click="alert(item.titulo + ' - ' + sub.nome)">Detalhes</button>
```

---

## Inicialização

```javascript
proxy.initProxy();
```

Chame após o DOM estar pronto. Em seguida, popule os dados normalmente:

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

Toda atribuição direta no `proxy.template` dispara a atualização do DOM:

```javascript
// Valor simples
proxy.template.produto.nome = "Novo nome";

// Item de lista
proxy.template.produto.lista[0].titulo = "Titulo atualizado";

// Substituir lista inteira
proxy.template.produto.lista = [
    { titulo: "Item novo", subitems: [] }
];

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

<div x-target="pedido">
    <h2 x-bind="pedido.cliente"></h2>
    <p x-if="pedido.confirmado">✅ Pedido confirmado</p>

    <div x-for="item in pedido.itens">
        <strong x-bind="{item.nome}"></strong>
        <span x-bind="Qtd: {item.qty}"></span>
        <button x-on:click="alert('Item ' + item.$i)">Ver</button>
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
</script>
```

---

## Referência rápida

| Diretiva | Descrição |
|---|---|
| `x-target="chave"` | Define o container reativo |
| `x-bind="expr"` | Renderiza valor ou interpolação `{var}` |
| `x-for="item in lista"` | Loop reativo (aninhável) |
| `x-if="expr"` | Condicional reativo |
| `x-model="caminho"` | Two-way binding com inputs |
| `x-on:evento="expr"` | Event listener com escopo do loop |
| `item.$i` | Índice do item no loop |