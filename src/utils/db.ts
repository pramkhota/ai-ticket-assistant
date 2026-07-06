import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ai-ticket-assistant';

export const connectDB = async () => {
    try {
        if (mongoose.connection.readyState >= 1) return;
        await mongoose.connect(MONGODB_URI);
        console.log(` [MongoDB] Connected successfully to ${MONGODB_URI.split('@').pop()}`);
    } catch (error) {
        console.error(`❌ [MongoDB] Connection error:`, error);
        // ถ้าต่อ DB ไม่ได้ เราจะยังไม่ปิดเซิร์ฟเวอร์เพื่อให้เห็น error บนจอ
    }
};
