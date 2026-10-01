// The page's few DOM helpers, written once: an element by its id, a new
// element with its text and class, a new SVG element with its attributes,
// a text saved as a file.
// Loaded before every page script that uses them (shell.html).
(function () {
  var NS = "http://www.w3.org/2000/svg";

  function $(id) {
    return document.getElementById(id);
  }

  // Text and class only when given: `null` text leaves the element empty.
  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }

  // Attributes, never properties: an SVG element's are read-only objects.
  function svg(tag, attrs, text) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (key) {
      e.setAttribute(key, attrs[key]);
    });
    if (text != null) e.textContent = text;
    return e;
  }

  // A text handed to the visitor as a file named `name`: a link to it,
  // clicked and gone, its address freed a second later.
  function download(name, text, type) {
    var url = URL.createObjectURL(new Blob([text], { type: type }));
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  window.effractorDom = { $: $, el: el, svg: svg, download: download };
})();
