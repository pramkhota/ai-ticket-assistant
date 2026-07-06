/**
 * ฟังก์ชันนี้ใช้สำหรับการปิดบังข้อมูลส่วนตัว (PII Masking)
 * เป็นด่านหน้าสำคัญ เพื่อป้องกันไม่ให้ข้อมูลความลับลูกค้าหลุดไปยังระบบภายนอก (LLM API)
 */
export function maskPII(text: string): string {
    // 1. Regex สำหรับหา Email 
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

    // 2. Regex สำหรับหาบัญชีจากคำบริบท (บัญชี, บช, บ.ช., บช.)
    // รองรับการเว้นวรรคหรือขีด (-) ภายในตัวเลข 10 หลัก
    const contextBankRegex = /(บัญชี|บช|บ\.ช\.|บช\.)[\s:]*(\d(?:[-\s]*\d){9})(?=[^\d]|$)/g;
    
    // 3. Regex สำหรับหาเบอร์โทรศัพท์ (ต้องขึ้นต้นด้วย 0 และมี 10 หลักรวมกัน)
    const phoneRegex = /(^|[^\d])(0(?:[-\s]*\d){9})(?=[^\d]|$)/g;

    // 4. Regex สำหรับหาเลขบัญชีธนาคาร (ตัวเลข 10 หลักรวมกัน)
    const bankRegex = /(^|[^\d])(\d(?:[-\s]*\d){9})(?=[^\d]|$)/g;

    let maskedText = text;

    maskedText = maskedText.replace(emailRegex, '[EMAIL_HIDDEN]');
    maskedText = maskedText.replace(contextBankRegex, '$1 [BANK_ACCOUNT_HIDDEN]');
    maskedText = maskedText.replace(phoneRegex, '$1[PHONE_HIDDEN]');
    maskedText = maskedText.replace(bankRegex, '$1[BANK_ACCOUNT_HIDDEN]');

    return maskedText;
}
