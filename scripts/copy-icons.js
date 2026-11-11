// tsc does not copy assets; n8n loads the icon from next to the compiled node.
const fs = require('fs');
const path = require('path');
const from = path.join(__dirname, '..', 'nodes', 'Shopiza', 'shopiza.png');
const to = path.join(__dirname, '..', 'dist', 'nodes', 'Shopiza', 'shopiza.png');
fs.mkdirSync(path.dirname(to), { recursive: true });
fs.copyFileSync(from, to);
console.log('icon copied');
