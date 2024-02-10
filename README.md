
# Javascript Proxy template HTML
Sistema template orientado a objeto do lado do cliente.

# Instalação
Inserimos o arquivo no HTML 
```html
<script type="text/javascript" src="./proxy-update.js"></script>
```

Montamos o **template**, que é o elemento onde está sua estrutura de layout:

```html
<script proxy-template="coxinha" type="x-tmpl">
	<h1>{{ titulo }}</h1>
</script>
```

Montamos o **Target**, que receberá o seu template:
```html
<div proxy-target="coxinha">
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

proxy.template.coxinha.titulo = "Titulo original";

//Depois caso queira alterar o valor:

proxy.template.coxinha.titulo = "Titulo alterado";

```

# Listas
Caso tiver uma lista de ítens, basta envelopar por uma hastag e fecha com uma barra:
```html
<script proxy-template="coxinha" type="x-tmpl">
	{{ #lista }}
		<li>{{ titulo }}</li>
	{{ /lista }}
</script>
```
Para setar uma lista ao objeto, poderá ser feito da seguinte forma:
```javascript
proxy.template.coxinha.lista = [
	{titulo:"Com catupiry"},
	{titulo:"Com bacon"},
	{titulo:"Com queijo e presunto"}
]
```

# Inserindo um item na lista
```javascript
proxy.template.coxinha.lista.push({titulo:"Com camarão"})
```
# Alterando um item na lista
```javascript
proxy.template.coxinha.lista[2].titulo="Com costela";
```


# REQUISIÇÃO AJAX
Pode-se trabalhar diretamente na requisição ajax para setar novos conteudos;
Se por exemplo seu retorno for:
```json
[
	{"titulo":"Sabor1"},
	{"titulo":"Sabor2"},
	{"titulo":"Sabor3"}
]
```
Então você poderá inserir os novos sabores dessa forma:
```javascript
$.ajax({
	url: "/api/sabores-de-coxinha",
	method: "GET",
	dataType: "json",
	success: function(response) {
		proxy.template.coxinha.lista.push(...response);
	},
	error: function(xhr, status, error) {
		console.error("Erro na requisição:", error);
	}
});
```



Não trabalhar mais com inserts de strings, apenas com objetos vindos do  servidor.   Legal né? 

# APROVEITEM!