import winston from 'winston';

const { combine, timestamp, printf, colorize } = winston.format;

// รูปแบบการแสดงผล Log: [เวลา] [ชื่อ Service] [Tracking No (ถ้ามี)]: ข้อความ
const myFormat = printf(({ level, message, timestamp, service, trackingNo }) => {
    const trackingStr = trackingNo ? `[${trackingNo}] ` : '';
    const serviceStr = service ? `[${service}] ` : '';
    return `${timestamp} ${level}: ${serviceStr}${trackingStr}${message}`;
});

export const logger = winston.createLogger({
    level: 'info',
    format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.json() // เก็บลงไฟล์เป็น JSON เพื่อให้วิเคราะห์ง่าย
    ),
    transports: [
        // แสดงผลผ่าน Console (หน้าจอดำ) ให้มนุษย์อ่านง่าย
        new winston.transports.Console({
            format: combine(
                colorize(),
                timestamp({ format: 'HH:mm:ss' }),
                myFormat
            )
        }),
        // บันทึกลงไฟล์ เพื่อทำ Audit / Monitoring
        new winston.transports.File({ filename: 'logs/system.log' })
    ],
});

export function getLogger(serviceName: string) {
    return logger.child({ service: serviceName });
}
