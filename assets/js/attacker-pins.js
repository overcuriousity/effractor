// Footholds and the target as pins, in the architecture view (spec 10):
// dragged from the tray in the canvas corner onto a component, or picked up
// from one component and dropped on another, or off the components to take
// it away. A kind with several states (a host: user, admin) asks which, at
// the drop; a kind with one takes it. It decides which edit;
// architecture-links.js makes it; wasm says whether it is valid.
(function () {
  if (typeof document === "undefined") return;
  var app = window.effractor;
  var U = window.effractorArchitectureUi;
  var L = window.effractorArchitectureLinks;
  var P = window.effractorProfiles;
  var DRAG_PX = 4;

  function doc() {
    return app.state.doc;
  }
  function own(map, key) {
    return map && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
  }
  function shown() {
    return P.isArchitecture(doc()) && document.getElementById("app").getAttribute("data-view") !== "attack";
  }

  // The component under the pointer, by id, or null.
  function entityAt(x, y) {
    var hit = document.elementFromPoint(x, y);
    var node = hit && hit.closest ? hit.closest("#canvas .node") : null;
    var q = node ? P.qualified(node.getAttribute("data-id")) : null;
    return q && q.kind === "entity" && own(doc().entities, q.id) ? q.id : null;
  }

  function place(role, entity, state, from) {
    U.apply(function () {
      return L.placePin(doc(), role, entity, state, from);
    }, null, true);
  }

  // Dropped on `entity`: its states decide whether there is a question.
  function drop(role, entity, from, x, y) {
    var e = doc().entities[entity];
    U.loadCatalog().then(function (catalog) {
      var spec = (catalog.entities || []).filter(function (s) {
        return s.kind === e.kind;
      })[0];
      var states = spec ? spec.states : [];
      if (!states.length) return app.say("a " + e.kind + " takes no pin: what an attacker gets there follows from its links");
      if (states.length === 1) return place(role, entity, states[0], from);
      app.showMenu([[role + " on " + e.label, "", null]].concat(states.map(function (s) {
        return [s, "", function () {
          place(role, entity, s, from);
        }];
      })), x, y);
    }, function () {
      app.say("the component library could not be read");
    });
  }

  // ---- the drag: from the tray or from a component's pin ----

  var drag = null; // {role, from, x, y, moved, ghost, over}

  function hover(entity) {
    if (drag.over === entity) return;
    drag.over = entity;
    app.renderer.highlight(entity ? ["entity/" + entity] : [], "pin-drop");
  }

  function end() {
    if (!drag) return;
    if (drag.ghost) drag.ghost.remove();
    if (drag.over) app.renderer.highlight([], "pin-drop");
    document.body.classList.remove("is-pinning");
    drag = null;
  }

  document.addEventListener("pointerdown", function (e) {
    if (e.button !== 0 || !shown()) return;
    var pin = e.target.closest ? e.target.closest("#canvas [data-pin-role]") : null;
    if (!pin) return;
    // Before the canvas sees it: a pin in hand is not the component moving.
    e.stopPropagation();
    e.preventDefault();
    var from = null;
    var node = pin.closest(".node");
    if (node) {
      var q = P.qualified(node.getAttribute("data-id"));
      from = { entity: q.id, state: pin.getAttribute("data-pin-state") };
    }
    drag = { role: pin.getAttribute("data-pin-role"), from: from, x: e.clientX, y: e.clientY, moved: false, ghost: null, over: null };
  }, true);

  document.addEventListener("pointermove", function (e) {
    if (!drag) return;
    if (!drag.moved && Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < DRAG_PX) return;
    if (!drag.moved) {
      drag.moved = true;
      drag.ghost = document.createElement("div");
      drag.ghost.className = "pin-ghost pin-" + drag.role;
      drag.ghost.textContent = drag.role + (drag.from ? " · " + drag.from.state : "");
      document.body.appendChild(drag.ghost);
      document.body.classList.add("is-pinning");
    }
    drag.ghost.style.setProperty("--pin-x", e.clientX + "px");
    drag.ghost.style.setProperty("--pin-y", e.clientY + "px");
    hover(entityAt(e.clientX, e.clientY));
  });

  document.addEventListener("pointerup", function (e) {
    if (!drag) return;
    var d = drag;
    end();
    if (!d.moved) {
      // A click: on a component's pin, the component; on the tray, the
      // selected component, if one is.
      if (d.from) return app.select("entity/" + d.from.entity);
      var q = P.qualified(app.state.selected);
      if (q && q.kind === "entity") return drop(d.role, q.id, null, e.clientX, e.clientY);
      return app.say("drag the " + d.role + " onto a component");
    }
    var entity = entityAt(e.clientX, e.clientY);
    if (entity) {
      if (d.from && d.from.entity === entity) return;
      return drop(d.role, entity, d.from, e.clientX, e.clientY);
    }
    if (!d.from) return app.say("drop the " + d.role + " on a component");
    U.apply(function () {
      return L.removePin(doc(), d.role, d.from.entity, d.from.state);
    });
  });

  document.addEventListener("pointercancel", end);
  document.addEventListener("keydown", function (e) {
    if (drag && e.key === "Escape") {
      e.stopPropagation();
      end();
    }
  }, true);
})();
