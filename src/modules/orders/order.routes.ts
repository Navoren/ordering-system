import { Router } from "express";
import { createOrder, getOrderById } from './order.controller.js';
import { validateBody } from '../../middlewares/validate.middleware.js';
import { createOrderSchema } from './order.types.js';

const router = Router();

router.post('/', validateBody(createOrderSchema), createOrder);
router.get('/:id', getOrderById);

export default router;