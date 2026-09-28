#!/usr/bin/env node
// Writes assets/nuclei/*.yaml from the table in assets/js/nuclei-templates.js
// (nuclei templates spec §2); scripts/nuclei-templates.test.js holds them equal.
const fs = require('node:fs');
const path = require('node:path');
const T = require('../../assets/js/nuclei-templates.js');

const dir = path.resolve(__dirname, '../../assets/nuclei');
fs.mkdirSync(dir, { recursive: true });
for (const t of T.TEMPLATES) fs.writeFileSync(path.join(dir, t.id + '.yaml'), T.text(t.id));
console.log('wrote ' + T.TEMPLATES.length + ' templates to assets/nuclei');
