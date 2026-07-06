import amqp from 'amqplib';
import type { Connection, Channel, ConsumeMessage } from 'amqplib';
import { getLogger } from './logger.js';

const logger = getLogger('RabbitMQ');

let connection: Connection | null = null;
let channel: Channel | null = null;

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';
const EXCHANGE_NAME = 'logistics_exchange';
const ORDER_QUEUE = 'order_created_queue';

export async function connectRabbitMQ() {
    try {
        connection = await amqp.connect(RABBITMQ_URL);
        channel = await connection.createChannel();

        // สร้าง Exchange แบบ Direct
        await channel.assertExchange(EXCHANGE_NAME, 'direct', { durable: true });
        
        // สร้าง Queue แบบ Durable (ทนทาน ไม่หายเมื่อปิดโปรแกรม)
        await channel.assertQueue(ORDER_QUEUE, { durable: true });
        
        // ผูก Queue เข้ากับ Exchange
        await channel.bindQueue(ORDER_QUEUE, EXCHANGE_NAME, 'order.created');

        logger.info('เชื่อมต่อ RabbitMQ สำเร็จ และเตรียม Queue พร้อมใช้งาน');
    } catch (error) {
        logger.error(`เชื่อมต่อ RabbitMQ ไม่สำเร็จ: ${(error as Error).message}`);
        // สำหรับ Production อาจจะต้องมี Retry Logic
    }
}

export async function publishEvent(routingKey: string, message: any, correlationId: string) {
    if (!channel) {
        logger.error('ยังไม่ได้เชื่อมต่อ RabbitMQ ไม่สามารถ Publish ได้');
        return;
    }

    try {
        const payload = Buffer.from(JSON.stringify(message));
        
        // ส่งข้อความไปที่ Exchange แบบ Persistent (เก็บลงดิสก์)
        channel.publish(EXCHANGE_NAME, routingKey, payload, {
            persistent: true,
            correlationId: correlationId // ฝัง ID เพื่อนำไปใช้ Tracking ใน Log
        });
        
        logger.info(`ส่ง Event [${routingKey}] ไปยัง RabbitMQ สำเร็จ`, { trackingNo: correlationId });
    } catch (error) {
        logger.error(`ส่ง Event ไม่สำเร็จ: ${(error as Error).message}`, { trackingNo: correlationId });
    }
}

export async function consumeEvent(
    queueName: string, 
    onMessage: (msg: any, correlationId: string, ack: () => void, nack: () => void) => Promise<void>
) {
    if (!channel) {
        logger.error('ยังไม่ได้เชื่อมต่อ RabbitMQ ไม่สามารถ Consume ได้');
        return;
    }

    // กำหนดให้ดึงข้อความมาทำทีละ 1 ข้อความ (ป้องกันการโหลดหนัก)
    await channel.prefetch(1);

    logger.info(`เริ่มดักจับ Event จาก Queue: ${queueName}`);

    channel.consume(queueName, async (msg: ConsumeMessage | null) => {
        if (msg) {
            const correlationId = msg.properties.correlationId || 'UNKNOWN';
            try {
                const content = JSON.parse(msg.content.toString());
                
                // ฟังก์ชันสำหรับตอบกลับว่าทำงานสำเร็จ (ลบออกจาก Queue)
                const ack = () => {
                    channel!.ack(msg);
                    logger.info(`ACK ข้อความสำเร็จ`, { trackingNo: correlationId });
                };
                
                // ฟังก์ชันสำหรับตอบกลับว่าทำงานล้มเหลว (ส่งกลับเข้า Queue ใหม่)
                const nack = () => {
                    channel!.nack(msg);
                    logger.warn(`NACK ข้อความ (Requeue)`, { trackingNo: correlationId });
                };

                await onMessage(content, correlationId, ack, nack);
            } catch (error) {
                logger.error(`เกิดข้อผิดพลาดในการประมวลผลข้อความ: ${(error as Error).message}`, { trackingNo: correlationId });
                // หาก Error นอกเหนือความคาดหมาย ให้ NACK เพื่อส่งกลับไปทำใหม่
                channel.nack(msg);
            }
        }
    }, {
        noAck: false // บังคับให้ต้อง Manual ACK เสมอ เพื่อความปลอดภัยของข้อมูล
    });
}
