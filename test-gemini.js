import 'dotenv/config';
import { findRelevantPolicy } from './src/utils/rag.js';
import { summarizeTicket } from './src/gemini.js';

async function test() {
    try {
        const ticket = "พัสดุแตกเสียหาย ต้องการเคลมด่วน บช 1234567890";
        console.log("Finding policy...");
        const policy = await findRelevantPolicy(ticket);
        console.log("Found Policy:", policy?.title);
        
        console.log("Summarizing ticket...");
        const summary = await summarizeTicket(ticket, policy);
        console.log("Summary:", summary);
    } catch (e) {
        console.error("ERROR:", e);
    }
}
test();
