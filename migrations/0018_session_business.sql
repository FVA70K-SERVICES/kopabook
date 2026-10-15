ALTER TABLE sessions ADD COLUMN business_id INTEGER REFERENCES businesses(id);
