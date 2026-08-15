import { pool } from '../../db/client.js';
import * as orderRepository from "./order.repository.js";
import type { CreateOrderDTO } from './order.types.js';
import { ConflictError, NotFoundError } from '../../errors.js';

export async function createOrder(input: CreateOrderDTO) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const product = await orderRepository.decrementStock(
            client,
            input.product_id,
            input.qty
        );

        if (!product) {
            // The conditional UPDATE in decrementStock returns no row both when
            // the product doesn't exist and when it exists but lacks stock.
            // Disambiguate with a cheap existence check, in the same
            // transaction, so callers get 404 vs 409 instead of one blended error.
            const exists = await orderRepository.productExists(client, input.product_id);

            if (!exists) {
                throw new NotFoundError(
                    `Product ${input.product_id} not found`
                );
            }

            throw new ConflictError(
                `Insufficient stock for product ${input.product_id}`
            );
        }

        const order = await orderRepository.createOrder(
            client,
            input.product_id,
            input.qty
        );

        await client.query("COMMIT");

        return order;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function getOrderById(orderId: number) {
  const client = await pool.connect();

  try {
    return await orderRepository.getOrderById(client, orderId);
  } finally {
    client.release();
  }
}
