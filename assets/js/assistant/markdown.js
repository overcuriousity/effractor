// What the agent writes, drawn safely (chat spec §7): paragraphs, lists,
// headings, code, bold, italics — nothing else. No links, no images, no HTML:
// the rest stays literal text, and drawing uses textContent only.
(function () {
  function inline(text) {
    var out = [], plain = "";
    function flush() {
      if (plain) out.push({ t: "text", v: plain });
      plain = "";
    }
    var i = 0;
    while (i < text.length) {
      var end;
      if (text[i] === "`" && (end = text.indexOf("`", i + 1)) > i + 1) {
        flush();
        out.push({ t: "code", v: text.slice(i + 1, end) });
        i = end + 1;
      } else if (text.slice(i, i + 2) === "**" && (end = text.indexOf("**", i + 2)) > i + 2) {
        flush();
        out.push({ t: "b", v: text.slice(i + 2, end) });
        i = end + 2;
      } else if (text[i] === "*" && text[i + 1] !== "*" && text[i + 1] !== " " && (end = text.indexOf("*", i + 1)) > i + 1 && text[end + 1] !== "*") {
        flush();
        out.push({ t: "i", v: text.slice(i + 1, end) });
        i = end + 1;
      } else {
        plain += text[i];
        i++;
      }
    }
    flush();
    return out;
  }

  var BULLET = /^\s*[-*]\s+(.*)$/, NUMBER = /^\s*\d+[.)]\s+(.*)$/, HEADING = /^#{1,6}\s+(.*)$/;

  function parse(text) {
    var lines = String(text == null ? "" : text).replace(/\r\n/g, "\n").split("\n");
    var blocks = [], para = [], list = null;
    function endPara() {
      if (para.length) blocks.push({ type: "p", inline: inline(para.join(" ")) });
      para = [];
    }
    function endList() {
      if (list) blocks.push(list);
      list = null;
    }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i], m;
      if (/^\s*```/.test(line)) {
        endPara(); endList();
        var code = [];
        for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
        blocks.push({ type: "code", text: code.join("\n") });
      } else if (!line.trim()) {
        endPara(); endList();
      } else if ((m = HEADING.exec(line))) {
        endPara(); endList();
        blocks.push({ type: "h", inline: inline(m[1]) });
      } else if ((m = BULLET.exec(line)) || (m = NUMBER.exec(line))) {
        endPara();
        var type = BULLET.test(line) ? "ul" : "ol";
        if (list && list.type !== type) endList();
        if (!list) list = { type: type, items: [] };
        list.items.push(inline(m[1]));
      } else {
        endList();
        para.push(line.trim());
      }
    }
    endPara(); endList();
    return blocks;
  }

  function inlineInto(el, parts, doc) {
    parts.forEach(function (p) {
      if (p.t === "text") return el.appendChild(doc.createTextNode(p.v));
      var tag = { b: "strong", i: "em", code: "code" }[p.t];
      var e = doc.createElement(tag);
      e.textContent = p.v;
      el.appendChild(e);
    });
  }

  function render(blocks, doc) {
    var frag = doc.createDocumentFragment();
    blocks.forEach(function (b) {
      var el;
      if (b.type === "code") {
        el = doc.createElement("pre");
        el.textContent = b.text;
      } else if (b.type === "ul" || b.type === "ol") {
        el = doc.createElement(b.type);
        b.items.forEach(function (item) {
          var li = doc.createElement("li");
          inlineInto(li, item, doc);
          el.appendChild(li);
        });
      } else {
        el = doc.createElement("p");
        if (b.type === "h") {
          var strong = doc.createElement("strong");
          inlineInto(strong, b.inline, doc);
          el.appendChild(strong);
        } else inlineInto(el, b.inline, doc);
      }
      frag.appendChild(el);
    });
    return frag;
  }

  var api = { parse: parse, render: render };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorAssistantMarkdown = api;
})();
