import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { clean, shopizaApiRequest, shopizaApiRequestAll } from './GenericFunctions';

const ORDER_STATUSES = [
	{ name: 'New', value: 'new' },
	{ name: 'Processing', value: 'processing' },
	{ name: 'Fulfilled (Shipped)', value: 'fulfilled' },
	{ name: 'Cancelled', value: 'cancelled' },
];

const PAYMENT_STATUSES = [
	{ name: 'Pending', value: 'pending' },
	{ name: 'Paid', value: 'paid' },
	{ name: 'Failed', value: 'failed' },
	{ name: 'Refunded', value: 'refunded' },
	{ name: 'Partially Refunded', value: 'partially_refunded' },
	{ name: 'Disputed', value: 'disputed' },
	{ name: 'Chargeback', value: 'chargeback' },
];

const show = (resource: string, operation: string[]) => ({ show: { resource: [resource], operation } });

const returnAllAndLimit = (resource: string): INodeProperties[] => [
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: show(resource, ['getAll']),
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { resource: [resource], operation: ['getAll'], returnAll: [false] } },
	},
];

const commonFilters: INodeProperties[] = [
	{
		displayName: 'Created After',
		name: 'created_after',
		type: 'dateTime',
		default: '',
	},
	{
		displayName: 'Updated After',
		name: 'updated_after',
		type: 'dateTime',
		default: '',
		description: 'Only items changed after this moment. With Sort set to Last Change, this gives an incremental sync.',
	},
	{
		displayName: 'Sort',
		name: 'sort',
		type: 'options',
		options: [
			{ name: 'Newest First', value: 'created_at' },
			{ name: 'Last Change First', value: 'updated_at' },
		],
		default: 'created_at',
	},
];

const commerceFields = (resource: string, operation: string): INodeProperties => ({
	displayName: 'Update Fields',
	name: 'updateFields',
	type: 'collection',
	placeholder: 'Add Field',
	default: {},
	displayOptions: show(resource, [operation]),
	options: [
		{
			displayName: 'Price',
			name: 'price',
			type: 'number',
			typeOptions: { minValue: 0, numberPrecision: 2 },
			default: 0,
			description: "Entered the same way as in the Shopiza admin (net or gross, per the shop's pricing setting)",
		},
		{
			displayName: 'Sale Price',
			name: 'sale_price',
			type: 'number',
			typeOptions: { minValue: 0, numberPrecision: 2 },
			default: 0,
			description: 'Must be lower than the price. 0 removes the sale.',
		},
		{
			displayName: 'Stock',
			name: 'stock',
			type: 'number',
			typeOptions: { minValue: 0 },
			default: 0,
		},
		{
			displayName: 'Stop Tracking Stock',
			name: 'untrackStock',
			type: 'boolean',
			default: false,
			description: 'Whether to stop tracking stock for this item (overrides Stock)',
		},
		{
			displayName: 'Visible in Shop',
			name: 'is_active',
			type: 'boolean',
			default: true,
		},
	],
});

export class Shopiza implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Shopiza',
		name: 'shopiza',
		icon: 'file:shopiza.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Read and update orders, products and customers in a Shopiza shop',
		defaults: { name: 'Shopiza' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [{ name: 'shopizaApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Customer', value: 'customer' },
					{ name: 'Order', value: 'order' },
					{ name: 'Product', value: 'product' },
					{ name: 'Shop', value: 'shop' },
				],
				default: 'order',
			},

			// ── Operations ──
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['order'] } },
				options: [
					{ name: 'Get', value: 'get', action: 'Get an order' },
					{ name: 'Get Many', value: 'getAll', action: 'Get many orders' },
					{ name: 'Update Status', value: 'update', action: 'Update an order status' },
				],
				default: 'getAll',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['product'] } },
				options: [
					{ name: 'Get', value: 'get', action: 'Get a product' },
					{ name: 'Get Many', value: 'getAll', action: 'Get many products' },
					{ name: 'Update', value: 'update', action: 'Update price, stock or visibility of a product' },
					{ name: 'Update Variant', value: 'updateVariant', action: 'Update price, stock or visibility of a variant' },
				],
				default: 'getAll',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['customer'] } },
				options: [
					{ name: 'Get', value: 'get', action: 'Get a customer' },
					{ name: 'Get Many', value: 'getAll', action: 'Get many customers' },
				],
				default: 'getAll',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['shop'] } },
				options: [{ name: 'Get', value: 'get', action: 'Get the shop' }],
				default: 'get',
			},

			// ── Order ──
			{
				displayName: 'Order ID',
				name: 'orderId',
				type: 'string',
				required: true,
				default: '',
				description: 'The numeric order ID (not the order number the customer sees)',
				displayOptions: show('order', ['get', 'update']),
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: ORDER_STATUSES,
				required: true,
				default: 'fulfilled',
				displayOptions: show('order', ['update']),
			},
			{
				displayName: 'Options',
				name: 'updateOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: show('order', ['update']),
				options: [
					{
						displayName: 'Notify Customer',
						name: 'notify_customer',
						type: 'boolean',
						default: true,
						description: 'Whether to email the customer when the order is marked fulfilled',
					},
					{ displayName: 'Tracking Number', name: 'tracking_number', type: 'string', default: '' },
					{ displayName: 'Tracking URL', name: 'tracking_url', type: 'string', default: '' },
				],
			},
			...returnAllAndLimit('order'),
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: show('order', ['getAll']),
				options: [
					{ displayName: 'Status', name: 'status', type: 'options', options: ORDER_STATUSES, default: 'new' },
					{ displayName: 'Payment Status', name: 'payment_status', type: 'options', options: PAYMENT_STATUSES, default: 'paid' },
					{ displayName: 'Order Number', name: 'number', type: 'string', default: '' },
					{ displayName: 'Customer Email', name: 'email', type: 'string', placeholder: 'name@email.com', default: '' },
					...commonFilters,
				],
			},

			// ── Product ──
			{
				displayName: 'Product ID',
				name: 'productId',
				type: 'string',
				required: true,
				default: '',
				displayOptions: show('product', ['get', 'update', 'updateVariant']),
			},
			{
				displayName: 'Variant ID',
				name: 'variantId',
				type: 'string',
				required: true,
				default: '',
				displayOptions: show('product', ['updateVariant']),
			},
			commerceFields('product', 'update'),
			commerceFields('product', 'updateVariant'),
			...returnAllAndLimit('product'),
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: show('product', ['getAll']),
				options: [
					{ displayName: 'SKU', name: 'sku', type: 'string', default: '' },
					{
						displayName: 'Visibility',
						name: 'is_active',
						type: 'options',
						options: [
							{ name: 'Visible', value: 'true' },
							{ name: 'Hidden', value: 'false' },
						],
						default: 'true',
					},
					...commonFilters,
				],
			},

			// ── Customer ──
			{
				displayName: 'Customer ID',
				name: 'customerId',
				type: 'string',
				required: true,
				default: '',
				displayOptions: show('customer', ['get']),
			},
			...returnAllAndLimit('customer'),
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: show('customer', ['getAll']),
				options: [
					{ displayName: 'Email', name: 'email', type: 'string', placeholder: 'name@email.com', default: '' },
					...commonFilters,
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;
		const collections: Record<string, string> = { order: '/orders', product: '/products', customer: '/customers' };

		for (let i = 0; i < items.length; i++) {
			try {
				let result: IDataObject | IDataObject[];

				if (resource === 'shop') {
					result = await shopizaApiRequest.call(this, 'GET', '/shop');
				} else if (operation === 'getAll') {
					const returnAll = this.getNodeParameter('returnAll', i) as boolean;
					const limit = returnAll ? undefined : (this.getNodeParameter('limit', i) as number);
					const filters = clean(this.getNodeParameter('filters', i, {}) as IDataObject);
					result = await shopizaApiRequestAll.call(this, collections[resource], filters, limit);
				} else if (operation === 'get') {
					const idParam = { order: 'orderId', product: 'productId', customer: 'customerId' }[resource] as string;
					const id = encodeURIComponent(String(this.getNodeParameter(idParam, i)).trim());
					result = await shopizaApiRequest.call(this, 'GET', `${collections[resource]}/${id}`);
				} else if (resource === 'order' && operation === 'update') {
					const id = encodeURIComponent(String(this.getNodeParameter('orderId', i)).trim());
					const body: IDataObject = {
						status: this.getNodeParameter('status', i) as string,
						...clean(this.getNodeParameter('updateOptions', i, {}) as IDataObject),
					};
					result = await shopizaApiRequest.call(this, 'PATCH', `/orders/${id}`, body);
				} else if (resource === 'product' && (operation === 'update' || operation === 'updateVariant')) {
					const pid = encodeURIComponent(String(this.getNodeParameter('productId', i)).trim());
					const fields = { ...(this.getNodeParameter('updateFields', i, {}) as IDataObject) };
					const body: IDataObject = {};
					if (fields.price !== undefined) body.price = fields.price;
					if (fields.sale_price !== undefined) body.sale_price = Number(fields.sale_price) > 0 ? fields.sale_price : null;
					if (fields.untrackStock === true) body.stock = null;
					else if (fields.stock !== undefined) body.stock = fields.stock;
					if (fields.is_active !== undefined) body.is_active = fields.is_active;
					if (!Object.keys(body).length) {
						throw new NodeOperationError(this.getNode(), 'Add at least one field to update', { itemIndex: i });
					}
					const path = operation === 'update'
						? `/products/${pid}`
						: `/products/${pid}/variants/${encodeURIComponent(String(this.getNodeParameter('variantId', i)).trim())}`;
					result = await shopizaApiRequest.call(this, 'PATCH', path, body);
				} else {
					throw new NodeOperationError(this.getNode(), `Unsupported operation ${resource}.${operation}`, { itemIndex: i });
				}

				const executionData = this.helpers.constructExecutionMetaData(
					this.helpers.returnJsonArray(result as IDataObject | IDataObject[]),
					{ itemData: { item: i } },
				);
				out.push(...executionData);
			} catch (error) {
				if (this.continueOnFail()) {
					out.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				throw error;
			}
		}
		return [out];
	}
}
