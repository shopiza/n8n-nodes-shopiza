import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

export const BASE_URL = 'https://shopiza.io/api/v1';

type Ctx = IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions;

export async function shopizaApiRequest(
	this: Ctx,
	method: IHttpRequestMethods,
	path: string,
	body: IDataObject = {},
	qs: IDataObject = {},
): Promise<any> {
	const options: IHttpRequestOptions = {
		method,
		url: `${BASE_URL}${path}`,
		qs,
		json: true,
	};
	if (method !== 'GET' && method !== 'DELETE') options.body = body;
	try {
		return await this.helpers.httpRequestWithAuthentication.call(this, 'shopizaApi', options);
	} catch (error) {
		// The API answers { error: { code, message, field?, param? } }: surface it.
		throw new NodeApiError(this.getNode(), error as JsonObject);
	}
}

// Walks page=1,2,... until has_more is false or `limit` items are collected.
export async function shopizaApiRequestAll(
	this: IExecuteFunctions,
	path: string,
	qs: IDataObject,
	limit?: number,
): Promise<IDataObject[]> {
	const out: IDataObject[] = [];
	let page = 1;
	for (;;) {
		const pageSize = limit ? Math.min(100, limit - out.length) : 100;
		const res = await shopizaApiRequest.call(this, 'GET', path, {}, { ...qs, page, limit: pageSize });
		const data = (res && res.data) || [];
		out.push(...data);
		if (!res.has_more || !data.length || (limit && out.length >= limit)) break;
		page += 1;
	}
	return limit ? out.slice(0, limit) : out;
}

// Drop empty strings and nulls from an n8n "fields" collection, keep false/0.
export function clean(fields: IDataObject): IDataObject {
	const out: IDataObject = {};
	for (const [k, v] of Object.entries(fields || {})) {
		if (v === '' || v === undefined) continue;
		out[k] = v;
	}
	return out;
}
