import type { Request, Response, NextFunction } from "express";
import * as OrderService from "./order.service";

export async function createOrder(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const order = await OrderService.createOrder(req.body);
    
        res.status(201).json(order);
    } catch (error) {
        next(error);
    }
}

export async function getOrderById(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const id = await Number(req.params.id);

        if (!Number.isInteger(id)) {
            res.status(400).json({
                message: "Invalid order id"
            });
            return;
        }

        const order = await OrderService.getOrderById(id);

        if(!order){
            res.status(400).json({
                message: "Order not found",
            });
            return;
        }

        res.json(order);
    } catch (error) {
        next(error);
    }
}