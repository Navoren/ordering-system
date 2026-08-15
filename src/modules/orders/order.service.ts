import { pool } from '../../db/client';
import * as orderRepository from "./order.repository";
import type { CreateOrderDTO } from './order.types';

export async function createOrder(input: CreateOrderDTO) {
    if (!Number.isInteger(input.product_id)) {
        throw new Error('Invalid product_id');
    }

    if (!Number.isInteger(input.qty) || input.qty <= 0) {
        throw new Error('Qty. must be greater than zero');
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const product = await orderRepository.decrementStock(
            client,
            input.product_id,
            input.qty
        );

        if (!product) {
            throw new Error("Insufficient stock or product not found");
        }

        const order = await orderRepository.createOrder(
            client,
            input.product_id,
            input.qty
        );

        await client.query("COMMIT");

        return order;
    }catch(error){
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