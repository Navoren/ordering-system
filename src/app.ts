import express from "express";
import cors from "cors";
import productRoutes from "./modules/products/product.routes.js";
import orderRoutes from "./modules/orders/order.routes.js";
import { errorMiddleware } from "./middlewares/error.middleware.js";
import { requestContextMiddleware } from "./middlewares/requestContext.middleware.js";
import { requestLoggingMiddleware } from "./middlewares/requestLogging.middleware.js";
import { getMetrics } from "./metrics/request.metrics.js";

const app = express();

app.use(requestContextMiddleware);
app.use(requestLoggingMiddleware);
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use('/products', productRoutes);
app.use('/orders',orderRoutes);

app.get("/metrics", (_req, res) => {
  const metrics = getMetrics();
  res.json(metrics);
});

app.use(errorMiddleware);
export default app;