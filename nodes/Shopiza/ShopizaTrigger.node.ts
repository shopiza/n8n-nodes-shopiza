import { createHmac, timingSafeEqual } from 'crypto';
import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { shopizaApiRequest } from './GenericFunctions';

const EVENTS = [
	{ name: 'New Order', value: 'order.created', description: 'A customer placed an order (before payment for card orders)' },
	{ name: 'Order Paid', value: 'order.paid' },
	{ name: 'Order Changed', value: 'order.updated', description: 'Any status or payment change' },
	{ name: 'Order Cancelled', value: 'order.cancelled' },
	{ name: 'Order Refunded', value: 'order.refunded', description: 'Full or partial refund' },
	{ name: 'Product Created', value: 'product.created' },
	{ name: 'Product Updated', value: 'product.updated' },
	{ name: 'Product Deleted', value: 'product.deleted' },
	{ name: 'New Customer Account', value: 'customer.created' },
];

const MAX_SKEW_SECONDS = 300;

// Shopiza-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
export function verifySignature(header: string, rawBody: string, secret: string, now = Date.now()): boolean {
	const parts: Record<string, string> = {};
	for (const p of String(header || '').split(',')) {
		const i = p.indexOf('=');
		if (i > 0) parts[p.slice(0, i).trim()] = p.slice(i + 1).trim();
	}
	if (!parts.t || !parts.v1) return false;
	if (Math.abs(now / 1000 - Number(parts.t)) > MAX_SKEW_SECONDS) return false;
	const expected = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`, 'utf8').digest('hex');
	const a = Buffer.from(parts.v1);
	const b = Buffer.from(expected);
	return a.length === b.length && timingSafeEqual(a, b);
}

export class ShopizaTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Shopiza Trigger',
		name: 'shopizaTrigger',
		icon: 'file:shopiza.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow when something happens in a Shopiza shop',
		defaults: { name: 'Shopiza Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'shopizaApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					'Your n8n must be reachable from the internet over https: Shopiza refuses webhook URLs on localhost or private networks. The API key needs the "Manage webhooks" permission plus read access to what you subscribe to.',
				name: 'notice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				options: EVENTS,
				required: true,
				default: ['order.created'],
			},
			{
				displayName: 'Output',
				name: 'output',
				type: 'options',
				options: [
					{
						name: 'Object Only',
						value: 'object',
						description: 'The order, product or customer, plus event_type and event_id',
					},
					{ name: 'Full Event', value: 'event', description: 'The raw event body as Shopiza sends it' },
				],
				default: 'object',
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node');
				if (!data.webhookId) return false;
				const url = this.getNodeWebhookUrl('default');
				const res = await shopizaApiRequest.call(this, 'GET', '/webhooks');
				const found = (((res && res.data) as IDataObject[]) || []).find(
					(w: IDataObject) => String(w.id) === String(data.webhookId) && w.url === url && w.is_active,
				);
				if (!found) {
					delete data.webhookId;
					delete data.secret;
					return false;
				}
				return true;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node');
				const url = this.getNodeWebhookUrl('default') as string;
				const events = this.getNodeParameter('events') as string[];
				const res = await shopizaApiRequest.call(this, 'POST', '/webhooks', {
					url,
					events,
					description: `n8n: ${this.getWorkflow().name || 'workflow'}`.slice(0, 120),
				});
				if (!res || !res.id) return false;
				data.webhookId = res.id;
				data.secret = res.secret;
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node');
				if (data.webhookId) {
					try {
						await shopizaApiRequest.call(this, 'DELETE', `/webhooks/${data.webhookId}`);
					} catch (error) {
						// Usually already gone (key revoked, removed in the admin), so
						// deactivating still succeeds; log it in case it was something else.
						this.logger.warn('Shopiza: could not remove the webhook', {
							webhookId: data.webhookId,
							error: (error as Error).message,
						});
					}
				}
				delete data.webhookId;
				delete data.secret;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const data = this.getWorkflowStaticData('node');
		const secret = data.secret as string | undefined;
		const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
		if (secret && raw) {
			const ok = verifySignature(String(req.headers['shopiza-signature'] || ''), raw.toString('utf8'), secret);
			if (!ok) {
				const res = this.getResponseObject();
				res.status(401).send('invalid signature').end();
				return { noWebhookResponse: true };
			}
		}
		const event = this.getBodyData() as IDataObject;
		const output = this.getNodeParameter('output', 'object') as string;
		let json: IDataObject = event;
		if (output === 'object') {
			const object = ((event.data as IDataObject) || {}).object as IDataObject;
			json = { ...(object || {}), event_type: event.type, event_id: event.id, event_created_at: event.created_at };
		}
		return { workflowData: [this.helpers.returnJsonArray(json)] };
	}
}
