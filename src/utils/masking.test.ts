import { describe, it, expect } from 'vitest';
import { maskPII } from './masking.js';

describe('PII Masking Utility', () => {
    
    describe('1. Email Masking', () => {
        it('should mask a standard email address', () => {
            const input = "ติดต่อ email-test@gmail-domain.com";
            const expected = "ติดต่อ [EMAIL_HIDDEN]";
            expect(maskPII(input)).toBe(expected);
        });
    });

    describe('2. Phone Masking (10 digits starting with 0)', () => {
        it('should mask standard 10-digit phone numbers', () => {
            const input = "เบอร์ผมคือ 0812345678 ครับ";
            const expected = "เบอร์ผมคือ [PHONE_HIDDEN] ครับ";
            expect(maskPII(input)).toBe(expected);
        });

        it('should mask phone numbers with hyphens WITHOUT removing other hyphens in text', () => {
            const input = "เบอร์ผมคือ 081-234-5678 รหัส ID-99";
            const expected = "เบอร์ผมคือ [PHONE_HIDDEN] รหัส ID-99";
            expect(maskPII(input)).toBe(expected);
        });
    });

    describe('3. Bank Account Masking (10 digits)', () => {
        it('should mask standard 10-digit numbers as bank accounts', () => {
            const input = "โอนเงินไปที่บัญชี 1234567890";
            const expected = "โอนเงินไปที่บัญชี [BANK_ACCOUNT_HIDDEN]";
            expect(maskPII(input)).toBe(expected);
        });

        it('should mask 10-digit numbers with random hyphens', () => {
            const input = "โอนเงินไปที่บัญชี 123-4-56789-0";
            const expected = "โอนเงินไปที่บัญชี [BANK_ACCOUNT_HIDDEN]";
            expect(maskPII(input)).toBe(expected);
        });

        it('should mask 10-digit numbers with Context Keywords (บช, บ.ช., บช.)', () => {
            const inputs = [
                { in: "บช 12-3456-7890", out: "บช [BANK_ACCOUNT_HIDDEN]" },
                { in: "บ.ช. 1234-56789-0", out: "บ.ช. [BANK_ACCOUNT_HIDDEN]" },
                { in: "บช. 123-456-7890", out: "บช. [BANK_ACCOUNT_HIDDEN]" }
            ];
            
            inputs.forEach(tc => {
                expect(maskPII(tc.in)).toBe(tc.out);
            });
        });
    });

    describe('4. Mixed Scenarios & Edge Cases', () => {
        it('should correctly distinguish between phone and bank account in the same sentence', () => {
            const input = "ตัดยอดเงินบัญชีนี้ยัง 12-3456-7890 โทร 081-234-5678 ชื่อ AB-3";
            const expected = "ตัดยอดเงินบัญชีนี้ยัง [BANK_ACCOUNT_HIDDEN] โทร [PHONE_HIDDEN] ชื่อ AB-3";
            expect(maskPII(input)).toBe(expected);
        });

        it('should handle the user failing case properly preserving hyphens elsewhere', () => {
            const input = "เช็คสเตตัส จ่ายเงิน บช 1234567890 ,โทร 0955000055 , ชื่อ AT-02";
            const expected = "เช็คสเตตัส จ่ายเงิน บช [BANK_ACCOUNT_HIDDEN] ,โทร [PHONE_HIDDEN] , ชื่อ AT-02";
            expect(maskPII(input)).toBe(expected);
        });
    });
});
