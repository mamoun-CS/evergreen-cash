import { z } from "zod";

export const personSchema = z.object({
  fullName: z.string().trim().min(2, "أدخل الاسم الكامل"),
  phone: z.string().trim().min(3, "أدخل رقم الهاتف"),
  address: z.string().optional(),
  notes: z.string().optional(),
});

export const transactionSchema = z.object({
  type: z.enum([
    "income",
    "expense",
    "advance_given",
    "advance_settlement",
    "advance_refund",
    "opening_balance",
    "adjustment",
  ]),
  amount: z.string().min(1, "أدخل المبلغ"),
  personId: z.string().optional(),
  category: z.string().optional(),
  description: z.string().trim().min(2, "أدخل الوصف"),
  notes: z.string().optional(),
  occurredAt: z.string().min(1, "أدخل التاريخ"),
  adjustmentDirection: z.enum(["increase", "decrease"]).optional(),
});

export const invoiceSchema = z.object({
  customerName: z.string().trim().min(2, "أدخل اسم العميل"),
  customerPhone: z.string().optional(),
  customerId: z.string().optional(),
  issuedAt: z.string().min(1),
  notes: z.string().optional(),
  discount: z.string().default("0"),
  tax: z.string().default("0"),
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(1, "وصف البند مطلوب"),
        quantity: z.string().min(1),
        unitPrice: z.string().min(1),
      }),
    )
    .min(1, "أضف بنداً واحداً على الأقل"),
});
