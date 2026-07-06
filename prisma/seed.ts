import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log("🌱 [DB] เริ่มสร้างข้อมูลพัสดุจำลองใน PostgreSQL...");

    // 1. สร้างลูกค้า
    const customer1 = await prisma.customer.create({
        data: {
            name: "สมชาย ใจดี",
            phone: "0812345678"
        }
    });

    const customer2 = await prisma.customer.create({
        data: {
            name: "สมหญิง รักเรียน",
            phone: "0998887777"
        }
    });

    // 2. สร้างพัสดุ (Orders) และผูกกับลูกค้า
    await prisma.order.createMany({
        data: [
            {
                trackingNo: "TH12345",
                pickupPoint: "คลังสินค้า A",
                dropoffPoint: "กรุงเทพมหานคร",
                status: "DELIVERED",
                customerId: customer1.id
            },
            {
                trackingNo: "TH67890",
                pickupPoint: "คลังสินค้า B",
                dropoffPoint: "เชียงใหม่",
                status: "IN_TRANSIT",
                customerId: customer2.id
            },
            {
                trackingNo: "TH11111",
                pickupPoint: "สาขาต้นทาง",
                dropoffPoint: "ขอนแก่น",
                status: "PENDING",
                customerId: customer1.id
            }
        ]
    });

    console.log("✅ [DB] สร้างข้อมูลจำลองสำเร็จ!");
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
