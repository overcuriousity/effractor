// Which asynchronous answers still describe what is on the page. Every parse,
// layout and solve takes a token when it starts and is accepted only if the
// document has not changed since and no newer request of its kind was made.
// Pure: no DOM, no timers.
(function () {
  function create() {
    var revision = 0;
    var latest = Object.create(null); // channel -> newest request number

    return {
      current: function () {
        return String(revision);
      },
      // The document changed: everything asked about the old one is moot.
      invalidate: function () {
        revision++;
      },
      issue: function (channel) {
        latest[channel] = (latest[channel] || 0) + 1;
        return { revision: String(revision), channel: channel, request: latest[channel] };
      },
      accept: function (token) {
        return !!token && token.revision === String(revision) && latest[token.channel] === token.request;
      },
    };
  }

  var api = { create: create };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorRevisions = api;
})();
