import { GoogleGenAI } from '@google/genai';
import type { Policy } from './data/logistics_policies.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });

export async function summarizeTicket(ticketText: string, relevantPolicy: Policy | null, orderContext: string | null = null): Promise<string> {
    const policyContext = relevantPolicy 
        ? `Company policy relevant to this issue:\n[${relevantPolicy.title}]\n${relevantPolicy.content}` 
        : `No direct policy found. Respond appropriately and suggest contacting support.`;

    const dbContext = orderContext 
        ? `\n=== Parcel Info from Database (PostgreSQL) ===\n${orderContext}\n(Note: Politely inform the customer of this status)\n` 
        : '';

    const prompt = `
    You are a Customer Support Assistant for a Logistics company.
    Please analyze the following customer complaint.
    
    Customer message: "${ticketText}"
    
    ---
    ${policyContext}
    ${dbContext}
    ---
    
    Please reply in Markdown format with the following 3 sections:
    **Issue Summary:** [Brief summary of the customer's issue]
    **Issue Category:** [Category such as Claim, Tracking, General]
    **Suggested Resolution:** [Tell the customer what to do by strictly referring to the Database info or Company Policy above. Do not hallucinate parcel data or policies.]
    `;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });

        return response.text || "Unable to summarize.";
    } catch (error) {
        console.error("Error summarizing ticket:", error);
        throw error;
    }
}
