import express from "express";
import cors from "cors";
import productRoutes from "./modules/products/product.routes";
import orderRoutes from "./modules/orders/order.routes";
import { errorMiddleware } from "./middlewares/error.middleware";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use('/products', productRoutes);
app.use('/orders',orderRoutes);

app.use(errorMiddleware);
export default app;