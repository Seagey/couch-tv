// A very small DOM, enough for tv-home/web/widgets.js to draw a widget in node (no jsdom here):
// elements with children, attributes, classes, inline style and text. Used by the widget data tests.
class FakeText {
  constructor(s) { this.nodeType = 3; this.data = String(s); this.parentNode = null; }
  get textContent() { return this.data; }
  cloneNode() { return new FakeText(this.data); }
}
class FakeEl {
  constructor(tag) {
    this.nodeType = 1; this.tagName = String(tag).toUpperCase(); this.nodeName = this.tagName;
    this.childNodes = []; this.attrs = {}; this.parentNode = null; this._cls = [];
    const el = this;
    this.classList = {
      add: (...c) => c.forEach((x) => { if (x && el._cls.indexOf(x) < 0) el._cls.push(x); }),
      remove: (...c) => { el._cls = el._cls.filter((x) => c.indexOf(x) < 0); },
      toggle: (c, on) => { const has = el._cls.indexOf(c) >= 0; const want = on === undefined ? !has : !!on; if (want) el.classList.add(c); else el.classList.remove(c); return want; },
      contains: (c) => el._cls.indexOf(c) >= 0
    };
    this.style = { cssText: "", setProperty(k, v) { this[k] = v; } };
  }
  get className() { return this._cls.join(" "); }
  set className(v) { this._cls = String(v || "").split(/\s+/).filter(Boolean); }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(""); }
  set textContent(v) { this.childNodes = []; if (v) this.appendChild(new FakeText(v)); }
  appendChild(n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); return n; }
  insertBefore(n, ref) { if (n.parentNode) n.parentNode.removeChild(n); const i = this.childNodes.indexOf(ref); n.parentNode = this; if (i < 0) this.childNodes.push(n); else this.childNodes.splice(i, 0, n); return n; }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; return n; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); }
  removeAttribute(k) { delete this.attrs[k]; }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  all() { const out = []; const walk = (e) => e.childNodes.forEach((c) => { if (c.nodeType === 1) { out.push(c); walk(c); } }); walk(this); return out; }
  // only the attribute selector widgets.js uses: [name]
  querySelectorAll(sel) { const m = /^\[([a-z-]+)\]$/.exec(sel); return m ? this.all().filter((e) => e.hasAttribute(m[1])) : []; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  cloneNode(deep) { const c = new FakeEl(this.tagName); c.attrs = Object.assign({}, this.attrs); c._cls = this._cls.slice(); c.style = Object.assign({}, this.style); if (deep) this.childNodes.forEach((k) => c.appendChild(k.cloneNode(true))); return c; }
}
function fakeDocument() {
  const html = new FakeEl("html");
  return {
    documentElement: html,
    createElement: (t) => new FakeEl(t),
    createElementNS: (ns, t) => new FakeEl(t),
    createTextNode: (s) => new FakeText(s),
    importNode: (n) => n.cloneNode(true),
    addEventListener() {}
  };
}
// a Date whose "now" is fixed: new Date() and Date.now() give the time set, anything else is a real Date
function fixedDate(RealDate) {
  let at = RealDate.now();
  class D extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(at); }
    static now() { return at; }
  }
  D.set = (d) => { at = +d; };
  return D;
}
module.exports = { FakeEl, FakeText, fakeDocument, fixedDate };
