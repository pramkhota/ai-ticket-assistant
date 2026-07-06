import 'dotenv/config'; 
import express from 'express';
import type { Request, Response } from 'express';
import { summarizeTicket } from './gemini.js';
import { maskPII } from './utils/masking.js';
import { findRelevantPolicy, initPolicyVectors } from './utils/rag.js';
import path from 'path';
import { connectDB } from './utils/db.js';
import Ticket from './models/Ticket.js';
import { connectRabbitMQ, publishEvent, consumeEvent } from './utils/rabbitmq.js';
import { getLogger } from './utils/logger.js';

const mainLogger = getLogger('Main');

const app = express();
const port = 3000;

// เชื่อมต่อ Database และเตรียมพร้อม RAG
connectDB().then(() => initPolicyVectors());

// เชื่อมต่อ RabbitMQ และเปิดใช้งาน Delivery Service
connectRabbitMQ().then(() => {
    startDeliveryService();
});

// ให้ Express สามารถอ่านข้อมูลที่ส่งมาเป็นแบบ JSON ได้
app.use(express.json());

// บอกให้ Express เอาไฟล์ในโฟลเดอร์ public (เช่น index.html) ไปแสดงผลเมื่อเข้าเว็บ
app.use(express.static(path.join(import.meta.dirname, '../public')));

// ---------------------------------------------------------
// สร้าง REST API Endpoint (รองรับ HTTP POST ที่ /api/ticket)
// ---------------------------------------------------------
// @ts-ignore - Ignore type error if Request/Response has issue
app.post('/api/ticket', async (req: Request, res: Response) => {
    try {
        // รับข้อความจาก Frontend (ที่เราพิมพ์ในกล่อง Textarea)
        const rawTicket = req.body.ticket;
        
        if (!rawTicket) {
             res.status(400).json({ error: "Missing ticket text" });
             return;
        }

        console.log("📥 [API] ได้รับข้อความใหม่จากหน้าเว็บ");

        // 1. นำข้อความไปเซ็นเซอร์ PII (AI Governance)
        const safeTicket = maskPII(rawTicket);

        // 2. RAG: ค้นหานโยบายบริษัทที่เกี่ยวข้อง
        const relevantPolicy = await findRelevantPolicy(safeTicket);

        // --- NEW: ตรวจสอบ PostgreSQL Order ---
        const trackingMatch = rawTicket.match(/\bTH\d{5}\b/i);
        let orderContext = null;
        if (trackingMatch) {
            const trackingNo = trackingMatch[0].toUpperCase();
            console.log(`🔍 [PG] พบรหัสพัสดุ ${trackingNo} ในข้อความ กำลังค้นหาข้อมูลจาก PostgreSQL...`);
            
            // ใช้ try-catch ครอบไว้เผื่อกรณียังไม่ได้รัน PostgreSQL หรือยังไม่ได้ Migrate
            try {
                const { prisma } = await import('./utils/pg.js');
                const order = await prisma.order.findUnique({
                    where: { trackingNo: trackingNo },
                    include: { customer: true }
                });

                if (order) {
                    orderContext = `ข้อมูลพัสดุ ${order.trackingNo}: สถานะปัจจุบันคือ "${order.status}" (ผู้รับ: ${order.customer.name}, ปลายทาง: ${order.dropoffPoint})`;
                    console.log(`✅ [PG] ดึงข้อมูลพัสดุสำเร็จ: สถานะ ${order.status}`);
                } else {
                    console.log(`❌ [PG] ไม่พบข้อมูลพัสดุ ${trackingNo} ในระบบ`);
                }
            } catch (pgError) {
                console.error("⚠️ [PG] ไม่สามารถดึงข้อมูลจาก PostgreSQL ได้ (แน่ใจว่าเชื่อมต่อ DB แล้ว?):", (pgError as Error).message);
            }
        }

        // 3. ส่งข้อความที่ปลอดภัย, นโยบาย และข้อมูล DB ไปให้ AI สรุป
        console.log("🤖 [API] กำลังส่งให้ Gemini ประมวลผล...");
        const aiResponse = await summarizeTicket(safeTicket, relevantPolicy, orderContext);

        // 4. บันทึกข้อมูลลง MongoDB
        const newTicket = new Ticket({
            originalText: rawTicket,
            safeText: safeTicket,
            aiSummary: aiResponse,
            retrievedPolicyTitle: relevantPolicy ? relevantPolicy.title : null
        });
        await newTicket.save();
        console.log("💾 [DB] บันทึกข้อมูล Ticket ลง Database สำเร็จ! (ID:", newTicket._id, ")");

        // 5. ส่งคำตอบกลับไปให้ Frontend เป็นรูปแบบ JSON
        res.json({
            safeTicket: safeTicket,
            aiResponse: aiResponse,
            retrievedPolicy: relevantPolicy ? relevantPolicy.title : null
        });
        
        console.log("✅ [API] ประมวลผลเสร็จสิ้นและส่งกลับไปหน้าเว็บแล้ว\n");

    } catch (error) {
        console.error("❌ Error processing ticket:", error);
        res.status(500).json({ error: "Failed to process ticket with AI" });
    }
});

// ---------------------------------------------------------
// [Phase 6] Order Service API - สร้างออเดอร์ใหม่
// ---------------------------------------------------------
// @ts-ignore
app.post('/api/orders', async (req: Request, res: Response) => {
    try {
        const { customerId, pickupPoint, dropoffPoint } = req.body;
        if (!customerId || !pickupPoint || !dropoffPoint) {
            res.status(400).json({ error: "Missing required fields (customerId, pickupPoint, dropoffPoint)" });
            return;
        }

        const { prisma } = await import('./utils/pg.js');
        
        // สำหรับการทดสอบ: ดึง Customer คนแรกในระบบมาใช้เพื่อป้องกัน Foreign Key Error
        const defaultCustomer = await prisma.customer.findFirst();
        const validCustomerId = defaultCustomer ? defaultCustomer.id : customerId;

        // สุ่มเลข Tracking No ใหม่ เช่น TH12345
        const trackingNo = `TH${Math.floor(Math.random() * 90000) + 10000}`;

        const newOrder = await prisma.order.create({
            data: {
                trackingNo,
                pickupPoint,
                dropoffPoint,
                customerId: validCustomerId,
                status: 'PENDING'
            }
        });

        mainLogger.info(`สร้างออเดอร์ใหม่สำเร็จใน DB`, { trackingNo, service: 'OrderService' });

        // ปล่อย Event เข้า Message Broker (RabbitMQ)
        await publishEvent('order.created', { orderId: newOrder.id, trackingNo, pickupPoint, dropoffPoint }, trackingNo);

        res.json({ message: "Order Created and Event Published", trackingNo });
    } catch (error) {
        mainLogger.error(`Error creating order: ${(error as Error).message}`, { service: 'OrderService' });
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// ---------------------------------------------------------
// [Phase 6] Delivery Service (Consumer)
// ---------------------------------------------------------
function startDeliveryService() {
    consumeEvent('order_created_queue', async (msg, correlationId, ack, nack) => {
        const loggerDelivery = getLogger('DeliveryService');
        loggerDelivery.info(`ได้รับ Event order.created กำลังตรวจสอบสถานะ...`, { trackingNo: correlationId });

        const { prisma } = await import('./utils/pg.js');

        // 1. Idempotency Check
        const order = await prisma.order.findUnique({ where: { trackingNo: correlationId } });
        if (!order) {
            loggerDelivery.warn(`ไม่พบออเดอร์ในระบบ (อาจถูกลบไปแล้ว) ทำลายข้อความทิ้ง`, { trackingNo: correlationId });
            ack();
            return;
        }

        if (order.status !== 'PENDING') {
            loggerDelivery.warn(`ข้ามการทำงาน เนื่องจากออเดอร์ถูกประมวลผลไปแล้ว (สถานะ: ${order.status})`, { trackingNo: correlationId });
            ack();
            return;
        }

        // 2. จำลองการเดินทาง (IN_TRANSIT)
        loggerDelivery.info(`สถานะถูกต้อง (PENDING) -> กำลังส่งรถไปเข้ารับพัสดุ...`, { trackingNo: correlationId });
        await prisma.order.update({ where: { trackingNo: correlationId }, data: { status: 'IN_TRANSIT' } });
        
        await new Promise(resolve => setTimeout(resolve, 3000)); // หน่วงเวลาจำลองการเดินทาง 3 วินาที

        // 3. จำลองการส่งสำเร็จ (DELIVERED)
        await prisma.order.update({ where: { trackingNo: correlationId }, data: { status: 'DELIVERED' } });
        loggerDelivery.info(`จัดส่งถึงมือลูกค้าสำเร็จ!`, { trackingNo: correlationId });

        // 4. จบการทำงาน (ส่ง ACK ไปบอก RabbitMQ ให้ลบข้อความได้)
        ack();
    });
}

// สั่งให้ Web Server เริ่มทำงาน
app.listen(port, () => {
    console.log(`\n🚀 Web Server is running!`);
    console.log(`👉 เปิดบราวเซอร์ไปที่: http://localhost:${port}`);
    console.log(`(กด Ctrl+C เพื่อหยุดการทำงาน)`);
});
