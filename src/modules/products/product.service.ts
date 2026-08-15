import * as productRepository from './product.repository.js';
import type { CreateProductDTO } from './product.types.js';

// Input shape/range checks now happen once, at the route boundary, via
// validateBody(createProductSchema) — see product.routes.ts. Re-checking the
// same constraints here by hand was how this drifted out of sync before
// (description wasn't checked at all, and this ran even though the zod
// schema already covered it more completely).
export async function createProduct(input: CreateProductDTO) {
    return productRepository.createProduct(input);
}

export async function getProductById(id: number) {
    return productRepository.getProductById(id);
}