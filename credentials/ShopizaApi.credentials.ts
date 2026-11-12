import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class ShopizaApi implements ICredentialType {
	name = 'shopizaApi';

	displayName = 'Shopiza API';

	documentationUrl = 'https://shopiza.io/developers';

	icon = 'file:../nodes/Shopiza/shopiza.svg' as const;

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Create a key in your Shopiza admin under Settings > Integrations > API keys. Starts with sz_live_.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://shopiza.io/api/v1',
			url: '/shop',
		},
	};
}
