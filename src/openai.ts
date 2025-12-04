import axios, { AxiosInstance } from 'axios';
import { IAIClient } from './types';
import { OPENAI_CONFIG, openAiSystemMessage, openAiUserMessage } from './prompts';

export class OpenAI implements IAIClient {
    private apiClient: AxiosInstance;
    private accessTokens: string[];
    private accessTokenIndex = 0;
    private model: string;

    constructor(apiUrl: string, accessToken: string, orgId?: string, customModel?: string) {
        this.accessTokens = accessToken.split(',');
        this.model = customModel || OPENAI_CONFIG.model;
        
        const headers: Record<string, string> = {};
        if (orgId) {
            headers['OpenAI-Organization'] = orgId;
        }
        
        this.apiClient = axios.create({
            baseURL: apiUrl,
            headers,
        });
    }

    async reviewCodeChange(diff: string): Promise<string> {
        const tokenIndex = this.getNextTokenIndex();
        
        const response = await this.apiClient.post('/chat/completions', {
            ...OPENAI_CONFIG,
            model: this.model,
            messages: [
                openAiSystemMessage,
                openAiUserMessage,
                { role: 'user', content: diff }
            ],
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.accessTokens[tokenIndex]}`
            }
        });
        
        return response.data.choices?.[0]?.message?.content || '';
    }

    private getNextTokenIndex(): number {
        this.accessTokenIndex = (this.accessTokenIndex + 1) % this.accessTokens.length;
        return this.accessTokenIndex;
    }
}
