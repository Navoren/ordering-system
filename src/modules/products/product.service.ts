import * as productRepository from './product.repository';
import type { CreateProductDTO } from './product.types';

export async function createProduct(input : CreateProductDTO){
    if (input.name.trim().length === 0) {
        throw new Error("Product name is required");
    }

    if (input.price < 0) {
        throw new Error("Product price cannot be negative");
    }

    if (input.stock_qty < 0) {
        throw new Error("Stock qty cannot be negative");
    }
    return productRepository.createProduct(input);
}

export async function getProductById(id: number) {
    return productRepository.getProductById(id);
}