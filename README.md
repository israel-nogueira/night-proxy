
# Javascript Proxy template HTML
Sistema template orientado a objeto do lado do cliente.

# Instalação
Inserimos o arquivos no HTML 

	<script type="text/javascript" src="./proxy-update.js"></script>

Montamos o **template**:

	<script proxy-template="targetElement" type="x-tmpl">
		<h1>{{ titulo }}</h1>
	</script>

Montamos o **Target** dele:
    <div proxy-target="targetElement">
    		carregando...
    </div>

Iniciamos o **Proxy**:
	<script type="text/javascript">
		proxy.initProxy();
	</script>

E agora quando alterarmos o objeto **template.targetElement.titulo** o HTML será alterado.

	<script type="text/javascript">
		template.targetElement.titulo = "Lista da feira";
	</script>

# Listas
Caso tiver uma lista de ítens:

    <script proxy-template="targetElement" type="x-tmpl">
    	{{ #lista }}
    		<li>{{ titulo }}</li>
    	{{ /lista }}
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

# APROVEITEM!