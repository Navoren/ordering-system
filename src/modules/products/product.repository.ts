import { pool } from "../../db/client.js";
import type { CreateProductDTO, Product } from "./product.types.js";

export async function createProduct(input: CreateProductDTO) {
    const result = await pool.query(
        `
        INSERT INTO products (name, description, price, stock_qty)
        VALUES ($1, $2, $3, $4)
        RETURNING id, name, description, price, stock_qty
        `,
        [input.name, input.description ?? null, input.price, input.stock_qty]
    );
    return result.rows[0] as Product;
}

export async function getProductById(id: number) {
    const result = await pool.query(
        `
        SELECT id, name, description, price, stock_qty
        FROM products
        WHERE id = $1
        `,
        [id]
    );
    return result.rows[0] as Product ?? null;
}