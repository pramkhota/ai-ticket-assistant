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
import nodemailer from 'nodemailer';

const mainLogger = getLogger('Main');

let etherealTransporter: nodemailer.Transporter | null = null;
async function getTransporter() {
    if (etherealTransporter) return etherealTransporter;
    const testAccount = await nodemailer.createTestAccount();
    etherealTransporter = nodemailer.createTransport({
        host: "smtp.ethereal.email",
        port: 587,
        secure: false,
        auth: { user: testAccount.user, pass: testAccount.pass },
    });
    return etherealTransporter;
}

const app = express();
const port = 3000;

// เชื่อมต่อ Database และเตรียมพร้อม RAG
connectDB().then(() => initPolicyVectors());

// เชื่อมต่อ RabbitMQ และเปิดใช้งาน Delivery Service
connectRabbitMQ().then(() => {
    startDeliveryService();
    startNotificationService();
});

// ให้ Express สามารถอ่านข้อมูลที่ส่งมาเป็นแบบ JSON ได้
app.use(express.json());

// บอกให้ Express เอาไฟล์ในโฟลเดอร์ public (เช่น index.html) ไปแสดงผลเมื่อเข้าเว็บ
app.use(express.static(path.join(import.meta.dirname, '../public')));

// ---------------------------------------------------------
// Health Check Endpoint
// ---------------------------------------------------------
// @ts-ignore
app.get('/api/health', async (req: Request, res: Response) => {
    let pgStatus = 'Unknown';
    let mongoStatus = 'Unknown';
    let rabbitStatus = 'Unknown';
    let overallHealthy = true;

    try {
        const { prisma } = await import('./utils/pg.js');
        await prisma.$queryRaw`SELECT 1`;
        pgStatus = 'Connected';
    } catch (e) {
        pgStatus = 'Disconnected';
        overallHealthy = false;
    }

    try {
        const mongoose = await import('mongoose');
        const readyState = mongoose.default ? mongoose.default.connection.readyState : mongoose.connection.readyState;
        mongoStatus = readyState === 1 ? 'Connected' : 'Disconnected';
        if (mongoStatus === 'Disconnected') overallHealthy = false;
    } catch (e) {
        mongoStatus = 'Disconnected';
        overallHealthy = false;
    }

    try {
        const { getChannel } = await import('./utils/rabbitmq.js');
        const channel = getChannel ? await getChannel() : null;
        rabbitStatus = channel ? 'Connected' : 'Disconnected';
        if (!channel) overallHealthy = false;
    } catch (e) {
        rabbitStatus = 'Disconnected';
        overallHealthy = false;
    }

    const response = {
        healthy: overallHealthy,
        services: {
            postgresql: pgStatus,
            mongodb: mongoStatus,
            rabbitmq: rabbitStatus
        }
    };

    if (overallHealthy) {
        res.status(200).json(response);
    } else {
        res.status(503).json(response);
    }
});

// ---------------------------------------------------------
// สร้าง REST API Endpoint (รองรับ HTTP POST ที่ /api/ticket)
// ---------------------------------------------------------
// @ts-ignore - Ignore type error if Request/Response has issue
app.post('/api/ticket', async (req: Request, res: Response) => {
    try {
        // Receive message from Frontend
        const rawTicket = req.body.ticket;
        
        if (!rawTicket) {
             res.status(400).json({ error: "Missing ticket text" });
             return;
        }

        console.log(" [API] Received new message from web client");

        // 1. นำข้อความไปเซ็นเซอร์ PII (AI Governance)
        const safeTicket = maskPII(rawTicket);

        // 2. RAG: ค้นหานโยบายบริษัทที่เกี่ยวข้อง
        const relevantPolicy = await findRelevantPolicy(safeTicket);

        // --- NEW: Check PostgreSQL Order ---
        const trackingMatch = rawTicket.match(/\bTH\d{5}\b/i);
        let orderContext = null;
        if (trackingMatch) {
            const trackingNo = trackingMatch[0].toUpperCase();
            console.log(` [PG] Found Tracking No ${trackingNo} in message. Searching PostgreSQL...`);
            
            // ใช้ try-catch ครอบไว้เผื่อกรณียังไม่ได้รัน PostgreSQL หรือยังไม่ได้ Migrate
            try {
                const { prisma } = await import('./utils/pg.js');
                const order = await prisma.order.findUnique({
                    where: { trackingNo: trackingNo },
                    include: { customer: true }
                });

                if (order) {
                    orderContext = `Parcel Info ${order.trackingNo}: Current status is "${order.status}" (Recipient: ${order.customer.name}, Dropoff: ${order.dropoffPoint})`;
                    console.log(` [PG] ดึงParcel Infoสำเร็จ: สถานะ ${order.status}`);
                } else {
                    console.log(`❌ [PG] ไม่พบParcel Info ${trackingNo} in the system`);
                }
            } catch (pgError) {
                console.error("⚠️ [PG] Failed to fetch from PostgreSQL (is DB connected?):", (pgError as Error).message);
            }
        }

        // 3. ส่งข้อความที่ปลอดภัย, นโยบาย และข้อมูล DB ไปให้ AI สรุป
        console.log(" [API] Sending to Gemini for processing...");
        const aiResponse = await summarizeTicket(safeTicket, relevantPolicy, orderContext);

        // 4. บันทึกข้อมูลลง MongoDB
        const newTicket = new Ticket({
            originalText: rawTicket,
            safeText: safeTicket,
            aiSummary: aiResponse,
            retrievedPolicyTitle: relevantPolicy ? relevantPolicy.title : null
        });
        await newTicket.save();
        console.log(" [DB] Successfully saved Ticket to Database! (ID:", newTicket._id, ")");

        // 5. ส่งคำตอบกลับไปให้ Frontend เป็นรูปแบบ JSON
        res.json({
            safeTicket: safeTicket,
            aiResponse: aiResponse,
            retrievedPolicy: relevantPolicy ? relevantPolicy.title : null
        });
        
        console.log(" [API] Processing completed and sent response to web client\n");

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
        const { customerId, customerEmail, pickupPoint, dropoffPoint } = req.body;
        if (!pickupPoint || !dropoffPoint) {
            res.status(400).json({ error: "Missing required fields (pickupPoint, dropoffPoint)" });
            return;
        }

        const { prisma } = await import('./utils/pg.js');
        
        // สำหรับการทดสอบ: ดึง Customer คนแรกin the systemมาใช้เพื่อป้องกัน Foreign Key Error
        const defaultCustomer = await prisma.customer.findFirst();
        const validCustomerId = defaultCustomer ? defaultCustomer.id : customerId || "temp-id";

        if (defaultCustomer && customerEmail) {
            await prisma.customer.update({ where: { id: validCustomerId }, data: { email: customerEmail } });
        }

        // Generate random Tracking No (e.g., TH12345)
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

        // Create Event Log indicating OrderService Success
        await prisma.orderEventLog.create({
            data: {
                orderId: newOrder.id,
                serviceName: 'OrderService',
                status: 'SUCCESS'
            }
        });


        mainLogger.info(`Successfully created new order in DB`, { trackingNo, service: 'OrderService' });

        // Publish Event to Message Broker (RabbitMQ)
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
        const { prisma } = await import('./utils/pg.js');
        const order = await prisma.order.findUnique({ where: { trackingNo: correlationId } });
        if (!order) { ack(); return; }

        try {
            // Check if already processed
            const existingLog = await prisma.orderEventLog.findFirst({
                where: { orderId: order.id, serviceName: 'DeliveryService', status: 'SUCCESS' }
            });
            if (existingLog) {
                loggerDelivery.warn('Skipping as DeliveryService already completed successfully', { trackingNo: correlationId });
                ack(); return;
            }

            // Log status as PENDING
            let eventLog = await prisma.orderEventLog.findFirst({
                where: { orderId: order.id, serviceName: 'DeliveryService' }
            });
            if (!eventLog) {
                eventLog = await prisma.orderEventLog.create({
                    data: { orderId: order.id, serviceName: 'DeliveryService', status: 'PENDING' }
                });
            }

            loggerDelivery.info('Dispatching vehicle for pickup...', { trackingNo: correlationId });
            await prisma.order.update({ where: { trackingNo: correlationId }, data: { status: 'IN_TRANSIT' } });
            await new Promise(resolve => setTimeout(resolve, 3000)); // Delay 3 seconds
            await prisma.order.update({ where: { trackingNo: correlationId }, data: { status: 'DELIVERED' } });

            // Update Log to SUCCESS
            await prisma.orderEventLog.update({
                where: { id: eventLog.id },
                data: { status: 'SUCCESS' }
            });

            loggerDelivery.info('Delivered to customer successfully!', { trackingNo: correlationId });
            ack();
        } catch (err) {
            loggerDelivery.error('DeliveryService Failed', { trackingNo: correlationId });
            const eventLog = await prisma.orderEventLog.findFirst({ where: { orderId: order.id, serviceName: 'DeliveryService' } });
            if (eventLog) {
                await prisma.orderEventLog.update({
                    where: { id: eventLog.id },
                    data: { status: 'FAILED', errorMessage: (err as Error).message }
                });
            }
            nack();
        }
    });
}

// ---------------------------------------------------------
// [Phase 7] Notification Service (Consumer)
// ---------------------------------------------------------
function startNotificationService() {
    consumeEvent('notification_queue', async (msg, correlationId, ack, nack) => {
        const loggerNotif = getLogger('NotificationService');
        const { prisma } = await import('./utils/pg.js');
        const order = await prisma.order.findUnique({ where: { trackingNo: correlationId }, include: { customer: true } });
        if (!order) { ack(); return; }

        try {
            // Check if already processed
            const existingLog = await prisma.orderEventLog.findFirst({
                where: { orderId: order.id, serviceName: 'NotificationService', status: 'SUCCESS' }
            });
            if (existingLog) {
                loggerNotif.warn('Skipping as MASTER email already sent', { trackingNo: correlationId });
                ack(); return;
            }

            let eventLog = await prisma.orderEventLog.findFirst({
                where: { orderId: order.id, serviceName: 'NotificationService' }
            });
            if (!eventLog) {
                eventLog = await prisma.orderEventLog.create({
                    data: { orderId: order.id, serviceName: 'NotificationService', status: 'PENDING' }
                });
            }

            loggerNotif.info('Sending email via Ethereal SMTP...', { trackingNo: correlationId });
            
            const transporter = await getTransporter();
            const subject = `Order Confirmation: ${order.trackingNo}`;
            const htmlContent = `
                <div style="font-family: sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
                    <h2 style="color: #4f46e5;"> Order Confirmation</h2>
                    <p>Hello <strong>${order.customer?.name || 'Customer'}</strong>,</p>
                    <p>We have received your parcel order successfully!</p>
                    <ul>
                        <li><strong>Tracking No:</strong> ${order.trackingNo}</li>
                        <li><strong>Pickup Point:</strong> ${order.pickupPoint}</li>
                        <li><strong>Dropoff Point:</strong> ${order.dropoffPoint}</li>
                    </ul>
                    <p>Thank you for using our service!</p>
                </div>
            `;

            // ส่งอีเมล
            const info = await transporter.sendMail({
                from: '"AI Ticket Assistant" <noreply@ai-ticket.com>',
                to: order.customer?.email || 'customer@example.com',
                subject: subject,
                html: htmlContent,
            });

            const previewUrl = nodemailer.getTestMessageUrl(info) || undefined;

            // บันทึก EmailLog (MASTER)
            await prisma.emailLog.create({
                data: {
                    orderId: order.id,
                    subject: subject,
                    htmlContent: htmlContent,
                    templateType: 'MASTER',
                    status: 'SUCCESS',
                    previewUrl: previewUrl,
                    recipientEmail: order.customer?.email || 'customer@example.com'
                }
            });

            // Update Log to SUCCESS
            await prisma.orderEventLog.update({
                where: { id: eventLog.id },
                data: { status: 'SUCCESS' }
            });

            loggerNotif.info(`Email sent successfully! Preview at: ${previewUrl}`, { trackingNo: correlationId });
            ack();
        } catch (err) {
            loggerNotif.error('NotificationService Failed: ' + (err as Error).message, { trackingNo: correlationId });
            const eventLog = await prisma.orderEventLog.findFirst({ where: { orderId: order.id, serviceName: 'NotificationService' } });
            if (eventLog) {
                await prisma.orderEventLog.update({
                    where: { id: eventLog.id },
                    data: { status: 'FAILED', errorMessage: (err as Error).message }
                });
            }
            // Mock failure. Keep it simple for now.
            ack(); 
        }
    });
}

// ---------------------------------------------------------
// [Phase 7] Dashboard API - Get Events & Retry
// ---------------------------------------------------------
// @ts-ignore
app.get('/api/dashboard/orders', async (req: Request, res: Response) => {
    try {
        const { prisma } = await import('./utils/pg.js');
        const orders = await prisma.order.findMany({
            include: { 
                events: true, 
                customer: true,
                emails: { orderBy: { createdAt: 'desc' } }
            },
            orderBy: { createdAt: 'desc' },
            take: 10
        });
        res.json(orders);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch dashboard data" });
    }
});

// @ts-ignore
app.post('/api/orders/retry/:trackingNo', async (req: Request, res: Response) => {
    try {
        const { trackingNo } = req.params;
        const { prisma } = await import('./utils/pg.js');
        const order = await prisma.order.findUnique({ where: { trackingNo } });
        
        if (!order) {
            res.status(404).json({ error: "Order not found" });
            return;
        }

        mainLogger.info('Manual Retry ถูกกด! ทำการ Replay Event...', { trackingNo });
        // Replay Event กลับเข้าไปใน RabbitMQ
        await publishEvent('order.created', { 
            orderId: order.id, 
            trackingNo: order.trackingNo, 
            pickupPoint: order.pickupPoint, 
            dropoffPoint: order.dropoffPoint 
        }, order.trackingNo);

        res.json({ message: "Retry Event Published successfully" });
    } catch (error) {
        res.status(500).json({ error: "Failed to retry" });
    }
});

// ---------------------------------------------------------
// [Phase 8] API สำหรับกด Resend Email
// ---------------------------------------------------------
// @ts-ignore
app.post('/api/emails/resend/:masterId', async (req: Request, res: Response) => {
    try {
        const { masterId } = req.params;
        const { newEmail } = req.body; // Get new email if provided
        
        const { prisma } = await import('./utils/pg.js');
        const masterEmail = await prisma.emailLog.findUnique({ 
            where: { id: masterId },
            include: { order: { include: { customer: true } } }
        });
        
        if (!masterEmail || masterEmail.templateType !== 'MASTER') {
            res.status(404).json({ error: "Master email not found" });
            return;
        }

        const targetEmail = newEmail || masterEmail.order.customer?.email || 'customer@example.com';
        mainLogger.info(`Resending email to: ${targetEmail}...`);
        
        const transporter = await getTransporter();
        const htmlContent = `
            <div style="background-color: #fffbeb; padding: 10px; text-align: center; font-weight: bold; color: #b45309; margin-bottom: 15px; border-radius: 4px;">
                [Resent] 
                ${newEmail ? `<br><small>(Changed destination from original email to: ${newEmail})</small>` : ''}
            </div>
            ${masterEmail.htmlContent}
        `;

        // ส่งอีเมล
        const info = await transporter.sendMail({
            from: '"AI Ticket Assistant" <noreply@ai-ticket.com>',
            to: targetEmail,
            subject: `[Resend] ${masterEmail.subject}`,
            html: htmlContent,
        });

        const previewUrl = nodemailer.getTestMessageUrl(info) || undefined;

        // Save EmailLog as RETRY
        await prisma.emailLog.create({
            data: {
                orderId: masterEmail.orderId,
                subject: `[Resend] ${masterEmail.subject}`,
                htmlContent: htmlContent,
                templateType: 'RETRY',
                parentId: masterEmail.id,
                status: 'SUCCESS',
                previewUrl: previewUrl,
                recipientEmail: targetEmail
            }
        });

        // Update retryCount in MASTER
        await prisma.emailLog.update({
            where: { id: masterEmail.id },
            data: { retryCount: { increment: 1 } }
        });

        res.json({ message: "Resent Email successfully", previewUrl });
    } catch (error) {
        mainLogger.error(`Error resending email: ${(error as Error).message}`);
        res.status(500).json({ error: "Failed to resend email" });
    }
});

// สั่งให้ Web Server เริ่มทำงาน
if (process.env.NODE_ENV !== 'test') {
    app.listen(port, () => {
        console.log(`\n Web Server is running!`);
        console.log(`👉 Open browser at: http://localhost:${port}`);
        console.log(`(Press Ctrl+C to stop)`);
    });
}

export { app };
