import { Request, Response, NextFunction } from "express";
import * as ProductService from "./product.service";

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
        const id = await Number(req.params.id);

        if (!Number.isInteger(id)) {
            res.status(400).json({
                message: "Invalid product id"
            });
            return;
        }

        const product = await ProductService.getProductById(id);

        if(!product){
            res.status(400).json({
                message: "Product not found",
            });
            return;
        }

        res.json(product);
    } catch (error) {
        next(error);
    }
};