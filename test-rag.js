import 'dotenv/config';
import { findRelevantPolicy } from './src/utils/rag.js';

async function test() {
    try {
        const policy = await findRelevantPolicy("พัสดุแตกเสียหาย ต้องการเคลมด่วน");
        console.log("Found Policy:", policy);
    } catch (e) {
        console.error("ERROR:", e);
    }
}
test();
