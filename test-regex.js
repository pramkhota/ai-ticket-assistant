const tests = [
    "เบอร์ผมคือ 081-234-5678 รหัส ID-99",
    "โอนเงินไปที่บัญชี 123-4-56789-0",
    "บช 12-3456-7890",
    "เช็คสเตตัส จ่ายเงิน บช 1234567890 ,โทร 0955000055 , ชื่อ AT-02",
    "email-test@gmail-domain.com"
];

function maskPII(text) {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const contextBankRegex = /(บัญชี|บช|บ\.ช\.|บช\.)[\s:]*(\d(?:[-\s]*\d){9})(?=[^\d]|$)/g;
    const phoneRegex = /(^|[^\d])(0(?:[-\s]*\d){9})(?=[^\d]|$)/g;
    const bankRegex = /(^|[^\d])(\d(?:[-\s]*\d){9})(?=[^\d]|$)/g;

    let maskedText = text;
    maskedText = maskedText.replace(emailRegex, '[EMAIL_HIDDEN]');
    maskedText = maskedText.replace(contextBankRegex, '$1 [BANK_ACCOUNT_HIDDEN]');
    maskedText = maskedText.replace(phoneRegex, '$1[PHONE_HIDDEN]');
    maskedText = maskedText.replace(bankRegex, '$1[BANK_ACCOUNT_HIDDEN]');

    return maskedText;
}

tests.forEach(t => console.log("IN :", t, "\nOUT:", maskPII(t), "\n---"));
