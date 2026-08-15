
import { z } from 'zod';

export interface Order {
  id: number;
  product_id: number;
  qty: number;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export const createOrderSchema = z.object({
  product_id: z.number().int().positive(),
  qty: z.number().int().positive(),
});

export type CreateOrderDTO = z.infer<typeof createOrderSchema>;