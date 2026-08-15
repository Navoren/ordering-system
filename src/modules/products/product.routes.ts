import { Router } from "express";
import { createProduct, getProductById } from './product.controller';

const router = Router();

router.post('/', createProduct);
router.get('/:id', getProductById);

export default router;