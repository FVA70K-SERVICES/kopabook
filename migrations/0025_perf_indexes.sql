-- 0025 Performance indexes for scale. Every hot query filters by business_id,
-- so composite indexes keep dashboards, histories, and ledgers fast as data grows.
CREATE INDEX IF NOT EXISTS idx_sales_biz_created ON sales(business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sales_biz_number ON sales(business_id, sale_number);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_payments_biz_sale ON payment_records(business_id, sale_id);
CREATE INDEX IF NOT EXISTS idx_ledger_customer ON customer_ledger(customer_id);
CREATE INDEX IF NOT EXISTS idx_expenses_biz_date ON expenses(business_id, incurred_on);
CREATE INDEX IF NOT EXISTS idx_products_biz ON products(business_id, is_active);
CREATE INDEX IF NOT EXISTS idx_customers_biz ON customers(business_id);
CREATE INDEX IF NOT EXISTS idx_members_biz_user ON business_members(business_id, user_id);
