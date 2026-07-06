import 'dotenv/config';
import { summarizeTicket } from './src/gemini.js';

async function test() {
    try {
        const ticket = "พัสดุของฉันสูญหาย ต้องทำอย่างไร";
        const mockPolicy = {
            id: 'POL-001',
            title: 'นโยบายความเสียหายหรือสูญหายของพัสดุ',
            content: 'หากพัสดุเกิดความเสียหายหรือสูญหายระหว่างการจัดส่ง บริษัทจะรับผิดชอบชดใช้ค่าเสียหายตามมูลค่าจริง แต่ไม่เกิน 2,000 บาทต่อชิ้น (เว้นแต่ลูกค้าจะซื้อประกันพัสดุเพิ่มเติม) ลูกค้าต้องแจ้งเคลมพร้อมหลักฐานภาพถ่ายภายใน 3 วันหลังจากได้รับพัสดุ'
        };
        
        console.log("Summarizing ticket...");
        const summary = await summarizeTicket(ticket, mockPolicy);
        console.log("\n=== AI RESPONSE ===");
        console.log(summary);
    } catch (e) {
        console.error("ERROR:", e);
    }
}
test();
