// Documents as `parse` hands them to the page. webserver.json is checked
// against the real thing by a Rust test in effractor-format.
const webserver = require("./webserver.doc.json");

const attack = {
  effractor: 2,
  profile: "attack-tree",
  name: "Office",
  top: "files",
  nodes: {
    files: { label: "Read the files", gate: "or", children: ["account", "physical"] },
    account: { label: "Take over an account", gate: "and", children: ["phish", "mfa"] },
    physical: { label: "Get in", gate: "vote", k: 2, children: ["key", "alarm", "phish"] },
    phish: { label: "Phishing", leaf: "basic", ttc: "HardAndUncertain", cost: 200, detection: 0.3 },
    mfa: { label: "MFA fatigue", leaf: "basic", p: 0.2, cost: 50 },
    key: { label: "Copy a key", leaf: "undeveloped" },
    alarm: { label: "Alarm is off", leaf: "undeveloped", p: 0.1, detection: 0.05 },
  },
};

module.exports = { webserver, attack };
