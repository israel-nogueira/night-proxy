/*!
 * 
 * night-proxy.js -  Interceptação e Aplicação de Templates com Proxy Recursivo
 * https://github.com/israel-nogueira/night-proxy
 * 
 * 
 */


/**
 *
 *  Utilizamos como base da engine o Mustache.js:
 *  (Houve alterações no core dele)
 *
 */
var objectToString = Object.prototype.toString, isArray = Array.isArray || function (e) { return "[object Array]" === objectToString.call(e) }; function isFunction(e) { return "function" == typeof e } function typeStr(e) { return isArray(e) ? "array" : typeof e } function escapeRegExp(e) { return e.replace(/[\-\[\]{}()*+?.,\\\^$|#\s]/g, "\\$&") } function hasProperty(e, t) { return null != e && "object" == typeof e && t in e } function primitiveHasOwnProperty(e, t) { return null != e && "object" != typeof e && e.hasOwnProperty && e.hasOwnProperty(t) } var regExpTest = RegExp.prototype.test; function testRegExp(e, t) { return regExpTest.call(e, t) } var nonSpaceRe = /\S/; function isWhitespace(e) { return !testRegExp(nonSpaceRe, e) } var entityMap = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "/": "&#x2F;", "`": "&#x60;", "=": "&#x3D;" }; function escapeHtml(e) { return String(e).replace(/[&<>"'`=\/]/g, function (e) { return entityMap[e] }) } var whiteRe = /\s*/, spaceRe = /\s+/, equalsRe = /\s*=/, curlyRe = /\s*\}/, tagRe = /#|\^|\/|>|\{|&|=|!/; function parseTemplate(e, t) { if (!e) return []; var r, n, i, a = !1, s = [], o = [], c = [], p = !1, u = !1, h = "", l = 0; function f() { if (p && !u) for (; c.length;)delete o[c.pop()]; else c = []; p = !1, u = !1 } function g(e) { if ("string" == typeof e && (e = e.split(spaceRe, 2)), !isArray(e) || 2 !== e.length) throw new Error("Invalid tags: " + e); r = new RegExp(escapeRegExp(e[0]) + "\\s*"), n = new RegExp("\\s*" + escapeRegExp(e[1])), i = new RegExp("\\s*" + escapeRegExp("}" + e[1])) } g(t || proxy.tags); for (var d, v, y, m, w, x, C = new Scanner(e); !C.eos();) { if (d = C.pos, y = C.scanUntil(r)) for (var W = 0, R = y.length; W < R; ++W)isWhitespace(m = y.charAt(W)) ? (c.push(o.length), h += m) : (u = !0, a = !0, h += " "), o.push(["text", m, d, d + 1]), d += 1, "\n" === m && (f(), h = "", l = 0, a = !1); if (!C.scan(r)) break; if (p = !0, v = C.scan(tagRe) || "name", C.scan(whiteRe), "=" === v ? (y = C.scanUntil(equalsRe), C.scan(equalsRe), C.scanUntil(n)) : "{" === v ? (y = C.scanUntil(i), C.scan(curlyRe), C.scanUntil(n), v = "&") : y = C.scanUntil(n), !C.scan(n)) throw new Error("Unclosed tag at " + C.pos); if (w = ">" == v ? [v, y, d, C.pos, h, l, a] : [v, y, d, C.pos], l++, o.push(w), "#" === v || "^" === v) s.push(w); else if ("/" === v) { if (!(x = s.pop())) throw new Error('Unopened section "' + y + '" at ' + d); if (x[1] !== y) throw new Error('Unclosed section "' + x[1] + '" at ' + d) } else "name" === v || "{" === v || "&" === v ? u = !0 : "=" === v && g(y) } if (f(), x = s.pop()) throw new Error('Unclosed section "' + x[1] + '" at ' + C.pos); return nestTokens(squashTokens(o)) } function squashTokens(e) { for (var t, r, n = [], i = 0, a = e.length; i < a; ++i)(t = e[i]) && ("text" === t[0] && r && "text" === r[0] ? (r[1] += t[1], r[3] = t[3]) : (n.push(t), r = t)); return n } function nestTokens(e) { for (var t, r = [], n = r, i = [], a = 0, s = e.length; a < s; ++a)switch ((t = e[a])[0]) { case "#": case "^": n.push(t), i.push(t), n = t[4] = []; break; case "/": i.pop()[5] = t[2], n = i.length > 0 ? i[i.length - 1][4] : r; break; default: n.push(t) }return r } function Scanner(e) { this.string = e, this.tail = e, this.pos = 0 } function Context(e, t) { this.view = e, this.cache = { ".": this.view }, this.parent = t } function Writer() { this.templateCache = { _cache: {}, set: function (e, t) { this._cache[e] = t }, get: function (e) { return this._cache[e] }, clear: function () { this._cache = {} } } } Scanner.prototype.eos = function () { return "" === this.tail }, Scanner.prototype.scan = function (e) { var t = this.tail.match(e); if (!t || 0 !== t.index) return ""; var r = t[0]; return this.tail = this.tail.substring(r.length), this.pos += r.length, r }, Scanner.prototype.scanUntil = function (e) { var t, r = this.tail.search(e); switch (r) { case -1: t = this.tail, this.tail = ""; break; case 0: t = ""; break; default: t = this.tail.substring(0, r), this.tail = this.tail.substring(r) }return this.pos += t.length, t }, Context.prototype.push = function (e) { return new Context(e, this) }, Context.prototype.lookup = function (e) { var t, r = this.cache; if (r.hasOwnProperty(e)) t = r[e]; else { for (var n, i, a, s = this, o = !1; s;) { if (e.indexOf(".") > 0) for (n = s.view, i = e.split("."), a = 0; null != n && a < i.length;)a === i.length - 1 && (o = hasProperty(n, i[a]) || primitiveHasOwnProperty(n, i[a])), n = n[i[a++]]; else n = s.view[e], o = hasProperty(s.view, e); if (o) { t = n; break } s = s.parent } r[e] = t } return isFunction(t) && (t = t.call(this.view)), t }, Writer.prototype.clearCache = function () { void 0 !== this.templateCache && this.templateCache.clear() }, Writer.prototype.parse = function (e, t) { var r = this.templateCache, n = e + ":" + (t || proxy.tags).join(":"), i = void 0 !== r, a = i ? r.get(n) : void 0; return null == a && (a = parseTemplate(e, t), i && r.set(n, a)), a }, Writer.prototype.render = function (e, t, r, n) { var i = this.getConfigTags(n), a = this.parse(e, i), s = t instanceof Context ? t : new Context(t, void 0); return this.renderTokens(a, s, r, e, n) }, Writer.prototype.renderTokens = function (e, t, r, n, i) { for (var a, s, o, c = "", p = 0, u = e.length; p < u; ++p)o = void 0, "#" === (s = (a = e[p])[0]) ? o = this.renderSection(a, t, r, n, i) : "^" === s ? o = this.renderInverted(a, t, r, n, i) : ">" === s ? o = this.renderPartial(a, t, r, i) : "&" === s ? o = this.unescapedValue(a, t) : "name" === s ? o = this.escapedValue(a, t, i) : "text" === s && (o = this.rawValue(a)), void 0 !== o && (c += o); return c }, Writer.prototype.renderSection = function (e, t, r, n, i) { var a = this, s = "", o = t.lookup(e[1]); if (o) { if (isArray(o)) for (var c = 0, p = o.length; c < p; ++c)s += this.renderTokens(e[4], t.push(o[c]), r, n, i); else if ("object" == typeof o || "string" == typeof o || "number" == typeof o) s += this.renderTokens(e[4], t.push(o), r, n, i); else if (isFunction(o)) { if ("string" != typeof n) throw new Error("Cannot use higher-order sections without the original template"); null != (o = o.call(t.view, n.slice(e[3], e[5]), function (e) { return a.render(e, t, r, i) })) && (s += o) } else s += this.renderTokens(e[4], t, r, n, i); return s } }, Writer.prototype.renderInverted = function (e, t, r, n, i) { var a = t.lookup(e[1]); if (!a || isArray(a) && 0 === a.length) return this.renderTokens(e[4], t, r, n, i) }, Writer.prototype.indentPartial = function (e, t, r) { for (var n = t.replace(/[^ \t]/g, ""), i = e.split("\n"), a = 0; a < i.length; a++)i[a].length && (a > 0 || !r) && (i[a] = n + i[a]); return i.join("\n") }, Writer.prototype.renderPartial = function (e, t, r, n) { if (r) { var i = this.getConfigTags(n), a = isFunction(r) ? r(e[1]) : r[e[1]]; if (null != a) { var s = e[6], o = e[5], c = e[4], p = a; 0 == o && c && (p = this.indentPartial(a, c, s)); var u = this.parse(p, i); return this.renderTokens(u, t, r, p, n) } } }, Writer.prototype.unescapedValue = function (e, t) { var r = t.lookup(e[1]); if (null != r) return r }, Writer.prototype.escapedValue = function (e, t, r) { var n = this.getConfigEscape(r) || proxy.escape, i = t.lookup(e[1]); if (null != i) return "number" == typeof i && n === proxy.escape ? String(i) : n(i) }, Writer.prototype.rawValue = function (e) { return e[1] }, Writer.prototype.getConfigTags = function (e) { return isArray(e) ? e : e && "object" == typeof e ? e.tags : void 0 }, Writer.prototype.getConfigEscape = function (e) { return e && "object" == typeof e && !isArray(e) ? e.escape : void 0 }; 


/**
 * Começamos a lógica do proxy
 */
var proxy = {
    name: 'night-proxy.js',
    version: '1.0.0',
    tags: ['{{', '}}'],
    template:{},
    clearCache: undefined,
    escape: undefined,
    parse: undefined,
    render: undefined,
    Scanner: undefined,
    Context: undefined,
    Writer: undefined,
    set templateCache(cache) {
        defaultWriter.templateCache = cache;
    },
    get templateCache() {
        return defaultWriter.templateCache;
    },

	extends: function (target, source) {
        return Object.assign(target, source);
    },
    preencheInputsFormCache: function (inner) {
        if (localStorage.getItem("template") != null && typeof (localStorage.getItem("template")) == 'string') {
            if (typeof (inner) == 'undefined') {
                proxy.template = JSON.parse(localStorage.getItem("template"));
            }
            for (const [key, value] of Object.entries(proxy.template)) {

                // AQUI AINDA NAO ESTA 100%
                // CORRETO SERÁ ELE VERIFICAR TODOS OS TIPOS DE INPUTS DE UM FORMULARIO
                // E SETAR O VALOR CORRETAMENTE EM CADA UM 

                if (document.querySelectorAll('form[proxy-form="' + key + '"]').length > 0) {
                    var FormElement = document.querySelectorAll('form[proxy-form="' + key + '"] [model]');
                    FormElement.forEach(function (aInput, bInput) {
                        if (typeof (proxy.template[key][aInput.name]) != null && typeof (proxy.template[key][aInput.name]) != 'undefined') {
                            if (aInput.type == 'checkbox' && proxy.template[key][aInput.name] == true) {
                                aInput.checked = proxy.template[key][aInput.name];
                            } else if (aInput.type == 'radio') {
                                var radioBox = document.querySelectorAll('form[proxy-form="' + key + '"] [name="' + aInput.name + '"][value="' + proxy.template[key][aInput.name] + '"]');
                                if (typeof (radioBox[0].checked) != 'undefined') {
                                    console.log(radioBox[0].checked)
                                    radioBox[0].checked = true;
                                }
                            } else {
                                aInput.value = proxy.template[key][aInput.name];
                            }
                        }
                    })
                }



            }
        }
    },
    listnerInputsForm: function () {
        var element = document.querySelectorAll('form[proxy-form]');
        element.forEach(function (form) {
            var FormName = form.attributes['proxy-form'].value;
            var FormElement = document.querySelectorAll('form[proxy-form="' + FormName + '"] [model]');
            if (typeof (proxy.template[FormName]) == 'undefined') { proxy.template[FormName] = {}; }
            FormElement.forEach(function (inputForm, bInput) {
                inputForm.onchange = function (eInnerInput) {
                    if (inputForm.type == 'checkbox') {
                        proxy.template[FormName][inputForm.name] = inputForm.checked
                    } else {
                        proxy.template[FormName][inputForm.name] = inputForm.value
                    }
                    localStorage.setItem("template", JSON.stringify(proxy.template));
                }
            })
        })
    },
    initProxy: function (source) {
        var elements = document.querySelectorAll('*[proxy-template]');
        for (var i = 0; i < elements.length; i++) {
            if (typeof (proxy.template[elements[i].getAttribute("proxy-template")]) == 'undefined') {
                proxy.template[elements[i].getAttribute("proxy-template")] = {};
            }
        }
        var config = proxy.extends({ cache: false }, source);
        if (config.cache == true) {
            proxy.preencheInputsFormCache();
            proxy.listnerInputsForm();
            proxy.applyTemplate();
        }
        proxy.template = new Proxy(proxy.template, proxy.observador_listner);
    },
    observador_listner: {
        get(target, key, receiver) {
            if (key == 'isProxy') { return true; }
            const inner_obj = target[key];
            if (typeof inner_obj == 'undefined') { return; }
            if (!inner_obj.isProxy && typeof inner_obj === 'object') {
                target[key] = new Proxy(inner_obj, proxy.observador_listner);
            }
            return target[key];
        },
        set(target, key, value, receiver) {
            if (value === undefined || value === null) {
                delete target[key];
            } else {
                target[key] = value;
                if (typeof value == 'object' && !Array.isArray(value)){
                    target[key].delete = function () {
                        receiver.splice(key,1)
                    };
                }
                target[key].add = function (array) {
                    if (typeof value == 'object' && !Array.isArray(array)){
                        target[key].push(array)
                    }else if (typeof value == 'object' && Array.isArray(array)){
                        array.forEach(function(a,b){
                            target[key].push(a)
                        })
                    }
                };
            }
            localStorage.setItem("template", JSON.stringify(proxy.template));
            proxy.applyTemplate();
            return true;
        }
    },
    applyTemplate: function () {
        const keys = Object.keys(proxy.template);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const value = proxy.template[key];
            if (value !== undefined) {
                if (document.querySelectorAll('*[proxy-template="' + key + '"]').length > 0 && document.querySelectorAll('*[proxy-target="' + key + '"]').length > 0) {
                    var model = document.querySelectorAll('*[proxy-template="' + key + '"]')[0].innerHTML;
                    proxy.tags = proxy.tags || ["<%", "%>"];
                    proxy.parse(model);
                    var rendered = proxy.render(model, value);
                    var elements = document.querySelectorAll('*[proxy-target="' + key + '"]');
                    for (var j = 0; j < elements.length; j++) {
                        elements[j].innerHTML = rendered;
                    }
                } else if (document.querySelectorAll('form[proxy-form="' + key + '"]').length > 0) {
                    proxy.preencheInputsFormCache(false);
                } else {
                    console.warn('Elemento "' + key + '" não existe no HTML')
                }
            }
        }
    }
};


var defaultWriter = new Writer();
proxy.clearCache = function clearCache() {
    return defaultWriter.clearCache();
};
proxy.parse = function parse(template, tags) {
    return defaultWriter.parse(template, tags);
};
proxy.render = function render(template, view, partials, config) {
    if (typeof template !== 'string') {
        throw new TypeError('Invalid template! Template should be a "string" ' +
            'but "' + typeStr(template) + '" was given as the first ' +
            'argument for proxy#render(template, view, partials)');
    }
    return defaultWriter.render(template, view, partials, config);
};

proxy.escape = escapeHtml;
proxy.Scanner = Scanner;
proxy.Context = Context;
proxy.Writer = Writer;

