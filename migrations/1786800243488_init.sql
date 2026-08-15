-- Up Migration

CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    stock_qty INT NOT NULL CHECK (stock_qty >= 0)
);

CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    product_id INT NOT NULL REFERENCES products(id),
    qty INT NOT NULL CHECK (qty > 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- orders.product_id is a foreign key that will be filtered/joined on; Postgres
-- does not index FK columns automatically.
CREATE INDEX idx_orders_product_id ON orders(product_id);

-- Supports future "scan for pending orders" style queries (order processing,
-- reconciliation) without a sequential scan.
CREATE INDEX idx_orders_status_created_at ON orders(status, created_at);

-- Down Migration

DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS products;
