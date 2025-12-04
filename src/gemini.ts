import axios, { AxiosInstance } from 'axios';
import { IAIClient } from './types';
import { SYSTEM_PROMPT, REVIEW_INSTRUCTIONS, DEFAULT_GEMINI_MODEL, GEMINI_SAFETY_SETTINGS } from './prompts';

export class Gemini implements IAIClient {
    private apiClient: AxiosInstance;
    private model: string;
    private apiKey: string;

    constructor(apiUrl: string, accessToken: string, customModel?: string) {
        this.apiKey = accessToken;
        this.model = customModel || DEFAULT_GEMINI_MODEL;
        
        this.apiClient = axios.create({
            baseURL: `${apiUrl}/v1beta/models`,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }

    async reviewCodeChange(diff: string): Promise<string> {
        const response = await this.apiClient.post(
            `/${this.model}:generateContent?key=${this.apiKey}`,
            {
                contents: [
                    {
                        role: 'user',
                        parts: [{ text: diff }]
                    }
                ],
                systemInstruction: {
                    parts: [
                        { text: SYSTEM_PROMPT },
                        { text: REVIEW_INSTRUCTIONS }
                    ]
                },
                safetySettings: GEMINI_SAFETY_SETTINGS,
            }
        );

        if (response.status < 200 || response.status >= 300) {
            throw new Error(`Gemini API request failed with status ${response.status}`);
        }

        return response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }
}
