
# Javascript Proxy template HTML
Sistema template orientado a objeto do lado do cliente.

# Instalação
Inserimos o arquivo no HTML 
```html
<script type="text/javascript" src="./proxy-update.js"></script>
```

Montamos o **template**, que é o elemento onde está sua estrutura de layout:

```html
<script proxy-template="targetElement" type="x-tmpl">
	<h1>{{ titulo }}</h1>
</script>
```

Montamos o **Target**, que receberá o seu template:
```html
<div proxy-target="targetElement">
	carregando...
</div>
```

Iniciamos o **Proxy**:
```javascript

	proxy.initProxy();

```
# Setando valor em um nó simples
Quando alterarmos o objeto "titulo", o HTML será alterado em realtime em seu HTML.
```javascript
	proxy.initProxy();

	// Primeiro setamos um valor

	proxy.template.targetElement.titulo = "Titulo original";
	
	//Depois caso queira alterar o valor:

	proxy.template.targetElement.titulo = "Titulo alterado";

```

# Listas
Caso tiver uma lista de ítens, basta envelopar por uma hastag e fecha com uma barra:
```html
<script proxy-template="targetElement" type="x-tmpl">
	{{ #lista }}
		<li>{{ titulo }}</li>
	{{ /lista }}
</script>
```
Para setar uma lista ao objeto, poderá ser feito da seguinte forma:
```javascript
proxy.template.targetElement.lista = [
	{titulo:"Tomate"},
	{titulo:"Alface"},
	{titulo:"Rúcula"},
	{titulo:"Beringela"},
	{titulo:"Cenoura"},
	{titulo:"Beterraba"}
]
```

# Inserindo um item na lista
```javascript
proxy.template.targetElement.lista.push({titulo:"Pão de queijo"})
```
# Alterando um item na lista
```javascript
template.targetElement.lista[2].titulo="Pão de queijo";
```

Imagine agora integrar isso com ajax?
Não trabalhar mais com inserts de strings, apenas com objetos vindos do  servidor.   Legal né? 

# APROVEITEM!