import { Gemini } from './gemini';
import { OpenAI } from './openai';
import { IAIProvider } from './types';

export interface ProviderFactoryOptions {
    allowPrivateApiUrls?: boolean;
}

/**
 * Creates the provider selected by the existing CLI mode option.
 * Unknown modes intentionally retain the historical OpenAI fallback.
 */
export function createAIProvider(
    mode: string,
    apiUrl: string,
    accessToken: string,
    orgId?: string,
    model?: string,
    options: ProviderFactoryOptions = {},
): IAIProvider {
    if (mode === 'gemini') {
        console.log('Creating Gemini client...');
        return new Gemini(apiUrl, accessToken, model, options);
    }

    console.log('Creating OpenAI client...');
    return new OpenAI(apiUrl, accessToken, orgId, model, options);
}
