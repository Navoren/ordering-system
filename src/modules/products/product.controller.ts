import { Request, Response, NextFunction } from "express";
import * as ProductService from "./product.service.js";
import { BadRequestError, NotFoundError } from "../../errors.js";

export async function createProduct(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const product = await ProductService.createProduct(req.body);
        res.status(201).json(product);
    } catch (error) {
        next(error);
    }
};

export async function getProductById(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const id = Number(req.params.id);

        if (!Number.isInteger(id)) {
            next(new BadRequestError("Invalid product id"));
            return;
        }

        const product = await ProductService.getProductById(id);

        if (!product) {
            next(new NotFoundError("Product not found"));
            return;
        }

        res.json(product);
    } catch (error) {
        next(error);
    }
};
