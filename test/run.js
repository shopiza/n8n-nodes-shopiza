// Runs the COMPILED nodes (dist/) against the live Shopiza API with a stub
// n8n context. Needs SHOPIZA_TEST_KEY (a key with every scope on a test shop).
//   SHOPIZA_TEST_KEY=sz_live_... npm test
// Writes nothing visible: the product "update" re-sends the price it read.
const assert = require('assert');
const crypto = require('crypto');
const { Shopiza } = require('../dist/nodes/Shopiza/Shopiza.node');
const { ShopizaTrigger, verifySignature } = require('../dist/nodes/Shopiza/ShopizaTrigger.node');

const KEY = process.env.SHOPIZA_TEST_KEY;
if (!KEY) { console.error('SHOPIZA_TEST_KEY is not set'); process.exit(2); }

async function httpRequestWithAuthentication(cred, opts) {
  assert.strictEqual(cred, 'shopizaApi');
  const url = new URL(opts.url);
  for (const [k, v] of Object.entries(opts.qs || {})) if (v !== undefined) url.searchParams.set(k, v);
  const r = await fetch(url, {
    method: opts.method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: opts.body && opts.method !== 'GET' ? JSON.stringify(opts.body) : undefined,
  });
  const text = await r.text();
  const json = text ? JSON.parse(text) : {};
  if (!r.ok) { const e = new Error(`HTTP ${r.status} ${text}`); e.httpCode = String(r.status); e.response = json; throw e; }
  return json;
}

function execCtx(params, items = [{ json: {} }]) {
  return {
    getInputData: () => items,
    getNodeParameter: (name, i, fallback) => (name in params ? params[name] : fallback),
    getNode: () => ({ name: 'Shopiza', type: 'shopiza', typeVersion: 1 }),
    continueOnFail: () => false,
    helpers: {
      httpRequestWithAuthentication,
      returnJsonArray: (d) => (Array.isArray(d) ? d : [d]).map((json) => ({ json })),
      constructExecutionMetaData: (items, meta) => items.map((it) => ({ ...it, pairedItem: meta.itemData })),
    },
  };
}

async function run(params) {
  const node = new Shopiza();
  const [out] = await node.execute.call(execCtx(params));
  return out.map((o) => o.json);
}

(async () => {
  let r = await run({ resource: 'shop', operation: 'get' });
  console.log('shop:', r[0].name, r[0].api_key.scopes.join(','));

  r = await run({ resource: 'order', operation: 'getAll', returnAll: false, limit: 3, filters: { payment_status: 'paid', sort: 'updated_at' } });
  assert.ok(r.length <= 3);
  assert.ok(r.every((o) => o.payment_status === 'paid'));
  console.log('orders paid, limit 3:', r.length, r.map((o) => o.number).join(' '));

  r = await run({ resource: 'order', operation: 'getAll', returnAll: false, limit: 130, filters: {} });
  console.log('orders limit 130 (two pages):', r.length);
  assert.ok(r.length === 130 || r.length < 130);

  const one = await run({ resource: 'order', operation: 'get', orderId: String(r[0].id) });
  assert.strictEqual(one[0].id, r[0].id);
  console.log('order get:', one[0].id, one[0].items.length, 'items');

  const prods = await run({ resource: 'product', operation: 'getAll', returnAll: false, limit: 5, filters: { is_active: 'true' } });
  const simple = prods.find((p) => !p.has_variants);
  const upd = await run({ resource: 'product', operation: 'update', productId: String(simple.id), updateFields: { price: Number(simple.price) } });
  assert.strictEqual(upd[0].price, simple.price);
  console.log('product update (same price):', simple.id, upd[0].price);

  await assert.rejects(run({ resource: 'product', operation: 'update', productId: String(simple.id), updateFields: {} }), /at least one field/);
  console.log('empty update refused locally');

  const custs = await run({ resource: 'customer', operation: 'getAll', returnAll: false, limit: 2, filters: {} });
  console.log('customers:', custs.length);

  // ── Trigger: subscribe, check, receive a signed event, unsubscribe ──
  const staticData = {};
  const hookCtx = {
    getWorkflowStaticData: () => staticData,
    getNodeWebhookUrl: () => 'https://httpbin.org/post',
    getNodeParameter: (n) => ({ events: ['order.created', 'order.paid'] }[n]),
    getWorkflow: () => ({ name: 'test workflow' }),
    getNode: () => ({ name: 'Shopiza Trigger' }),
    helpers: { httpRequestWithAuthentication },
  };
  const trig = new ShopizaTrigger();
  assert.strictEqual(await trig.webhookMethods.default.checkExists.call(hookCtx), false);
  assert.strictEqual(await trig.webhookMethods.default.create.call(hookCtx), true);
  assert.ok(staticData.webhookId && /^whsec_/.test(staticData.secret));
  assert.strictEqual(await trig.webhookMethods.default.checkExists.call(hookCtx), true);
  console.log('trigger subscribed webhook', staticData.webhookId);

  const event = { id: crypto.randomUUID(), type: 'order.paid', created_at: new Date().toISOString(), shop_id: 1, data: { object: { id: 7, number: 'X1' } } };
  const raw = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = `t=${t},v1=${crypto.createHmac('sha256', staticData.secret).update(`${t}.${raw}`).digest('hex')}`;
  assert.ok(verifySignature(sig, raw, staticData.secret));
  assert.ok(!verifySignature(sig, raw + ' ', staticData.secret));
  assert.ok(!verifySignature(`t=${t - 3600},v1=x`, raw, staticData.secret));
  let status = 200;
  const whCtx = (header) => ({
    getRequestObject: () => ({ headers: { 'shopiza-signature': header }, rawBody: Buffer.from(raw) }),
    getResponseObject: () => ({ status(s) { status = s; return this; }, send() { return this; }, end() {} }),
    getWorkflowStaticData: () => staticData,
    getBodyData: () => event,
    getNodeParameter: () => 'object',
    helpers: { returnJsonArray: (d) => [{ json: d }] },
  });
  const ok = await trig.webhook.call(whCtx(sig));
  assert.strictEqual(ok.workflowData[0][0].json.event_type, 'order.paid');
  assert.strictEqual(ok.workflowData[0][0].json.number, 'X1');
  const bad = await trig.webhook.call(whCtx(sig.replace(/v1=([0-9a-f])/, (m, c) => 'v1=' + (c === '0' ? '1' : '0'))));
  assert.ok(bad.noWebhookResponse && status === 401);
  console.log('webhook(): signed event accepted, tampered one answered 401');

  assert.strictEqual(await trig.webhookMethods.default.delete.call(hookCtx), true);
  assert.ok(!staticData.webhookId);
  console.log('trigger unsubscribed');
  console.log('ALL OK');
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
