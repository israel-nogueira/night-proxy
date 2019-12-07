
# Javascript Proxy template HTML
Sistema template orientado a objeto do lado do cliente.
Utilizando a engine do [Mustache](https://github.com/janl/mustache.js) para funcionamento perfeito do listner.


# Instalação
Inserimos os 2 arquivos no HTML 

    <script type="text/javascript" src="./mustache.min.js?v=1"></script>
	<script type="text/javascript" src="./proxy-update.js?v=1"></script>

Montamos o **template**:

	<script feats-template="targetElement" type="x-tmpl-mustache">
		<h1><% titulo %></h1>
	</script>
Montamos o **Target** dele:
	
    <div feats-target="targetElement">
    		carregando...
    </div>

Iniciamos o **Proxy**:

	<script type="text/javascript">
		feats.initProxy({cache:true});

E agora quando alterarmos o objeto **template.targetElement.titulo** o HTML será alterado.
	<script type="text/javascript">
		feats.initProxy({cache:true}); </script>


	<script type="text/javascript">
		template.targetElement.titulo = "Lista da feira";
	</script>

# Listas
Caso tiver uma lista de ítens:

    <script feats-template="targetElement" type="x-tmpl-mustache">
    	<% #lista %>
    		<li><% titulo %></li>
    	<% /lista %>
    </script>
Poderá inserir dados setando o objeto da seguinte forma:

    <script type="text/javascript">
	    template.targetElement.lista = [
		    {titulo:"Tomate"},
		    {titulo:"Alface"},
		    {titulo:"Rúcula"},
		    {titulo:"Beringela"},
		    {titulo:"Cenoura"},
		    {titulo:"Beterraba"}
	    ]
    </script>

# Inserindo um item na lista
	<script type="text/javascript">
		template.targetElement.lista.push({titulo:"Pão de queijo"})
	</script> 
# Alterando um item na lista
	<script type="text/javascript">
		template.targetElement.lista[2].titulo="Pão de queijo";
	</script> 

Imagine agora integrar isso com ajax?
Não trabalhar mais com inserts de strings, apenas com objetos vindos do  servidor.   Legal né? 
Para entenderem bem como funciona o template, sugiro estudarem a biblioteca do [Mustache](https://github.com/janl/mustache.js).

# APROVEITEM!