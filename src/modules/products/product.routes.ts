import { Router } from "express";
import { createProduct, getProductById } from './product.controller.js';
import { validateBody } from '../../middlewares/validate.middleware.js';
import { createProductSchema } from './product.types.js';

const router = Router();

router.post('/', validateBody(createProductSchema), createProduct);
router.get('/:id', getProductById);

export default router;
