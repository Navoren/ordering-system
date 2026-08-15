import { z } from 'zod';

export interface Product{
    id: number,
    name: string,
    description: string | null,
    price: number,
    stock_qty: number
}

export const createProductSchema = z.object({
    name: z.string().trim().min(1),
    description: z.string().max(250).optional(),
    price: z.number().nonnegative(),
    stock_qty: z.number().int().nonnegative(),
});

export type CreateProductDTO = z.infer<typeof createProductSchema>;