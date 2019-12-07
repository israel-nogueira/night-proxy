# Javascript Proxy template HTML
Sistema template orientado a objeto do lado do cliente.
Utilizando a engine do [Mustache](https://github.com/janl/mustache.js) para funcionamento perfeito do listner.


# Instalação
Inserimos os 2 arquivos no HTML 

    <script type="text/javascript" src="./mustache.min.js?v=1"></script>
	<script type="text/javascript" src="./proxy-update.js?v=1"></script>

Montamos o template:

	<script feats-template="targetElement" type="x-tmpl-mustache">
		<h1><% titulo %></h1>
	</script>
