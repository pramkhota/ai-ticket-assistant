import { GoogleGenAI } from '@google/genai';
import { logisticsPolicies, type Policy } from '../data/logistics_policies.js';
import PolicyModel from '../models/Policy.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });

// ฟังก์ชันคำนวณ Cosine Similarity (ความเหมือนของ Vector)
// ยิ่งเข้าใกล้ 1 แปลว่ายิ่งเหมือนกันมาก
function cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += (vecA[i] as number) * (vecB[i] as number);
        normA += (vecA[i] as number) * (vecA[i] as number);
        normB += (vecB[i] as number) * (vecB[i] as number);
    }
    
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ฟังก์ชันแปลงข้อความเป็น Vector (Embedding)
export async function generateEmbedding(text: string): Promise<number[]> {
    try {
        const response = await ai.models.embedContent({
            model: 'gemini-embedding-2',
            contents: text,
        });
        return response.embeddings?.[0]?.values || [];
    } catch (error) {
        console.error("Error generating embedding:", error);
        return [];
    }
}

// เตรียม Vector ของ Policy ทั้งหมดเอาไว้ใน Memory (เพื่อความรวดเร็ว)
// ในงานจริง มักจะแปลงล่วงหน้าแล้วเก็บลง Vector Database (เช่น Pinecone, pgvector)
let policyVectorsCache: { policy: Policy, vector: number[] }[] | null = null;

// ฟังก์ชันเตรียมข้อมูล (รันครั้งแรกครั้งเดียวตอนเปิดเซิร์ฟเวอร์)
export async function initPolicyVectors() {
    if (policyVectorsCache) return; // ถ้าเคยทำแล้วไม่ต้องทำซ้ำ

    try {
        console.log("⏳ [RAG] Initializing Policy Embeddings from Database...");
        const policyCount = await PolicyModel.countDocuments();
        
        // หากไม่มีข้อมูลเลยใน Database ให้ดึงจาก Mock data มาเซฟลง DB
        if (policyCount === 0) {
            console.log("🌱 [DB] Database is empty. Seeding initial policies...");
            for (const policy of logisticsPolicies) {
                const vector = await generateEmbedding(policy.content);
                await PolicyModel.create({
                    policyId: policy.id,
                    title: policy.title,
                    content: policy.content,
                    embedding: vector
                });
                console.log(`✅ [DB] Seeded policy: ${policy.title}`);
            }
        }
        
        // โหลดนโยบายพร้อม Vector ทั้งหมดจาก DB ขึ้นมาไว้ใน Cache
        const policiesFromDb = await PolicyModel.find();
        policyVectorsCache = policiesFromDb.map(p => ({
            policy: { id: p.policyId, title: p.title, content: p.content },
            vector: p.embedding
        }));

        console.log(`✅ [RAG] Successfully loaded ${policyVectorsCache.length} policies into memory.`);
    } catch (error) {
        console.error("❌ [RAG] Error initializing policies:", error);
        policyVectorsCache = null;
    }
}

// ค้นหานโยบายที่เกี่ยวข้องกับปัญหาของลูกค้ามากที่สุด
export async function findRelevantPolicy(ticketText: string): Promise<Policy | null> {
    if (!policyVectorsCache) {
        await initPolicyVectors();
    }

    // 1. แปลงปัญหาของลูกค้าเป็น Vector
    const ticketVector = await generateEmbedding(ticketText);
    
    if (ticketVector.length === 0) return null;

    let bestMatch: Policy | null = null;
    let highestScore = -1;

    // 2. Exact Search: นำ Vector ปัญหาลูกค้า ไปเปรียบเทียบกับ Vector นโยบายทุกข้อ 
    // (เน้น Quality 100% เพราะข้อมูลเรามีไม่เยอะ)
    for (const item of policyVectorsCache!) {
        const score = cosineSimilarity(ticketVector, item.vector);
        if (score > highestScore) {
            highestScore = score;
            bestMatch = item.policy;
        }
    }

    // ตั้งค่า Threshold ไว้สัก 0.5 (ถ้าไม่เหมือนเลย ไม่ต้องดึงมาอ้างอิง)
    // แต่สำหรับเดโม่ เราจะรีเทิร์นอันที่สูงที่สุดไปเลย
    return highestScore > 0.4 ? bestMatch : null;
}
