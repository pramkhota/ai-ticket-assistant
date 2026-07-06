import { GoogleGenAI } from '@google/genai';
import type { Policy } from './data/logistics_policies.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });

export async function summarizeTicket(ticketText: string, relevantPolicy: Policy | null, orderContext: string | null = null): Promise<string> {
    const policyContext = relevantPolicy 
        ? `นโยบายบริษัทที่เกี่ยวข้องกับการแก้ปัญหานี้:\n[${relevantPolicy.title}]\n${relevantPolicy.content}` 
        : `ไม่มีนโยบายที่เกี่ยวข้องโดยตรง ให้ตอบตามความเหมาะสมและแนะนำให้ลูกค้าติดต่อเจ้าหน้าที่`;

    const dbContext = orderContext 
        ? `\n=== ข้อมูลพัสดุจากระบบ Database (PostgreSQL) ===\n${orderContext}\n(หมายเหตุ: ให้นำข้อมูลสถานะนี้แจ้งให้ลูกค้าทราบอย่างสุภาพ)\n` 
        : '';

    const prompt = `
    คุณคือผู้ช่วยฝ่าย Customer Support ของบริษัทขนส่ง (Logistics)
    กรุณาวิเคราะห์ข้อความแจ้งปัญหาของลูกค้าด้านล่างนี้
    
    ข้อความของลูกค้า: "${ticketText}"
    
    ---
    ${policyContext}
    ${dbContext}
    ---
    
    ขอให้ตอบกลับเป็นรูปแบบ Markdown โดยมี 3 หัวข้อดังนี้:
    **สรุปปัญหา:** [ใจความสำคัญสั้นๆ ของปัญหาลูกค้า]
    **หมวดหมู่ปัญหา:** [หมวดหมู่ เช่น Claim, Tracking, General]
    **วิธีแก้ปัญหาเบื้องต้น (Suggested Resolution):** [บอกลูกค้าว่าต้องทำอย่างไร โดยอ้างอิงจากข้อมูล Database หรือนโยบายบริษัทด้านบนอย่างเคร่งครัด ห้ามแต่งข้อมูลพัสดุหรือนโยบายขึ้นมาเองเด็ดขาด]
    `;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });

        return response.text || "ไม่สามารถสรุปผลได้";
    } catch (error) {
        console.error("Error summarizing ticket:", error);
        throw error;
    }
}
