import type {PoolClient} from "pg";

export async function productExists(
    client: PoolClient,
    productId: number
){
    const result = await client.query(
        `SELECT id FROM products WHERE id = $1`,
        [productId]
    );

    return result.rows.length > 0;
}

export async function decrementStock(
    client: PoolClient,
    productId: number,
    qty: number
){
    const result = await client.query(
        `
        UPDATE products
        SET stock_qty = stock_qty - $1
        WHERE id = $2 AND stock_qty >= $1
        RETURNING id, name, description, price, stock_qty
        `,
        [qty, productId]
    );

    return result.rows[0] ?? null;
}

export async function createOrder(
    client: PoolClient,
    productId: number,
    qty: number
){
    const result = await client.query(
        `
        INSERT INTO orders (product_id, qty, status)
        VALUES ($1, $2, $3)
        RETURNING *
        `,
        [productId, qty, "confirmed"]
    );

    return result.rows[0];
}

export async function getOrderById(
    client: PoolClient,
    orderId: number
) {
    const result = await client.query(
        `
        SELECT id, product_id, qty, status, created_at, updated_at
        FROM orders
        WHERE id = $1
        `,
        [orderId]
    );

    return result.rows[0] ?? null;
}