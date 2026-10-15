ALTER TABLE expenses ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id);
ALTER TABLE expenses ADD COLUMN supplier_purchase_id INTEGER;
