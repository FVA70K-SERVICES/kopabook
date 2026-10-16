-- 0024 Track change given on each sale.
ALTER TABLE sales ADD COLUMN change_given REAL DEFAULT 0;
