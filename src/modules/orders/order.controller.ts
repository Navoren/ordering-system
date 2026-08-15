import type { Request, Response, NextFunction } from "express";
import * as OrderService from "./order.service.js";
import { BadRequestError, NotFoundError } from "../../errors.js";

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
        const id = Number(req.params.id);

        if (!Number.isInteger(id)) {
            next(new BadRequestError("Invalid order id"));
            return;
        }

        const order = await OrderService.getOrderById(id);

        if (!order) {
            next(new NotFoundError("Order not found"));
            return;
        }

        res.json(order);
    } catch (error) {
        next(error);
    }
}