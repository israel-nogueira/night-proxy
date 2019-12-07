"use strict";
//######################### VARIAVEL GLOBAL DO TEMPLATE
var template={};

//######################### VARIAVEL PADRÃO DO SISTEMA
var feats = {
	extends:function(target, source){
		return Object.assign(target, source);
	},
	preencheInputsFormCache: function (inner) {
		if(localStorage.getItem("template") != null && typeof(localStorage.getItem("template"))=='string'){
			if(typeof(inner)=='undefined'){
				template = JSON.parse(localStorage.getItem("template"));
			}
			for (const [key, value] of Object.entries(template)) {
				if(document.querySelectorAll('form[feats-form="'+key+'"]').length >0){
					var FormElement = document.querySelectorAll('form[feats-form="'+key+'"] [model]');
					FormElement.forEach(function(aInput,bInput){
						if(typeof(template[key][aInput.name])!=null && typeof(template[key][aInput.name])!='undefined'){
							if(aInput.type=='checkbox' && template[key][aInput.name]==true){
								aInput.checked = template[key][aInput.name];
							}else if(aInput.type=='radio'){
								var radioBox = document.querySelectorAll('form[feats-form="'+key+'"] [name="'+aInput.name+'"][value="'+template[key][aInput.name]+'"]');
								if(typeof(radioBox[0].checked)!='undefined'){
									console.log(radioBox[0].checked)
									radioBox[0].checked = true;
								}
							}else{
								aInput.value = template[key][aInput.name];
							}
						}
					})
				}
			}
		}
	},
	listnerInputsForm: function () {
		var element = document.querySelectorAll('form[feats-form]');
		element.forEach(function(form){
			var FormName	= form.attributes['feats-form'].value;
			var FormElement	= document.querySelectorAll('form[feats-form="'+FormName+'"] [model]');
			if(typeof(template[FormName])=='undefined'){template[FormName] = {};}
			FormElement.forEach(function(inputForm,bInput){
				inputForm.onchange = function(eInnerInput){
					if(inputForm.type=='checkbox'){
						template[FormName][inputForm.name] = inputForm.checked
					}else{
						template[FormName][inputForm.name] = inputForm.value
					}
					localStorage.setItem("template",JSON.stringify(template));
				}
			})
		})
	},
	initProxy: function (source) {
		var elements = document.querySelectorAll('*[feats-template]');
		for (var i = 0; i < elements.length; i++) {
			if(typeof(template[elements[i].getAttribute("feats-template")])=='undefined'){
				template[elements[i].getAttribute("feats-template")] = {};
			}
		}
		var config = feats.extends({cache:false},source);
		if ( config.cache==true) {
			feats.preencheInputsFormCache();
			feats.listnerInputsForm();
			feats.applyTemplate();
		}
		template = new Proxy(template, feats.observador_listner);
	},
	observador_listner: {
		get(target, key, receiver) {
			if (key == 'isProxy') {return true; }
			const inner_obj = target[key];
			if (typeof inner_obj == 'undefined') {return; }
			if (!inner_obj.isProxy && typeof inner_obj === 'object') {
				target[key] = new Proxy(inner_obj, feats.observador_listner);
			}
			return target[key];
		},
		set(target, key, value, receiver) {
			target[key] = value;
			localStorage.setItem("template",JSON.stringify(template));
		 	feats.applyTemplate();
			return true;
		}
	},
	applyTemplate: function () {
		 for (const [key, value] of Object.entries(template)) {
		 	if(document.querySelectorAll('*[feats-template="'+key+'"]').length >0 && document.querySelectorAll('*[feats-target="'+key+'"]').length > 0){
				var model 	= document.querySelectorAll('*[feats-template="'+key+'"]')[0].innerHTML;
				Mustache.tags =["<%", "%>"];
				Mustache.parse(model);
				var rendered = Mustache.render(model,value);
				var elements = document.querySelectorAll('*[feats-target="'+key+'"]');
				for (var i = 0; i < elements.length; i++) {
					elements[i].innerHTML = rendered;
				}
			}else if(document.querySelectorAll('form[feats-form="'+key+'"]').length >0){
				feats.preencheInputsFormCache(false);
			}else{
				console.warn('Elemento "'+key+'" não existe no HTML')
		 	}
		 }
	}
}